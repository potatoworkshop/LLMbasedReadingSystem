const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_MODEL = "x-ai/grok-4.1-fast";

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

const parseIntList = (value, fallback) => {
  if (!value) return fallback;
  const list = String(value)
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n));
  return list.length > 0 ? list : fallback;
};

const timestampCompact = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Usage:
  node scripts/run_ch5_adjust_questions_small_batch.js [options]

Defaults (small-batch for real articles in out_questions):
  --max-sources 3
  --target-levels 2,4
  --max-rounds 5
  --fidelity-threshold 0.72
  --delay-ms 1000

Options:
  --model <name>                 LLM model name (passed to backend), default: ${DEFAULT_MODEL}
  --api-base <url>               default: http://localhost:3001/api
  --max-sources <n>              how many source articles to sample from out_questions
  --target-levels <a,b,...>      explicit target levels, e.g. 2,4
  --relative-targets <d1,d2,...> relative target deltas, e.g. -1,1 (uses source level if present)
  --skip-same-level <true|false> default: false
  --max-rounds <n>               default: 5
  --fidelity-threshold <num>     default: 0.72
  --delay-ms <n>                 delay between calls, default: 1000
  --batch-id <id>                optional custom batch id
  --experiment-id <id>           optional custom experiment id
  --run-tag <tag>                default: debug_small
  --source-levels <a,b,...>      optional source level filter
`);
    process.exit(0);
  }

  const maxSources = parseNum(args["max-sources"], 3);
  const targetLevels = parseIntList(args["target-levels"], [2, 4]);
  const relativeTargets = parseIntList(args["relative-targets"], null);
  const sourceLevels = parseIntList(args["source-levels"], null);
  const runTag = args["run-tag"] || "debug_small";
  const batchId = args["batch-id"] || `adj_q_small_${timestampCompact()}`;
  const experimentId =
    args["experiment-id"] || `ch5_small_adjust_questions_${timestampCompact()}`;

  const config = {
    experiment_id: experimentId,
    run_tag: runTag,
    batch_id: batchId,
    api_base: args["api-base"] || "http://localhost:3001/api",
    model: args.model || DEFAULT_MODEL,
    source_dataset: "questions",
    source_dir: "out_questions",
    max_sources: Math.max(1, Math.floor(maxSources)),
    skip_same_level: String(args["skip-same-level"] || "false").toLowerCase() === "true",
    max_rounds: Math.min(5, Math.max(1, Math.floor(parseNum(args["max-rounds"], 5)))),
    fidelity_threshold: Math.min(
      1,
      Math.max(0.5, parseNum(args["fidelity-threshold"], 0.72))
    ),
    delay_ms: Math.max(0, Math.floor(parseNum(args["delay-ms"], 1000))),
  };

  if (relativeTargets && relativeTargets.length > 0) {
    config.relative_targets = relativeTargets;
  } else {
    config.target_levels = targetLevels;
  }

  if (sourceLevels && sourceLevels.length > 0) {
    config.source_filters = {
      levels: sourceLevels,
    };
  }

  const tmpConfigPath = path.join(
    os.tmpdir(),
    `codex_${batchId}_${Date.now()}_adjust_questions_small.json`
  );
  fs.writeFileSync(tmpConfigPath, JSON.stringify(config, null, 2), "utf8");

  console.log("[SMALL-ADJ] Config:");
  console.log(JSON.stringify(config, null, 2));
  console.log(`[SMALL-ADJ] Temp config: ${tmpConfigPath}`);

  const child = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "run_ch5_adjust_batch.js"), tmpConfigPath],
    {
      cwd: ROOT,
      stdio: "inherit",
    }
  );

  try {
    fs.unlinkSync(tmpConfigPath);
  } catch (_) {
    // ignore temp cleanup failure
  }

  if (child.error) {
    console.error(child.error);
    process.exit(1);
  }
  process.exit(child.status ?? 0);
};

main();
