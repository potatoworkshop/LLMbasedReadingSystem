import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getLlmResponse } from "../llm/llmAdapter";
import type { OpenRouterModel } from "../llm/openrouterClient";
import {
  formatProfileTargets,
  getDifficultyProfile,
} from "../config/difficultyProfiles";
import { JsonExtractError, extractJson } from "../utils/jsonExtract";
import { computeMetrics } from "../utils/metrics";

type GenerateRequest = {
  topic: string;
  level: number;
  target_words: number;
  lang: "en";
  model?: OpenRouterModel;
  experiment?: {
    experiment_id: string;
    run_tag?: string;
    batch_id?: string;
    sample_id?: string;
    notes?: string;
  };
};

type ModelResponse = {
  title: string;
  article: string;
};

const ARCHIVE_DIR = path.resolve(__dirname, "..", "..", "..", "out_generated");
const MAX_GENERATION_ATTEMPTS = 3;

const splitParagraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const archiveArticle = async (payload: {
  article_id: string;
  topic: string;
  level: number;
  target_words: number;
  lang: "en";
  title: string;
  article: string;
  metrics: ReturnType<typeof computeMetrics>;
  model?: OpenRouterModel;
  experiment?: GenerateRequest["experiment"];
  request_meta: {
    requested_at: string;
    length_bounds: {
      lower: number;
      upper: number;
    };
  };
  generation_meta: {
    max_attempts: number;
    attempts_used: number;
    selected_attempt: number;
    within_preferred_range: boolean;
    distance_to_target_words: number;
  };
}) => {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  const filePath = path.join(ARCHIVE_DIR, `${payload.article_id}.json`);
  const fileBody = {
    article_id: payload.article_id,
    topic: payload.topic,
    level: payload.level,
    target_words: payload.target_words,
    lang: payload.lang,
    title: payload.title,
    article: splitParagraphs(payload.article),
    metrics: payload.metrics,
    model: payload.model ?? null,
    provider: process.env.LLM_PROVIDER ?? null,
    experiment: payload.experiment ?? null,
    request_meta: payload.request_meta,
    generation_meta: payload.generation_meta,
    generated_at: new Date().toISOString(),
  };
  await fs.writeFile(filePath, `${JSON.stringify(fileBody, null, 2)}\n`, "utf8");
};

type WordBounds = {
  lowerBound: number;
  upperBound: number;
};

const resolveWordBounds = (targetWords: number): WordBounds => ({
  lowerBound: Math.round(targetWords * 0.9),
  upperBound: Math.round(targetWords * 1.2),
});

const buildPrompt = (request: GenerateRequest, bounds: WordBounds) => {
  const difficultyProfile = getDifficultyProfile(request.level);

  return [
    "You are an assistant that writes short reading passages.",
    `Topic: ${request.topic}`,
    `Target length: around ${request.target_words} words.`,
    `Preferred range: ${bounds.lowerBound}-${bounds.upperBound} words.`,
    `Difficulty level: ${difficultyProfile.level} (${difficultyProfile.label}).`,
    `Difficulty targets: ${formatProfileTargets(difficultyProfile)}.`,
    `Difficulty guidance: ${difficultyProfile.rewrite_guidance}`,
    "Language: English.",
    "Write in the style of an IELTS Academic Reading passage.",
    "Write 3 to 5 coherent paragraphs.",
    "No markdown, no lists, no headings.",
    "Return STRICT JSON with only these keys:",
    '{"title":"...","article":"..."}',
    "The article value should contain the full text with paragraphs separated by a blank line.",
  ].join("\n");
};

const isModelResponse = (value: unknown): value is ModelResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.title === "string" && typeof record.article === "string";
};

export const generateArticle = async (request: GenerateRequest) => {
  const bounds = resolveWordBounds(request.target_words);
  const prompt = buildPrompt(request, bounds);
  const article_id = uuidv4();
  let lastError: Error | null = null;
  let bestCandidate:
    | {
        title: string;
        article: string;
        metrics: ReturnType<typeof computeMetrics>;
        distanceToTarget: number;
        attemptNumber: number;
      }
    | null = null;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const raw = await getLlmResponse(prompt, { model: request.model });
      const parsed = extractJson(raw);

      if (!isModelResponse(parsed)) {
        throw new JsonExtractError("JSON missing title or article");
      }

      const title = parsed.title.trim();
      const article = parsed.article.trim();
      const metrics = computeMetrics(article);
      const distanceToTarget = Math.abs(metrics.word_count - request.target_words);
      const isWithinPreferredRange =
        metrics.word_count >= bounds.lowerBound &&
        metrics.word_count <= bounds.upperBound;

      if (
        !bestCandidate ||
        distanceToTarget < bestCandidate.distanceToTarget
      ) {
        bestCandidate = {
          title,
          article,
          metrics,
          distanceToTarget,
          attemptNumber: attempt + 1,
        };
      }
      const selectedCandidate = bestCandidate ?? {
        title,
        article,
        metrics,
        distanceToTarget,
        attemptNumber: attempt + 1,
      };

      if (!isWithinPreferredRange && attempt < MAX_GENERATION_ATTEMPTS - 1) {
        continue;
      }

      await archiveArticle({
        article_id,
        topic: request.topic,
        level: request.level,
        target_words: request.target_words,
        lang: request.lang,
        title: selectedCandidate.title,
        article: selectedCandidate.article,
        metrics: selectedCandidate.metrics,
        model: request.model,
        experiment: request.experiment,
        request_meta: {
          requested_at: new Date().toISOString(),
          length_bounds: {
            lower: bounds.lowerBound,
            upper: bounds.upperBound,
          },
        },
        generation_meta: {
          max_attempts: MAX_GENERATION_ATTEMPTS,
          attempts_used: attempt + 1,
          selected_attempt: selectedCandidate.attemptNumber,
          within_preferred_range:
            selectedCandidate.metrics.word_count >= bounds.lowerBound &&
            selectedCandidate.metrics.word_count <= bounds.upperBound,
          distance_to_target_words: selectedCandidate.distanceToTarget,
        },
      });

      return {
        article_id,
        topic: request.topic,
        level: request.level,
        target_words: request.target_words,
        title: selectedCandidate.title,
        article: selectedCandidate.article,
        metrics: selectedCandidate.metrics,
      };
    } catch (err) {
      const shouldRetry = err instanceof JsonExtractError;
      lastError = err instanceof Error ? err : new Error("Unknown error");
      if (attempt < MAX_GENERATION_ATTEMPTS - 1 && shouldRetry) {
        continue;
      }

      throw lastError;
    }
  }

  if (bestCandidate) {
    await archiveArticle({
      article_id,
      topic: request.topic,
      level: request.level,
      target_words: request.target_words,
      lang: request.lang,
      title: bestCandidate.title,
      article: bestCandidate.article,
      metrics: bestCandidate.metrics,
      model: request.model,
      experiment: request.experiment,
      request_meta: {
        requested_at: new Date().toISOString(),
        length_bounds: {
          lower: bounds.lowerBound,
          upper: bounds.upperBound,
        },
      },
      generation_meta: {
        max_attempts: MAX_GENERATION_ATTEMPTS,
        attempts_used: bestCandidate.attemptNumber,
        selected_attempt: bestCandidate.attemptNumber,
        within_preferred_range:
          bestCandidate.metrics.word_count >= bounds.lowerBound &&
          bestCandidate.metrics.word_count <= bounds.upperBound,
        distance_to_target_words: bestCandidate.distanceToTarget,
      },
    });

    return {
      article_id,
      topic: request.topic,
      level: request.level,
      target_words: request.target_words,
      title: bestCandidate.title,
      article: bestCandidate.article,
      metrics: bestCandidate.metrics,
    };
  }

  throw lastError ?? new Error("Failed to generate article");
};
