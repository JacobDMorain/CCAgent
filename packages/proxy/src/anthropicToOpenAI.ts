import { CCAgentError, ErrorCodes } from "@ccagent/core";
import type {
  AnthropicMessage,
  AnthropicMessagesRequest,
  OpenAIChatMessage,
  OpenAIChatRequest
} from "./protocolTypes.js";

export function anthropicToOpenAI(request: AnthropicMessagesRequest): OpenAIChatRequest {
  const messages: OpenAIChatMessage[] = [];

  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }

  for (const message of request.messages) {
    messages.push({
      role: message.role,
      content: textFromAnthropicContent(message)
    });
  }

  return removeUndefined({
    model: request.model,
    messages,
    max_tokens: request.max_tokens,
    stream: request.stream,
    temperature: request.temperature,
    top_p: request.top_p,
    stop: request.stop_sequences
  });
}

function textFromAnthropicContent(message: AnthropicMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .map((block) => {
      if (block.type !== "text") {
        throw new CCAgentError(
          ErrorCodes.ProxyUnsupported,
          `unsupported Anthropic content block: ${block.type}`
        );
      }
      return block.text;
    })
    .join("\n\n");
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
