# Day17 实验说明 — Next.js App Router 架构

## 实验环境

由于 Next.js 需要完整的构建工具链（webpack/turbopack），本实验用**纯 Node.js + React 模拟** App Router 的核心机制。

所有实验均使用：
- react@19 + react-dom@19 + jsdom@22
- JSDOM 虚拟 DOM + createRoot 渲染

---

## 实验列表

### N1：文件系统路由模拟 (`n1-file-routing.mjs`)
- 模拟目录结构 → URL 路由映射算法
- 动态路由 `[param]` 和 Catch-all `[...slug]` 匹配
- params 对象提取

### N2：Layout 嵌套系统 (`n2-layout-nesting.mjs`)
- Layout 不随子路由切换而重挂载（状态保持）
- Template 每次导航都销毁重建
- 嵌套 Layout 的 children 传递机制

### N3：Streaming + Suspense 边界 (`n3-streaming-suspense.mjs`)
- loading.tsx = Suspense fallback 自动包裹
- error.tsx = ErrorBoundary 包裹
- 流式替换：骨架屏 → 真实内容

## 运行方式

```bash
cd demos/day17
node n1-file-routing.mjs
node n2-layout-nesting.mjs
node n3-streaming-suspense.mjs
```

## 预期输出

每个实验通过后会输出 `✅ N1/N2/N3 通过`。
