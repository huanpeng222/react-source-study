# Day 15 实验观察记录

> README.md 已改为 Vite/浏览器版实验（真实 Zustand/Jotai 库，不是自制模拟实现）。跑完后把真实结果填进下方区块。

## 浏览器版实测记录（待填）

### S1：Context 性能陷阱 + 拆分修复
- 反模式下，改 items 是否也让 Header（只用 user/theme）跟着重渲染？
- 拆分 Context 后，改 items 是否不再影响 Header？

（待填）

### S2：Zustand vs 手写 Redux
- 两种方案功能是否完全等价？
- Zustand 版本代码量/心智负担对比手写 Redux 有多大差异？

（待填）

### S3：Jotai 原子派生 + 细粒度订阅
- 改 count 时 TextInput 是否完全不重渲染？
- 改 text 时 Counter/Doubler 是否完全不重渲染？
- Greeter（依赖两个 atom）是否两边变化都会触发？

（待填）
