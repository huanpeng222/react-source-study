# Day 15 实验指南

> 主题：状态管理深挖
> 环境：react@19 + react-dom@19 + jsdom@22 + zustand（需安装）
> 跑法：`node s1-context-trap.mjs` 等

## 安装依赖（仅需一次）
```bash
cd react-source-study
npm install zustand
```

## 实验 S1：Context 性能陷阱 + 三种修复对比

**验证什么：**
- 单一 Context 管多状态 → 无关消费者被拖累 re-render
- 方案 A（拆分 Context）效果
- 方案 B（selector 模式）效果
- 方案 C（Zustand 替代）效果 — 最佳

**运行：** `node s1-context-trap.mjs`

---

## 实验 S2：Zustand vs Redux 同功能对比

**验证什么：**
- 同一个计数器+用户功能，两种方案代码量差异
- Zustand 无 Provider、无 dispatch、无 action type
- 订阅精度对比

**运行：** `node s2-zustand-vs-redux.mjs`

---

## 实验 S3：Jotai 原子派生 + 粒度验证

**验证什么：**
- 基础 atom 和派生 atom (derived atom)
- atom A 变化不影响只订阅了 atom B 的组件
- 派生 atom 只在依赖变化时重新计算

**运行：** `node s3-jotai-atoms.mjs`
