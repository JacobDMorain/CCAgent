import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { createBuiltInProviders } from "@ccagent/provider";
import { DaemonClient } from "@ccagent/daemon-client";
import { MemorySecretStore } from "@ccagent/secrets";
import { createDaemon } from "../../apps/daemon/src/index.js";
import { createMcpTools } from "../../apps/mcp-server/src/index.js";
import { runClaude } from "../../packages/runner/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");
const daemons: Array<{ stop(): Promise<void> }> = [];

describe("review file through MCP", () => {
  afterEach(async () => {
    await Promise.all(daemons.splice(0).map((daemon) => daemon.stop()));
  });

  test("MCP review_file returns fake Claude review result and readable task logs", async () => {
    const fakeClaudePath = join(fixturesDir, "fake-claude.ts");
    const daemon = await createDaemon({
      ...isolatedDaemonOptions(),
      port: 0,
      settings: {
        claude: { path: process.execPath },
        workspace: { allowedRoots: [fixturesDir] },
        proxy: { portStart: 42000, portEnd: 42100 }
      },
      secretStore: new MemorySecretStore(),
      orchestration: {
        runClaude: (input) =>
          runClaude({
            ...input,
            claudeArgsPrefix: [fakeClaudePath]
          })
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    const provider = {
      ...createBuiltInProviders().glm,
      mode: "anthropic-compatible" as const,
      baseUrl: "https://anthropic.fake/v1"
    };
    await client.post("/providers", provider);
    await client.post("/providers/glm/secret", { value: "sk-test" });

    const tools = createMcpTools(client);
    const result = (await tools["ccagent.review_file"].handler({
      provider: "glm",
      model: "glm-5.1",
      cwd: fixturesDir,
      file: "test.md",
      reviewStyle: "full",
      timeoutMs: 5000
    })) as any;

    expect(result.status, JSON.stringify(result)).toBe("ok");
    expect(result.content).toBe("Fake review result for test.md");

    const output = (await tools["ccagent.read_task_output"].handler({
      taskId: result.taskId,
      maxBytes: 1000
    })) as any;
    expect(output.content).toContain("Fake review result for test.md");
  });

  test("redacts API keys from MCP output, GUI task data, and daemon logs", async () => {
    const apiKey = "sk-redaction-secret-123456";
    const daemon = await createDaemon({
      ...isolatedDaemonOptions(),
      port: 0,
      settings: {
        claude: { path: process.execPath },
        workspace: { allowedRoots: [fixturesDir] },
        proxy: { portStart: 42101, portEnd: 42200 }
      },
      secretStore: new MemorySecretStore(),
      orchestration: {
        checkClaudeBinary: async () => "claude 1.0.0",
        allocatePort: async () => ({ port: 42101, release: async () => undefined }),
        startProxy: async (config) => ({
          taskId: config.taskId,
          baseUrl: `http://127.0.0.1:${config.port}`,
          stop: async () => undefined
        }),
        runClaude: async (input) => {
          input.onStdout(`stdout leaked ${apiKey}`);
          input.onStderr(`stderr leaked Bearer ${apiKey}`);
          input.onStdout(`stdout leaked ${input.env.ANTHROPIC_AUTH_TOKEN}`);
          return {
            content: `review leaked ${apiKey} and ${input.env.ANTHROPIC_AUTH_TOKEN}`,
            raw: "{}"
          };
        }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    const provider = {
      ...createBuiltInProviders().deepseek,
      mode: "openai-compatible" as const,
      baseUrl: "https://openai.fake/v1"
    };
    await client.post("/providers", provider);
    await client.post("/providers/deepseek/secret", { value: apiKey });

    const tools = createMcpTools(client);
    const result = (await tools["ccagent.review_file"].handler({
      provider: "deepseek",
      cwd: fixturesDir,
      file: "test.md",
      reviewStyle: "full",
      timeoutMs: 5000
    })) as any;

    expect(result.status, JSON.stringify(result)).toBe("ok");
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain("ccagent-local-");
    expect(result.content).toContain("[REDACTED]");

    const output = (await tools["ccagent.read_task_output"].handler({
      taskId: result.taskId,
      maxBytes: 1000
    })) as any;
    expect(output.content).toContain("[REDACTED]");
    expect(output.content).not.toContain(apiKey);
    expect(output.content).not.toContain("ccagent-local-");

    const guiTask = (await client.get(`/tasks/${result.taskId}`)) as any;
    expect(JSON.stringify(guiTask)).toContain("[REDACTED]");
    expect(JSON.stringify(guiTask)).not.toContain(apiKey);
    expect(JSON.stringify(guiTask)).not.toContain("ccagent-local-");

    const logs = (await client.get(`/tasks/${result.taskId}/logs?maxBytes=4000`)) as any;
    expect(logs.content).toContain("[REDACTED]");
    expect(logs.content).not.toContain(apiKey);
    expect(logs.content).not.toContain("ccagent-local-");
    expect(logs.content).not.toContain(`Bearer ${apiKey}`);
  });
});

function isolatedDaemonOptions() {
  return {
    configPath: join(tmpdir(), `ccagent-e2e-config-${Date.now()}-${Math.random()}.json`),
    databasePath: ":memory:"
  };
}
