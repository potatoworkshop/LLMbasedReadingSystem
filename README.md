# LLM Based Reading System

This project is a simple reading passage generator.
It has a Next.js frontend and an Express backend.
The system can use OpenAI or Ollama to create short reading texts.

## Setup

Install dependencies:

```bash
npm install
npm install --prefix server
```

Create the environment file:

```bash
cp server/.env.example server/.env
```

Then set your model provider in `server/.env`.

Examples:

```env
LLM_PROVIDER=openai
OPENROUTER_API_KEY=your_key
```

or

```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=your_model
```

## Run

```bash
npm run dev
```

Frontend: `http://localhost:3000`  
Backend: `http://localhost:3001`

## API

Main endpoint:

`POST /api/generate-article`

Example request:

```json
{
  "topic": "Rainforest ecosystems",
  "level": 2,
  "target_words": 220,
  "lang": "en"
}
```
