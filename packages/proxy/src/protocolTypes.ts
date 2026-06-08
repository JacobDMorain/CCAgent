export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<AnthropicTextBlock | { type: string; [key: string]: unknown }>;
}

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens?: number;
  system?: string;
  messages: AnthropicMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
}

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop?: string[];
}

export interface OpenAIChatResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface AnthropicMessageResponse {
  type: "message";
  role: "assistant";
  content: AnthropicTextBlock[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "error";
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}
