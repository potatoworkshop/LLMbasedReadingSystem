import type { Metrics } from "../utils/metrics";

type Range = [number, number];

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

type DifficultyTargets = {
  flesch_kincaid_grade: Range;
  ari: Range;
  coleman_liau: Range;
  gunning_fog: Range;
};

export type DifficultyProfile = {
  level: DifficultyLevel;
  label: string;
  rewrite_guidance: string;
  mean_target: Range;
  targets: DifficultyTargets;
};

export const DIFFICULTY_PROFILES: Record<DifficultyLevel, DifficultyProfile> = {
  1: {
    level: 1,
    label: "Grade Mean 6-8",
    rewrite_guidance:
      "Push readability-grade metrics toward the 6-8 band with simpler wording and shorter sentences.",
    mean_target: [6, 8],
    targets: {
      flesch_kincaid_grade: [6, 8],
      ari: [6, 8],
      coleman_liau: [6, 8],
      gunning_fog: [6, 8],
    },
  },
  2: {
    level: 2,
    label: "Grade Mean 8-10",
    rewrite_guidance:
      "Push readability-grade metrics toward the 8-10 band with moderately complex wording and sentence structures.",
    mean_target: [8, 10],
    targets: {
      flesch_kincaid_grade: [8, 10],
      ari: [8, 10],
      coleman_liau: [8, 10],
      gunning_fog: [8, 10],
    },
  },
  3: {
    level: 3,
    label: "Grade Mean 10-12",
    rewrite_guidance:
      "Push readability-grade metrics toward the 10-12 band with denser wording and longer sentence structures.",
    mean_target: [10, 12],
    targets: {
      flesch_kincaid_grade: [10, 12],
      ari: [10, 12],
      coleman_liau: [10, 12],
      gunning_fog: [10, 12],
    },
  },
  4: {
    level: 4,
    label: "Grade Mean 12-14",
    rewrite_guidance:
      "Push readability-grade metrics toward the 12-14 band with advanced vocabulary and complex sentence structures.",
    mean_target: [12, 14],
    targets: {
      flesch_kincaid_grade: [12, 14],
      ari: [12, 14],
      coleman_liau: [12, 14],
      gunning_fog: [12, 14],
    },
  },
  5: {
    level: 5,
    label: "Grade Mean 14+",
    rewrite_guidance:
      "Push readability-grade metrics above 14 with very advanced vocabulary and dense, highly complex syntax.",
    mean_target: [14, 20],
    targets: {
      flesch_kincaid_grade: [14, 20],
      ari: [14, 20],
      coleman_liau: [14, 20],
      gunning_fog: [14, 20],
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

const normalizedCenterDistance = (value: number, [min, max]: Range) => {
  const center = (min + max) / 2;
  const halfSpan = (max - min) / 2 || 1;
  return Math.abs(value - center) / halfSpan;
};

export const isMetricsWithinProfile = (
  metrics: Metrics,
  profile: DifficultyProfile
) => {
  const meanReadability =
    (metrics.flesch_kincaid_grade +
      metrics.ari +
      metrics.coleman_liau +
      metrics.gunning_fog) /
    4;
  return inRange(meanReadability, profile.mean_target);
};

export const distanceToProfile = (metrics: Metrics, profile: DifficultyProfile) => {
  const meanReadability =
    (metrics.flesch_kincaid_grade +
      metrics.ari +
      metrics.coleman_liau +
      metrics.gunning_fog) /
    4;
  return Number(
    normalizedCenterDistance(meanReadability, profile.mean_target).toFixed(4)
  );
};

export const formatProfileTargets = (profile: DifficultyProfile) => {
  const { targets } = profile;
  return [
    `Mean readability target (FK/ARI/CLI/GF): ${profile.mean_target[0]}-${profile.mean_target[1]}`,
    `Flesch-Kincaid grade: ${targets.flesch_kincaid_grade[0]}-${targets.flesch_kincaid_grade[1]}`,
    `ARI: ${targets.ari[0]}-${targets.ari[1]}`,
    `Coleman-Liau: ${targets.coleman_liau[0]}-${targets.coleman_liau[1]}`,
    `Gunning Fog: ${targets.gunning_fog[0]}-${targets.gunning_fog[1]}`,
  ].join("; ");
};
