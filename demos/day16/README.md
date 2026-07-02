# Day16 实验说明

## 实验环境

RSC（React Server Components）需要 Next.js App Router 或类似框架才能完整运行。本实验用 **纯 JS 模拟** 来演示核心原理，不需要 Next.js 环境。

## 运行方式

```bash
cd react-source-study
node demos/day16/r1-server-client-boundary.mjs   # 实验1：Server/Client 边界
node demos/day16/r2-serialization.mjs            # 实验2：序列化边界 + Payload 格式
node demos/day16/r3-rsc-vs-ssr.mjs               # 实验3：RSC vs SSR 对比
```

## 实验清单

| 文件 | 主题 | 验证目标 |
|------|------|---------|
| r1-server-client-boundary.mjs | Server/Client 边界规则 | Server→Client合法，Client→Server非法，隐式client boundary |
| r2-serialization.mjs | 序列化 + RSC Payload | 可序列化类型、函数丢失、$/@ payload结构 |
| r3-rsc-vs-ssr.mjs | RSC vs SSR 流程对比 | SSR出HTML+hydrate，RSC出Payload+直接渲染 |
