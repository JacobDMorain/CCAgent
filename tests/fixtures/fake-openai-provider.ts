import http from "node:http";

export interface FakeOpenAIProvider {
  baseUrl: string;
  ports: number[];
  stop(): Promise<void>;
}

export async function startFakeOpenAIProvider(): Promise<FakeOpenAIProvider> {
  const ports: number[] = [];
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/chat/completions") {
      ports.push(Number(request.socket.localPort));
      writeJson(response, 200, {
        id: "chatcmpl-fake",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Fake provider response" },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      });
      return;
    }

    writeJson(response, 404, { error: "not found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected fake provider TCP address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    ports,
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function writeJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
