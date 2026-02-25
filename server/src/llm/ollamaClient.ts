const defaultBaseUrl = "http://localhost:11434";

export const callOllama = async (prompt: string) => {
  const baseUrl = process.env.OLLAMA_BASE_URL || defaultBaseUrl;
  const model = process.env.OLLAMA_MODEL;

  if (!model) {
    throw new Error("OLLAMA_MODEL is not set");
  }

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      format: "json"
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    message?: { content?: string };
  };

  const content = data.message?.content;
  if (!content) {
    throw new Error("Ollama response missing content");
  }

  return content;
};
