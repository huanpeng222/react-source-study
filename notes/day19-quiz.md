# Day19 自测题 — Scheduler：最小堆 + MessageChannel 时间片

## 题目

**1.** Scheduler 内部有两套独立机制，分别回答什么问题？`shouldYieldToHost` 属于哪一套？

**2.** `taskQueue` 和 `timerQueue` 分别用什么字段排序？`advanceTimers` 做了什么？

**3.** 背出五个优先级对应的 timeout 数值，并说明 expirationTime 是怎么算出来的。

**4.** 为什么 Scheduler 用 MessageChannel 而不是 `setTimeout(fn, 0)`？4ms 节流是什么？

**5.** `workLoop` 里的让出条件是 `currentTask.expirationTime > currentTime && shouldYieldToHost()`。如果一个任务已经过期且这一轮已经连续跑了 50ms，会让出吗？为什么？

**6.** 什么是"续体函数"？它和"高优先级打断后 wip 作废重来"是同一个机制吗？区别是什么？

**7.** Scheduler 是抢占式还是协作式调度？这意味着到点的延迟任务能不能打断正在执行的任务？

**8.** `unstable_cancelCallback` 是怎么把任务从最小堆里删掉的？为什么不能直接删？

**9.** Day10 的 `shouldYield` 和今天讲的 `shouldYieldToHost` 是什么关系？

**10.** 完整描述"高优先级更新打断低优先级渲染"的全过程，标出 Scheduler 在每一步扮演的角色。

---

## 参考答案（作答后核对）

<details>
<summary>点击查看答案</summary>

**1.** 机制①任务排序（回答"谁先跑"，最小堆按 expirationTime 排）；机制②时间片让出（回答"跑多久歇"，shouldYieldToHost 计时 5ms）。shouldYieldToHost 属于机制②，跟优先级无关。

**2.** taskQueue 按 expirationTime 排序（已就绪任务）；timerQueue 按 startTime 排序（延迟任务）。`advanceTimers(currentTime)` 检查 timerQueue 堆顶是否 `startTime <= currentTime`，到点了就转移到 taskQueue。

**3.** ImmediatePriority: -1；UserBlockingPriority: 250；NormalPriority: 5000；LowPriority: 10000；IdlePriority: 1073741823。`expirationTime = startTime + timeout`。源码 `SchedulerFeatureFlags.js`。

**4.** 浏览器对嵌套 `setTimeout` 超过一定层数会强制 clamp 到最低 4ms（HTML 规范历史遗留）。MessageChannel 的 postMessage 走宏任务队列，无此限制，调度更精确。

**5.** **不会让出**。任务已过期 → `expirationTime > currentTime` 为 false → `&&` 短路，`shouldYieldToHost` 根本不被调用 → 强制继续跑。这是防止高优先级任务被时间片反复推迟"饿死"的兜底。

**6.** 续体函数是 callback 执行后返回的函数，Scheduler 把它存回 `task.callback` 留队列不删，下次接着跑。**和打断作废不是同一机制**：续体=同优先级断点续传；打断作废=高优插队后低优 wip 树因 renderLanes 变化作废、从头重做。

**7.** **协作式**。正在跑的任务只能自己主动让出（跑完 or 时间片到 break），到点的延迟任务只是从 timerQueue 转正进 taskQueue，不能打断正在执行的任务。

**8.** **软删除**：只把 `task.callback = null`，不真的从堆里删。因为数组实现的最小堆只能高效弹堆顶（O(log n)），删中间节点要 O(n)。等下次 workLoop/advanceTimers 遍历到发现 callback 是 null 才 pop 丢弃。

**9.** Day10 的 `shouldYield` 是 reconciler 对 Scheduler 包 `shouldYieldToHost` 的转发包装（`react-reconciler/src/Scheduler.js` 里 `export const shouldYield = Scheduler_shouldYield`）。

**10.** ①低优 render 每处理完一个 Fiber 调 shouldYield（Scheduler 机制②）→ ②够 5ms 返回 true → break 返回续体给 Scheduler → ③Scheduler 通过 MessageChannel 让出主线程 → ④高优 setState 发生，expirationTime 更小 → ⑤新任务插到最小堆顶（Scheduler 机制①）→ ⑥下轮 workLoop peek 到高优先跑 → ⑦高优 commit 后，低优 wip 因 renderLanes 变化作废重来。Scheduler 全程驱动。

</details>
