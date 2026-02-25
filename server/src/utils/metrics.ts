export type Metrics = {
  word_count: number;
  sentence_count: number;
  avg_sentence_len: number;
  avg_word_len: number;
  syllable_count: number;
  complex_word_count: number;
  complex_word_ratio: number;
  flesch_reading_ease: number;
  flesch_kincaid_grade: number;
  ari: number;
  coleman_liau: number;
  gunning_fog: number;
};

const roundTwo = (value: number) => Number(value.toFixed(2));

const safeDivide = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : numerator / denominator;

const extractWords = (text: string) => text.match(/[A-Za-z0-9']+/g) ?? [];

const countSyllablesInWord = (word: string) => {
  if (!word) {
    return 0;
  }

  let value = word.toLowerCase();
  if (value.length > 1 && value.endsWith("e")) {
    value = value.slice(0, -1);
  }
  const groups = value.match(/[aeiouy]+/g);
  const count = groups ? groups.length : 0;
  return Math.max(1, count);
};

const stripCommonSuffix = (word: string) => {
  if (word.endsWith("ed") && word.length > 2) {
    return word.slice(0, -2);
  }
  if (word.endsWith("es") && word.length > 2) {
    return word.slice(0, -2);
  }
  return word;
};

export const computeMetrics = (text: string): Metrics => {
  const words = extractWords(text);
  const wordCount = words.length;
  const sentenceCount = text
    .split(/[.!?]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean).length;
  const totalWordChars = words.reduce((sum, word) => sum + word.length, 0);
  const syllableCount = words.reduce(
    (sum, word) => sum + countSyllablesInWord(word),
    0
  );
  const complexWordCount = words.reduce((sum, word) => {
    const base = stripCommonSuffix(word.toLowerCase());
    return sum + (countSyllablesInWord(base) > 3 ? 1 : 0);
  }, 0);

  const avgSentenceLen = sentenceCount > 0 ? wordCount / sentenceCount : 0;
  const avgWordLen = wordCount > 0 ? totalWordChars / wordCount : 0;
  const complexWordRatio = safeDivide(complexWordCount, wordCount);
  const lettersPer100 = safeDivide(totalWordChars, wordCount) * 100;
  const sentencesPer100 = safeDivide(sentenceCount, wordCount) * 100;
  const complexPercent = complexWordRatio * 100;
  const asl = avgSentenceLen;
  const asw = safeDivide(syllableCount, wordCount);

  return {
    word_count: wordCount,
    sentence_count: sentenceCount,
    avg_sentence_len: roundTwo(avgSentenceLen),
    avg_word_len: roundTwo(avgWordLen),
    syllable_count: syllableCount,
    complex_word_count: complexWordCount,
    complex_word_ratio: roundTwo(complexWordRatio),
    flesch_reading_ease: roundTwo(206.835 - 1.015 * asl - 84.6 * asw),
    flesch_kincaid_grade: roundTwo(0.39 * asl + 11.8 * asw - 15.59),
    ari: roundTwo(4.71 * safeDivide(totalWordChars, wordCount) + 0.5 * asl - 21.43),
    coleman_liau: roundTwo(
      0.0588 * lettersPer100 - 0.296 * sentencesPer100 - 15.8
    ),
    gunning_fog: roundTwo(0.4 * (asl + complexPercent)),
  };
};
