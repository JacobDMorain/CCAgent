import http from "node:http";
import { anthropicToOpenAI } from "./anthropicToOpenAI.js";
import { openAIToAnthropic } from "./openAIToAnthropic.js";
import type { AnthropicMessagesRequest, OpenAIChatResponse } from "./protocolTypes.js";

export interface ProxyTaskConfig {
  taskId: string;
  localToken: string;
  listenHost: "127.0.0.1";
  port: number;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  upstreamAuth: {
    header: "Authorization" | "x-api-key";
    scheme: "Bearer" | "Raw";
  };
  model: string;
  streaming: boolean;
}

export interface StartedProxy {
  taskId: string;
  baseUrl: string;
  stop(): Promise<void>;
}

export async function startProxy(config: ProxyTaskConfig): Promise<StartedProxy> {
  const server = http.createServer((request, response) => {
    void handleRequest(config, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.listenHost, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP server address");
  }

  return {
    taskId: config.taskId,
    baseUrl: `http://${config.listenHost}:${address.port}`,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function handleRequest(
  config: ProxyTaskConfig,
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
  if (!isAuthorized(config, request)) {
    writeJson(response, 401, { error: { message: "unauthorized" } });
    return;
  }

  if (request.method === "GET" && request.url === "/v1/models") {
    writeJson(response, 200, {
      object: "list",
      data: [{ id: config.model, object: "model" }]
    });
    return;
  }

  if (request.method === "POST" && request.url === "/v1/messages") {
    const body = (await readJson(request)) as AnthropicMessagesRequest;
    const upstreamRequest = anthropicToOpenAI(body);
    const upstreamResponse = await fetch(`${config.upstreamBaseUrl}/chat/completions`, {
      method: "POST",
      headers: buildUpstreamHeaders(config),
      body: JSON.stringify(upstreamRequest)
    });
    const upstreamJson = (await upstreamResponse.json()) as OpenAIChatResponse;
    writeJson(response, upstreamResponse.status, openAIToAnthropic(upstreamJson));
    return;
  }

  writeJson(response, 404, { error: { message: "not found" } });
}

function isAuthorized(config: ProxyTaskConfig, request: http.IncomingMessage): boolean {
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${config.localToken}` || authorization === config.localToken;
}

function buildUpstreamHeaders(config: ProxyTaskConfig): Record<string, string> {
  const value =
    config.upstreamAuth.scheme === "Bearer"
      ? `Bearer ${config.upstreamApiKey}`
      : config.upstreamApiKey;

  return {
    "content-type": "application/json",
    [config.upstreamAuth.header]: value
  };
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString();
  }
  return raw ? JSON.parse(raw) : {};
}

function writeJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
