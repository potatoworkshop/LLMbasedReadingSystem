import {
  getLlmResponseWithMeta,
  type LlmUsage,
} from "../llm/llmAdapter";
import type { OpenRouterModel } from "../llm/openrouterClient";
import {
  distanceToProfile,
  getDifficultyProfile,
  isMetricsWithinProfile,
  type DifficultyLevel,
  type DifficultyProfile,
} from "../config/difficultyProfiles";
import { JsonExtractError, extractJson } from "../utils/jsonExtract";
import { computeMetrics, type Metrics } from "../utils/metrics";

type AdjustmentDirection = "simpler" | "harder";

type FidelityReport = {
  overall: number;
  entity_recall: number;
  number_recall: number;
  keyword_recall: number;
  entity_total: number;
  number_total: number;
  keyword_total: number;
};

type TokenUsageSummary = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  llm_calls: number;
};

export type DifficultyAdjustmentHistoryEntry = {
  round: number;
  attempt: number;
  direction: AdjustmentDirection;
  accepted: boolean;
  reason: string;
  metrics: Metrics;
  distance_to_target: number;
  fidelity: FidelityReport;
  token_usage?: TokenUsageSummary;
};

export type DifficultyAdjustmentResult = {
  article: string;
  target_level: DifficultyLevel;
  profile: DifficultyProfile;
  original_metrics: Metrics;
  final_metrics: Metrics;
  hit_target: boolean;
  rounds_used: number;
  history: DifficultyAdjustmentHistoryEntry[];
  fidelity: FidelityReport;
  model: string | null;
  provider: string | null;
  token_usage: TokenUsageSummary;
};

type AdjustDifficultyInput = {
  article: string;
  target_level: number;
  max_rounds?: number;
  fidelity_threshold?: number;
  model?: OpenRouterModel;
};

type ReplacementKind = "word" | "sentence";

type ReplacementEdit = {
  kind: ReplacementKind;
  from: string;
  to: string;
};

type ReplacementVariant = {
  strategy_applied: string;
  replacements: ReplacementEdit[];
};

type RoundAdaptiveState = {
  wordBudget: number;
  sentenceBudget: number;
  gap: number;
  delta: number;
};

const DIFFICULTY_LEVELS: DifficultyLevel[] = [1, 2, 3, 4, 5];

const inferDifficultyLevel = (metrics: Metrics): DifficultyLevel => {
  let bestLevel: DifficultyLevel = 1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const level of DIFFICULTY_LEVELS) {
    const candidateProfile = getDifficultyProfile(level);
    const candidateDistance = distanceToProfile(metrics, candidateProfile);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestLevel = level;
    }
  }

  return bestLevel;
};

const ADJUST_ARTICLE_RESPONSE_SCHEMA = {
  name: "difficulty_adjust_article_response",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            strategy_applied: { type: "string" },
            replacements: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", enum: ["word", "sentence"] },
                  from: { type: "string" },
                  to: { type: "string" },
                },
                required: ["kind", "from", "to"],
              },
              minItems: 1,
              maxItems: 120,
            },
          },
          required: ["strategy_applied", "replacements"]
        },
        minItems: 3,
        maxItems: 3
      }
    },
    required: ["variants"],
  },
} as const;

const emptyTokenUsage = (): TokenUsageSummary => ({
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  llm_calls: 0,
});

const MAX_CANDIDATE_ATTEMPTS_PER_ROUND = 1;

const accumulateTokenUsage = (
  acc: TokenUsageSummary,
  usage: LlmUsage | null
) => {
  acc.llm_calls += 1;
  if (!usage) {
    return;
  }
  if (typeof usage.prompt_tokens === "number") {
    acc.prompt_tokens += usage.prompt_tokens;
  }
  if (typeof usage.completion_tokens === "number") {
    acc.completion_tokens += usage.completion_tokens;
  }
  if (typeof usage.total_tokens === "number") {
    acc.total_tokens += usage.total_tokens;
  }
};

const STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

const ENTITY_SINGLE_WORD_STOPLIST = new Set([
  "the",
  "a",
  "an",
  "in",
  "on",
  "at",
  "for",
  "from",
  "to",
  "of",
  "by",
  "with",
  "without",
  "after",
  "before",
  "when",
  "while",
  "if",
  "this",
  "that",
  "these",
  "those",
]);

const roundFour = (value: number) => Number(value.toFixed(4));

const safeDivide = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : numerator / denominator;

const extractWords = (text: string) => text.toLowerCase().match(/[a-z']+/g) ?? [];

const extractNumbers = (text: string) => {
  const matches = text.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];
  return [...new Set(matches)];
};

const extractEntities = (text: string) => {
  const properNouns = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g) ?? [];
  const acronyms = text.match(/\b[A-Z]{2,}\b/g) ?? [];

  const normalized = [...properNouns, ...acronyms]
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 1)
    .filter((value) => {
      if (value.includes(" ")) {
        return true;
      }
      return !ENTITY_SINGLE_WORD_STOPLIST.has(value);
    });

  return [...new Set(normalized)];
};

const buildKeywordList = (text: string, limit = 20) => {
  const counts = new Map<string, number>();
  for (const word of extractWords(text)) {
    if (word.length < 4 || STOPWORDS.has(word)) {
      continue;
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([word]) => word);
};

const coverageRatio = (
  requiredTerms: string[],
  candidateWordSet: Set<string>,
  candidateLower: string
) => {
  if (requiredTerms.length === 0) {
    return 1;
  }

  let covered = 0;
  for (const term of requiredTerms) {
    if (term.includes(" ")) {
      if (candidateLower.includes(term)) {
        covered += 1;
      }
      continue;
    }
    if (/\d/.test(term)) {
      if (candidateLower.includes(term.toLowerCase())) {
        covered += 1;
      }
      continue;
    }
    if (candidateWordSet.has(term)) {
      covered += 1;
    }
  }

  return safeDivide(covered, requiredTerms.length);
};

const computeFidelity = (source: string, candidate: string): FidelityReport => {
  const sourceEntities = extractEntities(source);
  const sourceNumbers = extractNumbers(source);
  const sourceKeywords = buildKeywordList(source, 20);

  const candidateLower = candidate.toLowerCase();
  const candidateWordSet = new Set(extractWords(candidate));

  const entityRecall = coverageRatio(
    sourceEntities,
    candidateWordSet,
    candidateLower
  );
  const numberRecall = coverageRatio(
    sourceNumbers.map((value) => value.toLowerCase()),
    candidateWordSet,
    candidateLower
  );
  const keywordRecall = coverageRatio(
    sourceKeywords,
    candidateWordSet,
    candidateLower
  );

  const overall = roundFour(
    entityRecall * 0.45 + numberRecall * 0.35 + keywordRecall * 0.2
  );

  return {
    overall,
    entity_recall: roundFour(entityRecall),
    number_recall: roundFour(numberRecall),
    keyword_recall: roundFour(keywordRecall),
    entity_total: sourceEntities.length,
    number_total: sourceNumbers.length,
    keyword_total: sourceKeywords.length,
  };
};

const isReplacementEdit = (value: unknown): value is ReplacementEdit => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "word" || record.kind === "sentence") &&
    typeof record.from === "string" &&
    typeof record.to === "string"
  );
};

const isArticleResponse = (value: unknown): value is { variants: ReplacementVariant[] } => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.variants)) return false;
  return record.variants.every((item) => {
    if (!item || typeof item !== "object") return false;
    const variant = item as Record<string, unknown>;
    return (
      typeof variant.strategy_applied === "string" &&
      Array.isArray(variant.replacements) &&
      variant.replacements.every(isReplacementEdit)
    );
  });
};

const parseAdjustedVariants = (raw: string) => {
  const parsed = extractJson(raw);
  if (!isArticleResponse(parsed)) {
    throw new JsonExtractError("JSON missing variants array");
  }
  return parsed.variants;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const applyWordReplacement = (text: string, from: string, to: string) => {
  const escaped = escapeRegex(from);
  const exactWord = new RegExp(`\\b${escaped}\\b`);
  if (exactWord.test(text)) {
    return {
      text: text.replace(exactWord, to),
      applied: true,
    };
  }

  const exact = new RegExp(escaped);
  if (exact.test(text)) {
    return {
      text: text.replace(exact, to),
      applied: true,
    };
  }

  return { text, applied: false };
};

const applySentenceReplacement = (text: string, from: string, to: string) => {
  const escaped = escapeRegex(from);
  const exact = new RegExp(escaped);
  if (!exact.test(text)) {
    return { text, applied: false };
  }
  return {
    text: text.replace(exact, to),
    applied: true,
  };
};

const applyReplacementVariant = (
  sourceArticle: string,
  replacements: ReplacementEdit[]
) => {
  let nextArticle = sourceArticle;
  let appliedCount = 0;

  for (const edit of replacements) {
    const from = edit.from.trim();
    const to = edit.to.trim();
    if (!from || !to || from === to) continue;

    const result =
      edit.kind === "sentence"
        ? applySentenceReplacement(nextArticle, from, to)
        : applyWordReplacement(nextArticle, from, to);
    if (result.applied) {
      nextArticle = result.text;
      appliedCount += 1;
    }
  }

  return {
    article: nextArticle,
    applied_count: appliedCount,
  };
};

const chooseDirection = (
  metrics: Metrics,
  profile: DifficultyProfile
): AdjustmentDirection => {
  const readabilityMean =
    (metrics.flesch_kincaid_grade +
      metrics.ari +
      metrics.coleman_liau +
      metrics.gunning_fog) /
    4;
  const [meanMin, meanMax] = profile.mean_target;
  if (readabilityMean > meanMax) {
    return "simpler";
  }
  if (readabilityMean < meanMin) {
    return "harder";
  }
  const meanCenter = (meanMin + meanMax) / 2;
  return readabilityMean >= meanCenter ? "simpler" : "harder";
};

const buildAdjustmentPrompt = (params: {
  article: string;
  profile: DifficultyProfile;
  round: number;
  maxRounds: number;
  coarseDirectionOnlyRound: boolean;
  direction: AdjustmentDirection;
  currentMetrics: Metrics;
  currentDistance: number;
  directionChanged: boolean;
  previousRoundAdaptive: RoundAdaptiveState | null;
}) => {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  const clampInt = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(value)));

  const center = ([min, max]: [number, number]) =>
    Number(((min + max) / 2).toFixed(2));

  const targetCenters = {
    fk: center(params.profile.targets.flesch_kincaid_grade),
    ari: center(params.profile.targets.ari),
    cli: center(params.profile.targets.coleman_liau),
    gf: center(params.profile.targets.gunning_fog),
  };

  const centerGapScore = Number(
    (
      (Math.abs(params.currentMetrics.flesch_kincaid_grade - targetCenters.fk) +
        Math.abs(params.currentMetrics.ari - targetCenters.ari) +
        Math.abs(params.currentMetrics.gunning_fog - targetCenters.gf)) /
      3
    ).toFixed(2)
  );

  const directionInstruction =
    params.direction === "simpler"
      ? "Reduce lexical and syntactic complexity by using more common words and shorter sentences."
      : "Increase lexical and syntactic complexity with more advanced wording and moderately denser sentence structure.";

  const normalizedAbsToCenter = (
    value: number,
    targetRange: [number, number]
  ) => {
    const span = targetRange[1] - targetRange[0] || 1;
    const targetCenter = (targetRange[0] + targetRange[1]) / 2;
    return Math.abs(value - targetCenter) / span;
  };

  const wordDeviation =
    (normalizedAbsToCenter(
      params.currentMetrics.flesch_kincaid_grade,
      params.profile.targets.flesch_kincaid_grade
    ) +
      normalizedAbsToCenter(
        params.currentMetrics.ari,
        params.profile.targets.ari
      ) +
      normalizedAbsToCenter(
        params.currentMetrics.coleman_liau,
        params.profile.targets.coleman_liau
      )) /
    3;
  const sentenceDeviation = normalizedAbsToCenter(
    params.currentMetrics.gunning_fog,
    params.profile.targets.gunning_fog
  );

  const dominantDimension =
    sentenceDeviation > wordDeviation ? "sentence" : "word";

  const tier = params.currentDistance > 2
    ? "dist_gt_2"
    : params.currentDistance >= 1
    ? "dist_1_to_2"
    : "dist_lt_1";

  const mode =
    params.directionChanged
      ? dominantDimension === "sentence"
        ? "sentence_budget_1"
        : "word_budget_3"
      : tier === "dist_gt_2"
      ? "both"
      : tier === "dist_1_to_2"
      ? dominantDimension === "sentence"
        ? "sentence_only"
        : "word_only"
      : dominantDimension === "sentence"
      ? "sentence_budget_1"
      : "word_budget_3";

  const wordCount = Math.max(1, params.currentMetrics.word_count);
  const sentenceCount = Math.max(1, params.currentMetrics.sentence_count);

  const lexicalGapNorm =
    (normalizedAbsToCenter(
      params.currentMetrics.flesch_kincaid_grade,
      params.profile.targets.flesch_kincaid_grade
    ) +
      normalizedAbsToCenter(
        params.currentMetrics.ari,
        params.profile.targets.ari
      ) +
      normalizedAbsToCenter(
        params.currentMetrics.coleman_liau,
        params.profile.targets.coleman_liau
      )) /
    3;
  const sentenceGapNorm = normalizedAbsToCenter(
    params.currentMetrics.gunning_fog,
    params.profile.targets.gunning_fog
  );

  const estimatedWordEdits = clampInt(
    wordCount * (0.04 + 0.12 * lexicalGapNorm),
    3,
    80
  );
  const estimatedSentenceEdits = clampInt(
    sentenceCount * (0.08 + 0.2 * sentenceGapNorm),
    1,
    Math.max(1, Math.ceil(sentenceCount * 0.35))
  );

  if (params.coarseDirectionOnlyRound) {
    const strategyTag = `tier=coarse_jump;dist=${params.currentDistance.toFixed(
      4
    )};dir=${params.direction};est_wb=${estimatedWordEdits};est_sb=${estimatedSentenceEdits}`;
    const prompt = [
      "You are an expert reading-text editor.",
      `Task: rewrite the article to match difficulty level ${params.profile.level} (${params.profile.label}).`,
      `Round ${params.round} of ${params.maxRounds}.`,
      `Direction: ${params.direction}.`,
      `Guidance: ${params.profile.rewrite_guidance}`,
      directionInstruction,
      "This is a DIRECTIONAL JUMP round.",
      "- Do a substantial rewrite toward the target direction (simpler or harder).",
      "- You may change both vocabulary and sentence structure aggressively.",
      "- Do not optimize for tiny local edits in this round.",
      "- Keep paragraph order unchanged.",
      "Output Requirements:",
      "- Provide EXACTLY 3 different variants in the JSON array.",
      "- Variant 1: Focus primarily on LEXICAL changes (word substitutions).",
      "- Variant 2: Focus primarily on SYNTACTIC changes (sentence replacements/splits/merges).",
      "- Variant 3: A BALANCED approach combining both strategies.",
      "- DO NOT return full rewritten article text.",
      '- Return only replacement edits with this schema for each variant: {"strategy_applied":"...","replacements":[{"kind":"word|sentence","from":"exact old text","to":"exact new text"}]}',
      "- Every `from` value MUST be an exact substring from the original article.",
      "Hard constraints:",
      "- Preserve all facts and factual relations.",
      "- Preserve all named entities, dates, numbers, and units.",
      "- Keep the same paragraph breaks and overall order of ideas.",
      "- Do not add new facts.",
      "- Do not remove key facts.",
      "Article:",
      params.article,
    ].join("\n");
    return {
      prompt,
      strategyTag,
      wordBudget: estimatedWordEdits,
      sentenceBudget: estimatedSentenceEdits,
      stopDueToZeroAdaptiveBudget: false,
    };
  }

  const lengthFactor = clamp(Math.sqrt(wordCount / 600), 0.7, 1.8);
  const distanceFactor = clamp(
    0.9 + 0.5 * Math.min(params.currentDistance, 2.5),
    0.9,
    2.1
  );

  const computeWordBudget = (ratio: number, min: number, max: number) =>
    clampInt(estimatedWordEdits * ratio * lengthFactor * distanceFactor, min, max);
  const computeSentenceBudget = (ratio: number, min: number) =>
    clampInt(
      estimatedSentenceEdits * ratio * lengthFactor * distanceFactor,
      min,
      Math.max(min, Math.ceil(sentenceCount * 0.35))
    );

  const wordBudget =
    mode === "both"
      ? computeWordBudget(1.0, 8, 80)
      : mode === "word_only"
      ? computeWordBudget(1.0, 8, 80)
      : mode === "word_budget_3"
      ? computeWordBudget(0.35, 3, 20)
      : computeWordBudget(0.6, 4, 40);

  const sentenceBudget =
    mode === "both"
      ? computeSentenceBudget(1.0, 2)
      : mode === "sentence_only"
      ? computeSentenceBudget(1.0, 2)
      : mode === "sentence_budget_1"
      ? computeSentenceBudget(0.35, 1)
      : computeSentenceBudget(0.6, 1);

  const needsWordBudget = mode === "both" || mode === "word_only" || mode === "word_budget_3";
  const needsSentenceBudget =
    mode === "both" || mode === "sentence_only" || mode === "sentence_budget_1";
  const previousAdaptive = params.previousRoundAdaptive;
  const ADAPTIVE_DELTA_EPS = 1e-6;
  const adaptiveFactorRaw =
    params.round > 1 && previousAdaptive
      ? previousAdaptive.gap > 0 && previousAdaptive.delta > ADAPTIVE_DELTA_EPS
        ? params.currentDistance / previousAdaptive.delta
        : 1
      : null;
  const adaptiveFactor =
    adaptiveFactorRaw === null
      ? null
      : clamp(adaptiveFactorRaw, 0.25, 3);
  const adaptiveFallback =
    params.round > 1 &&
    previousAdaptive !== null &&
    previousAdaptive.delta <= ADAPTIVE_DELTA_EPS;
  const wordBudgetMin = needsWordBudget ? 1 : 0;
  const sentenceBudgetMin = needsSentenceBudget ? 1 : 0;

  const adaptiveWordBudget =
    adaptiveFactor === null
      ? wordBudget
      : clampInt(wordBudget * adaptiveFactor, wordBudgetMin, 52);
  const adaptiveSentenceBudget =
    adaptiveFactor === null
      ? sentenceBudget
      : clampInt(
          sentenceBudget * adaptiveFactor,
          sentenceBudgetMin,
          Math.max(1, Math.ceil(sentenceCount * 0.35))
        );

  const stopDueToZeroAdaptiveBudget =
    params.round > 1 &&
    adaptiveFactor !== null &&
    ((needsWordBudget && adaptiveWordBudget <= 0) ||
      (needsSentenceBudget && adaptiveSentenceBudget <= 0));

  const strategyTag = `tier=${tier};dist=${params.currentDistance.toFixed(
    4
  )};center_gap=${centerGapScore};mode=${mode};dominant=${dominantDimension};dir_changed=${
    params.directionChanged ? "1" : "0"
  };wb=${adaptiveWordBudget};sb=${adaptiveSentenceBudget};est_wb=${estimatedWordEdits};est_sb=${estimatedSentenceEdits};lf=${lengthFactor.toFixed(
    2
  )};df=${distanceFactor.toFixed(2)};af=${
    adaptiveFactor === null ? "na" : adaptiveFactor.toFixed(4)
  };pg=${previousAdaptive ? previousAdaptive.gap.toFixed(4) : "na"};pd=${
    previousAdaptive ? previousAdaptive.delta.toFixed(4) : "na"
  };af_fb=${adaptiveFallback ? "1" : "0"}`;

  const strategyInstruction =
    params.directionChanged
      ? mode === "word_budget_3"
        ? [
            `Direction switch guard enabled (previous direction changed to ${params.direction}).`,
            "To avoid overshoot this round, use STRICT MICRO LEXICAL EDITS ONLY:",
            `- Replace at most ${adaptiveWordBudget} words in total.`,
            "- **CRITICAL: Keep all sentence structures, punctuation, and lengths EXACTLY as they are.**",
            "- Prioritize replacing the highest-impact words for readability adjustment.",
          ]
        : [
            `Direction switch guard enabled (previous direction changed to ${params.direction}).`,
            "To avoid overshoot this round, use STRICT MICRO SENTENCE EDITS ONLY:",
            `- Modify sentence length in at most ${adaptiveSentenceBudget} sentence(s).`,
            "- **CRITICAL: Keep vocabulary complexity stable. Do not swap synonyms unless necessary for length.**",
            "- Make one local split/merge/expand edit only.",
          ]
      : params.currentDistance > 2
      ? [
          `Distance tier: LARGE (distance_to_target=${params.currentDistance.toFixed(
            4
          )} > 2.0).`,
          "Apply strong rewrite operations on BOTH dimensions:",
          "- Lexical dimension: identify too complex/too simple words and replace with clearly simpler/clearly more advanced alternatives according to direction.",
          "- Sentence-structure dimension: substantially change sentence length by splitting or merging/expanding sentences; use fewer/more subordinate clauses according to direction.",
          "- Prioritize measurable movement, not minimal edits.",
        ]
      : params.currentDistance >= 1
      ? mode === "word_only"
        ? [
            `Distance tier: MEDIUM (distance_to_target=${params.currentDistance.toFixed(
              4
            )}, 1.0-2.0).`,
            "This round use WORD-ONLY adjustment.",
            "- Replace words to increase/decrease lexical complexity according to direction.",
            `- Replace approximately ${adaptiveWordBudget} words (integer budget).`,
            "- **CRITICAL: DO NOT split or merge sentences. Keep the sentence count and basic structure fixed.**",
            "- Focus on swapping high-frequency vs. academic-frequency synonyms.",
          ]
        : [
            `Distance tier: MEDIUM (distance_to_target=${params.currentDistance.toFixed(
              4
            )}, 1.0-2.0).`,
            "This round use SENTENCE-LENGTH-ONLY adjustment.",
            "- Change sentence length and clause density according to direction.",
            `- Modify approximately ${adaptiveSentenceBudget} sentence(s) (integer budget).`,
            "- **CRITICAL: KEEP VOCABULARY AS IS. Do not change words while adjusting sentence length.**",
            "- Focus on splitting long clauses or merging short fragments.",
          ]
      : [
          `Distance tier: SMALL (distance_to_target=${params.currentDistance.toFixed(
            4
          )} < 1.0).`,
          mode === "word_budget_3"
            ? "Use STRICT micro lexical editing. DO NOT touch sentence structures."
            : "Use STRICT micro sentence-length editing. DO NOT touch vocabulary.",
          mode === "word_budget_3"
            ? `- Replace at most ${adaptiveWordBudget} words in total.`
            : `- Modify sentence length in at most ${adaptiveSentenceBudget} sentence(s).`,
          "- Keep all other content and structure as stable as possible.",
        ];

  // 定向微调建议逻辑
  const specificAdvice: string[] = [];
  const targets = params.profile.targets;
  const metrics = params.currentMetrics;

  if (metrics.flesch_kincaid_grade > targets.flesch_kincaid_grade[1]) {
    specificAdvice.push("- The text is currently too difficult overall. Use simpler synonyms and shorter sentences.");
  } else if (metrics.flesch_kincaid_grade < targets.flesch_kincaid_grade[0]) {
    specificAdvice.push("- The text is currently too easy overall. Use more precise or academic terminology.");
  }

  if (metrics.gunning_fog < targets.gunning_fog[0]) {
    specificAdvice.push("- Academic density is low (too few complex words). Use a few more multi-syllabic, professional words.");
  } else if (metrics.gunning_fog > targets.gunning_fog[1]) {
    specificAdvice.push("- There are too many complex words. Replace 3+ syllable words with shorter alternatives.");
  }

  if (metrics.avg_sentence_len > 22 && targets.flesch_kincaid_grade[1] < 10) {
    specificAdvice.push("- Sentences are too long for this level. Break sentences into shorter fragments.");
  }

  const prompt = [
    "You are an expert reading-text editor.",
    `Task: rewrite the article to match difficulty level ${params.profile.level} (${params.profile.label}).`,
    `Round ${params.round} of ${params.maxRounds}.`,
    `Direction: ${params.direction}.`,
    `Guidance: ${params.profile.rewrite_guidance}`,
    ...(specificAdvice.length > 0 ? ["Specific Advice for this round:", ...specificAdvice] : []),
    directionInstruction,
    ...strategyInstruction,
    "Output Requirements:",
    "- Provide EXACTLY 3 different variants in the JSON array.",
    "- Variant 1: Focus primarily on LEXICAL changes (word substitutions).",
    "- Variant 2: Focus primarily on SYNTACTIC changes (sentence replacements/splits/merges).",
    "- Variant 3: A BALANCED approach combining both strategies.",
    "- DO NOT return full rewritten article text.",
    '- Return only replacement edits with this schema for each variant: {"strategy_applied":"...","replacements":[{"kind":"word|sentence","from":"exact old text","to":"exact new text"}]}',
    "- Every `from` value MUST be an exact substring from the original article.",
    "Hard constraints:",
    "- Preserve all facts and factual relations.",
    "- Preserve all named entities, dates, numbers, and units.",
    "- Keep the same paragraph breaks and overall order of ideas.",
    "- Do not add new facts.",
    "- Do not remove key facts.",
    "Article:",
    params.article,
  ].join("\n");

  return {
    prompt,
    strategyTag,
    wordBudget: adaptiveWordBudget,
    sentenceBudget: adaptiveSentenceBudget,
    stopDueToZeroAdaptiveBudget,
  };
};

export const adjustArticleDifficulty = async (
  input: AdjustDifficultyInput
): Promise<DifficultyAdjustmentResult> => {
  const profile = getDifficultyProfile(input.target_level);
  const maxRounds = Math.min(Math.max(input.max_rounds ?? 5, 1), 5);
  const fidelityThreshold = Math.min(
    Math.max(input.fidelity_threshold ?? 0.72, 0.5),
    1
  );

  const originalArticle = input.article.trim();
  const originalMetrics = computeMetrics(originalArticle);
  const inferredSourceLevel = inferDifficultyLevel(originalMetrics);
  const shouldUseCoarseFirstRound =
    Math.abs(inferredSourceLevel - profile.level) > 1;

  let currentBestArticle = originalArticle;
  let currentBestMetrics = originalMetrics;
  let currentBestDistance = distanceToProfile(currentBestMetrics, profile);

  // 全局最优追踪
  let globalBestArticle = originalArticle;
  let globalBestMetrics = originalMetrics;
  let globalBestDistance = currentBestDistance;
  let globalBestFidelity = computeFidelity(originalArticle, originalArticle);
  let globalBestHit = isMetricsWithinProfile(originalMetrics, profile);

  const totalTokenUsage = emptyTokenUsage();
  let llmProvider: string | null = process.env.LLM_PROVIDER ?? null;
  let llmModelResolved: string | null = input.model ?? null;
  let roundsUsed = 0;
  let previousDirection: AdjustmentDirection | null = null;
  let previousRoundAdaptive: RoundAdaptiveState | null = null;
  let stoppedByZeroAdaptiveBudget = false;

  const history: DifficultyAdjustmentHistoryEntry[] = [];
  let stopAllRoundsByHit = false;

  for (let round = 1; round <= maxRounds; round += 1) {
    if (stopAllRoundsByHit) {
      break;
    }
    roundsUsed = round;
    const direction = chooseDirection(currentBestMetrics, profile);
    const directionChanged =
      previousDirection !== null && previousDirection !== direction;
    let improvedInRound = false;
    const roundStartDistance = currentBestDistance;
    let roundWordBudget: number | null = null;
    let roundSentenceBudget: number | null = null;
    let roundStoppedBeforeAttempt = false;

    // 存储本轮尝试中的最佳候选
    let bestCandidateInRound: {
      article: string;
      metrics: Metrics;
      distance: number;
      fidelity: FidelityReport;
      reason: string;
      strategyTag: string;
      isHit: boolean;
    } | null = null;

    for (let attempt = 1; attempt <= MAX_CANDIDATE_ATTEMPTS_PER_ROUND; attempt += 1) {
      const coarseDirectionOnlyRound = shouldUseCoarseFirstRound && round === 1;
      const { prompt, strategyTag, wordBudget, sentenceBudget, stopDueToZeroAdaptiveBudget } =
        buildAdjustmentPrompt({
        article: currentBestArticle,
        profile,
        round,
        maxRounds,
        coarseDirectionOnlyRound,
        direction,
        currentMetrics: currentBestMetrics,
        currentDistance: currentBestDistance,
        directionChanged,
        previousRoundAdaptive,
      });
      roundWordBudget = wordBudget;
      roundSentenceBudget = sentenceBudget;

      if (stopDueToZeroAdaptiveBudget) {
        history.push({
          round,
          attempt,
          direction,
          accepted: false,
          reason: `stopped_zero_adaptive_budget|${strategyTag}`,
          metrics: currentBestMetrics,
          distance_to_target: currentBestDistance,
          fidelity: computeFidelity(originalArticle, currentBestArticle),
          token_usage: { ...totalTokenUsage },
        });
        roundStoppedBeforeAttempt = true;
        stoppedByZeroAdaptiveBudget = true;
        break;
      }

      try {
        const llmResponse = await getLlmResponseWithMeta(prompt, {
          model: input.model,
          structured_output: ADJUST_ARTICLE_RESPONSE_SCHEMA,
        });
        llmProvider = llmResponse.provider;
        llmModelResolved = llmResponse.model ?? llmModelResolved;
        accumulateTokenUsage(totalTokenUsage, llmResponse.usage);
        
        const variants = parseAdjustedVariants(llmResponse.content);
        let bestCandidateInRound: {
          article: string;
          metrics: Metrics;
          distance: number;
          fidelity: FidelityReport;
          isHit: boolean;
          strategy: string;
        } | null = null;

        for (const variant of variants) {
          const applied = applyReplacementVariant(
            currentBestArticle,
            variant.replacements
          );
          const candidateArticle = applied.article.trim();
          if (!candidateArticle || applied.applied_count <= 0) continue;

          const candidateMetrics = computeMetrics(candidateArticle);
          const candidateDistance = distanceToProfile(candidateMetrics, profile);
          const candidateFidelity = computeFidelity(originalArticle, candidateArticle);
          const isHitNow = isMetricsWithinProfile(candidateMetrics, profile);
          const wasHitBefore = isMetricsWithinProfile(currentBestMetrics, profile);

          // 解耦优化判定
          const wordImproved = candidateMetrics.flesch_kincaid_grade < currentBestMetrics.flesch_kincaid_grade || candidateMetrics.coleman_liau < currentBestMetrics.coleman_liau;
          const sentenceImproved = candidateMetrics.avg_sentence_len < currentBestMetrics.avg_sentence_len;

          const DISTANCE_SLACK = 0.05;
          const isQualified = candidateFidelity.overall >= fidelityThreshold;
          
          // 判定逻辑：必须满足保真度，且 (距离变短 OR 命中目标 OR 维度改进且高保真)
          const isBetter = candidateDistance < currentBestDistance + DISTANCE_SLACK || 
                           (isHitNow && !wasHitBefore) || 
                           (variant.strategy_applied.includes("LEXICAL") && wordImproved && candidateFidelity.overall > 0.85) || 
                           (variant.strategy_applied.includes("SYNTACTIC") && sentenceImproved && candidateFidelity.overall > 0.85);

          if (isQualified && isBetter) {
            if (!bestCandidateInRound || candidateDistance < bestCandidateInRound.distance) {
              bestCandidateInRound = {
                article: candidateArticle,
                metrics: candidateMetrics,
                distance: candidateDistance,
                fidelity: candidateFidelity,
                isHit: isHitNow,
                strategy: `${variant.strategy_applied}|applied_edits=${applied.applied_count}`
              };
            }
          }
        }

        if (bestCandidateInRound) {
          currentBestArticle = bestCandidateInRound.article;
          currentBestMetrics = bestCandidateInRound.metrics;
          currentBestDistance = bestCandidateInRound.distance;
          improvedInRound = true;

          history.push({
            round,
            attempt: 1,
            direction,
            accepted: true,
            reason: `accepted_variant|strategy=${bestCandidateInRound.strategy}|${strategyTag}`,
            metrics: currentBestMetrics,
            distance_to_target: currentBestDistance,
            fidelity: bestCandidateInRound.fidelity,
            token_usage: { ...totalTokenUsage },
          });

          // 全局最优更新
          if (currentBestDistance < globalBestDistance || (bestCandidateInRound.isHit && !globalBestHit)) {
            globalBestArticle = currentBestArticle;
            globalBestMetrics = currentBestMetrics;
            globalBestDistance = currentBestDistance;
            globalBestFidelity = bestCandidateInRound.fidelity;
            globalBestHit = bestCandidateInRound.isHit;
          }

          if (bestCandidateInRound.isHit) {
            stopAllRoundsByHit = true;
            break;
          }
        } else {
          history.push({
            round,
            attempt: 1,
            direction,
            accepted: false,
            reason: `no_qualified_variants|${strategyTag}`,
            metrics: currentBestMetrics,
            distance_to_target: currentBestDistance,
            fidelity: computeFidelity(originalArticle, currentBestArticle),
            token_usage: { ...totalTokenUsage },
          });
        }

      } catch (err) {
        history.push({
          round,
          attempt: 1,
          direction,
          accepted: false,
          reason: err instanceof Error ? `llm_error:${err.message}|${strategyTag}` : `llm_error|${strategyTag}`,
          metrics: currentBestMetrics,
          distance_to_target: currentBestDistance,
          fidelity: computeFidelity(originalArticle, currentBestArticle),
          token_usage: { ...totalTokenUsage },
        });
      }
    }

    if (
      roundWordBudget !== null &&
      roundSentenceBudget !== null &&
      !roundStoppedBeforeAttempt
    ) {
      previousRoundAdaptive = {
        wordBudget: roundWordBudget,
        sentenceBudget: roundSentenceBudget,
        gap: roundStartDistance,
        delta: Math.abs(roundStartDistance - currentBestDistance),
      };
    }

    if (stoppedByZeroAdaptiveBudget) {
      roundsUsed = Math.max(0, round - 1);
      break;
    }

    if (stopAllRoundsByHit) {
      break;
    }

    previousDirection = direction;
  }

  // 最终验收：回溯到全局最优
  return {
    article: globalBestArticle,
    target_level: profile.level,
    profile,
    original_metrics: originalMetrics,
    final_metrics: globalBestMetrics,
    hit_target: globalBestHit,
    rounds_used: roundsUsed,
    history,
    fidelity: globalBestFidelity,
    model: llmModelResolved,
    provider: llmProvider,
    token_usage: totalTokenUsage,
  };
};
