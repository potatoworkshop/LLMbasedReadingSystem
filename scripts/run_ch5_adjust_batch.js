const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

const articleTextFromJson = (data) => {
  if (typeof data.article === "string") return data.article;
  if (Array.isArray(data.article)) return data.article.join("\n\n");
  return "";
};

const inferSourceLevel = (data) => {
  if (Number.isInteger(data.level)) return data.level;
  if (Number.isInteger(data.target_level)) return data.target_level;
  return undefined;
};

const loadSourceRecords = (config) => {
  if (config.source_manifest) {
    const manifest = readJson(path.resolve(ROOT, config.source_manifest));
    return (manifest.records || []).map((r) => ({
      file: r.file || null,
      fullPath:
        r.source_dir && r.file
          ? path.resolve(ROOT, r.source_dir, r.file)
          : undefined,
      source_article_id: r.article_id || null,
      source_level: r.level,
      source_dataset: config.source_dataset || "generated_exp_ch5",
      article: null,
      from_manifest: r,
    }));
  }

  const sourceDir = path.resolve(ROOT, config.source_dir);
  const files = fs
    .readdirSync(sourceDir)
    .filter((f) => f.endsWith(".json") && f !== "article_stats.json");

  return files.map((file) => {
    const fullPath = path.join(sourceDir, file);
    const data = readJson(fullPath);
    return {
      file,
      fullPath,
      source_article_id: data.article_id || path.basename(file, ".json"),
      source_level: inferSourceLevel(data),
      source_dataset: config.source_dataset || "custom",
      article: articleTextFromJson(data),
      title: typeof data.title === "string" ? data.title : data.title?.text,
    };
  });
};

const applySourceFilters = (records, config) => {
  const filters = config.source_filters || {};
  return records.filter((rec) => {
    if (Array.isArray(filters.batch_ids) && filters.batch_ids.length > 0) {
      const batchId = rec.from_manifest?.batch_id ?? null;
      if (!filters.batch_ids.includes(batchId)) {
        return false;
      }
    }
    if (Array.isArray(filters.models) && filters.models.length > 0) {
      const model = rec.from_manifest?.model ?? null;
      if (!filters.models.includes(model)) {
        return false;
      }
    }
    if (Array.isArray(filters.levels) && filters.levels.length > 0) {
      if (!filters.levels.includes(rec.source_level)) {
        return false;
      }
    }
    if (
      Array.isArray(filters.target_words) &&
      filters.target_words.length > 0 &&
      rec.from_manifest
    ) {
      if (!filters.target_words.includes(rec.from_manifest.target_words)) {
        return false;
      }
    }
    return true;
  });
};

const resolveTargetLevels = (config, sourceLevel) => {
  if (Array.isArray(config.target_levels) && config.target_levels.length > 0) {
    let levels = config.target_levels.slice();
    if (config.skip_same_level && Number.isInteger(sourceLevel)) {
      levels = levels.filter((lvl) => lvl !== sourceLevel);
    }
    return levels;
  }

  if (config.relative_targets && Number.isInteger(sourceLevel)) {
    const levels = [];
    for (const delta of config.relative_targets) {
      const target = sourceLevel + delta;
      if (target >= 1 && target <= 5 && target !== sourceLevel) {
        levels.push(target);
      }
    }
    return [...new Set(levels)];
  }

  return [];
};

const main = async () => {
  const configArg = process.argv[2];
  if (!configArg) {
    console.error("Usage: node scripts/run_ch5_adjust_batch.js <config.json>");
    process.exit(1);
  }

  const configPath = path.resolve(ROOT, configArg);
  const config = readJson(configPath);
  const apiBase = config.api_base || "http://localhost:3001/api";
  const delayMs = Number(config.delay_ms || 0);

  let sources = loadSourceRecords(config);
  sources = applySourceFilters(sources, config);
  if (Number.isInteger(config.max_sources)) {
    sources = sources.slice(0, config.max_sources);
  }

  const jobs = [];
  for (const src of sources) {
    if (!src.article && src.fullPath) {
      const data = readJson(src.fullPath);
      src.article = articleTextFromJson(data);
    }
    if (!src.article) continue;

    const targetLevels = resolveTargetLevels(config, src.source_level);
    for (const targetLevel of targetLevels) {
      jobs.push({
        article: src.article,
        target_level: targetLevel,
        max_rounds: config.max_rounds ?? 5,
        fidelity_threshold: config.fidelity_threshold ?? 0.72,
        model: config.model,
        experiment: {
          experiment_id: config.experiment_id,
          run_tag: config.run_tag,
          batch_id: config.batch_id,
          sample_id: `${(src.file || src.source_article_id || "src").replace(/\.json$/i, "")}_to_l${targetLevel}`,
        },
        source: {
          source_article_id: src.source_article_id || undefined,
          source_dataset: src.source_dataset || undefined,
          source_file: src.file || undefined,
          source_level: Number.isInteger(src.source_level) ? src.source_level : undefined,
        },
      });
    }
  }

  const logsDir = path.resolve(ROOT, "experiments", "ch5", "logs");
  const manifestsDir = path.resolve(ROOT, "experiments", "ch5", "manifests");
  ensureDir(logsDir);
  ensureDir(manifestsDir);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(
    logsDir,
    `adjust_${config.batch_id || "batch"}_${stamp}.jsonl`
  );
  const manifestPath = path.join(
    manifestsDir,
    `adjusted_${config.batch_id || "batch"}_${stamp}.json`
  );

  const successRecords = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const started = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 900000); // 15 minutes timeout

    try {
      const response = await fetch(`${apiBase}/adjust-difficulty`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        failCount += 1;
        fs.appendFileSync(
          logPath,
          `${JSON.stringify({
            ts: nowIso(),
            ok: false,
            index: i + 1,
            total: jobs.length,
            status: response.status,
            target_level: job.target_level,
            source: job.source,
            sample_id: job.experiment.sample_id,
            error: body,
            elapsed_ms: Date.now() - started,
          })}\n`,
          "utf8"
        );
        console.error(
          `[ADJ][FAIL] ${i + 1}/${jobs.length} ${job.experiment.sample_id} status=${response.status}`
        );
      } else {
        successCount += 1;
        const record = {
          ts: nowIso(),
          ok: true,
          index: i + 1,
          total: jobs.length,
          article_id: body.article_id,
          sample_id: job.experiment.sample_id,
          source: job.source,
          target_level: job.target_level,
          hit_target: body.hit_target ?? null,
          rounds_used: body.rounds_used ?? null,
          fidelity_overall: body.fidelity?.overall ?? null,
          provider: body.provider ?? null,
          model: body.model ?? config.model ?? null,
          token_usage: body.token_usage ?? null,
          elapsed_ms: Date.now() - started,
        };
        successRecords.push(record);
        fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
        const tokens = body.token_usage?.total_tokens ?? "na";
        console.log(
          `[ADJ][OK] ${i + 1}/${jobs.length} ${record.sample_id} article_id=${record.article_id} hit=${record.hit_target} fidelity=${record.fidelity_overall} tokens=${tokens} time=${record.elapsed_ms}ms`
        );
      }
    } catch (error) {
      clearTimeout(timeoutId);
      failCount += 1;
      const errMsg = error instanceof Error ? error.message : String(error);
      fs.appendFileSync(
        logPath,
        `${JSON.stringify({
          ts: nowIso(),
          ok: false,
          index: i + 1,
          total: jobs.length,
          sample_id: job.experiment.sample_id,
          target_level: job.target_level,
          source: job.source,
          error: errMsg,
          elapsed_ms: Date.now() - started,
        })}\n`,
        "utf8"
      );
      console.error(
        `[ADJ][FAIL] ${i + 1}/${jobs.length} ${job.experiment.sample_id} error=${errMsg}`
      );
    }

    if (delayMs > 0 && i < jobs.length - 1) {
      await sleep(delayMs);
    }
  }

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        experiment_id: config.experiment_id,
        run_tag: config.run_tag || null,
        batch_id: config.batch_id || null,
        source_dataset: config.source_dataset || null,
        total_jobs: jobs.length,
        success_count: successCount,
        fail_count: failCount,
        generated_at: nowIso(),
        records: successRecords,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    `[ADJ][DONE] total=${jobs.length} success=${successCount} fail=${failCount} log=${path.relative(
      ROOT,
      logPath
    )} manifest=${path.relative(ROOT, manifestPath)}`
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
