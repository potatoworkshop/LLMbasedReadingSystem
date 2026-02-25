export class JsonExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonExtractError";
  }
}

export const extractJson = (text: string): unknown => {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new JsonExtractError("No JSON object found");
  }

  const jsonString = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonString);
  } catch {
    throw new JsonExtractError("Failed to parse JSON");
  }
};
