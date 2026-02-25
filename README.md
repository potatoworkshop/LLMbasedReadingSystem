# LLM Based Reading System

A simple Next.js frontend with an Express + TypeScript backend that generates short reading passages using either OpenAI or Ollama.

## Setup

1) Install root dependencies:

```bash
npm install
```

2) Install server dependencies:

```bash
npm install --prefix server
```

3) Configure environment variables:

```bash
cp server/.env.example server/.env
```

Set either:
- `LLM_PROVIDER=openai` and `OPENROUTER_API_KEY=...`
- `LLM_PROVIDER=ollama` and `OLLAMA_MODEL=...`

If `LLM_PROVIDER` is not set, the server uses Ollama when `OLLAMA_BASE_URL` or `OLLAMA_MODEL` is present; otherwise it uses OpenRouter if `OPENROUTER_API_KEY` is set.

## Run

```bash
npm run dev
```

- Next.js runs on `http://localhost:3000`
- Express runs on `http://localhost:3001`

## API

`POST /api/generate-article`

Request:
```json
{
  "topic": "Rainforest ecosystems",
  "level": 2,
  "target_words": 220,
  "lang": "en"
}
```

Response:
```json
{
  "article_id": "uuid",
  "topic": "Rainforest ecosystems",
  "level": 2,
  "target_words": 220,
  "title": "...",
  "article": "...",
  "metrics": {
    "word_count": 214,
    "sentence_count": 9,
    "avg_sentence_len": 23.78,
    "avg_word_len": 4.68
  }
}
```
