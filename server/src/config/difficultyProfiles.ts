import type { Metrics } from "../utils/metrics";

type Range = [number, number];

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

type DifficultyTargets = {
  flesch_kincaid_grade: Range;
  flesch_reading_ease: Range;
  avg_sentence_len: Range;
  complex_word_ratio: Range;
};

export type DifficultyProfile = {
  level: DifficultyLevel;
  label: string;
  rewrite_guidance: string;
  targets: DifficultyTargets;
};

export const DIFFICULTY_PROFILES: Record<DifficultyLevel, DifficultyProfile> = {
  1: {
    level: 1,
    label: "Very Easy",
    rewrite_guidance:
      "Use very common words, short declarative sentences, and explicit logical links.",
    targets: {
      flesch_kincaid_grade: [4, 6.5],
      flesch_reading_ease: [70, 90],
      avg_sentence_len: [8, 14],
      complex_word_ratio: [0.02, 0.08],
    },
  },
  2: {
    level: 2,
    label: "Easy",
    rewrite_guidance:
      "Use common vocabulary and mostly short-to-medium sentences with minimal subordination.",
    targets: {
      flesch_kincaid_grade: [6.5, 8.5],
      flesch_reading_ease: [60, 75],
      avg_sentence_len: [10, 16],
      complex_word_ratio: [0.05, 0.12],
    },
  },
  3: {
    level: 3,
    label: "Intermediate",
    rewrite_guidance:
      "Balance clarity and precision, mixing medium-length sentences with moderate lexical sophistication.",
    targets: {
      flesch_kincaid_grade: [8.5, 11],
      flesch_reading_ease: [50, 65],
      avg_sentence_len: [13, 20],
      complex_word_ratio: [0.08, 0.16],
    },
  },
  4: {
    level: 4,
    label: "Advanced",
    rewrite_guidance:
      "Use more discipline-specific terms and denser sentence structures while preserving coherence.",
    targets: {
      flesch_kincaid_grade: [11, 13.5],
      flesch_reading_ease: [38, 55],
      avg_sentence_len: [16, 24],
      complex_word_ratio: [0.12, 0.22],
    },
  },
  5: {
    level: 5,
    label: "Very Advanced",
    rewrite_guidance:
      "Use academically dense wording and longer syntactic structures where appropriate.",
    targets: {
      flesch_kincaid_grade: [13.5, 17],
      flesch_reading_ease: [20, 45],
      avg_sentence_len: [20, 30],
      complex_word_ratio: [0.18, 0.35],
    },
  },
};

const clampDifficultyLevel = (value: number): DifficultyLevel => {
  if (value <= 1) return 1;
  if (value >= 5) return 5;
  return value as DifficultyLevel;
};

export const getDifficultyProfile = (level: number): DifficultyProfile =>
  DIFFICULTY_PROFILES[clampDifficultyLevel(level)];

const inRange = (value: number, [min, max]: Range) => value >= min && value <= max;

const normalizedRangeDistance = (value: number, [min, max]: Range) => {
  if (inRange(value, [min, max])) {
    return 0;
  }
  const span = max - min || 1;
  if (value < min) {
    return (min - value) / span;
  }
  return (value - max) / span;
};

export const isMetricsWithinProfile = (
  metrics: Metrics,
  profile: DifficultyProfile
) =>
  inRange(metrics.flesch_kincaid_grade, profile.targets.flesch_kincaid_grade) &&
  inRange(metrics.flesch_reading_ease, profile.targets.flesch_reading_ease) &&
  inRange(metrics.avg_sentence_len, profile.targets.avg_sentence_len) &&
  inRange(metrics.complex_word_ratio, profile.targets.complex_word_ratio);

export const distanceToProfile = (metrics: Metrics, profile: DifficultyProfile) => {
  const fk = normalizedRangeDistance(
    metrics.flesch_kincaid_grade,
    profile.targets.flesch_kincaid_grade
  );
  const fre = normalizedRangeDistance(
    metrics.flesch_reading_ease,
    profile.targets.flesch_reading_ease
  );
  const asl = normalizedRangeDistance(
    metrics.avg_sentence_len,
    profile.targets.avg_sentence_len
  );
  const cwr = normalizedRangeDistance(
    metrics.complex_word_ratio,
    profile.targets.complex_word_ratio
  );
  return Number(((fk + fre + asl + cwr) / 4).toFixed(4));
};

export const formatProfileTargets = (profile: DifficultyProfile) => {
  const { targets } = profile;
  return [
    `Flesch-Kincaid grade: ${targets.flesch_kincaid_grade[0]}-${targets.flesch_kincaid_grade[1]}`,
    `Flesch Reading Ease: ${targets.flesch_reading_ease[0]}-${targets.flesch_reading_ease[1]}`,
    `Average sentence length: ${targets.avg_sentence_len[0]}-${targets.avg_sentence_len[1]}`,
    `Complex word ratio: ${targets.complex_word_ratio[0]}-${targets.complex_word_ratio[1]}`,
  ].join("; ");
};
