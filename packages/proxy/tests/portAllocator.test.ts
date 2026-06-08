import { describe, expect, test } from "vitest";
import { ErrorCodes } from "@ccagent/core";
import { PortAllocator, startProxy } from "../src/index.js";

describe("PortAllocator", () => {
  test("concurrent allocations never receive the same port", async () => {
    const allocator = new PortAllocator({ portStart: 41000, portEnd: 41002 });

    const allocations = await Promise.all([
      allocator.allocate(),
      allocator.allocate(),
      allocator.allocate()
    ]);

    expect(new Set(allocations.map((item) => item.port)).size).toBe(3);

    await Promise.all(allocations.map((item) => item.release()));
  });

  test("throws structured error when range is exhausted", async () => {
    const allocator = new PortAllocator({ portStart: 41010, portEnd: 41010 });
    const allocation = await allocator.allocate();

    await expect(allocator.allocate()).rejects.toMatchObject({
      code: ErrorCodes.ProxyPortUnavailable
    });

    await allocation.release();
  });

  test("allocated port can be bound by the task proxy", async () => {
    const allocator = new PortAllocator({ portStart: 41020, portEnd: 41020 });
    const allocation = await allocator.allocate();

    const proxy = await startProxy({
      taskId: "task-1",
      localToken: "local-token",
      listenHost: "127.0.0.1",
      port: allocation.port,
      upstreamBaseUrl: "https://upstream.example",
      upstreamApiKey: "upstream-key",
      upstreamAuth: { header: "Authorization", scheme: "Bearer" },
      model: "model-1",
      streaming: false
    });

    await proxy.stop();
    await allocation.release();
  });
});
