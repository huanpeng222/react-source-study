# Day 24 — 源码知识体系图 + 面试话术卡

> **主线位置**：`meta/job-sprint-plan.md` 阶段 A 第四天，收尾整个"并发渲染 + 状态管理"模块。今天**不学新知识**，做两份可以直接拿去面试的交付物。
> 衔接 Day23（模拟面试暴露 12 条薄弱点 → `notes/day23-gap-list.md`）。

---

## 今天产出两份材料

| 产物 | 文件 | 用途 |
|---|---|---|
| ① 源码知识体系图 | 本文件 §一（+ 对话里的可视化图） | 面试前 5 分钟扫一遍全局，建立"从 JSX 到并发特性"的整条链路地图 |
| ② 面试话术卡 | `meta/interview-cheatsheet.md` | 把源码讲成"逻辑链"的口语化脚本，整合 D23 薄弱点 + 高频追问 |

---

## 一、源码知识体系图（文字版，配合对话里的可视化图看）

整条主链路 + 每个节点对应的 DayN：

```
JSX (D1)
  │ createElement 语法糖
  ▼
React Element (D1)  —— 不可变的 UI 描述（type/props/key）
  │ 首次创建 / 更新时 diff
  ▼
Fiber 节点 + 双缓存 (D2)  —— 可变的工作单元，current ↔ workInProgress（alternate 互指）
  │
  ▼
Reconcile / Diff (D3)  —— 三个假设把 O(n³) 砍到 O(n)
  │
  ▼
render 阶段：可中断 DFS (D4, D24追问A)
  ├── beginWork（前序下钻，构建/diff/打 flags）
  └── completeWork（后序回溯，建 DOM / bubbleProperties 冒泡 subtreeFlags）
  │  整棵树 complete 完 → RootCompleted
  ▼
commit 阶段：同步不可打断 (D5)
  ├── Before Mutation（getSnapshotBeforeUpdate + 异步调度 useEffect）
  ├── Mutation（改 DOM + 卸载旧 ref + 上次 layout cleanup + 末尾切 current）
  └── Layout（useLayoutEffect + cDM/cDU + 绑新 ref）
  │  paint 后 → 异步 flushPassiveEffects（useEffect）
  ▼
─────────── 横向能力层（挂在上面主流程上）───────────

Hooks 体系 (D6-D9)
  ├── useState/useReducer（update 入队环形链表 + updateReducer reduce）(D6)
  ├── useEffect/useLayoutEffect（effect 链表 + flag 分阶段）(D7)
  ├── useRef/useMemo/useCallback（memoizedState 存值/引用）(D8)
  └── useContext（dependencies 记录 + propagateContextChanges 改 lanes 穿透 memo）(D9)

并发调度层 (D10, D19-D21)
  ├── Lane 位掩码优先级模型（isSubsetOfLanes 决定 update 跑不跑）(D10)
  ├── Scheduler（最小堆排序【谁先跑】+ 时间片 shouldYieldToHost【跑多久】两套独立机制）(D19)
  ├── useTransition/useDeferredValue（降级 TransitionLane）(D20)
  └── 高优先级打断（协作式 + prepareFreshStack 丢弃重做 + 过期防饿死）(D21)

并发特性层 (D11-D13)
  ├── Suspense（throw promise + typeof .then 分流 + ping 重试）(D11-D12)
  └── React 19 Actions（useActionState 异步超集 + action 队列串行）(D13)

性能优化 (D14)
  └── React.memo / bailout / Compiler（childLanes 剪枝 + Object.is 浅比较）

状态管理 (D15, D22)
  ├── Context 陷阱 / Zustand（模块级闭包 + useSyncExternalStore）/ Jotai（原子粒度）(D15)
  └── 自研 mini-store（useSyncExternalStore 防撕裂 + selector + queueMicrotask 批量去重）(D22)
```

**面试用法**：被问到任何一个点，都能往上/往下延伸——比如问 useContext，能顺着讲到"它靠改 lanes 破坏 bailout（并发调度层）"，体现你有全局视野而不是孤立记忆。

---

## 二、面试话术卡（详见 `meta/interview-cheatsheet.md`）

话术卡结构：每条 = **面试官问 → 30秒电梯版（先结论）→ 展开版（逻辑链）→ 如果追问怎么接**。

覆盖 5 大板块：
1. 渲染主流程（JSX链路 / 双缓存 / Diff三假设 / 可中断DFS / commit三阶段）
2. Hooks（setState内部 / effect时机 / useMemo / Context穿透memo）
3. 并发渲染（Lane / childLanes+bailout / 打断本质 / Scheduler两套机制 / Transition）
4. Suspense / Actions / 状态管理
5. 临场提醒（D23 栽过的 4 个边界混淆点 + 次数vs耗时正交）

带 ⚠️ 标记的都是 Day23 模拟面试栽过的点，讲的时候主动点破边界反而加分。

---

## 三、验收清单

- [x] 知识体系图覆盖 D1-D22 主链路，每节点标了对应 DayN
- [x] 面试话术卡整合 D23 的 12 条薄弱点（gap-list）
- [x] 每条话术是"逻辑链"不是"背书"，且标注了高频追问怎么接
- [x] 4 个边界混淆点（render↔commit / fiber.lanes↔renderLanes / 排序↔时间片 / 丢弃↔重新读）单独提醒
- [x] 产出 `meta/interview-cheatsheet.md`

---

## 四、阶段 A 收尾小结（D21-D24）

到今天，整个"并发渲染 + 状态管理"模块（阶段A）完成：
- **D21** 高优先级打断实战（Lane决策/丢弃重做/过期防饿死/entangle）
- **D22** 自研 mini-store（useSyncExternalStore/批量去重）
- **D23** 15题模拟面试（3对8偏4错，暴露薄弱点）
- **D24** 知识体系图 + 面试话术卡（把前面所有 Day 串成可面试的交付物）

W1-W4 的 React 源码学习至此有了一份完整的、可直接拿去面试的产物。

---

## 五、Day25 预告（阶段 B 启动 —— 最重要的差异化筹码）

**主题**：AI 全栈项目实战启动。按 `meta/job-sprint-plan.md` 阶段B，D25 当天要**敲定项目定位**（不能拖）：
- 技术栈：Next.js（App Router）+ Vercel AI SDK + 真实 LLM API（调 API，不训模型）
- 二选一：① AI 代码/文档助手（上传→多轮问答+工具调用）；② AI Agent 任务助手（目标→自主拆解+调工具+展示执行轨迹）
- 判断标准：能不能 3 分钟讲清"解决什么问题 / 做了什么架构决策 / 踩了什么坑"

这是简历上"前端全栈/AI 复合型"定位能不能立住的关键模块，D25-D34 十天做一个真实可部署的项目。
