# React Source Study

> React 源码 + AI Agent 工程化学习笔记。8 周 / 40 天 · 每日实操跟练。

---

## 📋 进度看板

| 周 | Day | 主题 | 状态 |
|---|---|---|---|
| W1 | D1 | JSX → React Element | ✅ |
| W1 | D2 | Element → Fiber + 双缓存 | ✅ |
| W1 | D3 | Reconcile diff 算法 | ✅ |
| W1 | D4 | beginWork / completeWork | ✅ |
| W1 | D5 | commit 阶段 | ✅ |
| W2 | D6 | Hooks 实现原理：useState | ✅ |
| W2 | D7 | useEffect / useLayoutEffect + effect 链表 | ✅ |
| W2 | D8 | useRef / useMemo / useCallback | ✅ |
| W2 | D9 | useContext 源码 + Context 穿透 memo | ✅ |
| W3 | D10 | Lane 优先级模型 + 并发渲染 | ✅ |
| W3 | D11 | Suspense 原理（throw promise + use + fallback） | ✅ |
| W3 | D12 | SuspenseList + 自定义 Suspense 实战 | ✅ |
| W3 | D13 | React 19 Actions 体系（useActionState/useFormStatus/useOptimistic） | ✅ |
| W3 | D14 | React Compiler + 性能优化深度（bailout/memo 体系） | ✅ |
| W4 | D15 | 状态管理库源码对比（Context 陷阱/Zustand/Jotai） | ✅ |
| W4 | D16 | React Server Components 原理 | ✅ |
| ~~支线~~ | ~~D17~~ | ~~Next.js App Router 架构深度解析~~ | 🔀 支线（非主线，见下方说明） |
| ~~支线~~ | ~~D18~~ | ~~Next.js 进阶（Parallel/Intercepting Routes/Middleware）~~ | 🔀 支线（非主线，见下方说明） |
| W3 | D19 | Scheduler：最小堆任务队列 + MessageChannel 时间片（补主线 D12 缺口） | ✅ |
| W3 | D20 | useTransition / useDeferredValue 源码级实现（补主线 D14 缺口） | ✅ |
| 阶段A | D21 | 高优先级打断低优先级实战（getNextLanes决策/prepareFreshStack丢弃重做/entangleTransitionUpdate） | ✅ |
| 阶段A | D22 | 自研 mini-store（useSyncExternalStore/selector细粒度/批量更新去重） | ✅ |
| 阶段A | D23 | 源码模块模拟面试（15题限时口述自检，Day1-22覆盖） | ✅ 完成（3对8偏4错，gap-list已归档） |
| 阶段A | D24 | 源码知识体系图 + 面试话术卡（收尾并发渲染+状态管理模块） | ✅ |

> ⚠️ **2026-07-03 核对发现**：D17、D18 是跨电脑接力时带偏的 **Next.js 框架专题**，不在 `meta/roadmap.md` 的原 8 周主线内。内容保留在仓库供参考，后续会单独开一轮 Next.js 学习，不再占用主线 DayN 编号。**主线已从 D19 起拉回 roadmap 缺口**：Scheduler（原 D12，已完成）→ useTransition/useDeferredValue（原 D14，已完成）→ 高优先级打断实战（原 D15）→ 自研 mini-store（原 D20）。

> 🎯 **2026-07-07 计划重排**：学习者当前处于求职状态（缓冲期>6个月，目标一线城市前端全栈/AI复合型岗位），每天可投入8小时全职冲刺。**Day21 及以后的执行依据改为 [`meta/job-sprint-plan.md`](./meta/job-sprint-plan.md)**，不再是 `meta/roadmap.md` 原表格。核心变化：D21-D24 收尾并发渲染+mini-store+模拟面试；D25-D34 用一个真实可部署的 AI 全栈项目替代"自研mini-react+自研Agent SDK"两个纯理论深度项目；D35-D37 简历与面试材料就位；D38起边投递边补短板。原 roadmap 保留存档参考。

完整路线见 [`meta/roadmap.md`](./meta/roadmap.md)（Day1-20 历史依据）+ [`meta/job-sprint-plan.md`](./meta/job-sprint-plan.md)（Day21+ 现行依据）。

---

## 📂 每日 4 件套（强制）

```
notes/dayN.md              完整教程（长，跟练前/中输出）
demos/dayN/                可跑代码 + observations.md + 截图
notes/dayN-summary.md      精简笔记（含跟练疑问 + 踩坑，学完后输出）
notes/dayN-quiz.md         自测题（答案折叠，学完后输出）
```

> ⭐ `dayN.md` 是教程，`dayN-summary.md` 是速查卡。详见 STUDY_PROTOCOL §2。

---

## 🚀 跨电脑接力

```bash
git pull
# 跟 AI 说 "开始第 N 天的学习"
# AI 自动读 STUDY_PROTOCOL.md + notes/day{N-1}.md 续接
```

---

## 📜 协作规范

详见 [`STUDY_PROTOCOL.md`](./STUDY_PROTOCOL.md)：
- 学习风格（教练式引导、先思路后代码）
- 仓库结构约定
- 每日 Day 6 步流程
- AI 必做 / 禁止做硬规则
- Commit message 规范
