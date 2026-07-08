# Day 21 — 高优先级打断低优先级实战

> **主线位置**：`meta/job-sprint-plan.md` 阶段 A 的第一天，对应原 `meta/roadmap.md` **D15**。这是并发渲染模块的最后一块拼图——Day10（Lane 决策树）+ Day19（Scheduler 让出机制）+ Day20（Transition 标记机制）讲完了"是什么"，今天讲**它们三个是怎么拼起来、真正实现"打断"这件事的**。讲完这篇，"并发渲染"这一整块就是一个完整闭环，可以直接拿去面试深挖。

---

## 零、入场自测（先答，不会就写"不会"）

这是 Day20 结尾留的 4 个预读问题，先凭直觉答一遍：

1. 怎么在代码里制造一个"故意很慢"的渲染，方便观察打断效果？
2. 打断发生时，React DevTools Profiler 会显示出什么迹象？
3. 如果低优先级渲染已经完成了 `beginWork` 但还没 `completeWork`，被打断后这部分工作是完全浪费，还是能有部分复用？
4. `entangleTransitions` 这个函数名多次在源码里出现，它是解决什么问题的？

### 零点五、入场自测点评（2026-07-08 跟练收尾）

学习者通过实际跑实验（I1/I2/I3）间接验证了这几个问题的答案：

- **Q1**：用一个大列表（300 项）+ 每项做同步空转计算模拟耗时渲染，实测有效——I1 里能清楚看到低优先级渲染被打断重做的证据。
- **Q3**：实测证实是**完全浪费，不能复用**——I1 观察到"打印一部分后被高优先级插入，之后重新从头打印"，直接对应 `prepareFreshStack` 丢弃整棵旧 wip 树、`createWorkInProgress` 从 root 重新生成。
- **Q4**：初版理解有误（以为是"同一 transition 里多个 state 一起提交"），跟练中通过追问纠正为"同一个 state 被两次独立事件触发 transition 时防止乱序"，I3 实测验证了顺序严格递增不乱序。
- **Q2**：最初设计的 Profiler 面板方案因阅读门槛太高被反馈"没法参考"，已改成 Console 打印 commit 序号的方案，避免依赖不熟悉的 DevTools UI 操作。

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
[让出点2] → 问一次"现在该跑谁" → 得到答案：出现了更高优先级！ �� 丢弃旧进度，换成跑高优先级
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

## 四点五、追问：如果高优先级反复打断，低优先级会不会被"饿死"（永远等不到）

**跟练追问（2026-07-07）**：wip 树在绘制时，一直有高优先级的来打断时，是不是会一直丢弃 wip 树，导致之前的更新一直在等待？

### 答案：不会无限等待——每个 lane 自带一个"过期倒计时"

先破题：这个问题问的是"§三/§四描述的机制会不会导致饿死"，答案是**理论上会，但 React 专门设计了一层"过期保底"来兜底，实际上不会**。

用类比讲：急诊室里，普通病人（低优先级）一直被插队的急症病人（高优先级）挤到重新排号，如果插队者络绎不绝，普通病人可能永远排不到——这就是"饿死"问题。医院的解法是：**给每个挂号病人都盖一个"最晚必须开诊"的时间戳**，一旦到点，不管后面还有没有插队的，这个号必须无条件优先处理，而且**处理过程中不能再被抢**。

### 源码证据 1：每个 lane 挂号时就带上"过期时间"

已核实源码（`computeExpirationTime` 函数）：

```js
function computeExpirationTime(lane, currentTime) {
  switch (lane) {
    case 1: case 2: case 4: case 8: case 64:      // SyncLane / InputContinuousLane 等紧急 lane
      return currentTime + 250;                    // 250ms 后过期
    case 16: /* ... */ case 2097152:               // DefaultLane / TransitionLanes 这批
      return currentTime + 5000;                    // 5000ms(5秒) 后过期
  }
}
```

这个时间戳在 `scheduleTaskForRootDuringMicrotask`（Day19 看过的函数）里，**每个 lane 第一次被记进 `root.pendingLanes` 时就顺手算好**，存进 `root.expirationTimes` 数组，跟"这次渲染有没有被打断"完全无关——不管中间被丢弃重做多少次，这个"最晚必须处理"的截止时间**从始至终不会重置**。

### 源码证据 2：过期之后，渲染模式整个切换成"不可打断"

已核实源码（`performWorkOnRoot` 函数）：

```js
var shouldTimeSlice =
    (!forceSync &&
      0 === (lanes & 124) &&
      0 === (lanes & root.expiredLanes)) ||   // ★ 关键：这批 lane 有没有过期
    checkIfRootIsPrerendering(root, lanes);
var exitStatus = shouldTimeSlice
  ? renderRootConcurrent(root, lanes)   // 可打断：workLoop 里有 shouldYield 检查
  : renderRootSync(root, lanes, !0);    // 不可打断：workLoopSync 没有任何让出检查
```

对比两个循环体：

```js
// 并发版：每处理完一个 fiber 就问一次"该让出了吗"
function workLoopConcurrentByScheduler() {
  for (; null !== workInProgress && !shouldYield(); ) performUnitOfWork(workInProgress);
}

// 同步版：一口气跑到底，循环条件里根本没有让出检查
function workLoopSync() {
  for (; null !== workInProgress; ) performUnitOfWork(workInProgress);
}
```

**一旦某个 lane 的过期时间到了**（`root.expiredLanes` 被标记上这个 lane），下一次渲染它时 `performWorkOnRoot` 会直接选择 `renderRootSync` 这条路——而不是之前一直在讲的、会被打断的 `renderRootConcurrent`。走到 `renderRootSync` 之后，**哪怕这期间又来了优先级更高的新更新，这一轮渲染也不会被打断**，会强制跑完整棵树然后立刻 commit。

### 完整时间线

```
t0     : TransitionLane 更新第一次挂号 → 记下过期时间 = t0+5000ms（这个时间戳不会因为后续打断而改变）
t0~t4999: 期间反复被更高优先级打断 → 每次都 prepareFreshStack 丢弃重做，一直没能提交成功
t5000  : 下次调度检查时发现 expirationTime <= currentTime → root.expiredLanes 标记上这个 lane
t5000+ : performWorkOnRoot 走 renderRootSync 分支 → workLoopSync 一路跑到底，不再检查 shouldYield
         → 哪怕又来新的高优先级更新，这一轮也不会被打断 → 跑完立刻 commit → 终于提交成功
```

### 一句话总结

**"打断"用来保证响应速度，"过期保底"用来保证不会无限延迟**——两者是同一套机制里互补的两面。普通/紧急类 lane 的保底窗口是 250ms，Default/Transition 这批是 5000ms。这也解释了为什么 Day19 §六讲的"过期任务饿死兜底"（`shouldYieldToHost` 层面的过期检测）和这里"渲染模式切换成同步不可打断"是**同一个"过期"概念在两个不同粒度上的体现**：Day19 讲的是 Scheduler 任务队列层面（同一批任务内部要不要让出主线程），这里讲的是 React 渲染调度层面（这一批 lane 要不要允许被下一批更高优先级抢占）。

---

## 四点六、追问：为什么实验里"高优先级"也卡、"低优先级"的值也没立刻消失

**跟练追问（2026-07-08）**：Day21 实验 I1 里，点击"高优先级"按钮后，`urgent` 计数也不是立刻响应、有延迟；同时点击后 `SlowItem` 里打印的 `tag` 还是旧值。这是两个独立的现象，根因完全不同，容易被混在一起理解。

### 现象一：高优先级更新也卡顿——这是"排队优先"和"渲染耗时"两件事被混淆了

先用类比破题：食堂插队成功，意味着你**排到了窗口前面**，但轮到你之后，阿姨给你打饭这个动作本身**依然需要花时间**——插队不会让"现炒一份菜"的物理耗时消失。**"高优先级"解决的是"谁先被处理"的排队顺序问题，不解决"这次渲染本身要跑多久"的问题。**

I1 实验里 `SlowItem` 最初的版本**没有包 `React.memo`**。这意味着：只要父组件 `App` 重新渲染（不管这次渲染的目的是更新 `tag` 还是 `urgent`），300 个 `SlowItem` 的函数体都会被无条件重新调用一次——因为 bailout 的前提是"有 memo 且 props 没变"（Day8/Day9 讲过），没有 memo，React 没有依据跳过调用这个函数。

而 `urgent` 触发的是一次同步渲染，走的是 `renderRootSync`（Day21 §四点五刚讲过），它的 `workLoopSync` 循环里**没有 `shouldYield` 检查**，一旦开始就会强制跑完整棵子树，中途不会再让出主线程。所以即使 `urgent` 是"高优先级"，只要这次渲染牵连的范围里包含 300 次 20 万级循环的同步计算，这次渲染依然会真实地卡顿——高优先级只保证它"排在最前面处理"，换不来"瞬间处理完"。

**修正方式**：给 `SlowItem` 包一层 `React.memo`。这样当 `urgent` 触发渲染、而 `tag`/`id` 这两个 props 都没变时，`SlowItem` 会直接命中 bailout，完全不会重新执行那 20 万次循环——这时才能真正观察到"高优先级更新几乎瞬间响应"的效果。**没加 memo 时看到的卡顿，不是打断机制的问题，是组件树缺少渲染隔离导致的连带重算。**

### 现象二：点击高优先级按钮后，SlowItem 打印的还是旧的 tag 值——这是 lane 过滤机制在正常工作

先用类比：仓库里一堆发货单，每张单子都盖着"批次章"。今天只处理"加急批次"的单子，普通批次的单子哪怕排在最前面也照样跳过，留着等它自己的批次日。

已核实源码（`updateReducerImpl`，处理 `useState` 更新队列的核心逻辑）：

```js
var updateLane = update.lane & -536870913;
if ((renderLanes & updateLane) === updateLane) {
  // 这条 update 的 lane 属于本次渲染要处理的批次 → 应用它，算出新值
} else {
  // 不属于 → 跳过！state 继续沿用旧值，这条 update 原样留在 baseQueue 里，等它自己的批次日
}
```

`setTag` 是包在 `startTransition` 里调的，它的 update 挂的 lane 是 **TransitionLane**。点击"高优先级"按钮触发的是**另一次独立的同步渲染**，这次的 `renderLanes` 只有 **SyncLane**（`getNextLanes` 挑批次时，命中紧急 lane 就只返回这一批，Day10/Day21 §二都讲过，不会顺便把 TransitionLane 也捎带处理）。所以这次渲染跑到 `tag` 这个 state 内部检查更新队列时，发现自己那条 update 是 TransitionLane，不在这次 `renderLanes` 里 → 跳过，`tag` 继续显示上一次已经提交成功的旧值。**这不是 bug，是"每个 state 的每条更新只认自己的 lane 是否在当前批次里"的正常表现**——`tag` 的更新没有丢，只是暂存着，要等下一次专门处理 TransitionLane 的渲染才会真正应用出来。

### 一句话总结

**"高优先级"帮你抢到的是"排队顺序"，不是"渲染耗时归零"，也不会替你把其他 state 的低优先级更新一起搭便车处理掉。** 这两个现象合起来正好完整回答了"打断机制到底改变了什么、没改变什么"——它改变的是"下一步该处理哪一批 lane"的决策，不改变"这一批要处理多少组件、每个 state 只处理自己那条 lane 更新"这些更基础的规则。

---

## 五、`entangleTransitions`：为什么某些更新会被"捆绑"

> ⚠️ **2026-07-08 修正**：本节 5.1 最初举的例子（"同一个 startTransition 里 setA+setB"）用错了机制，已重写。那个场景靠的是另一个更基础的机制（lane 缓存复用），跟 `entangleTransitions` 无关。真正的作用场景和验证方式见下方。

### 5.1 先排除一个常见误解：同一个 transition 回调里多次 setState，天生就是同一个 lane

已核实源码（`requestTransitionLane`）：

```js
function requestTransitionLane() {
  if (currentEventTransitionLane === 0) {
    currentEventTransitionLane = claimNextTransitionLane();  // 只在这个"事件"里第一次调用时才领新号
  }
  return currentEventTransitionLane;  // 之后同一事件内直接复用
}
```

`currentEventTransitionLane` 是一个全局缓存，只在每次微任务边界（`processRootScheduleInMicrotask`）才重置为 0。所以 `startTransition(() => { setA(1); setB(2); })` 里的两次 setState **天然拿到同一个 lane 号**——不是"两个不同的号被捆在一起"，而是压根没有产生两个不同的号。这也是 I3 实验里 `a` 和 `b` 始终相等的真正原因：**保证一致的是 lane 缓存复用，不是 `entangleTransitions`**。

### 5.2 真正要解决的问题：同一个 state，先后两次独立的 transition 更新，不能被拆开处理

用类比讲：想象你在改同一份合同——**第一次修订**是上周提的（第一次点击触发的 transition，因为渲染慢还没来得及处理完），**第二次修订**是今天刚提的（用户又点了一次，`currentEventTransitionLane` 已经被重置，这次会 `claimNextTransitionLane()` 领到一个**新的、不同的**编号）。这两次修订落在**同一份文件**上（同一个 `useState` 的 queue）。如果调度系统只顾处理"今天这次"、把"上周那次"晾在一边不知道什么时候才处理，这份文件的更新历史就乱了。

### 5.3 `entangleTransitionUpdate` 源码怎么防止这种情况

已核实源码：

```js
function entangleTransitionUpdate(root, queue, lane) {
  if ((lane & 4194048) !== 0) {          // 这次是 transition lane
    var queueLanes = queue.lanes;         // 这个 state 自己的 queue 上，已经挂着的旧 lane
    queueLanes &= root.pendingLanes;      // 只取"还没处理完"的那部分
    lane |= queueLanes;                   // 新旧 lane 合并
    queue.lanes = lane;
    markRootEntangled(root, lane);        // 记到 root.entangledLanes，强制以后必须一起处理
  }
}
```

**关键：这里操作的是单个 `useState`/`useReducer` 的 `queue`，不是整个组件**。它管的场景是：**同一个 state**先后被两次独立的 `startTransition`（隔着一次事件循环，领到了不同的 lane 编号）触发更新，这个 `queue` 上会同时挂着两个不同的 transition lane。`entangleTransitionUpdate` 把它们记到 `root.entangledLanes`，保证 `getNextLanes` 挑批次时，**只要选中其中一个 lane，就必须把捆绑的另一个也一起拉进这一批处理**（`prepareFreshStack` 里展开 `entangledLanes` 的逻辑就是干这个的）。

> 💡 修正后回答入场自测 Q4：**`entangleTransitions`/`entangleTransitionUpdate` 防止的是"同一个 state 先后收到两次独立的 transition 更新时，被调度系统拆成两批分开处理、打乱应用顺序"**，不是"同一次 transition 回调里的多个不同 state 保持一致"（那个由 lane 缓存复用天然保证，跟这个函数无关）。

### 5.4 怎么设计实验真正验证到它（而不是验证 5.1 那个天然一致的现象）

想验证 `entangleTransitions` 的效果，实验必须是**同一个 state，两次独立事件触发的 transition**，观察的不是"是否相等"，而是"**两次更新有没有被打乱顺序、其中一次有没有被无限期搭不上车**"：

```jsx
import { useState, useTransition } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  const [, startTransition] = useTransition();

  function handleClick() {
    // 每次点击都是"独立事件"——两次点击之间隔着一次事件循环，
    // currentEventTransitionLane 会被重置，第二次点击会领到不同的 lane
    startTransition(() => setCount(c => c + 1));
  }

  console.log('[render] count=', count);
  return <button onClick={handleClick}>count={count}</button>;
}
```

**操作步骤**：快速连续点击按钮 5 次（间隔尽量短，但仍是 5 次独立的 click 事件，不是同一个回调里调 5 次 setState）。观察 Console：`count` 是否**依次**从 1 递增到 5，没有跳号也没有乱序（比如先出现 3 再出现 2 这种反直觉顺序）。如果没有 `entangleTransitions` 这层保护，理论上后面的更新可能在前面的还没提交完时就被独立处理、导致渲染顺序错乱；有了这层保护，多个针对同一个 state 的 transition lane 会被强制按批次捆绑处理，不会出现顺序错乱。

**关于"其中一个失败"**：React 的更新模型里没有"某条 lane 单独失败"的概念——如果你在 `startTransition` 回调里同步 `throw`，那纯粹是 JS 控制流问题（后面的代码不会执行），跟 `entangleTransitions` 无关；如果你想测的是"一个异步操作报错、另一个操作是否正常完成"，那是 Day13 讲过的 `useActionState` 错误处理模型（`throw` 被自动捕获为 error state），是完全不同的机制，不应该混到这里验证。

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

1. **我以为** "打断"是 CPU 层面把正在执行的代码物理中断。**其实** JS 单线程做不到这点，"打断"的真正含义是"每次 `shouldYield` 让出后重新问一次 `getNextLanes` 该跑谁"，答案变了才触发 `prepareFreshStack` 丢弃重做——永远发生在两次同步代码之间的"缝隙"里。

2. **我以为** 低优先级渲染被打断后，已经做完的那部分工作（哪怕只差 `completeWork`）多少能省一点。**其实**完全浪费、不能复用——`prepareFreshStack` 调 `createWorkInProgress` 直接从 `root.current` 重新 clone 整棵 wip 树，旧的引用连痕迹都不留。I1 实测也证实了这点：打断后 `SlowItem` 的日志是"重新从头打印"，不是"接着上次打印"。

3. **我以为** wip 树如果一直被更高优先级反复打断，低优先级更新会永远排不上号。**其实**每个 lane 挂号时就带一个不受打断影响的"过期时间戳"（紧急类 250ms，Default/Transition 类 5000ms），过期后强制切到不可打断的 `renderRootSync`，保证不会无限延迟。（认知纠正 #76）

4. **我以为** "高优先级"意味着这次更新一定几乎瞬间响应。**其实**高优先级只保证"排队顺序靠前"，不保证"渲染耗时归零"——I1 最初版本没给 `SlowItem` 加 `memo`，导致高优先级的 `urgent` 更新依然要陪着 300 个耗时子组件一起重渲染，看起来一样卡。加了 memo 之后才能真正体现"高优先级几乎不受影响"。（认知纠正 #77）

5. **我以为** `entangleTransitions` 解决的是"同一个 `startTransition` 回调里多个不同 state 的 setState 保持一起提交"。**其实**那个场景靠的是更基础的机制（`currentEventTransitionLane` 全局缓存复用，同一事件内多次 setState 天然拿到同一个 lane）。`entangleTransitions`/`entangleTransitionUpdate` 真正管的是**同一个 state**被**两次独立事件**先后触发 transition 更新时，防止调度系统把这两次更新拆开处理导致顺序错乱——I3 用"同一个 count，连续点击 5 次独立事件"验证了这一点，渲染序列严格递增没有乱序。（认知纠正 #78）

---

## 十、动手实验（demos/day21/）

在真实的 Vite + React 项目里跑，详见 `demos/day21/README.md`：

| 实验 | 验证什么                                                                                            | 实测结果 |
| -- | ----------------------------------------------------------------------------------------------- | -- |
| I1 | 制造一个耗时的低优先级渲染（大列表 + `startTransition`），中途触发一个高优先级更新，用 console.log 观察渲染函数是否被"重新从头调用一次"           | ✅ 符合预期：urgent 很快响应，SlowItem 日志出现"打印一部分→被高优先级插入→重新从头打印"的重做证据 |
| I2 | 用 Console 打印 commit 完成序号（`useEffect`），观察高优先级和低优先级更新的 commit 完成顺序是否与点击顺序不一致 | 方案已从 Profiler 面板改为纯 Console 打印（原方案阅读门槛太高） |
| I3 | 验证 `entangleTransitionUpdate` 效果：同一个 state 被两次独立事件触发 transition，观察渲染序列是否严格递增不乱序 | ✅ 符合预期：连续点击5次后严格递增 1→2→3→4→5，没有跳号乱序 |

---

## 十一、验收清单

- [x] 能讲清楚"打断"不是 CPU 抢占，而是"每次让出后重新决策"
- [x] 能说出 `getNextLanes` 在整个链路里的作用和调用时机
- [x] 能讲清楚 `prepareFreshStack` 为什么会导致"旧进度完全浪费不能复用"
- [x] 能讲清楚"批次变化"不等于"一定打断"，理解容错窗口的判断逻辑
- [x] 能讲清楚 `entangleTransitions` 解决的"同一 state 跨事件不乱序"问题（已修正为准确表述）
- [x] 完成 3 个实验并记录到 observations.md

---

## 十二、Day22 预告

**主题**：自研 mini-store（订阅 + selector + 批量更新），衔接 `meta/job-sprint-plan.md` 阶段 A 第二天（原 roadmap D20）。Day15 已经讲完了 Redux/Zustand/Jotai 的源码对比，今天是**自己动手写一个**——目标是 100-150 行内实现一个 `createStore`，支持 `subscribe`/`selector`/批量更新去重，当天写完就是能跑的库。

**预读问题**：

1. 一个最小可用的状态管理库，最少需要几个核心方法？
2. 如果两个组件用同一个 `selector` 订阅同一个字段，状态变化时应该分别通知还是合并成一次？
3. "批量更新"在没有 React 内部机制帮忙的情况下，你自己的 store 要怎么手动实现？
