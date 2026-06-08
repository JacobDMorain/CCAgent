import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { startProxy, type StartedProxy } from "../src/index.js";

const started: StartedProxy[] = [];

describe("proxy server", () => {
  afterEach(async () => {
    await Promise.all(started.splice(0).map((proxy) => proxy.stop()));
  });

  test("unauthorized request returns 401", async () => {
    const upstream = await startFakeOpenAIProvider();
    const proxy = await startProxy({
      taskId: "task_1",
      localToken: "local-token",
      listenHost: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: upstream.baseUrl,
      upstreamApiKey: "upstream-key",
      upstreamAuth: { header: "Authorization", scheme: "Bearer" },
      model: "glm-5.1",
      streaming: false
    });
    started.push(proxy, upstream);

    const response = await request(`${proxy.baseUrl}/v1/messages`, {
      method: "POST",
      body: JSON.stringify({ model: "glm-5.1", messages: [] })
    });

    expect(response.status).toBe(401);
  });

  test("authorized non-stream request reaches fake provider and converts response", async () => {
    const upstream = await startFakeOpenAIProvider();
    const proxy = await startProxy({
      taskId: "task_1",
      localToken: "local-token",
      listenHost: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: upstream.baseUrl,
      upstreamApiKey: "upstream-key",
      upstreamAuth: { header: "Authorization", scheme: "Bearer" },
      model: "glm-5.1",
      streaming: false
    });
    started.push(proxy, upstream);

    const response = await request(`${proxy.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { Authorization: "Bearer local-token" },
      body: JSON.stringify({
        model: "glm-5.1",
        max_tokens: 100,
        messages: [{ role: "user", content: [{ type: "text", text: "Review" }] }]
      })
    });

    expect(response.status).toBe(200);
    expect(response.json.content[0].text).toBe("Proxy response");
    expect(upstream.requests[0].headers.authorization).toBe("Bearer upstream-key");
    expect(upstream.requests[0].body.messages[0]).toEqual({ role: "user", content: "Review" });
  });

  test("/v1/models returns configured task model", async () => {
    const upstream = await startFakeOpenAIProvider();
    const proxy = await startProxy({
      taskId: "task_1",
      localToken: "local-token",
      listenHost: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: upstream.baseUrl,
      upstreamApiKey: "upstream-key",
      upstreamAuth: { header: "Authorization", scheme: "Bearer" },
      model: "glm-5.1",
      streaming: false
    });
    started.push(proxy, upstream);

    const response = await request(`${proxy.baseUrl}/v1/models`, {
      headers: { Authorization: "Bearer local-token" }
    });

    expect(response.status).toBe(200);
    expect(response.json.data[0].id).toBe("glm-5.1");
  });
});

interface TestResponse {
  status: number;
  json: any;
}

async function request(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<TestResponse> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    json: await response.json().catch(() => undefined)
  };
}

async function startFakeOpenAIProvider(): Promise<
  StartedProxy & { requests: Array<{ headers: http.IncomingHttpHeaders; body: any }> }
> {
  const requests: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "Proxy response" },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2 }
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP server address");
  }

  return {
    taskId: "fake-upstream",
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}
