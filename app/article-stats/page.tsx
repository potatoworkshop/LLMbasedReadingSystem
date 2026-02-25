import fs from "fs/promises";
import path from "path";

type ReadabilityStats = {
  fleschReadingEase?: number;
  fleschKincaidGrade?: number;
  ari?: number;
  colemanLiau?: number;
  gunningFog?: number;
};

type InformationDensityStats = {
  uniqueWordCount?: number;
  typeTokenRatio?: number;
  rootTypeTokenRatio?: number;
};

type KeywordDensityStats = {
  keywordTypeCount?: number;
  keywordTokenCount?: number;
  keywordTypeDensity?: number;
  keywordTokenDensity?: number;
  selectedKeywords?: string[];
};

type AbstractnessStats = {
  meanConcreteness?: number;
  meanAbstractness?: number;
  concretenessCoverage?: number;
  matchedTokenCount?: number;
  totalTokenCount?: number;
};

type ArticleStatsEntry = {
  file: string;
  index?: {
    ielts?: string;
    test?: string;
    passage?: string;
  };
  sentenceCount?: number;
  wordCount?: number;
  charCount?: number;
  syllableCount?: number;
  complexWordCount?: number;
  readability?: ReadabilityStats;
  informationDensity?: InformationDensityStats;
  keywordDensity?: KeywordDensityStats;
  abstractness?: AbstractnessStats;
};

type ArticleStatsPayload = {
  total?: number;
  articles?: ArticleStatsEntry[];
};

type DatasetConfig = {
  key: string;
  label: string;
  filePath: string;
};

const DATASETS: DatasetConfig[] = [
  {
    key: "out_questions",
    label: "Out Questions",
    filePath: path.join(process.cwd(), "out_questions", "article_stats.json"),
  },
  {
    key: "out_generated",
    label: "Out Generated",
    filePath: path.join(process.cwd(), "out_generated", "article_stats.json"),
  },
  {
    key: "out_simplified",
    label: "Out Simplified",
    filePath: path.join(process.cwd(), "out_simplified", "article_stats.json"),
  },
];

const toNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const formatNumber = (value: number | null, digits = 0) => {
  if (value === null) {
    return "—";
  }
  return digits > 0 ? value.toFixed(digits) : Math.round(value).toString();
};

const average = (values: Array<number | null>) => {
  const filtered = values.filter((value): value is number => value !== null);
  if (filtered.length === 0) {
    return null;
  }
  const sum = filtered.reduce((acc, value) => acc + value, 0);
  return sum / filtered.length;
};

const median = (values: Array<number | null>) => {
  const filtered = values
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (filtered.length === 0) {
    return null;
  }
  const mid = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 0) {
    return (filtered[mid - 1] + filtered[mid]) / 2;
  }
  return filtered[mid];
};

const buildHistogram = (values: Array<number | null>, binCount = 12) => {
  const numericValues = values.filter((value): value is number => value !== null);
  if (numericValues.length === 0) {
    return { bins: [], min: 0, max: 0 };
  }
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const span = max - min || 1;
  const bins = Array.from({ length: binCount }, () => 0);
  numericValues.forEach((value) => {
    const ratio = (value - min) / span;
    const index = Math.min(binCount - 1, Math.floor(ratio * binCount));
    bins[index] += 1;
  });
  return { bins, min, max };
};

const buildMetricSummary = (key: string, values: Array<number | null>) => ({
  key,
  values,
  histogram: buildHistogram(values, 12),
  mean: average(values),
  median: median(values),
});

const buildDatasetStats = (payload: ArticleStatsPayload) => {
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  const total = typeof payload.total === "number" ? payload.total : articles.length;

  const sentenceAvg = average(articles.map((item) => toNumber(item.sentenceCount)));
  const wordAvg = average(articles.map((item) => toNumber(item.wordCount)));
  const charAvg = average(articles.map((item) => toNumber(item.charCount)));
  const syllableAvg = average(articles.map((item) => toNumber(item.syllableCount)));
  const complexAvg = average(articles.map((item) => toNumber(item.complexWordCount)));
  const freAvg = average(
    articles.map((item) => toNumber(item.readability?.fleschReadingEase))
  );
  const fkAvg = average(
    articles.map((item) => toNumber(item.readability?.fleschKincaidGrade))
  );
  const ariAvg = average(articles.map((item) => toNumber(item.readability?.ari)));
  const clAvg = average(
    articles.map((item) => toNumber(item.readability?.colemanLiau))
  );
  const gfAvg = average(
    articles.map((item) => toNumber(item.readability?.gunningFog))
  );
  const ttrAvg = average(
    articles.map((item) => toNumber(item.informationDensity?.typeTokenRatio))
  );
  const rootTtrAvg = average(
    articles.map((item) => toNumber(item.informationDensity?.rootTypeTokenRatio))
  );
  const keywordTypeDensityAvg = average(
    articles.map((item) => toNumber(item.keywordDensity?.keywordTypeDensity))
  );
  const keywordTokenDensityAvg = average(
    articles.map((item) => toNumber(item.keywordDensity?.keywordTokenDensity))
  );
  const abstractnessAvg = average(
    articles.map((item) => toNumber(item.abstractness?.meanAbstractness))
  );
  const concretenessCoverageAvg = average(
    articles.map((item) => toNumber(item.abstractness?.concretenessCoverage))
  );

  const readabilityMetrics = [
    {
      key: "Flesch Reading Ease",
      values: articles.map((item) => toNumber(item.readability?.fleschReadingEase)),
    },
    {
      key: "Flesch-Kincaid Grade",
      values: articles.map((item) => toNumber(item.readability?.fleschKincaidGrade)),
    },
    {
      key: "ARI",
      values: articles.map((item) => toNumber(item.readability?.ari)),
    },
    {
      key: "Coleman-Liau",
      values: articles.map((item) => toNumber(item.readability?.colemanLiau)),
    },
    {
      key: "Gunning Fog",
      values: articles.map((item) => toNumber(item.readability?.gunningFog)),
    },
  ].map((metric) => buildMetricSummary(metric.key, metric.values));

  const lexicalSemanticMetrics = [
    {
      key: "Type-Token Ratio",
      values: articles.map((item) =>
        toNumber(item.informationDensity?.typeTokenRatio)
      ),
    },
    {
      key: "Root Type-Token Ratio",
      values: articles.map((item) =>
        toNumber(item.informationDensity?.rootTypeTokenRatio)
      ),
    },
    {
      key: "Keyword Type Density",
      values: articles.map((item) =>
        toNumber(item.keywordDensity?.keywordTypeDensity)
      ),
    },
    {
      key: "Keyword Token Density",
      values: articles.map((item) =>
        toNumber(item.keywordDensity?.keywordTokenDensity)
      ),
    },
    {
      key: "Mean Abstractness",
      values: articles.map((item) => toNumber(item.abstractness?.meanAbstractness)),
    },
    {
      key: "Concreteness Coverage",
      values: articles.map((item) =>
        toNumber(item.abstractness?.concretenessCoverage)
      ),
    },
  ].map((metric) => buildMetricSummary(metric.key, metric.values));

  const passageGroups = articles.reduce<Record<string, ArticleStatsEntry[]>>(
    (acc, item) => {
      const passage = item.index?.passage ?? "unknown";
      if (!acc[passage]) {
        acc[passage] = [];
      }
      acc[passage].push(item);
      return acc;
    },
    {}
  );

  const passageOrder = ["passage1", "passage2", "passage3", "unknown"];
  const passageDistributions = Object.entries(passageGroups)
    .sort(([a], [b]) => {
      const indexA = passageOrder.indexOf(a);
      const indexB = passageOrder.indexOf(b);
      if (indexA === -1 && indexB === -1) {
        return a.localeCompare(b);
      }
      if (indexA === -1) {
        return 1;
      }
      if (indexB === -1) {
        return -1;
      }
      return indexA - indexB;
    })
    .map(([passage, items]) => {
      const metrics = [
        {
          key: "Flesch Reading Ease",
          values: items.map((item) => toNumber(item.readability?.fleschReadingEase)),
        },
        {
          key: "Flesch-Kincaid Grade",
          values: items.map((item) => toNumber(item.readability?.fleschKincaidGrade)),
        },
        {
          key: "ARI",
          values: items.map((item) => toNumber(item.readability?.ari)),
        },
        {
          key: "Coleman-Liau",
          values: items.map((item) => toNumber(item.readability?.colemanLiau)),
        },
        {
          key: "Gunning Fog",
          values: items.map((item) => toNumber(item.readability?.gunningFog)),
        },
      ].map((metric) => ({
        ...buildMetricSummary(metric.key, metric.values),
      }));
      return { passage, metrics };
    });

  const passageSummary = passageDistributions.map((group) => {
    const record = (key: string) => group.metrics.find((metric) => metric.key === key);
    return {
      passage: group.passage,
      fre: record("Flesch Reading Ease"),
      fk: record("Flesch-Kincaid Grade"),
      ari: record("ARI"),
      cl: record("Coleman-Liau"),
      gf: record("Gunning Fog"),
    };
  });

  return {
    articles,
    total,
    sentenceAvg,
    wordAvg,
    charAvg,
    syllableAvg,
    complexAvg,
    freAvg,
    fkAvg,
    ariAvg,
    clAvg,
    gfAvg,
    ttrAvg,
    rootTtrAvg,
    keywordTypeDensityAvg,
    keywordTokenDensityAvg,
    abstractnessAvg,
    concretenessCoverageAvg,
    readabilityMetrics,
    lexicalSemanticMetrics,
    passageDistributions,
    passageSummary,
  };
};

const renderDataset = (
  dataset: DatasetConfig,
  payload: ArticleStatsPayload | null,
  error: string | null
) => {
  if (error || !payload) {
    return (
      <section key={dataset.key} style={{ marginBottom: 32 }}>
        <h2 style={{ marginBottom: 8 }}>{dataset.label}</h2>
        <p style={{ color: "crimson" }}>
          Failed to load <code>{path.basename(dataset.filePath)}</code>.
        </p>
        {error && <p style={{ fontSize: 14 }}>{error}</p>}
      </section>
    );
  }

  const stats = buildDatasetStats(payload);

  return (
    <section key={dataset.key} style={{ marginBottom: 48 }}>
      <h2 style={{ marginBottom: 8 }}>{dataset.label}</h2>
      <p style={{ marginBottom: 16 }}>
        Summary of <code>{dataset.key}/article_stats.json</code>.
      </p>

      <section style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>
          <strong>Total articles:</strong> {stats.total}
        </div>
        <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
          <div>Avg sentences: {formatNumber(stats.sentenceAvg)}</div>
          <div>Avg words: {formatNumber(stats.wordAvg)}</div>
          <div>Avg chars: {formatNumber(stats.charAvg)}</div>
          <div>Avg syllables: {formatNumber(stats.syllableAvg)}</div>
          <div>Avg complex words: {formatNumber(stats.complexAvg)}</div>
          <div>Avg Flesch reading ease: {formatNumber(stats.freAvg, 2)}</div>
          <div>Avg Flesch-Kincaid grade: {formatNumber(stats.fkAvg, 2)}</div>
          <div>Avg ARI: {formatNumber(stats.ariAvg, 2)}</div>
          <div>Avg Coleman-Liau: {formatNumber(stats.clAvg, 2)}</div>
          <div>Avg Gunning Fog: {formatNumber(stats.gfAvg, 2)}</div>
          <div>Avg Type-Token Ratio: {formatNumber(stats.ttrAvg, 4)}</div>
          <div>Avg Root TTR: {formatNumber(stats.rootTtrAvg, 4)}</div>
          <div>
            Avg Keyword Type Density: {formatNumber(stats.keywordTypeDensityAvg, 4)}
          </div>
          <div>
            Avg Keyword Token Density: {formatNumber(stats.keywordTokenDensityAvg, 4)}
          </div>
          <div>Avg Abstractness: {formatNumber(stats.abstractnessAvg, 4)}</div>
          <div>
            Avg Concreteness Coverage:{" "}
            {formatNumber(stats.concretenessCoverageAvg, 4)}
          </div>
        </div>
        <div style={{ display: "grid", gap: 6, fontSize: 14, marginTop: 12 }}>
          <div>
            Median sentences:{" "}
            {formatNumber(median(stats.articles.map((item) => toNumber(item.sentenceCount))))}
          </div>
          <div>
            Median words: {formatNumber(median(stats.articles.map((item) => toNumber(item.wordCount))))}
          </div>
          <div>
            Median chars: {formatNumber(median(stats.articles.map((item) => toNumber(item.charCount))))}
          </div>
          <div>
            Median syllables:{" "}
            {formatNumber(median(stats.articles.map((item) => toNumber(item.syllableCount))))}
          </div>
          <div>
            Median complex words:{" "}
            {formatNumber(median(stats.articles.map((item) => toNumber(item.complexWordCount))))}
          </div>
          <div>
            Median Flesch reading ease:{" "}
            {formatNumber(
              median(stats.articles.map((item) => toNumber(item.readability?.fleschReadingEase))),
              2
            )}
          </div>
          <div>
            Median Flesch-Kincaid grade:{" "}
            {formatNumber(
              median(stats.articles.map((item) => toNumber(item.readability?.fleschKincaidGrade))),
              2
            )}
          </div>
          <div>
            Median ARI:{" "}
            {formatNumber(median(stats.articles.map((item) => toNumber(item.readability?.ari))), 2)}
          </div>
          <div>
            Median Coleman-Liau:{" "}
            {formatNumber(
              median(stats.articles.map((item) => toNumber(item.readability?.colemanLiau))),
              2
            )}
          </div>
          <div>
            Median Gunning Fog:{" "}
            {formatNumber(
              median(stats.articles.map((item) => toNumber(item.readability?.gunningFog))),
              2
            )}
          </div>
          <div>
            Median Type-Token Ratio:{" "}
            {formatNumber(
              median(
                stats.articles.map((item) =>
                  toNumber(item.informationDensity?.typeTokenRatio)
                )
              ),
              4
            )}
          </div>
          <div>
            Median Root TTR:{" "}
            {formatNumber(
              median(
                stats.articles.map((item) =>
                  toNumber(item.informationDensity?.rootTypeTokenRatio)
                )
              ),
              4
            )}
          </div>
          <div>
            Median Keyword Type Density:{" "}
            {formatNumber(
              median(
                stats.articles.map((item) =>
                  toNumber(item.keywordDensity?.keywordTypeDensity)
                )
              ),
              4
            )}
          </div>
          <div>
            Median Keyword Token Density:{" "}
            {formatNumber(
              median(
                stats.articles.map((item) =>
                  toNumber(item.keywordDensity?.keywordTokenDensity)
                )
              ),
              4
            )}
          </div>
          <div>
            Median Abstractness:{" "}
            {formatNumber(
              median(
                stats.articles.map((item) =>
                  toNumber(item.abstractness?.meanAbstractness)
                )
              ),
              4
            )}
          </div>
          <div>
            Median Concreteness Coverage:{" "}
            {formatNumber(
              median(
                stats.articles.map((item) =>
                  toNumber(item.abstractness?.concretenessCoverage)
                )
              ),
              4
            )}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginBottom: 12 }}>Readability Distributions (Overall)</h3>
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          {stats.readabilityMetrics.map((metric) => {
            const bins = metric.histogram.bins;
            const maxBin = Math.max(...bins, 1);
            return (
              <div
                key={metric.key}
                style={{
                  border: "1px solid #ddd",
                  padding: 12,
                  borderRadius: 6,
                  background: "#fff",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{metric.key}</div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  Range: {formatNumber(metric.histogram.min, 2)}–{formatNumber(metric.histogram.max, 2)}
                </div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  Mean: {formatNumber(metric.mean, 2)} | Median: {formatNumber(metric.median, 2)}
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
                  {bins.length === 0 && <div style={{ fontSize: 12 }}>No data</div>}
                  {bins.map((count, index) => {
                    const height = Math.round((count / maxBin) * 80);
                    return (
                      <div
                        key={`${metric.key}-${index}`}
                        title={`${count} items`}
                        style={{
                          width: 12,
                          height,
                          background: "#4b7bec",
                          borderRadius: 2,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginBottom: 12 }}>Readability Summary by Passage</h3>
        <div style={{ overflowX: "auto", border: "1px solid #ddd" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Passage
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  FRE (Mean / Median)
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  FK (Mean / Median)
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  ARI (Mean / Median)
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  CL (Mean / Median)
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  GF (Mean / Median)
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.passageSummary.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 12 }}>
                    No passage data found.
                  </td>
                </tr>
              )}
              {stats.passageSummary.map((row) => (
                <tr key={row.passage}>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    {row.passage === "unknown" ? "Unknown" : row.passage}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(row.fre?.mean, 2)} / {formatNumber(row.fre?.median, 2)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(row.fk?.mean, 2)} / {formatNumber(row.fk?.median, 2)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(row.ari?.mean, 2)} / {formatNumber(row.ari?.median, 2)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(row.cl?.mean, 2)} / {formatNumber(row.cl?.median, 2)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(row.gf?.mean, 2)} / {formatNumber(row.gf?.median, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginBottom: 12 }}>Readability Distributions by Passage</h3>
        {stats.passageDistributions.map((group) => (
          <div key={group.passage} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              {group.passage === "unknown" ? "Unknown Passage" : group.passage}
            </div>
            <div
              style={{
                display: "grid",
                gap: 16,
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              }}
            >
              {group.metrics.map((metric) => {
                const bins = metric.histogram.bins;
                const maxBin = Math.max(...bins, 1);
                return (
                  <div
                    key={`${group.passage}-${metric.key}`}
                    style={{
                      border: "1px solid #ddd",
                      padding: 12,
                      borderRadius: 6,
                      background: "#fff",
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                      {metric.key}
                    </div>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                      Range: {formatNumber(metric.histogram.min, 2)}–{formatNumber(metric.histogram.max, 2)}
                    </div>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                      Mean: {formatNumber(metric.mean, 2)} | Median: {formatNumber(metric.median, 2)}
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
                      {bins.length === 0 && <div style={{ fontSize: 12 }}>No data</div>}
                      {bins.map((count, index) => {
                        const height = Math.round((count / maxBin) * 80);
                        return (
                          <div
                            key={`${group.passage}-${metric.key}-${index}`}
                            title={`${count} items`}
                            style={{
                              width: 12,
                              height,
                              background: "#4b7bec",
                              borderRadius: 2,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h3 style={{ marginBottom: 12 }}>Lexical & Semantic Distributions (Overall)</h3>
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          {stats.lexicalSemanticMetrics.map((metric) => {
            const bins = metric.histogram.bins;
            const maxBin = Math.max(...bins, 1);
            return (
              <div
                key={metric.key}
                style={{
                  border: "1px solid #ddd",
                  padding: 12,
                  borderRadius: 6,
                  background: "#fff",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  {metric.key}
                </div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  Range: {formatNumber(metric.histogram.min, 4)}–
                  {formatNumber(metric.histogram.max, 4)}
                </div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  Mean: {formatNumber(metric.mean, 4)} | Median:{" "}
                  {formatNumber(metric.median, 4)}
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
                  {bins.length === 0 && <div style={{ fontSize: 12 }}>No data</div>}
                  {bins.map((count, index) => {
                    const height = Math.round((count / maxBin) * 80);
                    return (
                      <div
                        key={`${metric.key}-${index}`}
                        title={`${count} items`}
                        style={{
                          width: 12,
                          height,
                          background: "#2a9d8f",
                          borderRadius: 2,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div style={{ overflowX: "auto", border: "1px solid #ddd" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  File
                </th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Index
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Sentences
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Words
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Chars
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Syllables
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Complex
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  FRE
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  FK
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  ARI
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  CL
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  GF
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  TTR
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Root TTR
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  KeyType Dens
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  KeyToken Dens
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Abstract.
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Conc. Cov.
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.articles.length === 0 && (
                <tr>
                  <td colSpan={18} style={{ padding: 12 }}>
                    No article stats found.
                  </td>
                </tr>
              )}
              {stats.articles.map((item) => {
                const indexLabel = [item.index?.ielts, item.index?.test, item.index?.passage]
                  .filter(Boolean)
                  .join(" / ");
                return (
                  <tr key={`${dataset.key}-${item.file}`}>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {item.file}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                      {indexLabel || "—"}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.sentenceCount))}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.wordCount))}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.charCount))}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.syllableCount))}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.complexWordCount))}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.readability?.fleschReadingEase), 2)}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.readability?.fleschKincaidGrade), 2)}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.readability?.ari), 2)}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.readability?.colemanLiau), 2)}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.readability?.gunningFog), 2)}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.informationDensity?.typeTokenRatio), 4)}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(
                        toNumber(item.informationDensity?.rootTypeTokenRatio),
                        4
                      )}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.keywordDensity?.keywordTypeDensity), 4)}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.keywordDensity?.keywordTokenDensity), 4)}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.abstractness?.meanAbstractness), 4)}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                      {formatNumber(toNumber(item.abstractness?.concretenessCoverage), 4)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
};

export default async function ArticleStatsPage() {
  const datasets = await Promise.all(
    DATASETS.map(async (dataset) => {
      try {
        const raw = await fs.readFile(dataset.filePath, "utf-8");
        return {
          dataset,
          payload: JSON.parse(raw) as ArticleStatsPayload,
          error: null,
        };
      } catch (err) {
        return {
          dataset,
          payload: null,
          error: err instanceof Error ? err.message : "Unexpected error",
        };
      }
    })
  );

  const summaryRows = datasets
    .filter((item) => item.payload)
    .map(({ dataset, payload }) => ({
      dataset,
      stats: buildDatasetStats(payload as ArticleStatsPayload),
    }));

  return (
    <main style={{ maxWidth: 1200, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Article Stats</h1>
      <p style={{ marginBottom: 16 }}>
        Summary of <code>article_stats.json</code> across multiple datasets.
      </p>
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ marginBottom: 12 }}>Dataset Summary Table</h2>
        <div style={{ overflowX: "auto", border: "1px solid #ddd" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Dataset
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Total
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg Sentences
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg Words
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg Chars
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg Syllables
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg Complex
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg FRE
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg FK
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg ARI
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg CL
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg GF
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg TTR
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg Root TTR
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg KeyToken Dens
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg Abstractness
                </th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                  Avg Conc. Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.length === 0 && (
                <tr>
                  <td colSpan={17} style={{ padding: 12 }}>
                    No dataset summary available.
                  </td>
                </tr>
              )}
              {summaryRows.map(({ dataset, stats }) => (
                <tr key={`summary-${dataset.key}`}>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{dataset.label}</td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {stats.total}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.sentenceAvg)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.wordAvg)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.charAvg)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.syllableAvg)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.complexAvg)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.freAvg, 2)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.fkAvg, 2)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.ariAvg, 2)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.clAvg, 2)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.gfAvg, 2)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.ttrAvg, 4)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.rootTtrAvg, 4)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.keywordTokenDensityAvg, 4)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.abstractnessAvg, 4)}
                  </td>
                  <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>
                    {formatNumber(stats.concretenessCoverageAvg, 4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {datasets.map(({ dataset, payload, error }) => renderDataset(dataset, payload, error))}
    </main>
  );
}
