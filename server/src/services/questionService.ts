import { getLlmResponse } from "../llm/llmAdapter";
import type { OpenRouterModel } from "../llm/openrouterClient";
import { JsonExtractError, extractJson } from "../utils/jsonExtract";
import {
  normalizeQuestionSetFromUnknown,
  validateQuestionSet,
  type QuestionSet,
  type QuestionValidationResult,
} from "./questionValidator";

type GenerateQuestionsRequest = {
  article: string;
  title?: string;
  level: number;
  judgement_count: number;
  single_choice_count: number;
  model?: OpenRouterModel;
  max_repair_rounds?: number;
};

export type GenerateQuestionsResult = {
  title: string;
  sentence_count: number;
  judgement_questions: QuestionSet["judgement_questions"];
  single_choice_questions: QuestionSet["single_choice_questions"];
  validation: QuestionValidationResult;
  repair_rounds_used: number;
};

const QUESTION_SET_SCHEMA = {
  name: "reading_question_set",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      judgement_questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            number: { type: "integer" },
            question: { type: "string" },
            answer: {
              type: "string",
              enum: ["TRUE", "FALSE", "NOT GIVEN"],
            },
            evidence_sentence_indices: {
              type: "array",
              items: { type: "integer", minimum: 0 },
            },
          },
          required: ["number", "question", "answer", "evidence_sentence_indices"],
        },
      },
      single_choice_questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            number: { type: "integer" },
            question: { type: "string" },
            options: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: {
                    type: "string",
                    enum: ["A", "B", "C", "D"],
                  },
                  text: { type: "string" },
                },
                required: ["label", "text"],
              },
            },
            answer: {
              type: "string",
              enum: ["A", "B", "C", "D"],
            },
            evidence_sentence_indices: {
              type: "array",
              items: { type: "integer", minimum: 0 },
            },
          },
          required: [
            "number",
            "question",
            "options",
            "answer",
            "evidence_sentence_indices",
          ],
        },
      },
    },
    required: ["judgement_questions", "single_choice_questions"],
  },
} as const;

const splitSentences = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const sentenceListForPrompt = (sentences: string[]) =>
  sentences.map((sentence, index) => `[${index}] ${sentence}`).join("\n");

const makeTitle = (title: string | undefined, level: number) =>
  title?.trim() || `Generated Questions (L${level})`;

const buildGenerateQuestionsPrompt = (params: {
  title: string;
  article: string;
  sentences: string[];
  level: number;
  judgement_count: number;
  single_choice_count: number;
}) => {
  return [
    "You are an IELTS reading assessment writer.",
    `Create questions for the article titled: "${params.title}".`,
    `Difficulty level target: ${params.level} (1 easiest, 5 hardest).`,
    `Generate exactly ${params.judgement_count} TRUE/FALSE/NOT GIVEN questions.`,
    `Generate exactly ${params.single_choice_count} single-choice questions.`,
    "Every question must include evidence_sentence_indices using 0-based indices from the provided sentence list.",
    "For NOT GIVEN questions, evidence_sentence_indices can be empty.",
    "For TRUE/FALSE and single-choice questions, evidence_sentence_indices must not be empty.",
    "Single-choice questions must have exactly 4 options with labels A, B, C, D and exactly one correct answer label.",
    "Do not use markdown.",
    "Provide judgement_questions and single_choice_questions for the full set.",
    "Sentence list:",
    sentenceListForPrompt(params.sentences),
    "Article:",
    params.article,
  ].join("\n");
};

const buildRepairPrompt = (params: {
  title: string;
  article: string;
  sentences: string[];
  level: number;
  judgement_count: number;
  single_choice_count: number;
  issues: string[];
  currentQuestionSet: QuestionSet;
  round: number;
}) => {
  return [
    "You are fixing an IELTS question set.",
    `Round ${params.round}: repair the question set so all validation issues are resolved.`,
    `Title: "${params.title}"`,
    `Difficulty level target: ${params.level}`,
    `You must output exactly ${params.judgement_count} judgement questions and ${params.single_choice_count} single-choice questions.`,
    "Keep question intent close to the current set when possible, but fix invalid items.",
    "Validation issues to fix:",
    ...params.issues.map((issue) => `- ${issue}`),
    "Return a repaired full question set.",
    "Sentence list:",
    sentenceListForPrompt(params.sentences),
    "Current question set JSON:",
    JSON.stringify(params.currentQuestionSet),
    "Article:",
    params.article,
  ].join("\n");
};

const parseQuestionSet = (raw: string): QuestionSet => {
  const parsed = extractJson(raw);
  const normalized = normalizeQuestionSetFromUnknown(parsed);
  return {
    judgement_questions: normalized.judgement_questions.map((item, index) => ({
      ...item,
      number: index + 1,
    })),
    single_choice_questions: normalized.single_choice_questions.map((item, index) => ({
      ...item,
      number: index + 1,
    })),
  };
};

const ensureNonZeroQuestionCount = (request: GenerateQuestionsRequest) => {
  if (request.judgement_count + request.single_choice_count <= 0) {
    throw new Error("At least one question must be requested.");
  }
};

export const generateQuestions = async (
  request: GenerateQuestionsRequest
): Promise<GenerateQuestionsResult> => {
  ensureNonZeroQuestionCount(request);

  const title = makeTitle(request.title, request.level);
  const article = request.article.trim();
  const sentences = splitSentences(article);
  const expectedCounts = {
    judgement_count: request.judgement_count,
    single_choice_count: request.single_choice_count,
  };
  const maxRepairRounds = Math.min(Math.max(request.max_repair_rounds ?? 1, 0), 3);

  let questionSet: QuestionSet;
  try {
    const prompt = buildGenerateQuestionsPrompt({
      title,
      article,
      sentences,
      level: request.level,
      judgement_count: request.judgement_count,
      single_choice_count: request.single_choice_count,
    });
    const raw = await getLlmResponse(prompt, {
      model: request.model,
      structured_output: QUESTION_SET_SCHEMA,
    });
    questionSet = parseQuestionSet(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new JsonExtractError(`Failed to generate question JSON: ${message}`);
  }

  let validation = validateQuestionSet(questionSet, sentences, expectedCounts);
  let repairRoundsUsed = 0;

  for (let round = 1; round <= maxRepairRounds && !validation.is_valid; round += 1) {
    const repairPrompt = buildRepairPrompt({
      title,
      article,
      sentences,
      level: request.level,
      judgement_count: request.judgement_count,
      single_choice_count: request.single_choice_count,
      issues: validation.issues,
      currentQuestionSet: questionSet,
      round,
    });

    try {
      const raw = await getLlmResponse(repairPrompt, {
        model: request.model,
        structured_output: QUESTION_SET_SCHEMA,
      });
      const repairedSet = parseQuestionSet(raw);
      const repairedValidation = validateQuestionSet(
        repairedSet,
        sentences,
        expectedCounts
      );

      repairRoundsUsed = round;
      questionSet = repairedSet;
      validation = repairedValidation;
    } catch {
      repairRoundsUsed = round;
      continue;
    }
  }

  return {
    title,
    sentence_count: sentences.length,
    judgement_questions: questionSet.judgement_questions,
    single_choice_questions: questionSet.single_choice_questions,
    validation,
    repair_rounds_used: repairRoundsUsed,
  };
};
