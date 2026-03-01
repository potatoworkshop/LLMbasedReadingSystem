const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nowIso = () => new Date().toISOString();

const buildJobs = (config) => {
  const jobs = [];
  const repeats = Math.max(1, Number(config.repeats || 1));
  for (const topic of config.topics || []) {
    for (const level of config.levels || []) {
      for (const targetWords of config.target_words || []) {
        for (let r = 1; r <= repeats; r += 1) {
          jobs.push({
            topic,
            level,
            target_words: targetWords,
            lang: "en",
            model: config.model,
            experiment: {
              experiment_id: config.experiment_id,
              run_tag: config.run_tag,
              batch_id: config.batch_id,
              sample_id: `${String(topic).replace(/\s+/g, "_")}_l${level}_w${targetWords}_r${r}`,
            },
          });
        }
      }
    }
  }
  return jobs;
};

const main = async () => {
  const configArg = process.argv[2];
  if (!configArg) {
    console.error("Usage: node scripts/run_ch5_generation_batch.js <config.json>");
    process.exit(1);
  }

  const configPath = path.resolve(ROOT, configArg);
  const config = readJson(configPath);
  const apiBase = config.api_base || "http://localhost:3001/api";
  const delayMs = Number(config.delay_ms || 0);

  const jobs = buildJobs(config);
  const logsDir = path.resolve(ROOT, "experiments", "ch5", "logs");
  const manifestsDir = path.resolve(ROOT, "experiments", "ch5", "manifests");
  ensureDir(logsDir);
  ensureDir(manifestsDir);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(
    logsDir,
    `generation_${config.batch_id || "batch"}_${stamp}.jsonl`
  );
  const manifestPath = path.join(
    manifestsDir,
    `generated_${config.batch_id || "batch"}_${stamp}.json`
  );

  const successRecords = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const started = Date.now();
    try {
      const response = await fetch(`${apiBase}/generate-article`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
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
            job,
            error: body,
            elapsed_ms: Date.now() - started,
          })}\n`,
          "utf8"
        );
        console.error(
          `[GEN][FAIL] ${i + 1}/${jobs.length} ${job.experiment.sample_id} status=${response.status}`
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
          topic: job.topic,
          level: job.level,
          target_words: job.target_words,
          word_count: body.metrics?.word_count ?? null,
          provider: body.provider ?? null,
          model: body.model ?? config.model ?? null,
          token_usage: body.token_usage ?? null,
          elapsed_ms: Date.now() - started,
        };
        successRecords.push(record);
        fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
        const tokens = body.token_usage?.total_tokens ?? "na";
        console.log(
          `[GEN][OK] ${i + 1}/${jobs.length} ${record.sample_id} article_id=${record.article_id} words=${record.word_count} tokens=${tokens} time=${record.elapsed_ms}ms`
        );
      }
    } catch (error) {
      failCount += 1;
      const errMsg = error instanceof Error ? error.message : String(error);
      fs.appendFileSync(
        logPath,
        `${JSON.stringify({
          ts: nowIso(),
          ok: false,
          index: i + 1,
          total: jobs.length,
          job,
          error: errMsg,
          elapsed_ms: Date.now() - started,
        })}\n`,
        "utf8"
      );
      console.error(
        `[GEN][FAIL] ${i + 1}/${jobs.length} ${job.experiment.sample_id} error=${errMsg}`
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
        source: "generate-article",
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
    `[GEN][DONE] total=${jobs.length} success=${successCount} fail=${failCount} log=${path.relative(
      ROOT,
      logPath
    )} manifest=${path.relative(ROOT, manifestPath)}`
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

