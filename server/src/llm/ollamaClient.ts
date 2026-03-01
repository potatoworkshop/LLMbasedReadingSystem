import type { LlmResponse, StructuredOutputSchema } from "./llmAdapter";

const defaultBaseUrl = "http://localhost:11434";

export const callOllama = async (
  prompt: string,
  structuredOutput?: StructuredOutputSchema
): Promise<LlmResponse> => {
  const baseUrl = process.env.OLLAMA_BASE_URL || defaultBaseUrl;
  const model = process.env.OLLAMA_MODEL;

  if (!model) {
    throw new Error("OLLAMA_MODEL is not set");
  }

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      format: structuredOutput ? structuredOutput.schema : "json",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    message?: { content?: string };
    model?: string;
    prompt_eval_count?: number;
    eval_count?: number;
  };

  const content = data.message?.content;
  if (!content) {
    throw new Error("Ollama response missing content");
  }

  const promptTokens =
    typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : null;
  const completionTokens =
    typeof data.eval_count === "number" ? data.eval_count : null;

  return {
    content,
    provider: "ollama",
    model: data.model ?? model,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens:
        typeof promptTokens === "number" && typeof completionTokens === "number"
          ? promptTokens + completionTokens
          : null,
    },
  };
};
