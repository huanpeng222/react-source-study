# Day 23 — 源码模块模拟面试

> **主线位置**：`meta/job-sprint-plan.md` 阶段 A 第三天，衔接原 roadmap（无对应编号，是新增的自检环节）。今天**不学新知识**，做一次纯输出型自检——复用 `leetcode-algorithm` skill 的模拟面试节奏（先思路后代码、限时、不查资料）。

---

## 规则说明（模拟面试的真实场景）

- **不查任何资料**——不看 `dayN.md`、不看 `dayN-quiz.md` 的答案、不查源码。直接对着空气/录音讲清楚，就像真的坐在面试官对面。
- **限时**：每题 3-5 分钟口述（简单概念题3分钟，涉及源码链路/多步骤机制的给5分钟）。
- **讲不清楚就如实说"这块我讲不清楚"**，不要蒙混过关——诚实暴露薄弱点才是这次自检的价值所在。
- 讲完 15 题后，对照 `notes/dayN-quiz.md` 里的原答案自己评分，标记每题是 ✅全对 / 🟡部分对 / ❌讲不出来。
- 当天晚上把 ❌ 和 🟡 的点，一条条整理进 `notes/day23-gap-list.md`，**不过夜**。

---

## 15 题抽取名单（覆盖 Day1-22 的核心模块，按主题分布，不局限具体题号）

| # | 来源 | 主题模块 | 题目 |
|---|---|---|---|
| 1 | Day3 | Diff算法 | React 把通用树 diff 从 O(n³) 砍到 O(n)，用了哪 3 个假设？每个假设牺牲了什么？ |
| 2 | Day4 | beginWork/completeWork | bailout 只跳过当前 Fiber 自身的渲染，那子 Fiber 是否跳过看什么字段？为什么"父 memo 了，子还能渲染"？ |
| 3 | Day5 | commit阶段 | commit 分哪三个子阶段？`root.current` 的切换发生在哪个时间点，为什么不能放第一步？ |
| 4 | Day6 | useState源码 | `setN(x)` 被调用时，state 是立即改变的吗？如果不是，中间发生了什么？ |
| 5 | Day7 | useEffect源码 | Mutation阶段跑的cleanup和flushPassiveEffects跑的effect，是不是同一个useEffect在两个阶段各触发一次？ |
| 6 | Day8 | useMemo/useCallback | `useCallback(fn, deps)` 和 `useMemo(() => fn, deps)` 是什么关系？useCallback单独使用有意义吗？ |
| 7 | Day9 | useContext | Context value 变化时，React 是怎么找到消费者组件的？propagateContextChanges 具体做了什么？ |
| 8 | Day10 | Lane模型 | `isSubsetOfLanes(a, b)` 判断的是什么？两个参数分别代表什么？ |
| 9 | Day11 | Suspense原理 | throwException 内部怎么区分捕获到的是 promise 还是 Error？判断条件是什么？ |
| 10 | Day13 | React19 Actions | `useActionState` 和 `useReducer` 有什么本质区别？（至少说出3个维度） |
| 11 | Day14 | Compiler/性能优化 | React.memo 的自定义比较函数返回 true 表示什么？和 Array.filter 的语义有什么反直觉的地方？ |
| 12 | Day15 | 状态管理对比 | 为什么 Zustand 不需要 Provider？它的store存在哪里？ |
| 13 | Day19 | Scheduler | Scheduler 内部有两套独立机制，分别回答什么问题？`shouldYieldToHost` 属于哪一套？ |
| 14 | Day21 | 高优先级打断 | "打断"的真正含义是什么？为什么说它不是CPU层面的抢占？ |
| 15 | Day22 | mini-store | `useSyncExternalStore` 是怎么解决"渲染撕裂"问题的？说出具体的源码机制。 |

---

## 口述记录区（跟练时逐题填写：讲了什么 + 自评）

### Q1（Day3 · Diff算法）限时3分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q2（Day4 · beginWork/completeWork）限时3分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q3（Day5 · commit阶段）限时3分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q4（Day6 · useState源码）限时3分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q5（Day7 · useEffect源码）限时3分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q6（Day8 · useMemo/useCallback）限时3分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q7（Day9 · useContext）限时5分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q8（Day10 · Lane模型）限时3分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q9（Day11 · Suspense原理）限时5分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q10（Day13 · React19 Actions）限时5分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q11（Day14 · Compiler/性能优化）限时3分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q12（Day15 · 状态管理对比）限时3分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q13（Day19 · Scheduler）限时5分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q14（Day21 · 高优先级打断）限时5分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

### Q15（Day22 · mini-store）限时5分钟

**我讲的**：（待填）

**自评**：⬜✅ ⬜🟡 ⬜❌

---

## 最终统计（15题跑完后填写）

| 结果 | 数量 | 题号 |
|---|---|---|
| ✅ 全对 | | |
| 🟡 部分对 | | |
| ❌ 讲不出来 | | |

---

## 收尾：把薄弱点写进 gap-list（当天必做，不过夜）

跑完 15 题后，把所有 🟡 和 ❌ 的题目，逐条整理进 `notes/day23-gap-list.md`：
- 具体讲不清楚的是哪个环节（源码函数名/机制名）
- 回去翻的是哪个 DayN 笔记的哪一节
- 用自己的话重新讲一遍，直到能流畅说出来

这份 gap-list 是明天（Day24）面试话术卡的核心输入。

---

## Day24 预告

**主题**：源码知识体系图 + 面试话术卡，衔接 `meta/job-sprint-plan.md` 阶段A第四天（收尾整个"并发渲染+状态管理"模块）。产出两份材料：①一张从 JSX→Element→Fiber→Diff→beginWork/completeWork→Commit→Hooks→Lane→Scheduler→并发特性的知识体系图，标清楚每个节点对应哪天笔记；②`meta/interview-cheatsheet.md`——把今天 gap-list 暴露的薄弱点 + 常见追问整理成"我会怎么讲"的口语化脚本。做完 D21-D24，整个 W1-W4 的 React 源码学习就有了一份可以直接拿去面试的完整交付物。
