# Day 21 实验观察记录

> 真实 Vite + React 项目浏览器实验。

## 浏览器版实测记录（已完成，2026-07-08）

### I1：低优先级渲染被丢弃重做的证据 ✅ 符合预期
- `urgent` 计数很快响应（加了 `memo` 之后不再被 300 个 `SlowItem` 拖累）。
- `SlowItem` 的渲染日志出现了重复打印：先打印一部分（低优先级渲染进行中），中途被高优先级任务插入执行，高优先级任务完成后，低优先级渲染**重新从头开始打印**（对应 `prepareFreshStack` 丢弃旧 wip 树、`createWorkInProgress` 从 root 重新生成的证据）。
- 结论：验证了"打断 = 丢弃重做"，不是"暂停后接着做"。

### I2：commit 完成顺序（改用 Console 方案后，尚未重跑）
- 原 Profiler 面板方案因阅读门槛太高被反馈"没法参考"，已改成 `useEffect` 打印 `commit #N` 序号的纯 Console 方案（见 README.md 最新版）。
- 待用新方案重新跑一次，观察 `✅ [commit #N]` 的完成顺序是否验证"后点击的高优先级反而先 commit 完成"。

### I3：entangleTransitionUpdate 顺序一致性验证 ✅ 符合预期
- 快速连续点击 5 次后，`count` 的渲染序列严格递增（1→2→3→4→5），没有跳号也没有乱序。
- 结论：验证了同一个 state 被多次独立 transition 触发时，`entangleTransitionUpdate` 保证了处理顺序不会被打乱。
