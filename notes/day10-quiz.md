# Day 10 自测（答案折叠，先自己答）

> 主题：Lane 优先级模型 + 并发渲染。源码以 facebook/react `main` 为准。

## Q1
Lane 为什么用"位掩码"而不是"一个数字比大小"？位掩码多出来的能力具体是什么？

<details><summary>答案</summary>

数字只能比大小，做不到集合运算、也表达不了"一批更新"。位掩码（31 位）能 O(1) 做：合并（`a|b` mergeLanes）、求交集（`a&b` includesSomeLane）、子集判断（`(s&b)===b` isSubsetOfLanes）、差集（`s&~b` removeLanes），还能用多位 OR 表示"这几个更新属于同一批"。
</details>

## Q2
`SyncLane=2`、`DefaultLane=32`，哪个优先级高？`getHighestPriorityLane` 用 `lanes & -lanes` 为什么能取到最高优先级？

<details><summary>答案</summary>

SyncLane(2，即 0b10) 优先级**更高**——bit 越靠右（值越小）优先级越高。`lanes & -lanes` 是经典"取最低位 1"技巧：`-lanes` 是补码（按位取反+1），与原值相与只剩最低的那个 1，正好对应最靠右=最高优先级的车道。
</details>

## Q3
`isSubsetOfLanes(0b110, 0b010)` 结果是什么？签名两个参数分别代表什么？它在 updateReducer 里判断什么？

<details><summary>答案</summary>

结果 `true`。签名 `isSubsetOfLanes(set, subset)`，`(set & subset) === subset`——判断**第二个参数 subset 是不是第一个参数 set 的子集**。这里 0b010 是 0b110 的子集 → true。

在 `updateReducer`（Hooks L1378-1379）里：`isSubsetOfLanes(renderLanes, update.lane)` 判断**这条 update 的 lane 是否被本趟 renderLanes 完全覆盖**——是才执行，否则跳过、攒到下趟（低优先级 update 被保留的核心机制）。
</details>

## Q4
一次 setState 的 lane 是"提前存好的"还是"触发时算的"？`requestUpdateLane` 的判断顺序是什么？

<details><summary>答案</summary>

是**触发时当场算的**（`requestUpdateLane` WorkLoop L810）。短路顺序：① legacy 模式→恒 SyncLane；② render 阶段内 setState→pickArbitraryLane 借当前 wip；③ 在 startTransition 里→requestTransitionLane 领 TransitionLane；④ 默认→eventPriorityToLane(当前事件优先级)。输入只有渲染模式/是否transition/事件类型三项。
</details>

## Q5
`fiber.lanes` 和 `fiber.childLanes` 有什么区别？为什么 beginWork 能靠它整棵子树跳过（bailout）？

<details><summary>答案</summary>

- `fiber.lanes`：**本节点自己**欠的待处理 update。
- `fiber.childLanes`：**后代子树**欠的（setState 冒泡时沿 return 链累加汇总，自己不一定有）。

beginWork 用 `includesSomeLane(renderLanes, fiber.childLanes)`：若 `childLanes` 与本趟 renderLanes 没交集（子树里没活），整棵 bailout 跳过不往下 reconcile。这是性能关键。两字段在 FiberNode 构造时(L174-175)就初始化为 NoLanes。
</details>

## Q6
`startTransition(() => setX(v))` 是怎么让这次 setState 变低优先级的？回调是同步还是异步？

<details><summary>答案</summary>

startTransition **同步执行**回调，执行期间设置一个**全局 transition 上下文**。回调里 setX 走 requestUpdateLane 时检测到 `transition !== null` → 领一条 TransitionLane，这条 lane 标在 **update 对象（update.lane）** 上。

注意：不是"在 fiber 上打标"，也不是异步。低优先级体现在**调度/渲染阶段**（getNextLanes 排在 Sync 后、渲染可被打断丢弃），不是 commit 时跳过。
</details>

## Q7
`workLoopSync` 和 `workLoopConcurrent` 唯一的区别是什么？分别由什么 lane 触发？

<details><summary>答案</summary>

唯一区别是循环条件多了 `&& !shouldYield()`——并发版每处理完一个 Fiber 就问"该让出主线程吗（时间片到/有更高优先级）"。SyncLane（点击等离散事件）走 workLoopSync 不可中断；TransitionLane/DefaultLane（并发特性下）走 workLoopConcurrent 可中断。
</details>

## Q8
并发渲染中，低优先级 wIP 树渲染到一半被高优先级插队，这棵半成品树怎么处理？为什么用户看不到残缺画面？

<details><summary>答案</summary>

**整棵丢弃、从头重做**（不是暂停续跑）。流程：当前 render 中断 → 未完成 wIP 直接丢弃（不 commit）→ 先同步做完高优先级并 commit → 低优先级用新的 renderLanes 从头再走一遍。

用户看不到残缺是因为 reconcile 阶段只在内存里改 wIP 树，屏幕上始终是 current 树对应的 DOM；wIP 没 commit 就丢弃，current 毫发无损。
</details>

## Q9
`useTransition` 和 `useDeferredValue` 都能"降级为低优先级"，什么场景用哪个？

<details><summary>答案</summary>

- `useTransition`：你能改到 setState 的地方，主动把 setState 包进 startTransition。
- `useDeferredValue`：值来自 props / 第三方，你**改不到它的 setState**，只能拿到值——给值做"延迟版本"。

底层都是把更新标成 TransitionLane。一句话：**包"动作"用 transition，包"值"用 deferredValue。**
</details>

## Q10
`mergeLanes` / `getHighestPriorityLane` / `includesSomeLane` / `isSubsetOfLanes` / `removeLanes` 各自的位运算和典型调用阶段？

<details><summary>答案</summary>

| 函数 | 位运算 | 典型阶段 |
|---|---|---|
| mergeLanes | `a\|b` | 更新冒泡标记 / completeWork 汇总 childLanes |
| getHighestPriorityLane | `l & -l` | getNextLanes 选批次 |
| includesSomeLane | `(a&b)!==0` | beginWork 判断子树要不要重渲 |
| isSubsetOfLanes | `(s&b)===b` | updateReducer 判断 update 跑不跑 |
| removeLanes | `s & ~b` | commit 后/ping 时清账 |
</details>
