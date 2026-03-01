# Agent Quickstart（无上下文快速接手指南）

本文件用于让新的 Agent 在没有历史对话上下文时，快速理解项目目标、当前重点和代码入口。

## 1. 这是什么项目

一个 LLM 驱动的“动态阅读材料生成系统”：

- 生成英文阅读文章（按主题/字数/等级）
- 基础改写（简化/变难/缩句）
- 指定难度调节（1-5 级，基于多项阅读指标区间的闭环调节）
- 本地语料浏览与统计分析
- 题目生成与校验（扩展模块，代码已实现，但论文主线可不强调）

技术栈：

- 前端：Next.js（`app/`）
- 后端：Express + TypeScript（`server/`）
- LLM：OpenRouter / Ollama（统一适配）

## 2. 当前论文主线（重要）

当前毕业论文草稿主线聚焦：

- 动态阅读材料生成
- 指定难度（1-5）调节
- 难度可计算化（多指标）
- 统计分析与可视化

不作为主线（但代码存在）：

- 阅读理解题目生成与校验修复

论文草稿位置：

- `docs/Draft.md`

## 3. 最关键代码入口（先看这些）

### 前端

- `app/page.tsx`
  - 首页主交互：生成、改写、难度调节、本地语料浏览、题目生成（扩展）
- `app/article-stats/page.tsx`
  - 统计页面：读取 `article_stats.json` 做汇总/分布展示
- `app/api/local-articles/route.ts`
  - 本地 JSON 文件读取接口

### 后端

- `server/src/routes/generateArticle.ts`
  - 所有主要 API 路由入口（生成/改写/难度调节/出题/模型列表）
- `server/src/services/articleService.ts`
  - 文章生成核心逻辑（prompt、重试、候选选择、归档）
  - 已加入按等级长度补偿（length compensation）以校准 L1/L2 偏短问题，并记录 token 消耗/尝试信息
- `server/src/services/difficultyAdjustService.ts`
  - 指定难度调节核心（闭环迭代 + 保真约束）
- `server/src/config/difficultyProfiles.ts`
  - 难度等级 1-5 对应指标区间（论文主线关键）
- `server/src/utils/metrics.ts`
  - 在线文本指标计算

### 统计脚本（论文常用）

- `scripts/compute_article_stats.js`
  - 离线语料指标统计（可读性 + 信息密度 + 关键词密度 + 抽象度）
- `scripts/run_ch5_generation_batch.js`
  - 第5章生成实验批量脚本（逐条日志输出，记录 token/耗时/失败）
- `scripts/run_ch5_adjust_batch.js`
  - 第5章难度调节实验批量脚本（逐条日志输出，记录命中/保真度/token/耗时）

## 4. 典型数据目录（先看数据再动代码）

- `out_generated/`
  - 系统生成文章归档（含指标）
- `out_simplified/`
  - 改写/难度调节结果归档
- `out_questions/`
  - 本地参考语料（常作为“真实阅读材料”对比）
- `out_questions_generated/`
  - 系统生成题目归档（扩展）

统计结果文件（常见）：

- `out_generated/article_stats.json`
- `out_simplified/article_stats.json`
- `out_questions/article_stats.json`

实验批次日志与清单（第5章）：

- `experiments/ch5/logs/*.jsonl`
- `experiments/ch5/manifests/*.json`
- `experiments/ch5/configs/*.json`
  - 批量实验配置（按模型拆分的 generation/adjust 批次）

## 4.1 第5章实验进展（截至当前，便于新上下文接手）

- 已完成生成批次基线（补偿前）：`gen_b01`
  - 结论：长度命中率偏低（57.5%），L1/L2 系统性偏短，已据此加入长度补偿
- 已完成生成模型对比 pilot（补偿后）：
  - `gen_grok_b02`
  - `gen_gpt5mini_b02`
  - `gen_gemini_b02`
  - 当前观察：`grok`/`gpt-5-mini` 长度命中率较高，`gemini` 成本低但命中率偏低；`gpt-5-mini` 成本与耗时最高
- 已完成真实语料难度调节 pilot（部分模型）：
  - `adj_q_grok_b01`
  - `adj_q_gpt5mini_b01`
  - 当前观察：两者在真实语料上命中率均为 0%，但保真度高、轮次跑满，提示难度调节方法本身可能存在策略问题（不仅是模型问题）
- `Draft.md` 已记录：
  - 长度补偿策略（方法章节）
  - `gen_b01` 的过程性实验记录（第5章暂存小节）
- 下一步优先事项：
  1. 跑完 `adj_q_gemini_b01`
  2. 汇总三模型难度调节对比
  3. 分析并改进 `difficultyAdjustService.ts` 的方向选择/接受策略

## 5. 本项目里“难度”的定义（非常重要）

不是单纯的“简化/变难”描述性指令。

难度调节模块使用 `difficultyProfiles.ts` 中的等级（1-5）目标区间，至少包括：

- Flesch-Kincaid Grade
- Flesch Reading Ease
- 平均句长
- 复杂词比例

调节流程是闭环的：

- 计算当前指标
- 与目标区间比较
- 迭代改写
- 用保真度（实体/数字/关键词召回）过滤候选
- 输出命中目标或 best effort

## 6. 常见工作任务与最短路径

### 任务A：改论文相关逻辑（难度调节/指标）

先看：

1. `server/src/config/difficultyProfiles.ts`
2. `server/src/services/difficultyAdjustService.ts`
3. `server/src/utils/metrics.ts`
4. `scripts/compute_article_stats.js`
5. `app/article-stats/page.tsx`

### 任务B：改首页交互/展示

先看：

1. `app/page.tsx`
2. `server/src/routes/generateArticle.ts`

### 任务C：加新统计指标

需要同时改：

1. `scripts/compute_article_stats.js`（计算并输出）
2. `app/article-stats/page.tsx`（读取并展示）
3. 如在线显示也要改：`server/src/utils/metrics.ts` 和 `app/page.tsx`

## 7. 运行与环境（快速）

根目录：

- `npm run dev`：同时启动前端 + 后端

端口默认：

- 前端：`3000`
- 后端：`3001`

后端需至少一种 LLM 配置：

- OpenRouter（`OPENROUTER_API_KEY`）
- 或 Ollama（`OLLAMA_BASE_URL` / `OLLAMA_MODEL`）

## 8. 常见坑（新 Agent 容易踩）

- 首页功能很多，论文主线不是全部功能；不要默认“题目生成”是当前优先级
- 论文大纲与代码能力不完全等价：代码保留了扩展模块，但论文可选择不写主实验
- 修改统计字段后，前端统计页若不更新会出现空值或不显示
- 本地语料接口 `app/api/local-articles/route.ts` 对不同数据源做了结构适配，改 JSON 结构要同步这里
- 第5章生成实验中，L1/L2 容易系统性偏短；`articleService.ts` 已加入长度补偿。写实验结论时要区分“用户目标字数”和“提示词内部补偿目标字数”
- 生成/调节归档现在含 `experiment`、`request_meta`、`token_usage` 等字段；写统计脚本时应优先利用这些字段，不要只看旧字段

## 9. 建议的工作顺序（无上下文时）

1. 先读 `docs/Draft.md`（当前论文方向）
2. 再读 `docs/PROJECT_OVERVIEW.md`（代码全貌）
3. 快速扫一遍关键文件：
   - `server/src/routes/generateArticle.ts`
   - `server/src/services/articleService.ts`
   - `server/src/services/difficultyAdjustService.ts`
   - `scripts/compute_article_stats.js`
   - `app/page.tsx`
   - `app/article-stats/page.tsx`
4. 看 `out_*` 目录现有数据，再决定是写代码、跑统计还是改论文文档
5. 如果在做第5章实验，先读最新 `experiments/ch5/manifests/*.json`，确认哪些批次已完成（避免重复跑）

## 10. 如果任务是“继续写论文”

优先方向（通常比改功能更有价值）：

- 完善 `docs/Draft.md` 的相关工作对比（尤其三篇重点文献）
- 写“方法章节”正式版（指定难度 1-5 + 指标区间 + 闭环调节）
- 设计/补充实验方案与图表清单
- 用 `out_*` + `article_stats.json` 写“真实语料 vs 生成语料”统计对比
- 若在做第5章实验：优先查看 `experiments/ch5/manifests/*.json`（成功/失败、耗时、token），再结合 `out_generated/`、`out_simplified/` 归档做深入分析
