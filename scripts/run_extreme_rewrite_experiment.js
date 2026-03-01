const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(ROOT, "experiments", "rewrite_extreme");

const DEFAULT_MODEL = "openai/gpt-5-mini";
const DEFAULT_SOURCE_DIR = "out_questions";
const DEFAULT_MAX_SOURCES = 3;
const DEFAULT_DELAY_MS = 1200;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const loadDotEnv = () => {
  const candidates = [path.resolve(ROOT, ".env"), path.resolve(ROOT, "server", ".env")];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
};

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
};

const parseNum = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const extractWords = (text) => text.match(/[A-Za-z0-9']+/g) ?? [];

const safeDivide = (numerator, denominator) =>
  denominator === 0 ? 0 : numerator / denominator;

const roundTwo = (value) => Number(value.toFixed(2));

const countSyllablesInWord = (word) => {
  if (!word) return 0;
  let value = word.toLowerCase();
  if (value.length > 1 && value.endsWith("e")) {
    value = value.slice(0, -1);
  }
  const groups = value.match(/[aeiouy]+/g);
  const count = groups ? groups.length : 0;
  return Math.max(1, count);
};

const stripCommonSuffix = (word) => {
  if (word.endsWith("ed") && word.length > 2) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 2) return word.slice(0, -2);
  return word;
};

const computeMetrics = (text) => {
  const words = extractWords(text);
  const wordCount = words.length;
  const sentenceCount = text
    .split(/[.!?]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean).length;
  const totalWordChars = words.reduce((sum, word) => sum + word.length, 0);
  const syllableCount = words.reduce(
    (sum, word) => sum + countSyllablesInWord(word),
    0
  );
  const complexWordCount = words.reduce((sum, word) => {
    const base = stripCommonSuffix(word.toLowerCase());
    return sum + (countSyllablesInWord(base) > 3 ? 1 : 0);
  }, 0);

  const avgSentenceLen = sentenceCount > 0 ? wordCount / sentenceCount : 0;
  const avgWordLen = wordCount > 0 ? totalWordChars / wordCount : 0;
  const complexWordRatio = safeDivide(complexWordCount, wordCount);
  const lettersPer100 = safeDivide(totalWordChars, wordCount) * 100;
  const sentencesPer100 = safeDivide(sentenceCount, wordCount) * 100;
  const complexPercent = complexWordRatio * 100;
  const asl = avgSentenceLen;
  const asw = safeDivide(syllableCount, wordCount);

  return {
    word_count: wordCount,
    sentence_count: sentenceCount,
    avg_sentence_len: roundTwo(avgSentenceLen),
    avg_word_len: roundTwo(avgWordLen),
    complex_word_ratio: roundTwo(complexWordRatio),
    flesch_reading_ease: roundTwo(206.835 - 1.015 * asl - 84.6 * asw),
    flesch_kincaid_grade: roundTwo(0.39 * asl + 11.8 * asw - 15.59),
    ari: roundTwo(
      4.71 * safeDivide(totalWordChars, wordCount) + 0.5 * asl - 21.43
    ),
    coleman_liau: roundTwo(
      0.0588 * lettersPer100 - 0.296 * sentencesPer100 - 15.8
    ),
    gunning_fog: roundTwo(0.4 * (asl + complexPercent)),
  };
};

const extractJson = (raw) => {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_err) {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Failed to parse JSON from model output");
  }
};

const buildPrompt = (article, mode) => {
  const direction =
    mode === "simpler"
      ? "Make the article MUCH simpler and easier to read."
      : "Make the article MUCH harder and more advanced.";

  const strategy =
    mode === "simpler"
      ? [
          "- Replace many difficult words with common, concrete words.",
          "- Reduce sentence length aggressively by splitting long sentences.",
          "- Simplify clause structures and reduce nesting.",
          "- Keep facts, entities, numbers, and paragraph order.",
        ]
      : [
          "- Replace many common words with advanced, low-frequency vocabulary.",
          "- Increase sentence length by combining ideas and adding subordinate clauses.",
          "- Use denser and more formal phrasing.",
          "- Keep facts, entities, numbers, and paragraph order.",
        ];

  return [
    "You are a professional reading-level rewriter.",
    direction,
    "Your rewrite should be a LARGE, measurable difficulty shift, not minor edits.",
    "Rules:",
    ...strategy,
    "- Do not add new facts.",
    "- Do not delete key facts.",
    "- Keep all paragraphs in the same sequence.",
    'Return JSON only: {"article":"..."}',
    "Article:",
    article,
  ].join("\n");
};

const callOpenRouter = async (prompt, model) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

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
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extreme_rewrite_response",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              article: { type: "string" },
            },
            required: ["article"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model returned empty content");

  return {
    content,
    usage: data?.usage ?? null,
    model: data?.model ?? model,
  };
};

const listSourceFiles = (sourceDir, maxSources) => {
  const fullDir = path.resolve(ROOT, sourceDir);
  const files = fs
    .readdirSync(fullDir)
    .filter((f) => f.endsWith(".json") && f !== "article_stats.json")
    .slice(0, maxSources);
  return files.map((f) => path.join(fullDir, f));
};

const readArticle = (fullPath) => {
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const article = Array.isArray(data.article)
    ? data.article.join("\n\n")
    : String(data.article || "");
  return {
    source_file: path.basename(fullPath),
    source_article_id: data.article_id || path.basename(fullPath, ".json"),
    article,
  };
};

const delta = (after, before) => roundTwo(after - before);

const main = async () => {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const model = args.model || DEFAULT_MODEL;
  const sourceDir = args["source-dir"] || DEFAULT_SOURCE_DIR;
  const maxSources = Math.max(1, Math.floor(parseNum(args["max-sources"], DEFAULT_MAX_SOURCES)));
  const delayMs = Math.max(0, Math.floor(parseNum(args["delay-ms"], DEFAULT_DELAY_MS)));
  const runId = args["run-id"] || `rewrite_extreme_${nowIso().replace(/[:.]/g, "-")}`;

  ensureDir(OUT_DIR);
  const logPath = path.join(OUT_DIR, `${runId}.jsonl`);
  const summaryPath = path.join(OUT_DIR, `${runId}.summary.json`);

  const sourceFiles = listSourceFiles(sourceDir, maxSources);
  const modes = ["simpler", "harder"];
  const jobs = [];

  for (const fullPath of sourceFiles) {
    const src = readArticle(fullPath);
    if (!src.article.trim()) continue;
    for (const mode of modes) {
      jobs.push({ ...src, mode });
    }
  }

  const results = [];
  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const started = Date.now();
    try {
      const beforeMetrics = computeMetrics(job.article);
      const prompt = buildPrompt(job.article, job.mode);
      const resp = await callOpenRouter(prompt, model);
      const parsed = extractJson(resp.content);
      const rewritten = String(parsed.article || "").trim();
      if (!rewritten) {
        throw new Error("JSON missing article");
      }
      const afterMetrics = computeMetrics(rewritten);
      const record = {
        ts: nowIso(),
        ok: true,
        index: i + 1,
        total: jobs.length,
        source_file: job.source_file,
        source_article_id: job.source_article_id,
        mode: job.mode,
        model: resp.model,
        elapsed_ms: Date.now() - started,
        token_usage: resp.usage,
        before: beforeMetrics,
        after: afterMetrics,
        delta: {
          flesch_kincaid_grade: delta(
            afterMetrics.flesch_kincaid_grade,
            beforeMetrics.flesch_kincaid_grade
          ),
          flesch_reading_ease: delta(
            afterMetrics.flesch_reading_ease,
            beforeMetrics.flesch_reading_ease
          ),
          avg_sentence_len: delta(
            afterMetrics.avg_sentence_len,
            beforeMetrics.avg_sentence_len
          ),
          complex_word_ratio: delta(
            afterMetrics.complex_word_ratio,
            beforeMetrics.complex_word_ratio
          ),
          ari: delta(afterMetrics.ari, beforeMetrics.ari),
          coleman_liau: delta(afterMetrics.coleman_liau, beforeMetrics.coleman_liau),
          gunning_fog: delta(afterMetrics.gunning_fog, beforeMetrics.gunning_fog),
        },
      };
      results.push(record);
      okCount += 1;
      fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
      console.log(
        `[REWRITE][OK] ${i + 1}/${jobs.length} ${job.source_file} mode=${job.mode} FK ${beforeMetrics.flesch_kincaid_grade}->${afterMetrics.flesch_kincaid_grade} FRE ${beforeMetrics.flesch_reading_ease}->${afterMetrics.flesch_reading_ease}`
      );
    } catch (err) {
      failCount += 1;
      const rec = {
        ts: nowIso(),
        ok: false,
        index: i + 1,
        total: jobs.length,
        source_file: job.source_file,
        source_article_id: job.source_article_id,
        mode: job.mode,
        elapsed_ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
      fs.appendFileSync(logPath, `${JSON.stringify(rec)}\n`, "utf8");
      console.error(
        `[REWRITE][FAIL] ${i + 1}/${jobs.length} ${job.source_file} mode=${job.mode} error=${rec.error}`
      );
    }

    if (delayMs > 0 && i < jobs.length - 1) {
      await sleep(delayMs);
    }
  }

  const byMode = { simpler: [], harder: [] };
  for (const r of results) byMode[r.mode].push(r);
  const mean = (arr, sel) => {
    if (arr.length === 0) return null;
    return roundTwo(arr.reduce((s, x) => s + sel(x), 0) / arr.length);
  };
  const summary = {
    run_id: runId,
    generated_at: nowIso(),
    model,
    source_dir: sourceDir,
    max_sources: maxSources,
    total_jobs: jobs.length,
    success_count: okCount,
    fail_count: failCount,
    mode_summary: {
      simpler: {
        n: byMode.simpler.length,
        mean_delta_fk: mean(byMode.simpler, (x) => x.delta.flesch_kincaid_grade),
        mean_delta_fre: mean(byMode.simpler, (x) => x.delta.flesch_reading_ease),
        mean_delta_asl: mean(byMode.simpler, (x) => x.delta.avg_sentence_len),
        mean_delta_cwr: mean(byMode.simpler, (x) => x.delta.complex_word_ratio),
      },
      harder: {
        n: byMode.harder.length,
        mean_delta_fk: mean(byMode.harder, (x) => x.delta.flesch_kincaid_grade),
        mean_delta_fre: mean(byMode.harder, (x) => x.delta.flesch_reading_ease),
        mean_delta_asl: mean(byMode.harder, (x) => x.delta.avg_sentence_len),
        mean_delta_cwr: mean(byMode.harder, (x) => x.delta.complex_word_ratio),
      },
    },
  };

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`[REWRITE][DONE] log=${path.relative(ROOT, logPath)} summary=${path.relative(ROOT, summaryPath)}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
