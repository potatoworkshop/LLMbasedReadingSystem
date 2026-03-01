const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const safeReadJson = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
};

const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
};

const findLatestManifest = () => {
  const manifestDir = path.join(ROOT, "experiments", "ch5", "manifests");
  if (!fs.existsSync(manifestDir)) {
    throw new Error(`Manifest directory not found: ${manifestDir}`);
  }

  const files = fs
    .readdirSync(manifestDir)
    .filter((f) => /^adjusted_.*\.json$/i.test(f))
    .map((name) => {
      const fullPath = path.join(manifestDir, name);
      return {
        name,
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    throw new Error("No adjusted manifest file found.");
  }
  return files[0].fullPath;
};

const normalizedCenterDistance = (value, range) => {
  const min = Number(range[0]);
  const max = Number(range[1]);
  const center = (min + max) / 2;
  const halfSpan = (max - min) / 2 || 1;
  return Math.abs(value - center) / halfSpan;
};

const distanceToProfile = (metrics, profile) => {
  if (
    Array.isArray(profile?.mean_target) &&
    profile.mean_target.length === 2
  ) {
    const readabilityMean =
      (Number(metrics.flesch_kincaid_grade) +
        Number(metrics.ari) +
        Number(metrics.coleman_liau) +
        Number(metrics.gunning_fog)) /
      4;
    return Number(
      normalizedCenterDistance(readabilityMean, profile.mean_target).toFixed(4)
    );
  }

  const targets = profile?.targets || {};
  const fk = normalizedCenterDistance(
    Number(metrics.flesch_kincaid_grade),
    targets.flesch_kincaid_grade
  );
  const fre = normalizedCenterDistance(
    Number(metrics.flesch_reading_ease),
    targets.flesch_reading_ease
  );
  const ari = normalizedCenterDistance(Number(metrics.ari), targets.ari);
  const cli = normalizedCenterDistance(
    Number(metrics.coleman_liau),
    targets.coleman_liau
  );
  const gf = normalizedCenterDistance(
    Number(metrics.gunning_fog),
    targets.gunning_fog
  );
  return Number(((fk + fre + ari + cli + gf) / 5).toFixed(4));
};

const csvEscape = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const toCsv = (rows, headers) => {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Usage:
  node scripts/export_adjust_round_history_csv.js [manifestPath] [--out output.csv]

If manifestPath is omitted, the latest adjusted manifest in experiments/ch5/manifests is used.
`);
    process.exit(0);
  }

  const manifestPathArg = args._[0];
  const manifestPath = manifestPathArg
    ? path.resolve(ROOT, manifestPathArg)
    : findLatestManifest();

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest = safeReadJson(manifestPath);
  const records = Array.isArray(manifest.records) ? manifest.records : [];

  const outDir = path.join(ROOT, "experiments", "ch5", "analysis");
  fs.mkdirSync(outDir, { recursive: true });

  const outPath =
    args.out && typeof args.out === "string"
      ? path.resolve(ROOT, args.out)
      : path.join(
          outDir,
          `round_history_${manifest.batch_id || "batch"}_${nowStamp()}.csv`
        );

  const rows = [];

  for (const rec of records) {
    const articleId = rec.article_id;
    if (!articleId) continue;

    const articlePath = path.join(ROOT, "out_simplified", `${articleId}.json`);
    if (!fs.existsSync(articlePath)) continue;

    const article = safeReadJson(articlePath);
    const history = Array.isArray(article.history) ? article.history : [];
    const profile = article.profile;
    if (!profile?.targets) continue;

    let bestBefore = distanceToProfile(article.original_metrics, profile);
    let llmErrorsSoFar = 0;

    for (const h of history) {
      const round = Number(h.round || 0);
      const distance = Number(h.distance_to_target);
      const accepted = Boolean(h.accepted);
      const reason = String(h.reason || "");

      if (reason.startsWith("llm_error")) {
        llmErrorsSoFar += 1;
      }

      const improvedThisRound = Number.isFinite(distance) && distance < bestBefore;
      const bestAfter =
        accepted && Number.isFinite(distance) && distance < bestBefore
          ? distance
          : bestBefore;

      rows.push({
        batch_id: manifest.batch_id || "",
        experiment_id: manifest.experiment_id || "",
        model: rec.model || article.model || "",
        sample_id: rec.sample_id || "",
        article_id: articleId,
        target_level: rec.target_level ?? article.target_level ?? "",
        hit_target_final: article.hit_target ?? "",
        round,
        accepted,
        reason,
        distance_to_target: Number.isFinite(distance) ? distance : "",
        best_distance_before: bestBefore,
        best_distance_after: bestAfter,
        distance_delta_vs_best_before:
          Number.isFinite(distance) ? Number((distance - bestBefore).toFixed(4)) : "",
        improved_this_round: improvedThisRound,
        fidelity_overall: h.fidelity?.overall ?? "",
        fk: h.metrics?.flesch_kincaid_grade ?? "",
        fre: h.metrics?.flesch_reading_ease ?? "",
        ari: h.metrics?.ari ?? "",
        coleman_liau: h.metrics?.coleman_liau ?? "",
        gunning_fog: h.metrics?.gunning_fog ?? "",
        llm_errors_so_far: llmErrorsSoFar,
      });

      bestBefore = bestAfter;
    }
  }

  const headers = [
    "batch_id",
    "experiment_id",
    "model",
    "sample_id",
    "article_id",
    "target_level",
    "hit_target_final",
    "round",
    "accepted",
    "reason",
    "distance_to_target",
    "best_distance_before",
    "best_distance_after",
    "distance_delta_vs_best_before",
    "improved_this_round",
    "fidelity_overall",
    "fk",
    "fre",
    "ari",
    "coleman_liau",
    "gunning_fog",
    "llm_errors_so_far",
  ];

  fs.writeFileSync(outPath, toCsv(rows, headers), "utf8");
  console.log(
    `[EXPORT][DONE] rows=${rows.length} manifest=${path.relative(
      ROOT,
      manifestPath
    )} output=${path.relative(ROOT, outPath)}`
  );
};

main();
