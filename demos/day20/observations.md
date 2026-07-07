# Day20 实验观察记录

> README.md 已改为 Vite/浏览器版实验（真实 useTransition/useDeferredValue，不是 jsdom 脚本）。跑完后把真实结果填进下方区块。

## 浏览器版实测记录（待填）

### T1：startTransition 的 isPending 变化序列
- 直接 setN 是否只有 1 次渲染、isPending 全程 false？
- transition 版是否出现 isPending 从 true 变回 false 的两阶段？

（待填）

### T2：transition 更新与紧急更新同时发起
- 最终页面显示的 n 是 1 还是 2？
- 中间是否出现过 n=1 的可见渲染？

（待填）

### T3：useDeferredValue 在紧急渲染 vs transition 渲染中的差异
- 场景 A（同步更新）是否出现"旧值→新值"两阶段？
- 场景 B（transition 更新）是否"一步到位"，没有中间态？

（待填）
