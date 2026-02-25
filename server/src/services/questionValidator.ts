export type JudgementAnswer = "TRUE" | "FALSE" | "NOT GIVEN";
export type ChoiceLabel = "A" | "B" | "C" | "D";

export type JudgementQuestion = {
  number: number;
  question: string;
  answer: JudgementAnswer;
  evidence_sentence_indices: number[];
};

export type SingleChoiceOption = {
  label: ChoiceLabel;
  text: string;
};

export type SingleChoiceQuestion = {
  number: number;
  question: string;
  options: SingleChoiceOption[];
  answer: ChoiceLabel;
  evidence_sentence_indices: number[];
};

export type QuestionSet = {
  judgement_questions: JudgementQuestion[];
  single_choice_questions: SingleChoiceQuestion[];
};

export type QuestionValidationResult = {
  is_valid: boolean;
  issues: string[];
};

type ExpectedCounts = {
  judgement_count: number;
  single_choice_count: number;
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "were",
  "with",
  "which",
  "what",
  "when",
  "where",
  "who",
  "why",
  "how",
]);

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

const toInt = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
};

const normalizeEvidenceIndices = (value: unknown) => {
  const rawArray = Array.isArray(value) ? value : [];
  const indices = rawArray
    .map((item) => toInt(item))
    .filter((item): item is number => item !== null && item >= 0);

  return [...new Set(indices)].sort((a, b) => a - b);
};

const normalizeAnswer = (value: unknown): JudgementAnswer => {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "TRUE" || normalized === "FALSE" || normalized === "NOT GIVEN") {
    return normalized;
  }
  return "NOT GIVEN";
};

const normalizeChoiceLabel = (value: unknown, fallback: ChoiceLabel): ChoiceLabel => {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "A" || normalized === "B" || normalized === "C" || normalized === "D") {
    return normalized;
  }
  return fallback;
};

const normalizeOptions = (value: unknown): SingleChoiceOption[] => {
  const entries = Array.isArray(value) ? value : [];
  const fallbackLabels: ChoiceLabel[] = ["A", "B", "C", "D"];

  return entries.slice(0, 4).map((item, index) => {
    const fallbackLabel = fallbackLabels[index] ?? "A";

    if (typeof item === "string") {
      const compact = normalizeWhitespace(item);
      const match = compact.match(/^([A-D])[).:\-]\s*(.+)$/i);
      if (match) {
        return {
          label: normalizeChoiceLabel(match[1], fallbackLabel),
          text: normalizeWhitespace(match[2]),
        };
      }
      return {
        label: fallbackLabel,
        text: compact,
      };
    }

    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return {
        label: normalizeChoiceLabel(record.label, fallbackLabel),
        text: normalizeWhitespace(String(record.text ?? "")),
      };
    }

    return {
      label: fallbackLabel,
      text: "",
    };
  });
};

const parseJudgementQuestion = (
  value: unknown,
  fallbackNumber: number
): JudgementQuestion => {
  if (!value || typeof value !== "object") {
    return {
      number: fallbackNumber,
      question: "",
      answer: "NOT GIVEN",
      evidence_sentence_indices: [],
    };
  }

  const record = value as Record<string, unknown>;
  const question = normalizeWhitespace(String(record.question ?? ""));

  return {
    number: toInt(record.number) ?? fallbackNumber,
    question,
    answer: normalizeAnswer(record.answer),
    evidence_sentence_indices: normalizeEvidenceIndices(record.evidence_sentence_indices),
  };
};

const parseSingleChoiceQuestion = (
  value: unknown,
  fallbackNumber: number
): SingleChoiceQuestion => {
  if (!value || typeof value !== "object") {
    return {
      number: fallbackNumber,
      question: "",
      options: [],
      answer: "A",
      evidence_sentence_indices: [],
    };
  }

  const record = value as Record<string, unknown>;
  const options = normalizeOptions(record.options);
  const answer = normalizeChoiceLabel(record.answer, "A");

  return {
    number: toInt(record.number) ?? fallbackNumber,
    question: normalizeWhitespace(String(record.question ?? "")),
    options,
    answer,
    evidence_sentence_indices: normalizeEvidenceIndices(record.evidence_sentence_indices),
  };
};

export const normalizeQuestionSetFromUnknown = (value: unknown): QuestionSet => {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawJudgement = Array.isArray(record.judgement_questions)
    ? record.judgement_questions
    : [];
  const rawSingleChoice = Array.isArray(record.single_choice_questions)
    ? record.single_choice_questions
    : [];

  const judgement_questions = rawJudgement.map((item, index) =>
    parseJudgementQuestion(item, index + 1)
  );
  const single_choice_questions = rawSingleChoice.map((item, index) =>
    parseSingleChoiceQuestion(item, index + 1)
  );

  return {
    judgement_questions,
    single_choice_questions,
  };
};

const extractContentTokens = (text: string) => {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(
    words.filter((word) => word.length >= 3 && !STOPWORDS.has(word))
  );
};

const overlapCount = (a: Set<string>, b: Set<string>) => {
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
};

const validateEvidenceIndices = (
  evidenceIndices: number[],
  sentenceCount: number,
  prefix: string,
  issues: string[]
) => {
  evidenceIndices.forEach((index) => {
    if (index < 0 || index >= sentenceCount) {
      issues.push(`${prefix}: evidence sentence index out of range (${index}).`);
    }
  });
};

export const validateQuestionSet = (
  questionSet: QuestionSet,
  sentences: string[],
  expectedCounts?: ExpectedCounts
): QuestionValidationResult => {
  const issues: string[] = [];

  if (expectedCounts) {
    if (questionSet.judgement_questions.length !== expectedCounts.judgement_count) {
      issues.push(
        `Expected ${expectedCounts.judgement_count} judgement questions, got ${questionSet.judgement_questions.length}.`
      );
    }
    if (
      questionSet.single_choice_questions.length !== expectedCounts.single_choice_count
    ) {
      issues.push(
        `Expected ${expectedCounts.single_choice_count} single-choice questions, got ${questionSet.single_choice_questions.length}.`
      );
    }
  }

  const sentenceCount = sentences.length;
  const seenQuestions = new Set<string>();

  questionSet.judgement_questions.forEach((question, index) => {
    const prefix = `Judgement Q${index + 1}`;

    if (question.question.length < 8) {
      issues.push(`${prefix}: question text is too short.`);
    }

    const normalizedText = question.question.toLowerCase();
    if (seenQuestions.has(normalizedText)) {
      issues.push(`${prefix}: duplicated question text.`);
    }
    seenQuestions.add(normalizedText);

    validateEvidenceIndices(
      question.evidence_sentence_indices,
      sentenceCount,
      prefix,
      issues
    );

    if (
      question.answer !== "NOT GIVEN" &&
      question.evidence_sentence_indices.length === 0
    ) {
      issues.push(
        `${prefix}: TRUE/FALSE questions must include evidence_sentence_indices.`
      );
    }

    if (question.evidence_sentence_indices.length > 0) {
      const evidenceText = question.evidence_sentence_indices
        .map((sentenceIndex) => sentences[sentenceIndex] ?? "")
        .join(" ");
      const questionTokens = extractContentTokens(question.question);
      const evidenceTokens = extractContentTokens(evidenceText);
      if (overlapCount(questionTokens, evidenceTokens) === 0) {
        issues.push(`${prefix}: question has no lexical overlap with evidence.`);
      }
    }
  });

  questionSet.single_choice_questions.forEach((question, index) => {
    const prefix = `Single-choice Q${index + 1}`;

    if (question.question.length < 8) {
      issues.push(`${prefix}: question text is too short.`);
    }

    const normalizedText = question.question.toLowerCase();
    if (seenQuestions.has(normalizedText)) {
      issues.push(`${prefix}: duplicated question text.`);
    }
    seenQuestions.add(normalizedText);

    if (question.options.length !== 4) {
      issues.push(`${prefix}: options must contain exactly 4 items.`);
    }

    const labels = question.options.map((option) => option.label);
    const labelSet = new Set(labels);
    if (
      labels.length !== 4 ||
      !labelSet.has("A") ||
      !labelSet.has("B") ||
      !labelSet.has("C") ||
      !labelSet.has("D")
    ) {
      issues.push(`${prefix}: options labels must be A, B, C, D exactly once.`);
    }

    if (!labelSet.has(question.answer)) {
      issues.push(`${prefix}: answer label is not present in options.`);
    }

    const optionTexts = question.options.map((option) => option.text.toLowerCase());
    if (optionTexts.some((text) => text.length < 2)) {
      issues.push(`${prefix}: option text is empty or too short.`);
    }
    if (new Set(optionTexts).size !== optionTexts.length) {
      issues.push(`${prefix}: options contain duplicated text.`);
    }

    validateEvidenceIndices(
      question.evidence_sentence_indices,
      sentenceCount,
      prefix,
      issues
    );
    if (question.evidence_sentence_indices.length === 0) {
      issues.push(`${prefix}: missing evidence_sentence_indices.`);
    } else {
      const evidenceText = question.evidence_sentence_indices
        .map((sentenceIndex) => sentences[sentenceIndex] ?? "")
        .join(" ");
      const questionTokens = extractContentTokens(question.question);
      const evidenceTokens = extractContentTokens(evidenceText);
      if (overlapCount(questionTokens, evidenceTokens) === 0) {
        issues.push(`${prefix}: question has no lexical overlap with evidence.`);
      }
    }
  });

  return {
    is_valid: issues.length === 0,
    issues,
  };
};
