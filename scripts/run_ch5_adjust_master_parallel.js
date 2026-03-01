const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

const parseArgs = (argv) => {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
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

const sanitize = (value) => String(value).replace(/[^\w.-]+/g, "_");

const listSourceRecords = (sourceCfg) => {
  const sourceDir = path.resolve(ROOT, sourceCfg.source_dir);
  const files = fs
    .readdirSync(sourceDir)
    .filter((f) => f.endsWith(".json") && f !== "article_stats.json")
    .sort();

  return files.map((file) => {
    const fullPath = path.join(sourceDir, file);
    const data = readJson(fullPath);
    return {
      file,
      fullPath,
      source_article_id: data.article_id || path.basename(file, ".json"),
      source_level: inferSourceLevel(data),
      source_dataset: sourceCfg.source_dataset || "custom",
      source_id: sourceCfg.source_id || sourceCfg.source_dataset || "source",
      article: articleTextFromJson(data),
    };
  });
};

const buildBaseUnits = (masterConfig, sourceRecordsById) => {
  const units = [];
  const targetLevels = masterConfig.target_levels || [];
  const nPerLevel = Math.max(1, Number(masterConfig.n_per_level || 8));

  for (const sourceCfg of masterConfig.sources || []) {
    const sourceId =
      sourceCfg.source_id || sourceCfg.source_dataset || sourceCfg.source_dir;
    const records = sourceRecordsById[sourceId] || [];
    if (records.length === 0) {
      throw new Error(`No source records found for source_id=${sourceId}`);
    }

    for (let t = 0; t < targetLevels.length; t += 1) {
      const targetLevel = targetLevels[t];
      for (let i = 0; i < nPerLevel; i += 1) {
        // Deterministic cycle selection
        const idx = (t * nPerLevel + i) % records.length;
        const rec = records[idx];
        units.push({
          source_id: sourceId,
          target_level: targetLevel,
          repeat_index: i + 1,
          source_record: rec,
        });
      }
    }
  }
  return units;
};

const buildJobs = (masterConfig, baseUnits) => {
  const jobs = [];
  const models = masterConfig.models || [];
  const experimentId = masterConfig.experiment_id;
  const runTag = masterConfig.run_tag;

  for (const model of models) {
    for (const unit of baseUnits) {
      const src = unit.source_record;
      const sampleId = `${sanitize(unit.source_id)}_${sanitize(
        src.source_article_id
      )}_to_l${unit.target_level}_r${unit.repeat_index}_${sanitize(model)}`;
      jobs.push({
        article: src.article,
        target_level: unit.target_level,
        max_rounds: masterConfig.max_rounds ?? 5,
        fidelity_threshold: masterConfig.fidelity_threshold ?? 0.72,
        model,
        experiment: {
          experiment_id: experimentId,
          run_tag: runTag,
          batch_id: "", // Filled per micro-batch
          sample_id: sampleId,
        },
        source: {
          source_article_id: src.source_article_id || undefined,
          source_dataset: src.source_dataset || undefined,
          source_file: src.file || undefined,
          source_level: Number.isInteger(src.source_level)
            ? src.source_level
            : undefined,
        },
      });
    }
  }
  return jobs;
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

const runMicroBatch = async (params) => {
  const {
    apiBase,
    timeoutMs,
    delayMs,
    batchId,
    experimentId,
    runTag,
    microBatchIndex,
    jobs,
    logsDir,
    manifestsDir,
  } = params;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logsDir, `adjust_${batchId}_${stamp}.jsonl`);
  const manifestPath = path.join(manifestsDir, `adjusted_${batchId}_${stamp}.json`);

  let successCount = 0;
  let failCount = 0;
  const successRecords = [];

  for (let i = 0; i < jobs.length; i += 1) {
    const job = { ...jobs[i] };
    job.experiment = {
      ...(job.experiment || {}),
      experiment_id: experimentId,
      run_tag: runTag,
      batch_id: batchId,
    };

    const started = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
        const rec = {
          ts: nowIso(),
          ok: false,
          micro_batch_index: microBatchIndex,
          index: i + 1,
          total: jobs.length,
          status: response.status,
          sample_id: job.experiment?.sample_id,
          target_level: job.target_level,
          model: job.model,
          source: job.source,
          error: body,
          elapsed_ms: Date.now() - started,
        };
        fs.appendFileSync(logPath, `${JSON.stringify(rec)}\n`, "utf8");
        continue;
      }

      successCount += 1;
      const rec = {
        ts: nowIso(),
        ok: true,
        micro_batch_index: microBatchIndex,
        index: i + 1,
        total: jobs.length,
        article_id: body.article_id,
        sample_id: job.experiment?.sample_id,
        target_level: job.target_level,
        model: body.model ?? job.model ?? null,
        provider: body.provider ?? null,
        source: job.source,
        hit_target: body.hit_target ?? null,
        rounds_used: body.rounds_used ?? null,
        fidelity_overall: body.fidelity?.overall ?? null,
        token_usage: body.token_usage ?? null,
        elapsed_ms: Date.now() - started,
      };
      successRecords.push(rec);
      fs.appendFileSync(logPath, `${JSON.stringify(rec)}\n`, "utf8");
    } catch (err) {
      clearTimeout(timeoutId);
      failCount += 1;
      const rec = {
        ts: nowIso(),
        ok: false,
        micro_batch_index: microBatchIndex,
        index: i + 1,
        total: jobs.length,
        sample_id: job.experiment?.sample_id,
        target_level: job.target_level,
        model: job.model,
        source: job.source,
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms: Date.now() - started,
      };
      fs.appendFileSync(logPath, `${JSON.stringify(rec)}\n`, "utf8");
    }

    if (delayMs > 0 && i < jobs.length - 1) {
      await sleep(delayMs);
    }
  }

  const manifest = {
    experiment_id: experimentId,
    run_tag: runTag,
    batch_id: batchId,
    micro_batch_index: microBatchIndex,
    total_jobs: jobs.length,
    success_count: successCount,
    fail_count: failCount,
    generated_at: nowIso(),
    records: successRecords,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    batch_id: batchId,
    micro_batch_index: microBatchIndex,
    total_jobs: jobs.length,
    success_count: successCount,
    fail_count: failCount,
    log_path: path.relative(ROOT, logPath),
    manifest_path: path.relative(ROOT, manifestPath),
  };
};

const runParallelBatches = async (tasks, concurrency) => {
  const results = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }).map(
    async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= tasks.length) return;
        const task = tasks[idx];
        const result = await runMicroBatch(task);
        results.push(result);
        console.log(
          `[MAIN-N8][MB-DONE] batch=${result.batch_id} success=${result.success_count}/${result.total_jobs} fail=${result.fail_count}`
        );
      }
    }
  );

  await Promise.all(workers);
  return results.sort((a, b) => a.micro_batch_index - b.micro_batch_index);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node scripts/run_ch5_adjust_master_parallel.js <master_config.json> [options]

Options:
  --config <path>    Master config path (alternative to positional arg)
  --mb-start <n>     Run micro-batches from index n (1-based)
  --mb-end <n>       Run micro-batches up to index n (1-based)
  --mb-list <a,b,c>  Run only specific micro-batch indexes (1-based)
`);
    process.exit(0);
  }

  const configArg = args.config || args._[0];
  if (!configArg) {
    console.error(
      "Usage: node scripts/run_ch5_adjust_master_parallel.js <master_config.json> or --config <master_config.json>"
    );
    process.exit(1);
  }

  const configPath = path.resolve(ROOT, configArg);
  const cfg = readJson(configPath);

  const logsDir = path.resolve(ROOT, "experiments", "ch5", "logs");
  const manifestsDir = path.resolve(ROOT, "experiments", "ch5", "manifests");
  const analysisDir = path.resolve(ROOT, "experiments", "ch5", "analysis");
  ensureDir(logsDir);
  ensureDir(manifestsDir);
  ensureDir(analysisDir);

  const sourceRecordsById = {};
  for (const sourceCfg of cfg.sources || []) {
    const sourceId =
      sourceCfg.source_id || sourceCfg.source_dataset || sourceCfg.source_dir;
    sourceRecordsById[sourceId] = listSourceRecords(sourceCfg);
  }

  const baseUnits = buildBaseUnits(cfg, sourceRecordsById);
  const jobs = buildJobs(cfg, baseUnits);

  const batchSize = Math.max(1, Number(cfg.batch_size || 10));
  const microBatches = chunk(jobs, batchSize);
  const parallelBatches = Math.max(1, Number(cfg.parallel_batches || 4));
  const timeoutMs = Math.max(1000, Number(cfg.request_timeout_ms || 1200000));
  const delayMs = Math.max(0, Number(cfg.delay_ms_between_jobs_in_batch || 0));

  const planStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = path.join(
    analysisDir,
    `main_n8_plan_${sanitize(cfg.run_tag || "run")}_${planStamp}.json`
  );
  fs.writeFileSync(
    planPath,
    `${JSON.stringify(
      {
        generated_at: nowIso(),
        config_path: path.relative(ROOT, configPath),
        total_jobs: jobs.length,
        batch_size: batchSize,
        total_micro_batches: microBatches.length,
        parallel_batches: parallelBatches,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    `[MAIN-N8][PLAN] jobs=${jobs.length} micro_batches=${microBatches.length} batch_size=${batchSize} parallel=${parallelBatches}`
  );

  const allTasks = microBatches.map((jobsInBatch, i) => {
    const mbNum = String(i + 1).padStart(2, "0");
    const batchId = `${sanitize(cfg.run_tag || "main_n8")}_mb${mbNum}`;
    return {
      apiBase: cfg.api_base || "http://localhost:3001/api",
      timeoutMs,
      delayMs,
      batchId,
      experimentId: cfg.experiment_id,
      runTag: cfg.run_tag,
      microBatchIndex: i + 1,
      jobs: jobsInBatch,
      logsDir,
      manifestsDir,
    };
  });

  const totalMb = allTasks.length;
  let selectedTasks = allTasks;

  if (typeof args["mb-list"] === "string" && args["mb-list"].trim()) {
    const set = new Set(
      args["mb-list"]
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= totalMb)
    );
    selectedTasks = allTasks.filter((t) => set.has(t.microBatchIndex));
  } else {
    const mbStart = Number(args["mb-start"] || 1);
    const mbEnd = Number(args["mb-end"] || totalMb);
    const start = Number.isInteger(mbStart) ? Math.max(1, mbStart) : 1;
    const end = Number.isInteger(mbEnd) ? Math.min(totalMb, mbEnd) : totalMb;
    selectedTasks = allTasks.filter(
      (t) => t.microBatchIndex >= start && t.microBatchIndex <= end
    );
  }

  if (selectedTasks.length === 0) {
    console.error(
      `[MAIN-N8][ERROR] No micro-batch selected. total_micro_batches=${totalMb}`
    );
    process.exit(1);
  }

  console.log(
    `[MAIN-N8][SELECT] selected_micro_batches=${selectedTasks
      .map((t) => t.microBatchIndex)
      .join(",")}`
  );

  const results = await runParallelBatches(selectedTasks, parallelBatches);

  const sum = results.reduce(
    (acc, cur) => {
      acc.total_jobs += cur.total_jobs;
      acc.success_count += cur.success_count;
      acc.fail_count += cur.fail_count;
      return acc;
    },
    { total_jobs: 0, success_count: 0, fail_count: 0 }
  );

  const reportPath = path.join(
    analysisDir,
    `main_n8_report_${sanitize(cfg.run_tag || "run")}_${planStamp}.json`
  );
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generated_at: nowIso(),
        config_path: path.relative(ROOT, configPath),
        total_micro_batches: results.length,
        ...sum,
        micro_batches: results,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    `[MAIN-N8][DONE] jobs=${sum.total_jobs} success=${sum.success_count} fail=${sum.fail_count} report=${path.relative(
      ROOT,
      reportPath
    )}`
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
