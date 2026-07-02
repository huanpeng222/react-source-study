# Day 14 实验指南

> 主题：React Compiler + 性能优化（bailout / memo / useMemo / useCallback）
> 环境：react@19 + react-dom@19 + jsdom@22
> 跑法：`node p1-bailout.mjs` 等

## 实验 P1：bailout 可视化

**验证什么：**
- `React.memo` 命中时子组件**不重新执行**函数体
- props 引用不稳定（新函数/新对象）→ memo 形同虚设
- 用 `useCallback` / `useMemo` 稳定引用后 → memo 生效

**运行：** `node p1-bailout.mjs`

---

## 实验 P2：useMemo 依赖陷阱

**验证什么：**
- 依赖数组里的对象每次都是新引用 → **"假缓存"**
- 外部提常量 / useState 缓存 → 真正命中
- useMemo 的依赖用 `Object.is` 比较

**运行：** `node p2-usememo-trap.mjs`

---

## 实验 P3：React.memo 比较函数语义 + 边界场景

**验证什么：**
- 返回值语义和 Array.filter **相反**（true = skip render）
- 默认比较是 Object.is（引用相等）
- 自定义比较函数的使用场景
- 无 props 子组件也会跟着父组件 re-render

**运行：** `node p3-memo-edge.mjs`
