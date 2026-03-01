import { callOpenRouter, type OpenRouterModel } from "./openrouterClient";
import { callOllama } from "./ollamaClient";

type Provider = "openrouter" | "ollama";

export type StructuredOutputSchema = {
  name: string;
  schema: Record<string, unknown>;
};

const resolveProvider = (): Provider => {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === "openrouter" || explicit === "ollama") {
    return explicit;
  }
  if (explicit) {
    throw new Error(`Unsupported LLM_PROVIDER: ${explicit}`);
  }

  const hasOllama =
    Boolean(process.env.OLLAMA_BASE_URL) || Boolean(process.env.OLLAMA_MODEL);
  const hasOpenAi = Boolean(process.env.OPENROUTER_API_KEY);

  if (hasOllama) {
    return "ollama";
  }
  if (hasOpenAi) {
    return "openrouter";
  }

  throw new Error(
    "No LLM provider configured. Set LLM_PROVIDER, or provide OLLAMA_BASE_URL/OLLAMA_MODEL, or set OPENROUTER_API_KEY."
  );
};

type LlmOptions = {
  model?: OpenRouterModel;
  structured_output?: StructuredOutputSchema;
};

export type LlmUsage = {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
};

export type LlmResponse = {
  content: string;
  provider: Provider;
  model: string | null;
  usage: LlmUsage | null;
};

export const getLlmResponseWithMeta = async (
  prompt: string,
  options: LlmOptions = {}
): Promise<LlmResponse> => {
  const provider = resolveProvider();
  if (provider === "openrouter") {
    return callOpenRouter(prompt, options.model, options.structured_output);
  }
  return callOllama(prompt, options.structured_output);
};

export const getLlmResponse = async (
  prompt: string,
  options: LlmOptions = {}
) => {
  const response = await getLlmResponseWithMeta(prompt, options);
  return response.content;
};
