const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const GENERATED_DIR = path.join(ROOT, "out_generated");
const ADJUSTED_DIR = path.join(ROOT, "out_simplified");
const ANALYSIS_DIR = path.join(ROOT, "experiments", "ch5", "analysis");

const TASK_A_EXPERIMENT_ID = "ch5_e1_modelcmp_20260225";
const TASK_A_TARGET_N_PER_MODEL = 38;
const TASK_B_EXPERIMENT_ID = "ch5_main_n8_20260301";
const TASK_B_DEEPSEEK_REPLACE_EXPERIMENT_ID =
  "ch5_replace_gemini_fast80_deepseek_v32_20260301";
const TASK_B_FINAL_MODELS = new Set([
  "openai/gpt-5-mini",
  "x-ai/grok-4.1-fast",
  "deepseek/deepseek-v3.2",
]);

const FK_RANGES_TASK_A = {
  1: [6, 8],
  2: [8, 10],
  3: [10, 12],
  4: [12, 14],
  5: [14, 100],
};

const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const safeReadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const toNumber = (v) => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
};

const toBoolean = (v) => {
  if (v === true || v === false) return v;
  if (v === "True" || v === "true") return true;
  if (v === "False" || v === "false") return false;
  return "";
};

const csvEscape = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const writeCsv = (outPath, rows, headers) => {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
};

const parseTaskTime = (ts) => {
  if (!ts) return 0;
  const d = new Date(ts);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  return 0;
};

const latestTaskCsvPath = () => {
  if (!fs.existsSync(ANALYSIS_DIR)) return null;
  const candidates = fs
    .readdirSync(ANALYSIS_DIR)
    .filter((name) => /task_level_with_recovery\.csv$/i.test(name))
    .map((name) => {
      const full = path.join(ANALYSIS_DIR, name);
      return { full, mtimeMs: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.length ? candidates[0].full : null;
};

const parseCsvSimple = (csvText) => {
  const rows = [];
  let i = 0;
  const len = csvText.length;
  const parseField = () => {
    if (csvText[i] === '"') {
      i += 1;
      let val = "";
      while (i < len) {
        if (csvText[i] === '"') {
          if (csvText[i + 1] === '"') {
            val += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        val += csvText[i];
        i += 1;
      }
      return val;
    }
    let start = i;
    while (i < len && csvText[i] !== "," && csvText[i] !== "\n" && csvText[i] !== "\r") i += 1;
    return csvText.slice(start, i);
  };

  const parseRow = () => {
    const cols = [];
    while (i < len) {
      cols.push(parseField());
      if (i >= len) break;
      if (csvText[i] === ",") {
        i += 1;
        continue;
      }
      if (csvText[i] === "\r") i += 1;
      if (csvText[i] === "\n") {
        i += 1;
        break;
      }
    }
    return cols;
  };

  const header = parseRow();
  while (i < len) {
    const row = parseRow();
    if (row.length === 1 && row[0] === "") continue;
    const obj = {};
    for (let c = 0; c < header.length; c += 1) {
      obj[header[c]] = row[c] ?? "";
    }
    rows.push(obj);
  }
  return rows;
};

const buildGeneratedRows = () => {
  const files = fs
    .readdirSync(GENERATED_DIR)
    .filter((f) => f.toLowerCase().endsWith(".json") && f !== "article_stats.json")
    .map((name) => path.join(GENERATED_DIR, name));

  const rows = [];
  for (const filePath of files) {
    const j = safeReadJson(filePath);
    if (!j) continue;
    const metrics = j.metrics || {};
    const exp = j.experiment || {};
    const genMeta = j.generation_meta || {};
    const tokenUsage = j.token_usage || {};

    const level = toNumber(j.level);
    const fk = toNumber(metrics.flesch_kincaid_grade);
    const fkRange = FK_RANGES_TASK_A[level] || ["", ""];
    const taskAHit =
      fk !== "" && fkRange[0] !== ""
        ? fk >= fkRange[0] && fk <= fkRange[1]
        : "";

    const targetWords = toNumber(j.target_words);
    const wordCount = toNumber(metrics.word_count);
    const lenDevPct =
      targetWords && wordCount !== ""
        ? Number((Math.abs(wordCount - targetWords) * 100 / targetWords).toFixed(4))
        : "";

    rows.push({
      article_id: j.article_id || path.basename(filePath, ".json"),
      file_name: path.basename(filePath),
      generated_at: j.generated_at || "",
      topic: j.topic || "",
      level,
      target_words: targetWords,
      word_count: wordCount,
      len_dev_pct: lenDevPct,
      sentence_count: toNumber(metrics.sentence_count),
      complex_word_ratio: toNumber(metrics.complex_word_ratio),
      fk_grade: fk,
      fre: toNumber(metrics.flesch_reading_ease),
      ari: toNumber(metrics.ari),
      coleman_liau: toNumber(metrics.coleman_liau),
      gunning_fog: toNumber(metrics.gunning_fog),
      task_a_hit_by_level_band: taskAHit,
      model: j.model || "",
      provider: j.provider || "",
      experiment_id: exp.experiment_id || "",
      run_tag: exp.run_tag || "",
      batch_id: exp.batch_id || "",
      sample_id: exp.sample_id || "",
      attempts_used: toNumber(genMeta.attempts_used),
      max_attempts: toNumber(genMeta.max_attempts),
      selected_attempt: toNumber(genMeta.selected_attempt),
      within_preferred_range: toBoolean(genMeta.within_preferred_range),
      distance_to_target_words: toNumber(genMeta.distance_to_target_words),
      prompt_tokens: toNumber(tokenUsage.prompt_tokens),
      completion_tokens: toNumber(tokenUsage.completion_tokens),
      total_tokens: toNumber(tokenUsage.total_tokens),
      llm_calls: toNumber(tokenUsage.llm_calls),
      in_report_task_a_scope: exp.experiment_id === TASK_A_EXPERIMENT_ID,
      report_task_a_n38_rank_in_model: "",
      report_task_a_selected_n38: false,
      data_origin: "out_generated",
    });
  }

  const byModel = new Map();
  for (const r of rows) {
    if (!r.in_report_task_a_scope) continue;
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model).push(r);
  }
  for (const [, group] of byModel.entries()) {
    group.sort((a, b) => (b.generated_at || "").localeCompare(a.generated_at || ""));
    group.forEach((r, idx) => {
      const rank = idx + 1;
      r.report_task_a_n38_rank_in_model = rank;
      r.report_task_a_selected_n38 = rank <= TASK_A_TARGET_N_PER_MODEL;
    });
  }

  rows.sort((a, b) => {
    if (a.generated_at !== b.generated_at) return String(b.generated_at).localeCompare(String(a.generated_at));
    return String(a.article_id).localeCompare(String(b.article_id));
  });
  return rows;
};

const buildTaskRowMaps = (taskCsvRows) => {
  const bySample = new Map();
  const byArticle = new Map();
  for (const r of taskCsvRows) {
    const existing = bySample.get(r.sample_id);
    if (!existing || parseTaskTime(r.ts) >= parseTaskTime(existing.ts)) {
      if (r.sample_id) bySample.set(r.sample_id, r);
    }
    if (r.article_id) {
      const exByArt = byArticle.get(r.article_id);
      if (!exByArt || parseTaskTime(r.ts) >= parseTaskTime(exByArt.ts)) {
        byArticle.set(r.article_id, r);
      }
    }
  }
  return { bySample, byArticle };
};

const buildAdjustedRows = () => {
  const taskCsv = latestTaskCsvPath();
  const taskRows = taskCsv ? parseCsvSimple(fs.readFileSync(taskCsv, "utf8")) : [];
  const { bySample, byArticle } = buildTaskRowMaps(taskRows);

  const files = fs
    .readdirSync(ADJUSTED_DIR)
    .filter((f) => f.toLowerCase().endsWith(".json") && f !== "article_stats.json")
    .map((name) => path.join(ADJUSTED_DIR, name));

  const landedRows = [];
  const seenSampleIds = new Set();

  for (const filePath of files) {
    const j = safeReadJson(filePath);
    if (!j) continue;
    if (j.mode !== "difficulty_adjust") continue;

    const exp = j.experiment || {};
    const source = j.source || {};
    const req = j.request_meta || {};
    const original = j.original_metrics || {};
    const finalM = j.final_metrics || {};
    const tokenUsageFinal = (Array.isArray(j.history) && j.history.length
      ? j.history[j.history.length - 1]?.token_usage
      : null) || {};

    const sampleId = exp.sample_id || "";
    if (sampleId) seenSampleIds.add(sampleId);

    const taskRow = bySample.get(sampleId) || byArticle.get(j.article_id) || null;
    const taskRecovered = taskRow ? toBoolean(taskRow.recovered_from_output) : "";
    const taskOk = taskRow ? toBoolean(taskRow.ok) : "";
    const metadataRecovered =
      taskRow && taskRecovered === true && taskOk === false;

    landedRows.push({
      row_kind: "landed_record",
      is_landed: true,
      file_mtime_ms: fs.statSync(filePath).mtimeMs,
      article_id: j.article_id || path.basename(filePath, ".json"),
      file_name: path.basename(filePath),
      generated_at: j.generated_at || "",
      mode: j.mode || "",
      model: j.model || "",
      provider: j.provider || "",
      experiment_id: exp.experiment_id || "",
      run_tag: exp.run_tag || "",
      batch_id: exp.batch_id || "",
      sample_id: sampleId,
      source_article_id: source.source_article_id || "",
      source_dataset: source.source_dataset || "",
      source_file: source.source_file || "",
      source_level: toNumber(source.source_level),
      target_level: toNumber(j.target_level ?? req.target_level),
      hit_target: toBoolean(j.hit_target),
      rounds_used: toNumber(j.rounds_used),
      fidelity_overall: toNumber(
        j.history && j.history.length
          ? j.history[j.history.length - 1]?.fidelity?.overall
          : ""
      ),
      original_word_count: toNumber(original.word_count),
      original_fk_grade: toNumber(original.flesch_kincaid_grade),
      final_word_count: toNumber(finalM.word_count),
      final_fk_grade: toNumber(finalM.flesch_kincaid_grade),
      final_fre: toNumber(finalM.flesch_reading_ease),
      final_ari: toNumber(finalM.ari),
      final_coleman_liau: toNumber(finalM.coleman_liau),
      final_gunning_fog: toNumber(finalM.gunning_fog),
      prompt_tokens: toNumber(tokenUsageFinal.prompt_tokens),
      completion_tokens: toNumber(tokenUsageFinal.completion_tokens),
      total_tokens: toNumber(tokenUsageFinal.total_tokens),
      llm_calls: toNumber(tokenUsageFinal.llm_calls),
      task_csv_matched: Boolean(taskRow),
      task_csv_ts: taskRow ? taskRow.ts : "",
      task_csv_log_file: taskRow ? taskRow.log_file : "",
      task_csv_ok: taskOk,
      task_csv_recovered_from_output: taskRecovered,
      task_csv_error: taskRow ? taskRow.error : "",
      task_csv_status: taskRow ? taskRow.status : "",
      task_csv_elapsed_ms: taskRow ? toNumber(taskRow.elapsed_ms) : "",
      metadata_write_failed_recovered: metadataRecovered,
      in_report_task_b_scope:
        exp.experiment_id === TASK_B_EXPERIMENT_ID ||
        exp.experiment_id === TASK_B_DEEPSEEK_REPLACE_EXPERIMENT_ID,
      report_task_b_candidate:
        (exp.experiment_id === TASK_B_EXPERIMENT_ID &&
          (j.model === "openai/gpt-5-mini" ||
            j.model === "x-ai/grok-4.1-fast")) ||
        (exp.experiment_id === TASK_B_DEEPSEEK_REPLACE_EXPERIMENT_ID &&
          j.model === "deepseek/deepseek-v3.2"),
      report_task_b_preferred_record: false,
      in_report_task_b_final_model_set: false,
      data_origin: "out_simplified",
    });
  }

  // For report-final Task B table, dedupe by (model, sample_id) and keep latest landed record.
  const candidates = landedRows.filter((r) => r.report_task_b_candidate && r.sample_id);
  const keyToRows = new Map();
  for (const r of candidates) {
    const key = `${r.model}::${r.sample_id}`;
    if (!keyToRows.has(key)) keyToRows.set(key, []);
    keyToRows.get(key).push(r);
  }
  for (const [, group] of keyToRows.entries()) {
    group.sort((a, b) => {
      const ta = Number(a.file_mtime_ms || 0);
      const tb = Number(b.file_mtime_ms || 0);
      if (ta !== tb) return tb - ta;
      return String(b.article_id).localeCompare(String(a.article_id));
    });
    group[0].report_task_b_preferred_record = true;
    group[0].in_report_task_b_final_model_set = true;
  }

  const csvOnlyRows = [];
  for (const taskRow of taskRows) {
    const sampleId = taskRow.sample_id || "";
    if (!sampleId || seenSampleIds.has(sampleId)) continue;
    const taskRecovered = toBoolean(taskRow.recovered_from_output);
    const taskOk = toBoolean(taskRow.ok);
    csvOnlyRows.push({
      row_kind: "task_csv_only_unlanded",
      is_landed: false,
      file_mtime_ms: "",
      article_id: taskRow.article_id || "",
      file_name: "",
      generated_at: "",
      mode: "difficulty_adjust",
      model: taskRow.model || "",
      provider: taskRow.provider || "",
      experiment_id: "",
      run_tag: "",
      batch_id: "",
      sample_id: sampleId,
      source_article_id: taskRow.source_article_id || "",
      source_dataset: taskRow.source_dataset || "",
      source_file: taskRow.source_file || "",
      source_level: "",
      target_level: toNumber(taskRow.target_level),
      hit_target: toBoolean(taskRow.hit_target),
      rounds_used: toNumber(taskRow.rounds_used),
      fidelity_overall: toNumber(taskRow.fidelity_overall),
      original_word_count: "",
      original_fk_grade: "",
      final_word_count: "",
      final_fk_grade: "",
      final_fre: "",
      final_ari: "",
      final_coleman_liau: "",
      final_gunning_fog: "",
      prompt_tokens: toNumber(taskRow.prompt_tokens),
      completion_tokens: toNumber(taskRow.completion_tokens),
      total_tokens: toNumber(taskRow.total_tokens),
      llm_calls: toNumber(taskRow.llm_calls),
      task_csv_matched: true,
      task_csv_ts: taskRow.ts || "",
      task_csv_log_file: taskRow.log_file || "",
      task_csv_ok: taskOk,
      task_csv_recovered_from_output: taskRecovered,
      task_csv_error: taskRow.error || "",
      task_csv_status: taskRow.status || "",
      task_csv_elapsed_ms: toNumber(taskRow.elapsed_ms),
      metadata_write_failed_recovered: taskRecovered === true && taskOk === false,
      in_report_task_b_scope: false,
      report_task_b_candidate: false,
      report_task_b_preferred_record: false,
      in_report_task_b_final_model_set: false,
      data_origin: taskCsv ? path.relative(ROOT, taskCsv) : "task_level_with_recovery_csv",
    });
  }

  const allRows = [...landedRows, ...csvOnlyRows];
  allRows.sort((a, b) => {
    const ta = a.task_csv_ts || "";
    const tb = b.task_csv_ts || "";
    if (ta !== tb) return tb.localeCompare(ta);
    return String(a.sample_id).localeCompare(String(b.sample_id));
  });

  return {
    rows: allRows,
    taskCsvPath: taskCsv ? path.relative(ROOT, taskCsv) : "",
  };
};

const main = () => {
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true });

  const generatedRows = buildGeneratedRows();
  const adjusted = buildAdjustedRows();

  const stamp = nowStamp();
  const generatedOut = path.join(ANALYSIS_DIR, `ch5_ai_generated_landed_${stamp}.csv`);
  const adjustedOut = path.join(ANALYSIS_DIR, `ch5_difficulty_adjust_landed_${stamp}.csv`);
  const generatedLatestOut = path.join(ANALYSIS_DIR, "ch5_ai_generated_landed_latest.csv");
  const adjustedLatestOut = path.join(ANALYSIS_DIR, "ch5_difficulty_adjust_landed_latest.csv");

  writeCsv(
    generatedOut,
    generatedRows,
    [
      "article_id",
      "file_name",
      "generated_at",
      "topic",
      "level",
      "target_words",
      "word_count",
      "len_dev_pct",
      "sentence_count",
      "complex_word_ratio",
      "fk_grade",
      "fre",
      "ari",
      "coleman_liau",
      "gunning_fog",
      "task_a_hit_by_level_band",
      "model",
      "provider",
      "experiment_id",
      "run_tag",
      "batch_id",
      "sample_id",
      "attempts_used",
      "max_attempts",
      "selected_attempt",
      "within_preferred_range",
      "distance_to_target_words",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "llm_calls",
      "in_report_task_a_scope",
      "report_task_a_n38_rank_in_model",
      "report_task_a_selected_n38",
      "data_origin",
    ]
  );
  writeCsv(
    generatedLatestOut,
    generatedRows,
    [
      "article_id",
      "file_name",
      "generated_at",
      "topic",
      "level",
      "target_words",
      "word_count",
      "len_dev_pct",
      "sentence_count",
      "complex_word_ratio",
      "fk_grade",
      "fre",
      "ari",
      "coleman_liau",
      "gunning_fog",
      "task_a_hit_by_level_band",
      "model",
      "provider",
      "experiment_id",
      "run_tag",
      "batch_id",
      "sample_id",
      "attempts_used",
      "max_attempts",
      "selected_attempt",
      "within_preferred_range",
      "distance_to_target_words",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "llm_calls",
      "in_report_task_a_scope",
      "report_task_a_n38_rank_in_model",
      "report_task_a_selected_n38",
      "data_origin",
    ]
  );

  writeCsv(
    adjustedOut,
    adjusted.rows,
    [
      "row_kind",
      "is_landed",
      "file_mtime_ms",
      "article_id",
      "file_name",
      "generated_at",
      "mode",
      "model",
      "provider",
      "experiment_id",
      "run_tag",
      "batch_id",
      "sample_id",
      "source_article_id",
      "source_dataset",
      "source_file",
      "source_level",
      "target_level",
      "hit_target",
      "rounds_used",
      "fidelity_overall",
      "original_word_count",
      "original_fk_grade",
      "final_word_count",
      "final_fk_grade",
      "final_fre",
      "final_ari",
      "final_coleman_liau",
      "final_gunning_fog",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "llm_calls",
      "task_csv_matched",
      "task_csv_ts",
      "task_csv_log_file",
      "task_csv_ok",
      "task_csv_recovered_from_output",
      "task_csv_error",
      "task_csv_status",
      "task_csv_elapsed_ms",
      "metadata_write_failed_recovered",
      "in_report_task_b_scope",
      "report_task_b_candidate",
      "report_task_b_preferred_record",
      "in_report_task_b_final_model_set",
      "data_origin",
    ]
  );
  writeCsv(
    adjustedLatestOut,
    adjusted.rows,
    [
      "row_kind",
      "is_landed",
      "file_mtime_ms",
      "article_id",
      "file_name",
      "generated_at",
      "mode",
      "model",
      "provider",
      "experiment_id",
      "run_tag",
      "batch_id",
      "sample_id",
      "source_article_id",
      "source_dataset",
      "source_file",
      "source_level",
      "target_level",
      "hit_target",
      "rounds_used",
      "fidelity_overall",
      "original_word_count",
      "original_fk_grade",
      "final_word_count",
      "final_fk_grade",
      "final_fre",
      "final_ari",
      "final_coleman_liau",
      "final_gunning_fog",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "llm_calls",
      "task_csv_matched",
      "task_csv_ts",
      "task_csv_log_file",
      "task_csv_ok",
      "task_csv_recovered_from_output",
      "task_csv_error",
      "task_csv_status",
      "task_csv_elapsed_ms",
      "metadata_write_failed_recovered",
      "in_report_task_b_scope",
      "report_task_b_candidate",
      "report_task_b_preferred_record",
      "in_report_task_b_final_model_set",
      "data_origin",
    ]
  );

  const taskAInScope = generatedRows.filter((r) => r.in_report_task_a_scope).length;
  const taskASelected = generatedRows.filter((r) => r.report_task_a_selected_n38).length;
  const landedAdjusted = adjusted.rows.filter((r) => r.is_landed).length;
  const recoveredAdjusted = adjusted.rows.filter((r) => r.metadata_write_failed_recovered).length;
  const csvOnlyAdjusted = adjusted.rows.filter((r) => r.row_kind === "task_csv_only_unlanded").length;

  console.log(`[EXPORT][DONE] generated_csv=${path.relative(ROOT, generatedOut)}`);
  console.log(`[EXPORT][DONE] adjusted_csv=${path.relative(ROOT, adjustedOut)}`);
  console.log(`[EXPORT][DONE] generated_latest_csv=${path.relative(ROOT, generatedLatestOut)}`);
  console.log(`[EXPORT][DONE] adjusted_latest_csv=${path.relative(ROOT, adjustedLatestOut)}`);
  console.log(`[STATS] task_a_in_scope=${taskAInScope} task_a_selected_n38=${taskASelected}`);
  console.log(`[STATS] adjusted_landed=${landedAdjusted} adjusted_metadata_recovered=${recoveredAdjusted} adjusted_task_csv_only_unlanded=${csvOnlyAdjusted}`);
  console.log(`[STATS] task_csv_used=${adjusted.taskCsvPath || "N/A"}`);
};

main();
