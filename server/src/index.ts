import express from "express";
import cors from "cors";
import generateArticleRouter from "./routes/generateArticle";
import "dotenv/config";


const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", generateArticleRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 3001;

const server = app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

// 延长超时时间以支持多轮 LLM 迭代 (15 minutes)
server.timeout = 900000;
server.headersTimeout = 900000;
server.keepAliveTimeout = 900000;
