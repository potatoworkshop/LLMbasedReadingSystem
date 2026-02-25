import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

type LocalSource = "generated" | "questions" | "generated_questions";

const SOURCE_DIRS: Record<LocalSource, string> = {
  generated: "out_generated",
  questions: "out_questions",
  generated_questions: "out_questions_generated",
};

const isSafeFilename = (filename: string) =>
  filename === path.basename(filename) && !filename.includes("/") && !filename.includes("\\");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const source = url.searchParams.get("source") as LocalSource | null;
  const filename = url.searchParams.get("file");

  if (!source || !(source in SOURCE_DIRS)) {
    return NextResponse.json(
      {
        error:
          "Invalid source. Use 'generated', 'questions', or 'generated_questions'.",
      },
      { status: 400 }
    );
  }

  const baseDir = path.join(process.cwd(), SOURCE_DIRS[source]);

  if (!filename) {
    try {
      const entries = await fs.readdir(baseDir);
      const files = entries.filter((entry) => entry.endsWith(".json")).sort();
      return NextResponse.json({ files });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to read files." },
        { status: 500 }
      );
    }
  }

  if (!isSafeFilename(filename) || !filename.endsWith(".json")) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 });
  }

  try {
    const filePath = path.join(baseDir, filename);
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);

    const normalizeArticle = (value: unknown) => {
      if (Array.isArray(value)) {
        return value.filter((item) => typeof item === "string");
      }
      if (typeof value === "string") {
        return value
          .split("\n\n")
          .map((paragraph) => paragraph.trim())
          .filter(Boolean);
      }
      return [];
    };

    if (source === "generated") {
      const article = normalizeArticle(data.article);
      return NextResponse.json({
        source,
        filename,
        title: data.title || filename,
        article,
        metrics: data.metrics,
      });
    }

    const article = normalizeArticle(data.article);
    const judgementQuestions = Array.isArray(data.judgement_questions)
      ? data.judgement_questions.map((item: { number?: number; question: string; answer?: string }) => ({
          type: "judgement",
          number: item.number,
          question: item.question,
          answer: item.answer,
        }))
      : [];
    const singleChoiceQuestions = Array.isArray(data.single_choice_questions)
      ? data.single_choice_questions.map(
          (item: {
            number?: number;
            question: string;
            answer?: string;
            options?: { label?: string; text?: string }[];
          }) => ({
            type: "single_choice",
            number: item.number,
            question: item.question,
            answer: item.answer,
            options: Array.isArray(item.options)
              ? item.options.map((option) => {
                  const label = option.label ? `${option.label}. ` : "";
                  return `${label}${option.text ?? ""}`.trim();
                })
              : [],
          })
        )
      : [];

    return NextResponse.json({
      source,
      filename,
      title:
        data.title?.name ||
        data.title?.text ||
        data.title?.title ||
        data.title ||
        filename,
      article,
      questions: [...judgementQuestions, ...singleChoiceQuestions],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read file." },
      { status: 500 }
    );
  }
}
