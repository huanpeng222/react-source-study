# Day 14 实验观察记录

> README.md 已改为 Vite/浏览器版实验（真实 React.memo/useMemo/useCallback，不是 jsdom 脚本）。跑完后把真实结果填进下方区块。

## 浏览器版实测记录（待填）

### P1：bailout 可视化
- ChildA（无 memo）是否每次都跟着 Parent 渲染？
- ChildB（memo 但 props 不稳定）是否和 ChildA 表现一致（memo 失效）？
- ChildC（memo + 稳定引用）、HeavyComponent（无 props + memo）是否只在首次 mount 渲染一次？

（待填）

### P2：useMemo/useCallback 依赖陷阱
- 场景 A（依赖是对象）：点击按钮是否每次都打印"重算"？
- 场景 B（依赖基本类型）：点"改 count"是否重算，点"改 other"是否不重算？
- 场景 C：badFn() 是否卡在初始值，goodFn() 是否跟着 count 变？

（待填）

### P3：memo 比较函数语义 + 边界场景
- CustomChild 的 name 变化但 id 不变时，是否真的跳过渲染？
- 无 props 的 NoPropsChild 加 memo 后是否真的不再重渲染？

（待填）
