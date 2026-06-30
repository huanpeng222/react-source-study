# Day 12 实验：SuspenseList + 自定义 Suspense 实战

> 跑法：`node k1.mjs` / `node k2.mjs` / `node k3.mjs`
> 前置：需要 React 18+ 和 react-dom（npm install react react-dom）

## 3 个实验

| 编号 | 内容 | 核心验证点 |
|------|------|-----------|
| **L1** | SuspenseList 三种模式对比 | together / forwards / backwards 的展示差异 |
| **L2** | use() + 缓存 Map 模板 | 防死循环、同 id 只请求一次 |
| **L3** | ErrorBoundary + Suspense 嵌套 | 错误走 ErrorBoundary、挂起走 Suspense |

## 观察记录

跑完每个实验后把控制台输出贴到 `observations.md`。

## 验收标准

- [ ] L1 能观察到 "together 模式下所有内容同时出现" vs "forwards 模式逐个出现"
- [ ] L2 控制台只打印一次 `fetching user:1`（证明缓存生效，没有重复请求）
- [ ] L3 模拟 reject 时显示错误 fallback，pending 时显示 loading fallback
