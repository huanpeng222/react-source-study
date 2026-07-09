# Day 25 — 阶段 B 启动：立项 + 脚手架 + 首次部署跑通

> **主线位置**：`meta/job-sprint-plan.md` 阶段 B（D25-D34）第一天。项目已定向为 **AI Agent 工作台**（决策依据见 `meta/ai-project-design.md`）。
> **今天不写业务逻辑**，目标是把"空项目→能在 Vercel 上访问"这条最短闭环打通，确认工具链没问题。

---

## 0. 先说清楚：这个阶段的目录约定和跟练方式（重要，先读）

### 目录彻底分开
源码学习（D1-D24：读代码 + 做实验）和项目实战（D25+：从零搭真实项目）是两种完全不同的活动，目录隔离：

```
react-source-study/                 ← 仓库根（不变）
├── notes/  demos/                  ← 源码学习（D1-D24，保持不动，别混进来）
├── meta/                           ← 计划 / 话术卡 / 立项文档
│   ├── job-sprint-plan.md
│   ├── interview-cheatsheet.md
│   └── ai-project-design.md        ← 阶段B 立项文档
└── agent-workbench/                ← ⭐ 阶段B 全部内容都在这里
    ├── tutorials/                  ← 教程（相当于源码学习的 notes/）
    │   ├── day25.md  ← 本文件
    │   ├── day25-summary.md
    │   └── ...
    └── (你从今天起 init 的 Next.js 项目代码，就落在 agent-workbench/ 下)
```

> 也就是说：`agent-workbench/` 既是教程目录，也是你真实项目代码的根。tutorials/ 放教程，其余放代码。

### 跟练方式（和源码学习不一样，先对齐预期）
- **源码学习**是"我讲机制 → 你验证"。
- **项目实战**是"我出跟练手册（今天做什么/为什么这么做/每步跑什么命令/会踩什么坑）→ 你亲手敲代码 → 报错我们一起调"。
- **代码由你亲手写，我不替你 init、不替你贴大段可直接粘的完整文件**——因为面试要讲的是"你怎么做的"，手过一遍才讲得出。我会给：命令、关键代码片段、决策解释、验收标准、踩坑预警。
- 每个 DayN 教程结构固定：**当天目标 → 前置知识铺垫 → 分步操作 → 验收清单 → 踩坑预警 → 次日预告**。
- 每天结束照旧：commit + push（保持跨电脑接力），需要时写 `observations.md` 记录当天真实决策/踩坑。

---

## 一、今天的目标（MVP 的第 0 步）

一句话：**跑通"空 Next.js 项目 → 本地能起 → 部署到 Vercel 拿到公网 URL"这条闭环。**

为什么第一天就部署？因为"最后再部署"是新手最大的坑——攒到 D32 才第一次部署，往往会遇到环境变量、构建配置、Node 版本一堆问题，手忙脚乱。**先把部署管道打通，之后每天的功能都能持续集成上去**，这也是真实工程里 CI/CD 的思路（面试可以讲这个决策）。

今天结束时你应该有：
1. 一个本地能 `dev` 起来的 Next.js 15 项目
2. 一个能 push 的 git 仓库（可以就用现在这个 monorepo，也可以单独开）
3. 一个 Vercel 上可访问的 URL（哪怕页面还是默认脚手架）

---

## 二、前置知识铺垫（动手前先理解，不然只是抄命令）

### 2.1 为什么是 Next.js App Router 而不是纯 React + Express
- **API Key 安全**：LLM 的 API Key 绝对不能出现在浏览器端。Next.js 的 API 路由（`app/api/xxx/route.ts`）跑在服务端，Key 放服务端环境变量，前端只调自己的 `/api/agent`，Key 永不下发。纯 React 得单独搭一个 Express 后端才能做到，多一套部署。
- **流式天然支持**：App Router 的 Route Handler 可以直接返回 `ReadableStream`，配合 AI SDK 的流式输出零成本。
- **一体化部署**：前后端一个项目、一次部署（Vercel 对 Next.js 零配置），省掉跨域和两套运维。

面试话术骨架：*"我选 Next.js 是因为 LLM Key 必须在服务端持有，App Router 的 Route Handler 让我不用额外搭后端就能安全代理 LLM 调用，还天然支持流式响应。"*

### 2.2 Vercel AI SDK 的版本坑（一定要知道，否则会照着过时教程写错）
AI SDK 迭代很快，网上大量教程是 v4/v5 的，**API 已经变了**。今天不用写到这些，但立项前你要心里有数（D27-D29 会用到）：

| 老写法（v4/v5，别用） | 新写法（v6+，用这个） |
|---|---|
| `maxSteps: 5` | `stopWhen: stepCountIs(5)` |
| `system: '...'` | `instructions: '...'` |
| `result.toDataStreamResponse()` | `result.toUIMessageStreamResponse()` |
| `Experimental_Agent` | `ToolLoopAgent` |

> ⚠️ v7 要求 Node 22+ 和 ESM。**建议我们锁 v6 稳定版**（生态文档最全、坑最少），Node 用 20 或 22 都行。D27 装依赖时会明确锁版本。

### 2.3 你需要准备的一个东西：LLM API Key
今天可以先不接，但要开始准备。选一个你能拿到 Key 的 provider：
- OpenAI 兼容接口 / 国内大模型（如通义、智谱、DeepSeek 等，很多有免费额度）
- 判断标准：**有稳定的 API、有免费额度够 demo、最好兼容 OpenAI 格式**（AI SDK 对 OpenAI 兼容接口支持最好，切换成本低）

---

## 三、分步操作（你来敲，我在每步说明"为什么"和"验收标准"）

> 环境提示：确认本机 Node 版本 `node -v`。建议 ≥ 20。项目建在 `agent-workbench/` 下。

### Step 1 · 确认方向、给项目定名
翻一遍 `meta/ai-project-design.md`（尤其"方向决策"和"MVP范围"两节），确认你认同这个方向。然后定一个项目名（英文，用于包名/仓库/域名），比如 `agent-workbench` / `trace-agent` / 你喜欢的名字。

**验收**：你能用一句话说出"这个项目是做什么的"（对照立项文档的一句话介绍）。

### Step 2 · 初始化 Next.js 15 项目
在 `agent-workbench/` 目录下初始化（脚手架会在这里生成项目文件）。核心选择项建议：
- TypeScript：**Yes**（面试必备，且 AI SDK 的类型体验很好）
- Tailwind CSS：**Yes**（D30-31 做 UI 要用）
- App Router：**Yes**（这是我们整个架构的前提）
- `src/` 目录、import alias：按个人习惯，建议用默认

> 具体用哪个脚手架命令、装到当前目录还是子目录，你先自己跑一次 `create-next-app` 的交互式流程，遇到选项拿不准就停下来问我。**我故意不把完整命令贴给你**——因为面试可能会问"你项目怎么初始化的、为什么选这些选项"，自己走一遍才有印象。

**验收**：`npm run dev` 能起来，浏览器打开 `localhost:3000` 看到 Next.js 默认页。

### Step 3 · 清理默认页 + 放一个自己的占位首页
把默认的 `page.tsx` 内容删掉，换成一个最简单的自己的首页（一个标题 + 一句项目介绍即可），确认你能改动并热更新生效。

**验收**：改完保存，浏览器自动刷新显示你写的内容。

### Step 4 · Git 纳管
决定：是把项目放进现在这个 `react-source-study` 仓库（monorepo，`agent-workbench/` 作为子目录一起 push），还是给项目单开一个仓库（更贴近真实、Vercel 部署更干净）。

> 我的建议：**单开一个新仓库**给这个项目。理由：① 部署到 Vercel 时一个仓库对应一个项目最干净；② 面试时给面试官的是这个项目的独立 GitHub 链接，不希望混着源码学习笔记；③ 学习记录（tutorials/）可以继续留在这个 monorepo 里,代码仓库单独放。
> 如果你想省事，也可以先都放 monorepo，D32 部署时再拆——但那样会多一步。今天先定下来。

**验收**：项目代码有一个能 push 的 git 远程。

### Step 5 · 部署到 Vercel（今天的重头戏）
- 用 GitHub 账号登录 Vercel，import 你的项目仓库
- Next.js 项目 Vercel 零配置，直接 deploy
- 拿到一个 `xxx.vercel.app` 的 URL

**验收**：手机/无痕窗口打开这个 URL，能看到你 Step 3 写的占位首页。**这一步通了，整个部署管道就通了。**

> 踩坑预警见下一节。

---

## 四、踩坑预警（新手在 Day25 最常卡的地方）

1. **Node 版本不匹配**：Next.js 15 要求 Node 18.18+，Vercel 默认 Node 版本可能和本地不一致。如果部署报构建错误，先看 Vercel 项目 Settings → Node.js Version 是否 ≥ 18.18（建议锁 20）。
2. **monorepo 部署找不到项目根**：如果你把项目放在 `agent-workbench/` 子目录里又用了 monorepo，Vercel 需要在 Settings → Root Directory 指定子目录，否则它在仓库根找 `package.json` 会失败。这就是我建议单开仓库的原因之一。
3. **create-next-app 装到了错误的目录层级**：注意是"在当前目录初始化"还是"新建一个子文件夹"，交互式流程里会问项目名，那个名字会变成文件夹名。想清楚你要的最终结构再敲。
4. **别急着装 AI SDK**：今天只跑通脚手架+部署，AI SDK D27 才装（且要锁 v6 版本）。今天装了也用不上，反而可能引入版本困惑。

---

## 五、今日验收清单

- [ ] 读完 `meta/ai-project-design.md`，认同项目方向，给项目定了名
- [ ] `agent-workbench/` 下初始化了 Next.js 15 + TS + Tailwind + App Router 项目
- [ ] `npm run dev` 本地能起，改动能热更新
- [ ] 项目已 git 纳管（确定了 monorepo 还是单独仓库）
- [ ] 部署到 Vercel，拿到可公网访问的 URL
- [ ] 准备好了一个 LLM provider 的 API Key（或至少确定了用哪个）

---

## 六、面试视角（今天做的事怎么变成面试素材）

- **"部署优先"的工程决策**：*"我第一天就把 CI/CD 管道打通，而不是最后才部署，避免临上线才发现环境问题。"*
- **技术选型能对比着讲**：Next.js vs React+Express（Key 安全/流式/一体化部署）。
- 这些都会在 D33 复盘文档里沉淀成简历项目描述。

---

## 七、Day26 预告

**主题**：架构设计定稿 + 数据流设计 + 工具接口约定。产出架构图（前端交互层 / API 路由层 / Agent 编排层 / 工具执行层）和 TypeScript 类型定义（Agent 步骤、工具接口的类型契约）。D26 结束后，D27 就可以正式接 LLM 流式输出了。

> 今天卡在任何一步（脚手架选项、git 仓库选择、Vercel 部署报错），直接把报错贴给我，我们一起调。
