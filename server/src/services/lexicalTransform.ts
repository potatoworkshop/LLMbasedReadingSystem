import { getLlmResponse } from "../llm/llmAdapter";
import { JsonExtractError, extractJson } from "../utils/jsonExtract";

type TransformMode = "simplify" | "harder" | "shorten";

type TransformResponse = {
  article: string;
};

const buildPrompt = (article: string, mode: TransformMode) => {
  const direction =
    mode === "simplify"
      ? "Replace complex words with simpler, shorter, low-syllable, common words."
      : mode === "harder"
      ? "Replace simple, common words with more complex, less common words."
      : "Shorten sentences by simplifying clauses and splitting long sentences.";

  const rules =
    mode === "shorten"
      ? [
          "- Split long sentences into shorter sentences.",
          "- Simplify clauses while preserving meaning and facts.",
          "- Do not add new information or remove facts.",
          "- Keep paragraph breaks.",
        ]
      : [
          "- Only replace individual words with synonyms.",
          "- For simplify mode: prefer the simplest, shortest, most common word that preserves meaning.",
          "- For harder mode: prefer more complex, less common words that preserve meaning.",
          "- Do not add or remove words, sentences, or punctuation.",
          "- Keep the original order and paragraph breaks.",
          "- Preserve the original casing of each replaced word (e.g., Apple -> Orange, APPLE -> ORANGE).",
          "- Do not paraphrase or change grammar.",
        ];

  return [
    "You are a text rewriter.",
    direction,
    "Rules:",
    ...rules,
    'Return STRICT JSON: {"article":"..."}',
    "Text to transform:",
    article,
  ].join("\n");
};

const isTransformResponse = (value: unknown): value is TransformResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.article === "string";
};

export const transformArticle = async (
  article: string,
  mode: TransformMode
) => {
  const prompt = buildPrompt(article, mode);
  const raw = await getLlmResponse(prompt);
  const parsed = extractJson(raw);

  if (!isTransformResponse(parsed)) {
    throw new JsonExtractError("JSON missing article");
  }

  return parsed.article.trim();
};
