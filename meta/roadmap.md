# 学习路线图（roadmap）

> React 源码 + AI Agent 工程化 · 共 8 周 / 40 天
> 每天 2-4 小时

---

## 阶段总览

| 周 | 主题 | Day 范围 | 产出 |
|---|---|---|---|
| W1 | JSX → Element → Fiber → 调度 | D1-D5 | 心智模型 + DevTools 实操 |
| W2 | Hooks 实现原理 | D6-D10 | 手写 mini hooks |
| W3 | 并发渲染 Lane + Suspense + Transition | D11-D15 | 并发模型理解 |
| W4 | 状态库源码（Redux Toolkit / Zustand） | D16-D20 | 自研 mini-store |
| W5 | AI Agent 工程化（流式/Tool Calling/ReAct） | D21-D25 | Agent 核心闭环 |
| W6 | 自研 mini-react（500 行复刻） | D26-D30 | 一个能跑的 React |
| W7 | 自研 AI Agent SDK | D31-D35 | 基于 React 19 的 Agent SDK |
| W8 | 综合项目 + 面试包装 | D36-D40 | 上线 demo + 简历更新 |

---

## W1：从 JSX 到调度

| Day | 主题 | 关键产出 |
|---|---|---|
| D1 | JSX → React Element | createElement 心智模型 |
| D2 | Element → Fiber + 双缓存 | Fiber 字段 + alternate |
| D3 | Reconcile diff 算法 | 单/多节点 diff + key |
| D4 | beginWork / completeWork 工作循环 | workLoop 手写复刻 |
| D5 | commit 阶段三子阶段 | before mutation / mutation / layout |

---

## W2：Hooks 原理

| Day | 主题 |
|---|---|
| D6 | useState 实现：Hook 链表 + dispatch |
| D7 | useEffect / useLayoutEffect 实现 |
| D8 | useRef / useMemo / useCallback |
| D9 | useReducer / useContext 源码 |
| D10 | 自定义 Hook + 手写 mini-hooks |

---

## W3：并发渲染

| Day | 主题 |
|---|---|
| D11 | Lane 模型：优先级位掩码 |
| D12 | Scheduler：requestIdleCallback / MessageChannel |
| D13 | Suspense + use(promise) |
| D14 | useTransition / useDeferredValue |
| D15 | 高优先级打断低优先级实战 |

---

## W4：状态库

| Day | 主题 |
|---|---|
| D16 | Redux 核心 100 行 |
| D17 | Redux Toolkit / Immer / createSlice |
| D18 | Zustand 源码 |
| D19 | useSyncExternalStore + tearing |
| D20 | 自研 mini-store（订阅 + selector） |

---

## W5：AI Agent 工程化

| Day | 主题 |
|---|---|
| D21 | LLM 流式输出：SSE / fetch ReadableStream |
| D22 | Tool Calling：JSON Schema + 函数路由 |
| D23 | ReAct 模式：Thought → Action → Observation |
| D24 | Memory：短期上下文 + 长期向量库 |
| D25 | Agent UI：消息流 + 工具调用可视化 |

---

## W6-W8：综合项目（待规划）

后续每周开始前细化。
