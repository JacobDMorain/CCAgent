import type { AnthropicMessageResponse, OpenAIChatResponse } from "./protocolTypes.js";

export function openAIToAnthropic(response: OpenAIChatResponse): AnthropicMessageResponse {
  const choice = response.choices[0];
  const content = choice?.message.content ?? "";

  return {
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: content }],
    stop_reason: mapFinishReason(choice?.finish_reason),
    usage: response.usage
      ? {
          input_tokens: response.usage.prompt_tokens ?? 0,
          output_tokens: response.usage.completion_tokens ?? 0
        }
      : undefined
  };
}

function mapFinishReason(reason?: string | null): AnthropicMessageResponse["stop_reason"] {
  if (reason === "length") {
    return "max_tokens";
  }
  if (reason === "stop") {
    return "end_turn";
  }
  return "end_turn";
}
