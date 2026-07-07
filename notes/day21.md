# Day 21 — 高优先级打断低优先级实战

> **主线位置**：`meta/job-sprint-plan.md` 阶段 A 的第一天，对应原 `meta/roadmap.md` **D15**。这是并发渲染模块的最后一块拼图——Day10（Lane 决策树）+ Day19（Scheduler 让出机制）+ Day20（Transition 标记机制）讲完了"是什么"，今天讲**它们三个是怎么拼起来、真正实现"打断"这件事的**。讲完这篇，"并发渲染"这一整块就是一个完整闭环，可以直接拿去面试深挖。

---

## 零、入场自测（先答，不会就写"不会"）

这是 Day20 结尾留的 4 个预读问题，先凭直觉答一遍：

1. 怎么在代码里制造一个"故意很慢"的渲染，方便观察打断效果？
2. 打断发生时，React DevTools Profiler 会显示出什么迹象？
3. 如果低优先级渲染已经完成了 `beginWork` 但还没 `completeWork`，被打断后这部分工作是完全浪费，还是能有部分复用？
4. `entangleTransitions` 这个函数名多次在源码里出现，它是解决什么问题的？

---

## 一、先破除一个最大的误解："打断"不是 CPU 层面抢占

### 你可能以为的画面

```
低优先级渲染正在跑 beginWork(fiber5)
                ↓
        用户敲了个字（高优先级）
                ↓
   "咣"一声，React 立刻掐断当前这行代码的执行，
   转头去跑高优先级的逻辑
```

这个画面是错的。JS 是单线程的，**没有任何机制能在一条同步代码执行到一半时把它物理打断**——`beginWork(fiber5)` 这个函数调用只要开始了，就必须先跑完这一次调用才能停下来。

### 真实的画面：打断发生在"两次问路"之间的空隙

```
[让出点1] → 问一次"现在该跑谁" → 得到答案：还是继续跑低优先级 → 跑一个fiber → [让出点2]
[让出点2] → 问一次"现在该跑谁" → 得到答案：出现了更高优先级！ → 丢弃旧进度，换成跑高优先级
```

**"打断"的真正含义是**：Scheduler 每让出一次主线程（Day19 讲过的 `shouldYield`），React 都会重新问一次"现在最该跑的是哪一批更新"。如果这次问出来的答案跟上一轮不一样（出现了更高优先级的新任务），**才会**触发"丢弃旧进度、重新开始"——但这永远发生在两次同步代码执行之间的"缝隙"里，不是代码执行过程中被物理打断。

> 📌 这解释了为什么 Day19 反复强调"协作式调度，不是抢占式"——真正的抢占式调度需要操作系统/浏览器内核支持中断当前指令，React 做不到这个，它能做的是**缩短每次"问路"的间隔**（时间片 5ms），让"重新决策"的机会来得更频繁，从体感上接近"随时能被打断"。

---

## 二、"问路"问的是谁——`getNextLanes` 这个决策函数

### 2.1 每次更新触发后，都会走一次"要不要重新排班"的检查

```
用户操作 → setState → scheduleUpdateOnFiber(root, fiber, lane)
                            ↓
                    markRootUpdated（把这个 lane 记进 root.pendingLanes，Day10 讲过）
                            ↓
                    ensureRootIsScheduled(root)
                            ↓
              安排一个"立即执行"的微任务：processRootScheduleInMicrotask
                            ↓
                 对这个 root 调用 scheduleTaskForRootDuringMicrotask
                            ↓
                    getNextLanes(root, ...) —— ★ 这就是"问路"的核心 ★
```

已核实源码（`react-dom-client.development.js`，`scheduleUpdateOnFiber` 函数体）：每次 `setState` 最终都会调 `ensureRootIsScheduled(root)`，它不是"直接执行渲染"，而是**排一个微任务**，在这个微任务里重新算一遍"现在这个 root 到底该处理哪些 lane"。

### 2.2 `getNextLanes` 怎么决定"下一批处理谁"

用类比先讲清楚这个函数在干什么：想象 `root.pendingLanes` 是一张挂号单，上面记着所有"还没看的病人的优先级"。`getNextLanes` 做的事情就是**每次都重新扫一遍这张单子，挑出优先级最高的那一批**，不管这批病人是不是刚挂号的。

```
getNextLanes(root, wipLanes, ...):
  1. 看 root.pendingLanes 里有没有"非 Idle"的挂号（nonIdlePendingLanes）
  2. 排除掉已经 suspended（挂起等异步）的
  3. 剩下的里面，调 getHighestPriorityLanes 挑出"同一批次"里优先级最高的一组
     （这一步用到 Day10 讲过的 lane 掩码：先看有没有 pendingSyncLanes = lanes & 42，
      SyncLane/InputContinuousLane 这类紧急 lane 只要存在就直接整批返回）
  4. 【关键判断】如果算出来的这批(nextLanes)跟"正在渲染中的这批"(wipLanes)不一样，
     且新这批优先级不比正在跑的更高 → 继续用 wipLanes（不重开！）
     否则 → 换成用 nextLanes（这就是打断发生的信号）
```

这一步"第 4 点"是最容易被忽略但最关键的地方——**不是任何一次"批次变化"都会导致重开**，只有新出现的批次优先级确实更高时才会。这就是"高优先级打断低优先级"这句话在源码里的真正落点。

> 📌 **微检查点 1**：如果 `wipLanes`（正在渲染中的批次）是 `TransitionLane`，这时候又来了一个 `DefaultLane` 的更新（比正常的 setState 优先级高一点但不是紧急事件），会不会打断当前的 transition 渲染？（提示：回去看上面第 4 点的判断逻辑，比较两者的"数值大小"关系——Day10 讲过 lane 数值越小优先级越高）

---

## 三、真正的"丢弃重做"发生在哪——`prepareFreshStack`

### 3.1 拿到新的 lanes 之后，谁来决定"要不要重新盖房子"

```
getNextLanes 返回新的 lanes
        ↓
performWorkOnRootViaSchedulerTask 拿到这批 lanes
        ↓
performWorkOnRoot(root, lanes, didTimeout)
        ↓
renderRootConcurrent(root, lanes)
        ↓
★ 关键判断（已核实源码）：
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    prepareFreshStack(root, lanes);   // ← 重新盖房子！
  }
```

翻译成人话：`renderRootConcurrent` 每次被调用时都会先问一句——**"这次要处理的 lanes，跟我上次正在处理的 lanes 是同一批吗？"**

- **是同一批**（比如上次因为时间片到了让出，这次接着跑）→ 什么都不做，直接从 `workInProgress` 指向的那个 fiber 继续跑（Day19 讲的续体机制）。
- **不是同一批**（说明中间发生了 §二 里的"重新排班"，换了更高优先级的新批次）→ 调用 `prepareFreshStack`，**把整棵 wip fiber 树推倒重新生成**。

### 3.2 `prepareFreshStack` 到底"推倒"了什么

```js
// 已核实源码关键行：
workInProgress = createWorkInProgress(root.current, null);
```

`createWorkInProgress` 是从 `root.current`（上一次成功 commit 的那棵 fiber 树）重新 clone 出一棵全新的 wip 树。**旧的那棵 wip 树（哪怕已经跑了一半 beginWork）直接被丢弃，连引用都不保留**。

用类比讲："打断"不是"暂停后来接着做"，而是"图纸撕掉重画一张新的"。之前已经画好的那部分（哪怕只差最后一笔）跟这次的新任务没有任何关系——因为新的更新可能改变了完全不同的东西，旧的计算结果不能保证还适用。

> 💡 直接回答入场自测 Q3：**完全浪费，不能复用**。`beginWork` 阶段产生的新 fiber 节点、计算出的 `memoizedState` 等等，随着旧 wip 树被丢弃全部作废，下一轮从 root 开始重新走一遍 `beginWork`。这正是"渐进式渲染必须保持纯函数（无副作用）"这条 React 铁律的底层原因——**你的组件函数随时可能被跑到一半就扔掉重跑，如果里面有副作用，重跑一次就会出两次副作用**。

### 3.3 时间线图：一次完整的"打断"过程

```
t0: 低优先级更新(TransitionLane)触发 → getNextLanes返回[Transition]
                                          ↓
t1: renderRootConcurrent(root, [Transition]) → 首次渲染这批，prepareFreshStack建wip树
                                          ↓
t2: workLoopConcurrentByScheduler开始跑 beginWork(fiber1) → beginWork(fiber2) → ...
                                          ↓
t3: 跑了3个fiber后，shouldYield()返回true（5ms时间片到）→ 让出主线程，
    workInProgress还停在fiber4，状态被"冻住"等下次继续
                                          ↓
t4: 【这个间隙】用户点击了一个按钮，触发 setState(SyncLane)
                                          ↓
t5: scheduleUpdateOnFiber → ensureRootIsScheduled → 排微任务重新getNextLanes
    这次算出的nextLanes = [SyncLane]，优先级比[Transition]高 → 替换掉wipLanes
                                          ↓
t6: performWorkOnRoot(root, [SyncLane]) → renderRootConcurrent(root, [SyncLane])
    workInProgressRootRenderLanes(=[Transition]) !== lanes(=[SyncLane]) → ★ 触发！
                                          ↓
t7: prepareFreshStack(root, [SyncLane]) → 丢弃fiber1-4已经做的所有work，
    从root重新createWorkInProgress，开始全新一轮beginWork
                                          ↓
t8: [SyncLane]这批很快跑完并commit（同步优先级不可再被打断）
                                          ↓
t9: commit完之后，root.pendingLanes里[Transition]还挂着（它没有被处理完，只是被延后）
    → 再触发一轮getNextLanes → 这次没有更高优先级了 → 重新走一遍[Transition]的渲染
```

**关键理解**：`[Transition]` 那批更新**没有丢失，只是被延后重做了一遍**——它对应的 `setState` 调用本身没有消失，只是它触发的那次渲染计算被扔了，之后会用同样的 state 重新算一遍。用户感知到的是"高优先级操作立刻响应，低优先级的更新稍微晚一点才出现"，不会有数据丢失。

---

## 四、什么时候"不会"重开——容错窗口

上面 §二第 4 点提到，`getNextLanes` 不是"批次一变就重开"，有个容错条件。用类比讲清楚：

想象你在食堂排队打饭，你（transition 渲染）已经排到窗口了。这时候又来了一个人（新的 update），如果这个人是**插队规则里排在你后面的**（优先级不比你高），食堂阿姨（`getNextLanes`）不会把你从窗口拽走重新排——直接让你先打完。只有真正插队权限更高的人（SyncLane/InputContinuousLane 这类紧急 lane）来了，才会把你换下去。

> 📌 **微检查点 2**：这个"容错窗口"设计避免了什么问题？（提示：如果每次 pending 里出现任何新 lane 都无条件重开，会对正在进行的低优先级渲染造成什么后果？）

---

## 五、`entangleTransitions`：为什么某些更新会被"捆绑"

### 5.1 要解决的问题：两个 transition 各自处理，会不会互相踩

想象一个场景：`startTransition` 里同时触发了 `setA(1)` 和 `setB(2)`，这两个 setState 各自会拿到一个 lane，理论上它们可以被独立处理、独立提交。但如果 `setA` 先提交了，`setB` 还没提交，用户会看到 A 和 B 短暂不一致的中间状态。

### 5.2 `entangleTransitions` 做的事

已核实源码（`ReactFiberConcurrentUpdates.js` 对应逻辑）：

```js
function entangleTransitions(root, fiber, lane) {
  var queue = fiber.updateQueue;
  if (queue !== null && (lane & 4194048) !== 0) {  // 4194048 = 全部 TransitionLanes 的掩码
    var queueLanes = queue.lanes & root.pendingLanes;
    lane |= queueLanes;
    queue.lanes = lane;
    markRootEntangled(root, lane);  // 把这些 lane"捆"在一起
  }
}
```

翻译：如果这次更新是一个 transition（属于 `TransitionLanes` 范围），就把**这个 fiber 的 updateQueue 上已经挂着的其他 transition lane**，和这次新来的 lane 合并成一个"捆绑组"，记到 `root.entangledLanes` 上。之后 `getNextLanes` 挑选批次时，**这些被捆绑的 lane 只能作为一整批一起处理，不能只处理其中一部分**。

> 💡 直接回答入场自测 Q4：**`entangleTransitions` 解决的是"同一个 transition 里多个 setState 触发的多个 lane，必须绑在一起同批提交，不能让用户看到其中一部分先更新、另一部分还没更新的中间态"**。这是为了保证 transition 的"原子性"体验。

---

## 六、DevTools Profiler 怎么观察打断

### 6.1 关键指标：渲染时长条 + "interrupted"标记

在 React DevTools 的 Profiler 面板录制一段有打断发生的操作后：

- 每次 commit 会显示为一个"火焰图"色块，色块的宽度是这次 commit 的耗时。
- 如果一次渲染中途被打断重做，**你不会看到"半截的渲染"出现在时间轴上**——因为被丢弃的那次渲染从未 commit，Profiler 只记录真正提交成功的那些 commit。你能观察到的是：**本该只需要一次 commit 的低优先级更新，变成了"先出现一次极快的高优先级 commit，紧接着才出现低优先级的 commit"**，两次 commit 之间的时间差，就是打断造成的延迟。

### 6.2 用 Chrome Performance 面板看得更直接

在 Performance 面板的 Main 线程时间轴上，找 React 的 `workLoop` 相关调用栈：
- 正常情况：一段连续的 `beginWork`/`completeWork` 调用栈，直到 commit。
- 发生打断：会看到**一段 `beginWork` 调用栈突然中断**，中间插入了一段新的、独立的调用栈（对应高优先级更新的处理），处理完之后如果日志埋点够细，能看到**又开始了一段新的 `beginWork` 调用栈，从 root 的 fiber 开始**（而不是接着上次中断的地方）——这正是 `prepareFreshStack` 重新创建 wip 树的证据。

---

## 七、把 Day10 + 19 + 20 + 21 串成一条完整链路

```
┌─────────────────────────────────────────────────────────────┐
│ Day10: Lane 模型                                              │
│   每次更新触发时，requestUpdateLane 决定这次更新的"优先级标签" │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ Day21 §二: getNextLanes                                       │
│   每次微任务里重新扫一遍 root.pendingLanes，                  │
│   挑出当前"最该处理"的那一批 lane                             │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ Day19: Scheduler                                               │
│   把这批 lane 换算成 Scheduler 优先级，排进最小堆，            │
│   workLoop 每处理完一个 fiber 就 shouldYield() 让出一次        │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ Day21 §三: prepareFreshStack                                   │
│   每次让出后重新走一遍 getNextLanes，如果批次变了（更高优先级）│
│   就丢弃旧 wip 树，从 root 重新开始——这就是"打断"的落地实现   │
└───────────────────────┬───────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ Day20: useTransition / useDeferredValue                       │
│   是普通开发者操作"哪些更新标记成可以被打断的低优先级"的入口   │
└─────────────────────────────────────────────────────────────┘
```

一句话总结：**Day10 决定"谁的优先级是多少"，Day19 决定"每跑一会儿就问一次现在该跑谁"，Day21 决定"问出来的答案变了就推倒重做"，Day20 是开发者手动参与这套机制的 API 入口**。

---

## 八、几个容易搞混/被面试问到的点

**Q：打断是发生在 render 阶段还是 commit 阶段？**

只发生在 render（beginWork/completeWork）阶段。commit 阶段（beforeMutation/mutation/layout）是同步不可中断的——一旦开始 commit 就必须跑完，这是 Day1-5 讲过的内容，跟今天讲的打断机制不矛盾，是两个不同阶段的规则。

**Q："打断"和"批处理（batching）"是一回事吗？**

不是。批处理是"同一个事件循环里的多个 setState 合并成一次渲染"，是**减少渲染次数**；打断是"渲染进行中，出现更高优先级任务，丢弃当前进度重做"，是**调整渲染顺序**。两者都跟 Lane 有关但解决不同的问题。

**Q：低优先级渲染如果已经跑到 completeWork 阶段（就差 commit 了），还会被打断吗？**

会。只要还没有真正调用 commit 相关函数（`commitRoot`），只要还在 `performWorkOnRootViaSchedulerTask` 循环里，下一次的 `getNextLanes` 判断随时可能触发重开。只有进入 commit 阶段之后才不可打断。

**Q：为什么 React 不做"部分复用"（比如已经算好的 fiber 节点先留着）？**

理论上可以设计成"复用没有依赖变化的子树"，但 React 选择了简单直接的"整棵重来"策略——因为要判断"哪部分可以复用"本身的复杂度和潜在 bug 风险，可能比直接重新计算更高，尤其是在渲染函数被要求保持"纯"的前提下，重新计算的代价被认为是可接受的。

---

## 九、我之前以为…，其实是…（跟练后回填）

（跟练完成后填写 5 条认知纠正）

---

## 十、动手实验（demos/day21/）

在真实的 Vite + React 项目里跑，详见 `demos/day21/README.md`：

| 实验 | 验证什么 |
|---|---|
| I1 | 制造一个耗时的低优先级渲染（大列表 + `startTransition`），中途触发一个高优先级更新，用 console.log 观察渲染函数是否被"重新从头调用一次" |
| I2 | 用 React DevTools Profiler 录制 I1 的操作，观察 commit 时间轴上高优先级和低优先级更新的先后顺序 |
| I3 | 验证 `entangleTransitions` 效果：同一个 `startTransition` 里触发两个 setState，观察它们是否总是同一次 commit 一起出现，不会有中间态 |

---

## 十一、验收清单

- [ ] 能讲清楚"打断"不是 CPU 抢占，而是"每次让出后重新决策"
- [ ] 能说出 `getNextLanes` 在整个链路里的作用和调用时机
- [ ] 能讲清楚 `prepareFreshStack` 为什么会导致"旧进度完全浪费不能复用"
- [ ] 能讲清楚"批次变化"不等于"一定打断"，理解容错窗口的判断逻辑
- [ ] 能讲清楚 `entangleTransitions` 解决的"多个 setState 一起提交"问题
- [ ] 完成 3 个实验并记录到 observations.md

---

## 十二、Day22 预告

**主题**：自研 mini-store（订阅 + selector + 批量更新），衔接 `meta/job-sprint-plan.md` 阶段 A 第二天（原 roadmap D20）。Day15 已经讲完了 Redux/Zustand/Jotai 的源码对比，今天是**自己动手写一个**——目标是 100-150 行内实现一个 `createStore`，支持 `subscribe`/`selector`/批量更新去重，当天写完就是能跑的库。

**预读问题**：
1. 一个最小可用的状态管理库，最少需要几个核心方法？
2. 如果两个组件用同一个 `selector` 订阅同一个字段，状态变化时应该分别通知还是合并成一次？
3. "批量更新"在没有 React 内部机制帮忙的情况下，你自己的 store 要怎么手动实现？
