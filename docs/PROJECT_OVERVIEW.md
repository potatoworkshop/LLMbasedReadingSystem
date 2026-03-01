# LLM Based Reading System 项目文档（代码说明）

## 1. 项目概述

本项目是一个“LLM 驱动的阅读材料生成与分析系统”，采用：

- 前端：Next.js（App Router）
- 后端：Express + TypeScript
- LLM 接入：OpenRouter / Ollama（统一适配层）

系统当前代码能力包括：

- 按主题、目标字数、等级生成英文阅读文章（IELTS 风格）
- 对文章执行改写（`simplify` / `harder` / `shorten`）
- 将文章调节到指定难度等级（1-5），使用多项阅读指标区间做闭环迭代
- 生成阅读理解题目（判断题 + 单选题），并执行结构校验/修复（代码已实现）
- 浏览本地语料（生成文章、参考题库、生成题目）
- 统计并可视化多个数据集的可读性、词汇密度与抽象度指标

说明：

- 论文主线可聚焦“动态阅读材料生成 + 指定难度调节 + 统计分析”
- 题目生成模块是系统扩展能力，代码仍保留并可用于后续实验或演示

## 2. 当前功能与数据流（按用户操作）

### 2.1 文章生成

用户在首页输入：

- `topic`
- `level`（1-5）
- `target_words`
- `model`（OpenRouter 模型）

前端调用：

- `POST http://localhost:3001/api/generate-article`

后端流程：

- 参数校验（Zod）
- 构造提示词（包含目标长度、难度等级、JSON 输出要求）
- 调用 LLM
- 解析 JSON
- 计算基础指标（词数、句数、FRE/FK 等）
- 若长度偏差过大则重试并保留更优候选
- 归档到 `out_generated/`

### 2.2 文章改写（基础改写）

改写模式：

- `simplify`
- `harder`
- `shorten`

前端调用：

- `POST http://localhost:3001/api/simplify-article`

后端流程：

- 构造改写提示词
- 调用 LLM 并解析 JSON
- 写入 `out_simplified/`

### 2.3 指定难度调节（核心）

前端调用：

- `POST http://localhost:3001/api/adjust-difficulty`

后端流程：

- 输入：`article`、`target_level`、`max_rounds`、`fidelity_threshold`
- 使用 `difficultyProfiles.ts` 中定义的等级目标区间（1-5）
- 计算当前文本指标与目标区间距离
- 选择调节方向（趋向更易/更难）
- 多轮迭代改写并重新计算指标
- 用保真度评分（实体/数字/关键词召回）过滤候选
- 输出最佳结果（命中目标或 best effort）
- 写入 `out_simplified/`（`mode: difficulty_adjust`）

### 2.4 题目生成与校验（扩展模块）

前端调用：

- `POST http://localhost:3001/api/generate-questions`

后端流程：

- 生成判断题与单选题（要求严格 JSON）
- 每题包含 `evidence_sentence_indices`
- 调用 `questionValidator.ts` 校验数量、选项结构、答案合法性、重复、证据索引、词汇重叠
- 若不通过则进入 repair prompt 修复（最多若干轮）
- 写入 `out_questions_generated/`

### 2.5 本地语料浏览与统计分析

前端页面：

- `/`：本地文章读取与展示
- `/article-stats`：统计分析页面

本地 API：

- `GET /api/local-articles?source=...`

支持数据源：

- `generated` -> `out_generated/`
- `questions` -> `out_questions/`
- `generated_questions` -> `out_questions_generated/`

统计脚本：

- `scripts/compute_article_stats.js`
 - `scripts/run_ch5_generation_batch.js`（第5章生成批量实验）
 - `scripts/run_ch5_adjust_batch.js`（第5章难度调节批量实验）

输入目录中的 JSON 文章，输出：

- `article_stats.json`

## 3. 目录结构（核心）

- `app/`
  - `app/page.tsx`：首页（生成、改写、指定难度调节、题目生成、本地语料浏览）
  - `app/article-stats/page.tsx`：统计页面（多数据集汇总、分布、表格）
  - `app/api/local-articles/route.ts`：本地 JSON 读取接口（含文件名安全校验）
- `server/`
  - `server/src/index.ts`：Express 入口
  - `server/src/routes/generateArticle.ts`：生成/改写/难度调节/出题/模型列表 API
  - `server/src/services/articleService.ts`：文章生成 + 重试 + 归档
  - `server/src/services/lexicalTransform.ts`：基础改写
  - `server/src/services/difficultyAdjustService.ts`：指定难度调节（闭环）
  - `server/src/services/questionService.ts`：题目生成 + repair
  - `server/src/services/questionValidator.ts`：题目结构校验
  - `server/src/config/difficultyProfiles.ts`：1-5 难度等级目标区间
  - `server/src/llm/*`：LLM 适配（OpenRouter / Ollama）
  - `server/src/utils/jsonExtract.ts`：从 LLM 输出中提取 JSON
  - `server/src/utils/metrics.ts`：文本指标计算
- `scripts/compute_article_stats.js`
  - 批量统计脚本（可读性、信息密度、关键词密度、抽象度）
- `scripts/run_ch5_generation_batch.js`
  - 读取 `experiments/ch5/configs/*.json`，批量调用 `/api/generate-article`
  - 输出 `experiments/ch5/logs/*.jsonl` 和 `experiments/ch5/manifests/*.json`
- `scripts/run_ch5_adjust_batch.js`
  - 读取 `experiments/ch5/configs/*.json`，批量调用 `/api/adjust-difficulty`
  - 输出 `experiments/ch5/logs/*.jsonl` 和 `experiments/ch5/manifests/*.json`
- `experiments/ch5/configs/`
  - 第5章实验配置（按模型拆分 generation/adjust 批次）
- `experiments/ch5/logs/`
  - 批量实验逐条执行日志（成功/失败、耗时、token）
- `experiments/ch5/manifests/`
  - 批量实验成功样本清单与批次汇总
- `out_generated/`
  - 生成文章归档
- `out_simplified/`
  - 改写和难度调节结果归档
- `out_questions/`
  - 参考题库语料（本地已有）
- `out_questions_generated/`
  - 系统生成题目归档
- `docs/`
  - 论文草稿、项目文档、参考文献与演示材料

## 4. 前端代码说明（`app/`）

### 4.1 首页 `app/page.tsx`

主要功能：

- 获取模型列表
- 生成文章
- 基础改写
- 指定难度调节（显示前后指标与保真度）
- 题目生成（扩展）
- 读取本地语料并进行本地文章改写

主要状态（按功能分组）：

- 生成：`topic` / `level` / `targetWords` / `model` / `result`
- 改写：`transformMode` / `transformedArticle`
- 难度调节：`difficultyTargetLevel` / `difficultyResult`
- 题目生成：`questionJudgementCount` / `questionSingleChoiceCount` / `questionResult`
- 本地语料：`localSource` / `localFiles` / `localFile` / `localArticle`

主要函数：

- `handleSubmit()`：生成文章
- `handleTransform()`：基础改写
- `handleAdjustDifficulty()`：指定难度调节
- `handleGenerateQuestions()`：题目生成（扩展）
- `handleLoadLocal()`：读取本地 JSON
- `handleLocalTransform()`：对本地文章执行基础改写

### 4.2 本地文章 API `app/api/local-articles/route.ts`

职责：

- 返回本地 JSON 文件列表
- 读取指定 JSON 文件并标准化返回结构
- 防路径穿越（`isSafeFilename()`）

注意：

- `questions` 和 `generated_questions` 的 JSON 结构不同，但接口层做了统一展示格式转换

### 4.3 统计页 `app/article-stats/page.tsx`

职责：

- 读取多个数据集的 `article_stats.json`
- 汇总平均数/中位数
- 构建直方图
- 展示总体分布、按 passage 分布、明细表格

默认读取数据集：

- `out_questions/article_stats.json`
- `out_generated/article_stats.json`
- `out_simplified/article_stats.json`

## 5. 后端代码说明（`server/`）

### 5.1 路由层 `server/src/routes/generateArticle.ts`

包含 API：

- `POST /generate-article`
- `POST /simplify-article`
- `POST /adjust-difficulty`
- `POST /generate-questions`（扩展）
- `GET /llm-models`

特点：

- 全部请求先经 Zod schema 校验
- 统一返回错误结构（`error` + `message/details`）
- 生成/改写/调节/出题结果都会归档到本地目录
- `generate-article` / `adjust-difficulty` 已支持实验元数据字段（`experiment` / `source`），便于第5章批量实验追踪

### 5.2 文章生成 `server/src/services/articleService.ts`

关键实现点：

- `buildPrompt()`：提示词包含主题、目标字数范围、等级难度描述、JSON 返回格式
- 已加入按等级长度补偿（length compensation）校准低等级文本系统性偏短
- `computeMetrics()`：生成后立即计算文本指标
- `MAX_GENERATION_ATTEMPTS`：多次尝试
- `bestCandidate`：保留最接近目标字数的候选
- `archiveArticle()`：写入 `out_generated/`
- 归档包含实验元数据、长度补偿信息、生成尝试信息、token 消耗统计

### 5.3 基础改写 `server/src/services/lexicalTransform.ts`

功能：

- 按模式（简化/复杂化/缩句）构造不同规则
- 要求 LLM 返回严格 JSON：`{"article":"..."}`

### 5.4 指定难度调节 `server/src/services/difficultyAdjustService.ts`

这是系统核心方法模块，区别于简单改写：

- 使用 `difficultyProfiles.ts` 的 1-5 等级目标区间
- 用 `distanceToProfile()` 衡量当前文本距离目标难度
- 用 `isMetricsWithinProfile()` 判断是否命中目标
- 迭代改写并记录 `history`
- 使用 `computeFidelity()` 做内容保真约束（实体/数字/关键词召回）
- 仅接受满足保真阈值且更接近目标的候选

输出包括：

- `original_metrics` / `final_metrics`
- `hit_target`
- `rounds_used`
- `history`
- `fidelity`
- `model` / `provider`
- `token_usage`（累计 token 与 LLM 调用次数）

### 5.5 题目生成与校验（扩展）

- `questionService.ts`
  - 生成判断题/单选题
  - 支持 repair prompt 修复不合格结果
- `questionValidator.ts`
  - 校验数量、结构、答案标签、重复、证据句索引、词汇重叠等

该模块是工程扩展能力，论文可按需要选择是否纳入主实验。

### 5.6 LLM 适配层 `server/src/llm/*`

- `llmAdapter.ts`
  - 自动判断使用 `openrouter` 或 `ollama`
  - 向上层提供统一 `getLlmResponse()`
- `openrouterClient.ts`
  - 模型列表常量 `OPENROUTER_MODEL_OPTIONS`
  - 调用 OpenRouter Chat Completions API
- `ollamaClient.ts`
  - 调用本地 Ollama 模型

## 6. 指标与统计脚本说明

### 6.1 在线指标（生成/调节阶段）

`server/src/utils/metrics.ts` 计算：

- `word_count`
- `sentence_count`
- `avg_sentence_len`
- `avg_word_len`
- `complex_word_ratio`
- `flesch_reading_ease`
- `flesch_kincaid_grade`
- `ari`
- `coleman_liau`
- `gunning_fog`

### 6.2 离线统计（语料分析阶段）

`scripts/compute_article_stats.js` 除了经典可读性指标，还计算：

- 信息密度：`typeTokenRatio`、`rootTypeTokenRatio`
- 关键词密度：TF-IDF 选词后的 type/token density
- 抽象度：基于 concreteness ratings 的 `meanAbstractness`

用途：

- 支撑论文中的“真实语料 vs 生成语料 vs 调节语料”对比分析
- 为 `app/article-stats/page.tsx` 提供输入数据

## 7. 接口速览

后端（默认 `http://localhost:3001`）：

- `POST /api/generate-article`
- `POST /api/simplify-article`
- `POST /api/adjust-difficulty`
- `POST /api/generate-questions`（扩展）
- `GET  /api/llm-models`
- `GET  /health`

前端本地 API（Next.js）：

- `GET /api/local-articles?source=generated|questions|generated_questions`
- `GET /api/local-articles?source=...&file=xxx.json`

## 8. 运行方式（本地开发）

项目根目录脚本（`package.json`）：

- `npm run dev`：同时启动前端（3000）和后端（3001）
- `npm run dev:next`
- `npm run dev:server`

前置条件：

- Node.js 环境
- 后端依赖（`server/` 下）
- 至少配置一种 LLM 提供方（OpenRouter 或 Ollama）

## 9. 环境变量（后端）

- `LLM_PROVIDER=openrouter|ollama`
- `OPENROUTER_API_KEY=...`
- `OPENROUTER_MODEL=...`
- `OPENROUTER_SITE_URL=...`（可选）
- `OPENROUTER_SITE_NAME=...`（可选）
- `OLLAMA_BASE_URL=...`
- `OLLAMA_MODEL=...`
- `PORT=3001`（可选）

## 10. 维护建议（给后续开发者/Agent）

- 修改论文主线相关能力时，优先关注：
  - `server/src/services/articleService.ts`
  - `server/src/services/difficultyAdjustService.ts`
  - `server/src/config/difficultyProfiles.ts`
  - `scripts/compute_article_stats.js`
  - `app/article-stats/page.tsx`
- 修改页面交互时，主要入口是 `app/page.tsx`
- 做第5章实验时，优先用 `experiments/ch5/configs/*.json` + 批量脚本，不要手工重复点击前端以免参数不可追踪
- 做实验统计时，优先使用归档中的 `experiment`、`request_meta`、`generation_meta`、`token_usage` 字段筛选样本与分组
- 若新增统计指标，需要同时更新：
  - `scripts/compute_article_stats.js` 输出
  - `app/article-stats/page.tsx` 读取与展示逻辑
- 题目生成模块虽然是扩展功能，但与首页和本地读取接口存在耦合，删除前需检查：
  - `app/page.tsx`
  - `app/api/local-articles/route.ts`
  - `server/src/routes/generateArticle.ts`

## 11. 第5章实验阶段性状态（便于接手）

- 生成基线（补偿前）已完成：`gen_b01`
  - 结果：结构成功率高，但长度命中率偏低；L1/L2 显著偏短（据此已加入长度补偿）
- 生成模型对比 pilot（补偿后）已完成：
  - `gen_grok_b02`
  - `gen_gpt5mini_b02`
  - `gen_gemini_b02`
- 真实语料难度调节模型对比 pilot 已部分完成：
  - `adj_q_grok_b01`
  - `adj_q_gpt5mini_b01`
  - 当前观察：真实语料上命中率为 0%，但保真度高、成本高，提示方法策略需要后续改进
- 继续工作前建议先检查：
  - `experiments/ch5/manifests/*.json`
  - `experiments/ch5/logs/*.jsonl`
  - `docs/Draft.md` 第5章“实验过程记录（暂存）”
