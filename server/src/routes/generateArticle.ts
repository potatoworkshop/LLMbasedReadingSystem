import { Router } from "express";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { OPENROUTER_MODEL_OPTIONS } from "../llm/openrouterClient";
import { generateArticle } from "../services/articleService";
import { adjustArticleDifficulty } from "../services/difficultyAdjustService";
import { transformArticle } from "../services/lexicalTransform";
import { generateQuestions } from "../services/questionService";

const router = Router();
const SIMPLIFIED_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "out_simplified"
);
const GENERATED_QUESTIONS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "out_questions_generated"
);

const experimentMetaSchema = z
  .object({
    experiment_id: z.string().min(1).max(80),
    run_tag: z.string().min(1).max(40).optional(),
    batch_id: z.string().min(1).max(80).optional(),
    sample_id: z.string().min(1).max(120).optional(),
    notes: z.string().max(300).optional(),
  })
  .optional();

const sourceMetaSchema = z
  .object({
    source_article_id: z.string().min(1).optional(),
    source_dataset: z
      .enum(["generated", "generated_exp_ch5", "questions", "custom"])
      .optional(),
    source_file: z.string().min(1).optional(),
    source_level: z.number().int().min(1).max(5).optional(),
  })
  .optional();

const requestSchema = z.object({
  topic: z.string().min(1),
  level: z.number().int().min(1).max(5),
  target_words: z.number().int().min(80).max(1200),
  lang: z.literal("en"),
  model: z.enum(OPENROUTER_MODEL_OPTIONS).optional(),
  experiment: experimentMetaSchema,
});

const transformSchema = z.object({
  article: z.string().min(1),
  mode: z.enum(["simplify", "harder", "shorten"]).default("simplify"),
});

const adjustDifficultySchema = z.object({
  article: z.string().min(1),
  target_level: z.number().int().min(1).max(5),
  max_rounds: z.number().int().min(1).max(5).default(5),
  fidelity_threshold: z.number().min(0.5).max(1).default(0.72),
  model: z.enum(OPENROUTER_MODEL_OPTIONS).optional(),
  experiment: experimentMetaSchema,
  source: sourceMetaSchema,
});

const generateQuestionsSchema = z.object({
  article: z.string().min(1),
  title: z.string().min(1).optional(),
  level: z.number().int().min(1).max(5).default(3),
  judgement_count: z.number().int().min(0).max(10).default(5),
  single_choice_count: z.number().int().min(0).max(10).default(5),
  max_repair_rounds: z.number().int().min(0).max(3).default(1),
  source_article_id: z.string().min(1).optional(),
  topic: z.string().min(1).optional(),
  model: z.enum(OPENROUTER_MODEL_OPTIONS).optional(),
});

router.post("/generate-article", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await generateArticle(parsed.data);
    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to generate article",
      message,
    });
  }
});

router.post("/simplify-article", async (req, res) => {
  const parsed = transformSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const transformed = await transformArticle(
      parsed.data.article,
      parsed.data.mode
    );
    const article_id = uuidv4();
    await fs.mkdir(SIMPLIFIED_DIR, { recursive: true });
    const filePath = path.join(SIMPLIFIED_DIR, `${article_id}.json`);
    const fileBody = {
      article_id,
      mode: parsed.data.mode,
      original_article: parsed.data.article,
      article: transformed,
      transformed_at: new Date().toISOString(),
    };
    await fs.writeFile(filePath, `${JSON.stringify(fileBody, null, 2)}\n`, "utf8");

    return res.json({ article_id, article: transformed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to transform article",
      message,
    });
  }
});

router.post("/adjust-difficulty", async (req, res) => {
  const parsed = adjustDifficultySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const adjusted = await adjustArticleDifficulty(parsed.data);
    const article_id = uuidv4();
    await fs.mkdir(SIMPLIFIED_DIR, { recursive: true });
    const filePath = path.join(SIMPLIFIED_DIR, `${article_id}.json`);
    const fileBody = {
      article_id,
      mode: "difficulty_adjust",
      original_article: parsed.data.article,
      max_rounds: parsed.data.max_rounds,
      fidelity_threshold: parsed.data.fidelity_threshold,
      experiment: parsed.data.experiment ?? null,
      source: parsed.data.source ?? null,
      request_meta: {
        target_level: parsed.data.target_level,
        max_rounds: parsed.data.max_rounds,
        fidelity_threshold: parsed.data.fidelity_threshold,
      },
      ...adjusted,
      transformed_at: new Date().toISOString(),
    };
    await fs.writeFile(filePath, `${JSON.stringify(fileBody, null, 2)}\n`, "utf8");

    return res.json({
      article_id,
      ...adjusted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to adjust article difficulty",
      message,
    });
  }
});

router.post("/generate-questions", async (req, res) => {
  const parsed = generateQuestionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
  }

  const requestedTotal =
    parsed.data.judgement_count + parsed.data.single_choice_count;
  if (requestedTotal <= 0) {
    return res.status(400).json({
      error: "At least one question must be requested.",
    });
  }

  try {
    const generated = await generateQuestions(parsed.data);
    const article_id = uuidv4();

    await fs.mkdir(GENERATED_QUESTIONS_DIR, { recursive: true });
    const filePath = path.join(GENERATED_QUESTIONS_DIR, `${article_id}.json`);
    const fileBody = {
      article_id,
      source_article_id: parsed.data.source_article_id ?? null,
      topic: parsed.data.topic ?? null,
      title: {
        text: generated.title,
        level: parsed.data.level,
      },
      article: parsed.data.article
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean),
      judgement_questions: generated.judgement_questions,
      single_choice_questions: generated.single_choice_questions,
      validation: generated.validation,
      repair_rounds_used: generated.repair_rounds_used,
      generated_at: new Date().toISOString(),
    };
    await fs.writeFile(filePath, `${JSON.stringify(fileBody, null, 2)}\n`, "utf8");

    return res.json({
      article_id,
      ...generated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to generate questions",
      message,
    });
  }
});

router.get("/llm-models", (_req, res) => {
  return res.json({
    models: OPENROUTER_MODEL_OPTIONS,
    default_model: process.env.OPENROUTER_MODEL || OPENROUTER_MODEL_OPTIONS[0],
  });
});

export default router;
