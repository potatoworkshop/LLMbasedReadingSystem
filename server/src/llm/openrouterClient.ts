const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const OPENROUTER_MODEL_OPTIONS = [
  "openai/gpt-5-mini",
  "google/gemini-3-flash-preview",
  "x-ai/grok-4.1-fast",
] as const;

export type OpenRouterModel = (typeof OPENROUTER_MODEL_OPTIONS)[number];

export const callOpenRouter = async (
  prompt: string,
  modelOverride?: OpenRouterModel
) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const model =
    modelOverride || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_SITE_NAME || "LLM Reading System",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response missing content");
  }

  return content;
};
