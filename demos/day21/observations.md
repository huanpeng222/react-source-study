# Day 21 实验观察记录

> 真实 Vite + React 项目浏览器实验（配合 React DevTools Profiler）。跑完后把真实结果填进下方区块。

## 浏览器版实测记录（待填）

### I1：低优先级渲染被丢弃重做的证据
- 点击"②高优先级更新"后，urgent 计数是否立刻响应，不等300条SlowItem渲染完？
- 300条 `[SlowItem]` 日志是否出现了重复打印（同一tag下同一id渲染了2次以上）？

（待填）

### I2：Profiler 时间轴上的 commit 顺序
- 一共出现了几次 commit？
- 高优先级的 commit 是否排在了低优先级 commit 之前（即使低优先级按钮先点）？

（待填）

### I3：entangleTransitionUpdate 顺序一致性验证（2026-07-08 已重新设计）
- 快速连续点击5次后，count 的渲染序列是否严格递增（1→2→3→4→5），没有跳号也没有乱序？

（待填）
