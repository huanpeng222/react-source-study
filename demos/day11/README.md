# Day 11 Demos: Suspense 原理实验

## 实验列表

| 实验 | 脚本 | 验证目标 |
|---|---|---|
| K1 | `k1.mjs` | Suspense 边界兜底：throw promise 不崩溃 |
| K2 | `k1.mjs` (同文件) | React.use(promise) API 可用性 + 三态逻辑 |
| K3 | `k1.mjs` (同文件) | throwException 路由分流条件（Promise→Suspense, Error→ErrorBoundary）|

## 运行方式

```bash
cd /path/to/react-source-study/demos/day11
NODE_PATH=/Users/guest_1/.workbuddy/binaries/node/workspace/node_modules \
node k1.mjs
```

环境：jsdom + react@19.2.7 + react-dom@19.2.7

## ⚠️ 实测边界声明

以下行为**在 jsdom 中无法观察**，因为 jsdom 无 Scheduler / 无浏览器事件循环：

- **promise resolve → attachPingListener → 自动重试渲染 → 切回 primary**（异步链路断裂）
- **Concurrent 模式延迟 fallback**（拥塞节流 ~500ms）
- **OffscreenComponent 切换前后状态保留**（需要完整 render→commit 周期）
- **workLoopConcurrent 的 shouldYield 中断**

本实验只验证可在 jsdom 同步执行中确定观察到的行为。
