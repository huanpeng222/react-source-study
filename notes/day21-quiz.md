# Day 21 自测题 — 高优先级打断低优先级实战

<details>
<summary><b>Q1</b>："打断"发生在渲染的哪个阶段？commit阶段会不会被打断？</summary>

只发生在 render（beginWork/completeWork）阶段。commit 阶段（beforeMutation/mutation/layout）是同步不可中断的——一旦开始 commit 就必须跑完，跟今天讲的打断机制是两个不同阶段的规则。
</details>

<details>
<summary><b>Q2</b>：假设低优先级渲染已经跑完了某个fiber的beginWork但还没completeWork，突然被高优先级打断，这部分work会被保留一部分吗？</summary>

不会，完全浪费。`prepareFreshStack` 调 `createWorkInProgress` 从 `root.current` 重新 clone 整棵 wip 树，旧的 wip 树（哪怕只差最后一步）连引用都不保留。这正是"渐进式渲染要求组件函数保持纯函数（无副作用）"的底层原因——组件随时可能被跑到一半就扔掉重跑。
</details>

<details>
<summary><b>Q3</b>：什么情况下"批次变化"不会触发重开？</summary>

`getNextLanes` 判断新批次(nextLanes)优先级是否**确实比正在渲染的批次(wipLanes)更高**，只有更高时才换。如果新出现的 lane 优先级不比正在渲染的高，就会继续用 wipLanes，不会无脑重开——这个容错窗口避免了"任何风吹草动都推倒重做"导致渲染永远无法完成。
</details>

<details>
<summary><b>Q4</b>：如果高优先级更新反复出现，低优先级更新会不会永远等不到处理？</summary>

不会。每个 lane 从第一次挂号（`scheduleTaskForRootDuringMicrotask`）开始就带一个不受打断影响的"过期时间戳"（`computeExpirationTime`：紧急类lane 250ms，Default/Transition类 5000ms）。一旦过期，`performWorkOnRoot` 会放弃可打断的 `renderRootConcurrent`，改用 `renderRootSync`——它的 `workLoopSync` 循环里没有 `shouldYield` 检查，会强制一口气跑完并立刻提交，不管中途有没有更高优先级插队。"打断"保证响应速度，"过期"保证不会无限延迟。
</details>

<details>
<summary><b>Q5</b>：一个组件树很大、没有加memo，即使触发的是SyncLane的高优先级更新，这次渲染会不会卡顿？为什么？</summary>

会卡顿。高优先级只保证"排队顺序靠前"（能插队到最前面处理），不保证"这次渲染本身耗时归零"。没有 memo 时，只要父组件重渲染，子组件函数体就会被无条件重新调用（bailout的前提是有memo且props没变）。SyncLane走的`renderRootSync`是同步不可打断的，会强制跑完整棵树的计算——所以即使是高优先级，只要牵连的组件树计算量大，依然会真实卡顿。
</details>

<details>
<summary><b>Q6</b>：点击一个高优先级按钮触发setUrgent，另一个state（setTag）是在startTransition里更新的、还没提交完成。这次高优先级渲染会不会顺便把tag的新值也应用出来？</summary>

不会。`useState` 内部的更新队列按 lane 逐条过滤（`updateReducerImpl`：`(renderLanes & updateLane) === updateLane` 才应用，否则跳过留着等自己的批次）。setTag挂的是TransitionLane，这次高优先级渲染的renderLanes只有SyncLane，不包含TransitionLane，所以tag这个state会跳过这次待处理的更新，继续显示上一次已提交的旧值——这不是bug，是lane过滤机制的正常表现。
</details>

<details>
<summary><b>Q7</b>：entangleTransitions/entangleTransitionUpdate 到底解决什么问题？（这是一个曾经被误解的点，注意区分）</summary>

**不是**"同一个 `startTransition` 回调里多个不同 state 的 setState 保持一起提交"——那个场景靠更基础的机制天然保证（`currentEventTransitionLane` 全局缓存，同一事件回调内多次setState会复用同一个lane号，压根不需要"捆绑"）。

**真正解决的是**：**同一个 state**（同一个 `useState`/`useReducer` 的 queue）被**两次独立的事件**（隔着一次事件循环，各自领到不同的transition lane编号）先后触发更新时，防止调度系统把这两次更新拆开处理导致应用顺序错乱。`entangleTransitionUpdate` 操作的是单个`queue.lanes`，把新旧lane捆绑记到`root.entangledLanes`，保证`getNextLanes`选中其中一个时必须把另一个也一起拉进同一批处理。
</details>

<details>
<summary><b>Q8</b>：为什么React选择"整棵wip树重新计算"而不是"只复用没有依赖变化的子树"？</summary>

理论上可以设计成"复用没变化的子树"，但React选择了简单直接的策略——判断"哪部分可以复用"本身的复杂度和潜在bug风险，可能比直接重新计算更高，尤其在渲染函数要求保持"纯"的前提下，重新计算的代价被认为是可接受的工程权衡。
</details>

<details>
<summary><b>Q9</b>：Day19讲的"过期任务饿死兜底"和Day21讲的"渲染模式切换成同步不可打断"是同一个机制吗？</summary>

不是同一个粒度，但是同一个"过期"思想在两个层面的体现。Day19讲的是**Scheduler任务队列层面**——同一批任务内部要不要让出主线程（`shouldYieldToHost`层面的过期检测）。Day21讲的是**React渲染调度层面**——这一批lane要不要允许被下一批更高优先级抢占（`performWorkOnRoot`选择`renderRootConcurrent`还是`renderRootSync`）。两者独立存在，但设计动机一致：都是防止"该处理的任务被无限期推迟"。
</details>

<details>
<summary><b>Q10</b>：如果你要用React DevTools观察打断发生的证据，应该看什么？为什么"看不到半截的渲染"？</summary>

因为被丢弃的那次渲染从未成功commit，Profiler只记录真正提交成功的commit。能观察到的证据是：**本该一次commit的低优先级更新，被拆成"先出现一次极快的高优先级commit，之后才单独出现低优先级的commit"**，两次commit之间的时间差就是打断造成的延迟。（实测中发现Profiler面板阅读门槛较高，也可以改用`useEffect`打印commit序号+时间戳的Console方案，更直观地看commit完成顺序。）
</details>
