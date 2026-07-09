# agent-workbench（阶段 B · AI Agent 工作台）

> 求职冲刺阶段 B（D25-D34）的项目实战目录。与源码学习（`../notes/`、`../demos/`）完全隔离。

## 目录约定
- `tutorials/` — 每日跟练教程（`day25.md` 起），相当于源码学习的 `notes/`。
- 其余目录 — 你亲手初始化的 Next.js 项目代码（D25 起）。

## 项目定位
一个通用 AI Agent 工作台：给一个目标 → Agent 自主拆解 → 调用工具（联网搜索 / 代码执行 / 文档检索）→ 实时展示 Thought→Action→Observation 执行轨迹。

完整立项/架构/排期见 `../meta/ai-project-design.md`。

## 跟练方式
教程给"做什么/为什么/命令/验收/踩坑"，代码由学习者亲手写（面试要讲得出）。每天 commit + push。

## 技术栈
Next.js 15 App Router + Vercel AI SDK v6+ + 真实 LLM API + Zustand + Tailwind，部署 Vercel。
