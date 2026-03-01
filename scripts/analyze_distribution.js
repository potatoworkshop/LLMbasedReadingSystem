const fs = require("fs");
const path = require("path");

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node analyze_distribution.js <article_stats.json>");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
const articles = data.articles || [];

const getStats = (arr) => {
  if (arr.length === 0) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  return {
    min: sorted[0],
    q1: q(0.25),
    median: q(0.5),
    q3: q(0.75),
    max: sorted[sorted.length - 1],
    avg: sorted.reduce((a, b) => a + b, 0) / sorted.length
  };
};

const metrics = [
  { name: "FK", selector: (r) => r.readability.fleschKincaidGrade },
  { name: "FRE", selector: (r) => r.readability.fleschReadingEase },
  { name: "ARI", selector: (r) => r.readability.ari },
  { name: "CLI", selector: (r) => r.readability.colemanLiau },
  { name: "GF", selector: (r) => r.readability.gunningFog },
  { name: "ASL", selector: (r) => r.sentenceCount > 0 ? r.wordCount / r.sentenceCount : 0 },
  { name: "Abstractness", selector: (r) => r.abstractness.meanAbstractness }
];

console.log(`
=== Distribution Analysis: ${filePath} ===`);
metrics.forEach(m => {
  const values = articles.map(m.selector).filter(v => typeof v === 'number' && !isNaN(v));
  const s = getStats(values);
  if (s) {
    console.log(`${m.name.padEnd(12)} | Min: ${s.min.toFixed(2)} | Q1: ${s.q1.toFixed(2)} | Median: ${s.median.toFixed(2)} | Q3: ${s.q3.toFixed(2)} | Max: ${s.max.toFixed(2)} | Avg: ${s.avg.toFixed(2)}`);
  }
});
