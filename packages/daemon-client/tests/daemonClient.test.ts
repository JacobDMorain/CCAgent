import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { DaemonClient } from "../src/index.js";

const servers: http.Server[] = [];

describe("DaemonClient", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  test("sends bearer auth header and parses JSON response", async () => {
    const server = http.createServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer token-1");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const baseUrl = await listen(server);

    const client = new DaemonClient({ baseUrl, token: "token-1" });

    await expect(client.get("/providers")).resolves.toEqual({ ok: true });
  });

  test("throws structured error for daemon error response", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "CCAGENT_TASK_MISSING", message: "missing" } }));
    });
    const baseUrl = await listen(server);

    const client = new DaemonClient({ baseUrl, token: "token-1" });

    await expect(client.get("/tasks/missing")).rejects.toMatchObject({
      code: "CCAGENT_TASK_MISSING"
    });
  });

  test("throws structured daemon unavailable error when fetch cannot connect", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const baseUrl = await listen(server);
    await closeServer(server);
    servers.splice(servers.indexOf(server), 1);

    const client = new DaemonClient({ baseUrl, token: "token-1" });

    await expect(client.get("/review-roles/generate")).rejects.toMatchObject({
      code: "CCAGENT_DAEMON_UNAVAILABLE",
      message: expect.stringContaining("daemon request failed before response"),
      detail: expect.stringContaining("/review-roles/generate")
    });
  });

  test("rotateToken updates in-memory token from response", async () => {
    const seenAuth: string[] = [];
    const server = http.createServer((req, res) => {
      seenAuth.push(req.headers.authorization ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/auth/rotate-token") {
        res.end(JSON.stringify({ token: "token-2" }));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
    const baseUrl = await listen(server);
    const client = new DaemonClient({ baseUrl, token: "token-1" });

    await client.rotateToken();
    await client.get("/providers");

    expect(seenAuth).toEqual(["Bearer token-1", "Bearer token-2"]);
  });
});

async function listen(server: http.Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
