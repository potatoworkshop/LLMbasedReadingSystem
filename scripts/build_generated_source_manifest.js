const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE_DIR = path.join(ROOT, "out_generated");
const OUTPUT_DIR = path.join(ROOT, "experiments", "ch5", "manifests");

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const main = () => {
  const sourceDirArg = process.argv[2];
  const sourceDir = sourceDirArg
    ? path.resolve(ROOT, sourceDirArg)
    : DEFAULT_SOURCE_DIR;

  const files = fs
    .readdirSync(sourceDir)
    .filter((f) => f.endsWith(".json") && f !== "article_stats.json");

  const records = [];
  for (const file of files) {
    const fullPath = path.join(sourceDir, file);
    const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    if (!data?.experiment?.batch_id) {
      continue;
    }
    records.push({
      file,
      article_id: data.article_id || path.basename(file, ".json"),
      topic: data.topic ?? null,
      level: Number.isInteger(data.level) ? data.level : null,
      target_words: Number.isInteger(data.target_words) ? data.target_words : null,
      model: data.model ?? null,
      provider: data.provider ?? null,
      batch_id: data.experiment.batch_id,
      experiment_id: data.experiment.experiment_id ?? null,
      sample_id: data.experiment.sample_id ?? null,
      generated_at: data.generated_at ?? null,
      word_count: data.metrics?.word_count ?? null,
      source_dir: path.relative(ROOT, sourceDir).replace(/\\/g, "/"),
    });
  }

  records.sort((a, b) => {
    if ((a.batch_id || "") !== (b.batch_id || "")) {
      return (a.batch_id || "").localeCompare(b.batch_id || "");
    }
    if ((a.model || "") !== (b.model || "")) {
      return (a.model || "").localeCompare(b.model || "");
    }
    if ((a.level ?? 0) !== (b.level ?? 0)) {
      return (a.level ?? 0) - (b.level ?? 0);
    }
    if ((a.target_words ?? 0) !== (b.target_words ?? 0)) {
      return (a.target_words ?? 0) - (b.target_words ?? 0);
    }
    return (a.sample_id || a.file).localeCompare(b.sample_id || b.file);
  });

  const byBatch = {};
  const byModel = {};
  for (const r of records) {
    byBatch[r.batch_id] = (byBatch[r.batch_id] || 0) + 1;
    byModel[r.model || "unknown"] = (byModel[r.model || "unknown"] || 0) + 1;
  }

  ensureDir(OUTPUT_DIR);
  const outPath = path.join(
    OUTPUT_DIR,
    `generated_source_manifest_${nowStamp()}.json`
  );
  const output = {
    source_dir: path.relative(ROOT, sourceDir).replace(/\\/g, "/"),
    total: records.length,
    by_batch: byBatch,
    by_model: byModel,
    generated_at: new Date().toISOString(),
    records,
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(
    JSON.stringify(
      {
        manifest: path.relative(ROOT, outPath).replace(/\\/g, "/"),
        total: records.length,
        by_batch: byBatch,
        by_model: byModel,
      },
      null,
      2
    )
  );
};

main();

