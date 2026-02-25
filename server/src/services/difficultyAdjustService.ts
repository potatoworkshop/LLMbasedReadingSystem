import { getLlmResponse } from "../llm/llmAdapter";
import type { OpenRouterModel } from "../llm/openrouterClient";
import {
  distanceToProfile,
  formatProfileTargets,
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

export type DifficultyAdjustmentHistoryEntry = {
  round: number;
  direction: AdjustmentDirection;
  accepted: boolean;
  reason: string;
  metrics: Metrics;
  distance_to_target: number;
  fidelity: FidelityReport;
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
};

type AdjustDifficultyInput = {
  article: string;
  target_level: number;
  max_rounds?: number;
  fidelity_threshold?: number;
  model?: OpenRouterModel;
};

type ArticleResponse = {
  article: string;
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

const isArticleResponse = (value: unknown): value is ArticleResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.article === "string";
};

const parseAdjustedArticle = (raw: string) => {
  const parsed = extractJson(raw);
  if (!isArticleResponse(parsed)) {
    throw new JsonExtractError("JSON missing article");
  }
  return parsed.article.trim();
};

const chooseDirection = (
  metrics: Metrics,
  profile: DifficultyProfile
): AdjustmentDirection => {
  const [fkMin, fkMax] = profile.targets.flesch_kincaid_grade;
  const [freMin, freMax] = profile.targets.flesch_reading_ease;

  if (
    metrics.flesch_kincaid_grade > fkMax ||
    metrics.flesch_reading_ease < freMin
  ) {
    return "simpler";
  }
  if (
    metrics.flesch_kincaid_grade < fkMin ||
    metrics.flesch_reading_ease > freMax
  ) {
    return "harder";
  }

  const fkCenter = (fkMin + fkMax) / 2;
  return metrics.flesch_kincaid_grade > fkCenter ? "simpler" : "harder";
};

const buildAdjustmentPrompt = (params: {
  article: string;
  profile: DifficultyProfile;
  round: number;
  maxRounds: number;
  direction: AdjustmentDirection;
  currentMetrics: Metrics;
}) => {
  const directionInstruction =
    params.direction === "simpler"
      ? "Reduce lexical and syntactic complexity by using more common words and shorter sentences."
      : "Increase lexical and syntactic complexity with more advanced wording and moderately denser sentence structure.";

  return [
    "You are an expert reading-text editor.",
    `Task: rewrite the article to match difficulty level ${params.profile.level} (${params.profile.label}).`,
    `Round ${params.round} of ${params.maxRounds}.`,
    `Direction: ${params.direction}.`,
    `Current metrics: FK=${params.currentMetrics.flesch_kincaid_grade}, FRE=${params.currentMetrics.flesch_reading_ease}, ASL=${params.currentMetrics.avg_sentence_len}, CWR=${params.currentMetrics.complex_word_ratio}.`,
    `Target ranges: ${formatProfileTargets(params.profile)}.`,
    `Guidance: ${params.profile.rewrite_guidance}`,
    directionInstruction,
    "Hard constraints:",
    "- Preserve all facts and factual relations.",
    "- Preserve all named entities, dates, numbers, and units.",
    "- Keep the same paragraph breaks and overall order of ideas.",
    "- Do not add new facts.",
    "- Do not remove key facts.",
    'Return STRICT JSON only: {"article":"..."}',
    "Article:",
    params.article,
  ].join("\n");
};

export const adjustArticleDifficulty = async (
  input: AdjustDifficultyInput
): Promise<DifficultyAdjustmentResult> => {
  const profile = getDifficultyProfile(input.target_level);
  const maxRounds = Math.min(Math.max(input.max_rounds ?? 3, 1), 5);
  const fidelityThreshold = Math.min(
    Math.max(input.fidelity_threshold ?? 0.72, 0.5),
    1
  );

  const originalArticle = input.article.trim();
  const originalMetrics = computeMetrics(originalArticle);

  let bestArticle = originalArticle;
  let bestMetrics = originalMetrics;
  let bestDistance = distanceToProfile(bestMetrics, profile);

  const history: DifficultyAdjustmentHistoryEntry[] = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    if (isMetricsWithinProfile(bestMetrics, profile)) {
      break;
    }

    const direction = chooseDirection(bestMetrics, profile);
    try {
      const prompt = buildAdjustmentPrompt({
        article: bestArticle,
        profile,
        round,
        maxRounds,
        direction,
        currentMetrics: bestMetrics,
      });
      const raw = await getLlmResponse(prompt, { model: input.model });
      const candidateArticle = parseAdjustedArticle(raw);

      if (!candidateArticle) {
        history.push({
          round,
          direction,
          accepted: false,
          reason: "empty_output",
          metrics: bestMetrics,
          distance_to_target: bestDistance,
          fidelity: computeFidelity(originalArticle, bestArticle),
        });
        continue;
      }

      const candidateMetrics = computeMetrics(candidateArticle);
      const candidateDistance = distanceToProfile(candidateMetrics, profile);
      const candidateFidelity = computeFidelity(originalArticle, candidateArticle);
      const candidateHitsTarget = isMetricsWithinProfile(candidateMetrics, profile);

      const accepted =
        candidateFidelity.overall >= fidelityThreshold &&
        (candidateHitsTarget || candidateDistance < bestDistance);

      if (accepted) {
        bestArticle = candidateArticle;
        bestMetrics = candidateMetrics;
        bestDistance = candidateDistance;
      }

      history.push({
        round,
        direction,
        accepted,
        reason: accepted
          ? candidateHitsTarget
            ? "accepted_hit_target"
            : "accepted_better_distance"
          : candidateFidelity.overall < fidelityThreshold
          ? "rejected_low_fidelity"
          : "rejected_not_better",
        metrics: candidateMetrics,
        distance_to_target: candidateDistance,
        fidelity: candidateFidelity,
      });

      if (accepted && candidateHitsTarget) {
        break;
      }
    } catch (err) {
      history.push({
        round,
        direction,
        accepted: false,
        reason: err instanceof Error ? `llm_error:${err.message}` : "llm_error",
        metrics: bestMetrics,
        distance_to_target: bestDistance,
        fidelity: computeFidelity(originalArticle, bestArticle),
      });
    }
  }

  return {
    article: bestArticle,
    target_level: profile.level,
    profile,
    original_metrics: originalMetrics,
    final_metrics: bestMetrics,
    hit_target: isMetricsWithinProfile(bestMetrics, profile),
    rounds_used: history.length,
    history,
    fidelity: computeFidelity(originalArticle, bestArticle),
  };
};
