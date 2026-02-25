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

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
