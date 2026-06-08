import net from "node:net";
import { CCAgentError, ErrorCodes } from "@ccagent/core";

export interface PortAllocation {
  port: number;
  release(): Promise<void>;
}

export interface PortRange {
  portStart: number;
  portEnd: number;
}

export class PortAllocator {
  private readonly reserved = new Set<number>();

  constructor(private readonly range: PortRange) {}

  async allocate(): Promise<PortAllocation> {
    for (let port = this.range.portStart; port <= this.range.portEnd; port += 1) {
      if (this.reserved.has(port)) {
        continue;
      }

      this.reserved.add(port);
      try {
        const server = await listenOnPort(port);
        await closeServer(server);
        const reserved = this.reserved;
        return {
          port,
          async release() {
            reserved.delete(port);
          }
        };
      } catch (error) {
        this.reserved.delete(port);
      }
    }

    throw new CCAgentError(
      ErrorCodes.ProxyPortUnavailable,
      `no available proxy ports in range ${this.range.portStart}-${this.range.portEnd}`
    );
  }
}

async function listenOnPort(port: number): Promise<net.Server> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
