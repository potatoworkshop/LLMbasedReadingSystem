"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Metrics = {
  word_count: number;
  sentence_count: number;
  avg_sentence_len: number;
  avg_word_len: number;
  complex_word_ratio?: number;
  flesch_reading_ease?: number;
  flesch_kincaid_grade?: number;
  gunning_fog?: number;
};

type ArticleResponse = {
  article_id: string;
  topic: string;
  level: number;
  target_words: number;
  title: string;
  article: string;
  metrics: Metrics;
};

type OpenRouterModel = string;

type ModelResponse = {
  models: OpenRouterModel[];
  default_model: OpenRouterModel;
};

type LocalSource = "generated" | "questions" | "generated_questions";

type LocalQuestion = {
  type: "judgement" | "single_choice";
  number?: number;
  question: string;
  answer?: string;
  options?: string[];
};

type LocalArticle = {
  source: LocalSource;
  filename: string;
  title: string;
  article: string[];
  metrics?: Metrics;
  questions?: LocalQuestion[];
};

type FidelityReport = {
  overall: number;
  entity_recall: number;
  number_recall: number;
  keyword_recall: number;
};

type DifficultyAdjustResponse = {
  article_id: string;
  article: string;
  target_level: number;
  hit_target: boolean;
  rounds_used: number;
  original_metrics: Metrics;
  final_metrics: Metrics;
  fidelity: FidelityReport;
};

type JudgementQuestion = {
  number: number;
  question: string;
  answer: "TRUE" | "FALSE" | "NOT GIVEN";
  evidence_sentence_indices: number[];
};

type SingleChoiceOption = {
  label: "A" | "B" | "C" | "D";
  text: string;
};

type SingleChoiceQuestion = {
  number: number;
  question: string;
  options: SingleChoiceOption[];
  answer: "A" | "B" | "C" | "D";
  evidence_sentence_indices: number[];
};

type QuestionValidation = {
  is_valid: boolean;
  issues: string[];
};

type QuestionGenerationResponse = {
  article_id: string;
  title: string;
  sentence_count: number;
  judgement_questions: JudgementQuestion[];
  single_choice_questions: SingleChoiceQuestion[];
  validation: QuestionValidation;
  repair_rounds_used: number;
};

export default function Page() {
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState(2);
  const [targetWords, setTargetWords] = useState(600);
  const [modelOptions, setModelOptions] = useState<OpenRouterModel[]>([]);
  const [model, setModel] = useState<OpenRouterModel>("");
  const [result, setResult] = useState<ArticleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [transformMode, setTransformMode] = useState<
    "simplify" | "harder" | "shorten"
  >("simplify");
  const [transformedArticle, setTransformedArticle] = useState<string[] | null>(
    null
  );
  const [transformLoading, setTransformLoading] = useState(false);
  const [transformError, setTransformError] = useState<string | null>(null);
  const [difficultyTargetLevel, setDifficultyTargetLevel] = useState(2);
  const [difficultyLoading, setDifficultyLoading] = useState(false);
  const [difficultyError, setDifficultyError] = useState<string | null>(null);
  const [difficultyResult, setDifficultyResult] =
    useState<DifficultyAdjustResponse | null>(null);
  const [questionJudgementCount, setQuestionJudgementCount] = useState(5);
  const [questionSingleChoiceCount, setQuestionSingleChoiceCount] = useState(5);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [questionResult, setQuestionResult] =
    useState<QuestionGenerationResponse | null>(null);
  const [localSource, setLocalSource] = useState<LocalSource>("generated");
  const [localFiles, setLocalFiles] = useState<string[]>([]);
  const [localFile, setLocalFile] = useState("");
  const [localArticle, setLocalArticle] = useState<LocalArticle | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localLoading, setLocalLoading] = useState(false);
  const [localTransformMode, setLocalTransformMode] = useState<
    "simplify" | "harder" | "shorten"
  >("simplify");
  const [localTransformedArticle, setLocalTransformedArticle] = useState<
    string[] | null
  >(null);
  const [localTransformLoading, setLocalTransformLoading] = useState(false);
  const [localTransformError, setLocalTransformError] = useState<string | null>(
    null
  );

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch("http://localhost:3001/api/llm-models");
        if (!response.ok) {
          throw new Error("Failed to load models");
        }
        const data = (await response.json()) as ModelResponse;
        setModelOptions(data.models);
        setModel(data.default_model);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
      }
    };

    fetchModels();
  }, []);

  useEffect(() => {
    const fetchLocalFiles = async () => {
      setLocalLoading(true);
      setLocalError(null);
      setLocalFiles([]);
      setLocalFile("");
      setLocalArticle(null);
      setLocalTransformedArticle(null);
      setLocalTransformError(null);
      try {
        const response = await fetch(
          `/api/local-articles?source=${encodeURIComponent(localSource)}`
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || payload?.error || "Request failed");
        }
        const files = Array.isArray(payload?.files) ? payload.files : [];
        setLocalFiles(files);
        setLocalFile(files[0] || "");
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Unexpected error");
      } finally {
        setLocalLoading(false);
      }
    };

    fetchLocalFiles();
  }, [localSource]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setTransformedArticle(null);
    setTransformError(null);
    setDifficultyResult(null);
    setDifficultyError(null);
    setQuestionResult(null);
    setQuestionError(null);

    try {
      const response = await fetch("http://localhost:3001/api/generate-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          level,
          target_words: targetWords,
          lang: "en",
          model: model || undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Request failed");
      }

      const generated = payload as ArticleResponse;
      setResult(generated);
      setDifficultyTargetLevel(generated.level);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  const handleTransform = async () => {
    if (!result) {
      return;
    }
    setTransformLoading(true);
    setTransformError(null);
    setTransformedArticle(null);

    try {
      const response = await fetch("http://localhost:3001/api/simplify-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article: result.article,
          mode: transformMode,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Request failed");
      }

      setTransformedArticle(normalizeArticle(payload.article));
    } catch (err) {
      setTransformError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setTransformLoading(false);
    }
  };

  const handleAdjustDifficulty = async () => {
    if (!result) {
      return;
    }
    setDifficultyLoading(true);
    setDifficultyError(null);
    setDifficultyResult(null);

    try {
      const response = await fetch("http://localhost:3001/api/adjust-difficulty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article: result.article,
          target_level: difficultyTargetLevel,
          model: model || undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Request failed");
      }

      setDifficultyResult(payload as DifficultyAdjustResponse);
    } catch (err) {
      setDifficultyError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setDifficultyLoading(false);
    }
  };

  const handleGenerateQuestions = async () => {
    if (!result) {
      return;
    }

    setQuestionLoading(true);
    setQuestionError(null);
    setQuestionResult(null);

    try {
      const response = await fetch("http://localhost:3001/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article: result.article,
          title: result.title,
          level: result.level,
          judgement_count: questionJudgementCount,
          single_choice_count: questionSingleChoiceCount,
          source_article_id: result.article_id,
          topic: result.topic,
          model: model || undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Request failed");
      }

      setQuestionResult(payload as QuestionGenerationResponse);
    } catch (err) {
      setQuestionError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setQuestionLoading(false);
    }
  };

  const handleLoadLocal = async () => {
    if (!localFile) {
      setLocalError("Please select a file.");
      return;
    }
    setLocalLoading(true);
    setLocalError(null);
    setLocalArticle(null);
    setLocalTransformedArticle(null);
    setLocalTransformError(null);
    try {
      const response = await fetch(
        `/api/local-articles?source=${encodeURIComponent(localSource)}&file=${encodeURIComponent(
          localFile
        )}`
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Request failed");
      }
      setLocalArticle(payload as LocalArticle);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLocalLoading(false);
    }
  };

  const handleLocalTransform = async () => {
    if (!localArticle) {
      return;
    }
    setLocalTransformLoading(true);
    setLocalTransformError(null);
    setLocalTransformedArticle(null);

    try {
      const response = await fetch("http://localhost:3001/api/simplify-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article: localArticle.article.join("\n\n"),
          mode: localTransformMode,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "Request failed");
      }

      setLocalTransformedArticle(normalizeArticle(payload.article));
    } catch (err) {
      setLocalTransformError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLocalTransformLoading(false);
    }
  };

  const normalizeArticle = (article: string | string[]) => {
    if (Array.isArray(article)) {
      return article;
    }
    return article
      .split("\n\n")
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  };

  const getTransformLabel = (mode: "simplify" | "harder" | "shorten") => {
    if (mode === "simplify") {
      return "Simplify";
    }
    if (mode === "harder") {
      return "Make harder";
    }
    return "Shorten sentences";
  };

  const formatMetric = (value: number | undefined, digits = 2) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "—";
    }
    return value.toFixed(digits);
  };

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>LLM Reading System</h1>
      <p style={{ marginBottom: 24 }}>
        Generate a short, level-appropriate article with metrics.
      </p>
      <div style={{ marginBottom: 24 }}>
        <Link href="/article-stats" style={{ textDecoration: "none" }}>
          <button type="button" style={{ padding: "10px 16px", cursor: "pointer" }}>
            View Article Stats
          </button>
        </Link>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          Topic
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="e.g. Rainforest ecosystems"
            required
            style={{ padding: 8 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          Level (1-5)
          <input
            type="number"
            min={1}
            max={5}
            value={level}
            onChange={(event) => setLevel(Number(event.target.value))}
            required
            style={{ padding: 8 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          Model (OpenRouter)
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            style={{ padding: 8 }}
          >
            {modelOptions.length === 0 && (
              <option value="">Loading models...</option>
            )}
            {modelOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          Target words (80-1200)
          <input
            type="number"
            min={80}
            max={1200}
            value={targetWords}
            onChange={(event) => setTargetWords(Number(event.target.value))}
            required
            style={{ padding: 8 }}
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          style={{ padding: "10px 16px", cursor: "pointer" }}
        >
          {loading ? "Generating..." : "Generate"}
        </button>
      </form>

      {error && (
        <p style={{ color: "crimson", marginTop: 16 }}>
          Error: {error}
        </p>
      )}

      {result && (
        <section style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #ddd" }}>
          <h2 style={{ marginBottom: 8 }}>{result.title}</h2>
          {normalizeArticle(result.article).map((paragraph, index) => (
            <p key={index} style={{ marginBottom: 12 }}>
              {paragraph}
            </p>
          ))}
          <div style={{ marginTop: 16, fontSize: 14 }}>
            <strong>Metrics:</strong>
            <div>Word count: {result.metrics.word_count}</div>
            <div>Sentence count: {result.metrics.sentence_count}</div>
            <div>Avg sentence length: {result.metrics.avg_sentence_len}</div>
            <div>Avg word length: {result.metrics.avg_word_len}</div>
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
              Transform mode
              <select
                value={transformMode}
                onChange={(event) =>
                  setTransformMode(
                    event.target.value as "simplify" | "harder" | "shorten"
                  )
                }
                style={{ padding: 8 }}
              >
                <option value="simplify">Simplify</option>
                <option value="harder">Make harder</option>
                <option value="shorten">Shorten sentences</option>
              </select>
            </label>
            <button
              type="button"
              onClick={handleTransform}
              disabled={transformLoading}
              style={{ padding: "10px 16px", cursor: "pointer", width: "fit-content" }}
            >
              {transformLoading ? "Transforming..." : getTransformLabel(transformMode)}
            </button>
            {transformError && (
              <p style={{ color: "crimson", marginTop: 4 }}>
                Error: {transformError}
              </p>
            )}
          </div>
          {transformedArticle && (
            <section style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed #ccc" }}>
              <h3 style={{ marginBottom: 8 }}>
                {transformMode === "simplify"
                  ? "Simplified"
                  : transformMode === "harder"
                  ? "More difficult"
                  : "Shortened"}{" "}
                article
              </h3>
              {transformedArticle.map((paragraph, index) => (
                <p key={index} style={{ marginBottom: 12 }}>
                  {paragraph}
                </p>
              ))}
            </section>
          )}

          <section style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed #ccc" }}>
            <h3 style={{ marginBottom: 8 }}>Adjust difficulty to target level</h3>
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
                Target level (1-5)
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={difficultyTargetLevel}
                  onChange={(event) =>
                    setDifficultyTargetLevel(Number(event.target.value))
                  }
                  style={{ padding: 8 }}
                />
              </label>
              <button
                type="button"
                onClick={handleAdjustDifficulty}
                disabled={difficultyLoading}
                style={{ padding: "10px 16px", cursor: "pointer", width: "fit-content" }}
              >
                {difficultyLoading ? "Adjusting..." : "Adjust difficulty"}
              </button>
              {difficultyError && (
                <p style={{ color: "crimson", marginTop: 4 }}>
                  Error: {difficultyError}
                </p>
              )}
            </div>
            {difficultyResult && (
              <section style={{ marginTop: 16 }}>
                <h4 style={{ marginBottom: 8 }}>
                  Adjusted article (target L{difficultyResult.target_level}) -{" "}
                  {difficultyResult.hit_target ? "Target hit" : "Best effort"}
                </h4>
                {normalizeArticle(difficultyResult.article).map((paragraph, index) => (
                  <p key={index} style={{ marginBottom: 12 }}>
                    {paragraph}
                  </p>
                ))}
                <div style={{ marginTop: 12, fontSize: 14 }}>
                  <strong>Before {"->"} After</strong>
                  <div>
                    FK grade:{" "}
                    {formatMetric(difficultyResult.original_metrics.flesch_kincaid_grade)}{" "}
                    {"->"}{" "}
                    {formatMetric(difficultyResult.final_metrics.flesch_kincaid_grade)}
                  </div>
                  <div>
                    FRE:{" "}
                    {formatMetric(difficultyResult.original_metrics.flesch_reading_ease)}{" "}
                    {"->"}{" "}
                    {formatMetric(difficultyResult.final_metrics.flesch_reading_ease)}
                  </div>
                  <div>
                    Avg sentence length:{" "}
                    {formatMetric(difficultyResult.original_metrics.avg_sentence_len)}{" "}
                    {"->"}{" "}
                    {formatMetric(difficultyResult.final_metrics.avg_sentence_len)}
                  </div>
                  <div>
                    Complex word ratio:{" "}
                    {formatMetric(difficultyResult.original_metrics.complex_word_ratio, 3)}{" "}
                    {"->"}{" "}
                    {formatMetric(difficultyResult.final_metrics.complex_word_ratio, 3)}
                  </div>
                  <div>Rounds used: {difficultyResult.rounds_used}</div>
                  <div>
                    Fidelity overall:{" "}
                    {formatMetric(difficultyResult.fidelity.overall, 3)}
                  </div>
                </div>
              </section>
            )}
          </section>

          <section style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed #ccc" }}>
            <h3 style={{ marginBottom: 8 }}>Generate Questions</h3>
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "grid", gap: 6, maxWidth: 280 }}>
                Judgement question count
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={questionJudgementCount}
                  onChange={(event) =>
                    setQuestionJudgementCount(Number(event.target.value))
                  }
                  style={{ padding: 8 }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, maxWidth: 280 }}>
                Single-choice question count
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={questionSingleChoiceCount}
                  onChange={(event) =>
                    setQuestionSingleChoiceCount(Number(event.target.value))
                  }
                  style={{ padding: 8 }}
                />
              </label>
              <button
                type="button"
                onClick={handleGenerateQuestions}
                disabled={questionLoading}
                style={{ padding: "10px 16px", cursor: "pointer", width: "fit-content" }}
              >
                {questionLoading ? "Generating questions..." : "Generate questions"}
              </button>
              {questionError && (
                <p style={{ color: "crimson", marginTop: 4 }}>
                  Error: {questionError}
                </p>
              )}
            </div>

            {questionResult && (
              <section style={{ marginTop: 16 }}>
                <h4 style={{ marginBottom: 8 }}>{questionResult.title}</h4>
                <div style={{ fontSize: 14, marginBottom: 12 }}>
                  <div>Sentence count: {questionResult.sentence_count}</div>
                  <div>Repair rounds used: {questionResult.repair_rounds_used}</div>
                  <div>
                    Validation:{" "}
                    {questionResult.validation.is_valid ? "Passed" : "Has issues"}
                  </div>
                  {!questionResult.validation.is_valid && (
                    <div style={{ marginTop: 6 }}>
                      {questionResult.validation.issues.map((issue, index) => (
                        <div key={`${issue}-${index}`}>- {issue}</div>
                      ))}
                    </div>
                  )}
                </div>

                {questionResult.judgement_questions.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <strong>Judgement Questions</strong>
                    {questionResult.judgement_questions.map((item) => (
                      <div key={`j-${item.number}`} style={{ marginTop: 8 }}>
                        <div>
                          {item.number}. {item.question}
                        </div>
                        <div style={{ fontSize: 14 }}>
                          Answer: {item.answer} | Evidence: [
                          {item.evidence_sentence_indices.join(", ")}]
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {questionResult.single_choice_questions.length > 0 && (
                  <div>
                    <strong>Single Choice Questions</strong>
                    {questionResult.single_choice_questions.map((item) => (
                      <div key={`s-${item.number}`} style={{ marginTop: 8 }}>
                        <div>
                          {item.number}. {item.question}
                        </div>
                        <ul style={{ margin: "6px 0 0 20px" }}>
                          {item.options.map((option) => (
                            <li key={`${item.number}-${option.label}`}>
                              {option.label}. {option.text}
                            </li>
                          ))}
                        </ul>
                        <div style={{ fontSize: 14 }}>
                          Answer: {item.answer} | Evidence: [
                          {item.evidence_sentence_indices.join(", ")}]
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </section>
        </section>
      )}

      <section style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #ddd" }}>
        <h2 style={{ marginBottom: 8 }}>Read Local Articles</h2>
        <p style={{ marginBottom: 16 }}>
          Load content from <code>out_generated</code> or <code>out_questions</code>.
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            Source
            <select
              value={localSource}
              onChange={(event) => setLocalSource(event.target.value as LocalSource)}
              style={{ padding: 8 }}
            >
              <option value="generated">out_generated</option>
              <option value="questions">out_questions</option>
              <option value="generated_questions">out_questions_generated</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            File
            <select
              value={localFile}
              onChange={(event) => setLocalFile(event.target.value)}
              style={{ padding: 8 }}
              disabled={localLoading || localFiles.length === 0}
            >
              {localFiles.length === 0 && <option value="">No files found</option>}
              {localFiles.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={handleLoadLocal}
            disabled={localLoading || !localFile}
            style={{ padding: "10px 16px", cursor: "pointer" }}
          >
            {localLoading ? "Loading..." : "Load article"}
          </button>
        </div>

        {localError && (
          <p style={{ color: "crimson", marginTop: 16 }}>
            Error: {localError}
          </p>
        )}

        {localArticle && (
          <section style={{ marginTop: 20 }}>
            <h3 style={{ marginBottom: 8 }}>{localArticle.title}</h3>
            {localArticle.article.map((paragraph, index) => (
              <p key={index} style={{ marginBottom: 12 }}>
                {paragraph}
              </p>
            ))}
            {localArticle.metrics && (
              <div style={{ marginTop: 16, fontSize: 14 }}>
                <strong>Metrics:</strong>
                <div>Word count: {localArticle.metrics.word_count}</div>
                <div>Sentence count: {localArticle.metrics.sentence_count}</div>
                <div>Avg sentence length: {localArticle.metrics.avg_sentence_len}</div>
                <div>Avg word length: {localArticle.metrics.avg_word_len}</div>
              </div>
            )}
            {localArticle.questions && localArticle.questions.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <strong>Questions:</strong>
                {localArticle.questions.map((item, index) => (
                  <div key={`${item.type}-${item.number ?? index}`} style={{ marginTop: 10 }}>
                    <div>
                      {item.number ? `${item.number}. ` : ""}
                      {item.question}
                    </div>
                    {item.options && item.options.length > 0 && (
                      <ul style={{ margin: "6px 0 0 20px" }}>
                        {item.options.map((option) => (
                          <li key={option}>{option}</li>
                        ))}
                      </ul>
                    )}
                    {item.answer && (
                      <div style={{ fontSize: 14, marginTop: 4 }}>
                        Answer: {item.answer}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
              <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
                Transform mode
                <select
                  value={localTransformMode}
                  onChange={(event) =>
                    setLocalTransformMode(
                      event.target.value as "simplify" | "harder" | "shorten"
                    )
                  }
                  style={{ padding: 8 }}
                >
                  <option value="simplify">Simplify</option>
                  <option value="harder">Make harder</option>
                  <option value="shorten">Shorten sentences</option>
                </select>
              </label>
              <button
                type="button"
                onClick={handleLocalTransform}
                disabled={localTransformLoading}
                style={{ padding: "10px 16px", cursor: "pointer", width: "fit-content" }}
              >
                {localTransformLoading
                  ? "Transforming..."
                  : getTransformLabel(localTransformMode)}
              </button>
              {localTransformError && (
                <p style={{ color: "crimson", marginTop: 4 }}>
                  Error: {localTransformError}
                </p>
              )}
            </div>
            {localTransformedArticle && (
              <section style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed #ccc" }}>
                <h3 style={{ marginBottom: 8 }}>
                  {localTransformMode === "simplify"
                    ? "Simplified"
                    : localTransformMode === "harder"
                    ? "More difficult"
                    : "Shortened"}{" "}
                  article
                </h3>
                {localTransformedArticle.map((paragraph, index) => (
                  <p key={index} style={{ marginBottom: 12 }}>
                    {paragraph}
                  </p>
                ))}
              </section>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
