const fs = require("fs");
const path = require("path");

const resolveDirArg = (value, fallback) =>
  path.resolve(__dirname, "..", value || fallback);

const inputDir = resolveDirArg(process.argv[2], "out_questions");
const outputFile = process.argv[3]
  ? resolveDirArg(process.argv[3], "article_stats.json")
  : path.join(inputDir, "article_stats.json");

const files = fs
  .readdirSync(inputDir)
  .filter((file) => file.endsWith(".json") && file !== path.basename(outputFile));

const CONCRETENESS_FILE = path.resolve(
  __dirname,
  "..",
  "data",
  "Concreteness_ratings_Brysbaert_et_al_BRM.txt"
);

const STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

const normalizeText = (text) =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const splitSentences = (text) => {
  if (!text) return [];
  return text
    .replace(/([.!?])\s+/g, "$1|")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
};

const countWords = (text) => {
  if (!text) return 0;
  const cleaned = text.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
};

const extractWords = (text) => {
  if (!text) return [];
  const matches = text.match(/[a-z]+/g);
  return matches ? matches : [];
};

const countSyllablesInWord = (word) => {
  if (!word) return 0;
  let value = word.toLowerCase();
  if (value.length > 1 && value.endsWith("e")) {
    value = value.slice(0, -1);
  }
  const groups = value.match(/[aeiouy]+/g);
  const count = groups ? groups.length : 0;
  return Math.max(1, count);
};

const stripCommonSuffix = (word) => {
  if (word.endsWith("ed") && word.length > 2) {
    return word.slice(0, -2);
  }
  if (word.endsWith("es") && word.length > 2) {
    return word.slice(0, -2);
  }
  return word;
};

const countSyllables = (words) =>
  words.reduce((sum, word) => sum + countSyllablesInWord(word), 0);

const countComplexWords = (words) => {
  let total = 0;
  for (const word of words) {
    const base = stripCommonSuffix(word);
    if (countSyllablesInWord(base) > 3) {
      total += 1;
    }
  }
  return total;
};

const countCharsNoSpacePunct = (text) => {
  if (!text) return 0;
  const matches = text.match(/[\p{L}\p{N}]/gu);
  return matches ? matches.length : 0;
};

const safeDivide = (numerator, denominator) =>
  denominator === 0 ? 0 : numerator / denominator;

const round = (value, digits = 6) => {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
};

const computeReadability = ({
  sentenceCount,
  wordCount,
  syllableCount,
  charCount,
  complexWordCount,
}) => {
  const asl = safeDivide(wordCount, sentenceCount);
  const asw = safeDivide(syllableCount, wordCount);
  const lettersPer100 = safeDivide(charCount, wordCount) * 100;
  const sentencesPer100 = safeDivide(sentenceCount, wordCount) * 100;
  const complexPercent = safeDivide(complexWordCount, wordCount) * 100;

  return {
    fleschReadingEase: 206.835 - 1.015 * asl - 84.6 * asw,
    fleschKincaidGrade: 0.39 * asl + 11.8 * asw - 15.59,
    ari: 4.71 * safeDivide(charCount, wordCount) + 0.5 * asl - 21.43,
    colemanLiau: 0.0588 * lettersPer100 - 0.296 * sentencesPer100 - 15.8,
    gunningFog: 0.4 * (asl + complexPercent),
  };
};

const normalizeLexiconWord = (word) =>
  word.toLowerCase().replace(/[^a-z]/g, "");

const loadConcretenessRatings = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Concreteness file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    throw new Error(`Concreteness file is empty: ${filePath}`);
  }

  const header = lines[0].split("\t");
  const wordIndex = header.indexOf("Word");
  const concIndex = header.indexOf("Conc.M");

  if (wordIndex === -1 || concIndex === -1) {
    throw new Error(
      `Concreteness file header missing required columns (Word, Conc.M): ${filePath}`
    );
  }

  const ratings = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const columns = lines[i].split("\t");
    if (columns.length <= Math.max(wordIndex, concIndex)) {
      continue;
    }
    const word = normalizeLexiconWord(columns[wordIndex] || "");
    const score = Number(columns[concIndex]);
    if (!word || !Number.isFinite(score)) {
      continue;
    }
    ratings.set(word, score);
  }

  return ratings;
};

const buildTermCounts = (terms) => {
  const counts = new Map();
  for (const term of terms) {
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  return counts;
};

const filterContentTerms = (words) =>
  words.filter(
    (word) => word.length >= 3 && !STOPWORDS.has(word) && /[a-z]/.test(word)
  );

const buildTfIdfProfile = (docTermsList) => {
  const docCount = docTermsList.length;
  const documentFrequencies = new Map();

  for (const terms of docTermsList) {
    const uniqueTerms = new Set(terms);
    for (const term of uniqueTerms) {
      documentFrequencies.set(term, (documentFrequencies.get(term) || 0) + 1);
    }
  }

  return docTermsList.map((terms) => {
    const counts = buildTermCounts(terms);
    const uniqueTermCount = counts.size;
    const totalTerms = terms.length;

    if (totalTerms === 0 || uniqueTermCount === 0) {
      return {
        selectedKeywords: [],
        keywordTypeCount: 0,
        keywordTokenCount: 0,
      };
    }

    const scores = [];
    for (const [term, count] of counts.entries()) {
      const tf = count / totalTerms;
      const df = documentFrequencies.get(term) || 0;
      const idf = Math.log((docCount + 1) / (df + 1)) + 1;
      const tfidf = tf * idf;
      scores.push({ term, tfidf, count });
    }

    scores.sort((a, b) => {
      if (b.tfidf !== a.tfidf) {
        return b.tfidf - a.tfidf;
      }
      return a.term.localeCompare(b.term);
    });

    const keywordTypeCount = Math.max(
      5,
      Math.min(20, Math.round(Math.sqrt(uniqueTermCount)))
    );
    const selected = scores.slice(0, keywordTypeCount);
    const keywordTokenCount = selected.reduce((sum, item) => sum + item.count, 0);

    return {
      selectedKeywords: selected.map((item) => item.term),
      keywordTypeCount: selected.length,
      keywordTokenCount,
    };
  });
};

const computeInformationDensity = (words, totalWords) => {
  const uniqueWordCount = new Set(words).size;
  return {
    uniqueWordCount,
    typeTokenRatio: round(safeDivide(uniqueWordCount, totalWords)),
    rootTypeTokenRatio: round(safeDivide(uniqueWordCount, Math.sqrt(totalWords))),
  };
};

const computeAbstractness = (words, concretenessMap) => {
  let matchedTokenCount = 0;
  let concretenessSum = 0;

  for (const word of words) {
    const score = concretenessMap.get(word);
    if (typeof score === "number") {
      matchedTokenCount += 1;
      concretenessSum += score;
    }
  }

  const totalTokenCount = words.length;
  const meanConcreteness =
    matchedTokenCount > 0 ? concretenessSum / matchedTokenCount : null;
  const meanAbstractness = meanConcreteness === null ? null : 6 - meanConcreteness;

  return {
    meanConcreteness:
      meanConcreteness === null ? null : round(meanConcreteness, 4),
    meanAbstractness: meanAbstractness === null ? null : round(meanAbstractness, 4),
    concretenessCoverage: round(safeDivide(matchedTokenCount, totalTokenCount), 6),
    matchedTokenCount,
    totalTokenCount,
  };
};

const parseIndex = (fileName, data) => {
  const match = fileName.match(/^ielts_(\d+)_test(\d+)_passage(\d+)_/);
  if (match) {
    return {
      ielts: `ielts-${match[1]}`,
      test: `test-${match[2]}`,
      passage: `passage${match[3]}`,
    };
  }

  const test = data?.title?.test;
  const passage = data?.title?.passage;
  return {
    ielts: "ielts-unknown",
    test: Number.isInteger(test) ? `test-${test}` : "test-unknown",
    passage: Number.isInteger(passage) ? `passage${passage}` : "passage-unknown",
  };
};

const concretenessMap = loadConcretenessRatings(CONCRETENESS_FILE);

const baseArticles = files.map((file) => {
  const fullPath = path.join(inputDir, file);
  const raw = fs.readFileSync(fullPath, "utf8");
  const data = JSON.parse(raw);

  const articleParts = Array.isArray(data.article)
    ? data.article
    : typeof data.article === "string"
      ? data.article.split(/\n\s*\n/)
      : [];
  const combined = normalizeText(articleParts.join(" "));
  const sentences = splitSentences(combined);
  const words = extractWords(combined);
  const contentTerms = filterContentTerms(words);

  return {
    file,
    data,
    words,
    contentTerms,
    stats: {
      sentenceCount: sentences.length,
      wordCount: countWords(combined),
      charCount: countCharsNoSpacePunct(combined),
      syllableCount: countSyllables(words),
      complexWordCount: countComplexWords(words),
    },
  };
});

const tfidfProfiles = buildTfIdfProfile(
  baseArticles.map((article) => article.contentTerms)
);

const results = baseArticles.map((article, index) => {
  const tfidf = tfidfProfiles[index];
  const infoDensity = computeInformationDensity(
    article.words,
    article.stats.wordCount
  );
  const abstractness = computeAbstractness(article.words, concretenessMap);

  const keywordTypeDensity = round(
    safeDivide(tfidf.keywordTypeCount, article.stats.wordCount)
  );
  const keywordTokenDensity = round(
    safeDivide(tfidf.keywordTokenCount, article.stats.wordCount)
  );

  const stats = {
    file: article.file,
    index: parseIndex(article.file, article.data),
    sentenceCount: article.stats.sentenceCount,
    wordCount: article.stats.wordCount,
    charCount: article.stats.charCount,
    syllableCount: article.stats.syllableCount,
    complexWordCount: article.stats.complexWordCount,
  };

  return {
    ...stats,
    readability: computeReadability(stats),
    informationDensity: infoDensity,
    keywordDensity: {
      keywordTypeCount: tfidf.keywordTypeCount,
      keywordTokenCount: tfidf.keywordTokenCount,
      keywordTypeDensity,
      keywordTokenDensity,
      selectedKeywords: tfidf.selectedKeywords,
    },
    abstractness,
  };
});

const output = {
  total: results.length,
  articles: results,
};

fs.writeFileSync(outputFile, JSON.stringify(output, null, 2) + "\n", "utf8");

console.log(`Wrote ${results.length} records to ${outputFile}`);
