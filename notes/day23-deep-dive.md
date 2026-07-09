# Day 23 深度讲解 — 错题/模糊题的面试级答案

> 配套 `notes/day23-gap-list.md`。gap-list 是"回哪节 + 一句话正确版"的速查；本文件是**面试时能完整讲出来、扛得住追问**的深度版本。
> 每题结构：**面试怎么问 → 完整回答（分层）→ 可能的追问 & 怎么接**。
> 源码全部核实自 react-dom@19.1.0 打包产物（`/tmp/rdcd.js`），标了函数名和行为，不是凭印象。

---

## 补充问题：整棵树统一 commit，还是每个 fiber complete 完就 commit？

**结论：整棵 wip 树的所有 fiber 都 completeWork 完之后，才一次性 commit。不是边 complete 边 commit。**

### 源码链路（能背出这条链就稳了）

render 阶段的主循环是 `workLoopConcurrent` / `workLoopSync`：

```js
function workLoopSync() {
  for (; null !== workInProgress; ) performUnitOfWork(workInProgress);
}
```

`performUnitOfWork` 对单个 fiber 先 `beginWork`（下钻），没有子节点了就进 `completeUnitOfWork`：

```js
function completeUnitOfWork(unitOfWork) {
  var completedWork = unitOfWork;
  do {
    // ... 调 completeWork(current, completedWork, ...) 处理当前节点
    completedWork = completedWork.sibling;
    if (null !== completedWork) { workInProgress = completedWork; return; } // 有兄弟→去做兄弟
    workInProgress = completedWork = unitOfWork.return;                     // 没兄弟→回溯到父
  } while (null !== completedWork);
  // 一直回溯到 root，completedWork 变 null，循环退出
  workInProgressRootExitStatus = RootCompleted;  // ★ 标记"整棵树完成"
}
```

关键：`completeUnitOfWork` 只是**在树里往上爬**（处理完自己→找兄弟→找不到就回父），它**从不调用 commit**。只有当 `workInProgress` 最终变成 `null`（回溯到 root 之上），说明整棵树 complete 完了，才把 root 的退出状态标成 `RootCompleted`。

然后回到调度入口 `performWorkOnRoot`，render loop 完全退出后才判断：

```js
switch (exitStatus) {
  case RootCompleted:
    commitRoot(root, finishedWork, lanes, ...);  // ★ 这里才 commit，且是整棵树一次
}
```

### 为什么必须这样设计（面试深挖点）

1. **subtreeFlags 冒泡需要完整**：commit 阶段靠 `subtreeFlags` 做剪枝（从根只走"有副作用"的路径，O(log n)）。而 `subtreeFlags` 是在 completeWork 的 `bubbleProperties` 里自底向上合并的——**必须整棵树 complete 完，root 的 subtreeFlags 才是完整的**。没 complete 完就 commit，剪枝信息是残缺的。

2. **render 可打断，commit 不可打断**：render 阶段（beginWork/completeWork）在内存里操作 wip 树，随时可以被高优先级打断丢弃重来（Day21）。如果"complete 一个就 commit 一个"，就等于把"改真实 DOM"这个不可逆动作散落在可打断的过程里——一旦打断，用户会看到改了一半的界面（撕裂）。React 的设计哲学就是：**思考阶段（render）允许反复重来，所以做成可打断；动手阶段（commit）会被用户看到，所以必须一次性同步跑完。**

3. **一致性**：commit 里 `root.current = finishedWork` 这个指针切换是"新旧两棵树的原子交接"。只有整棵新树都准备好了，才能一次性切过去，中间态对用户不可见。

**一句话面试版**："render 阶段深度遍历整棵 wip 树，每个 fiber 做 beginWork 下钻、completeWork 回溯，直到 workInProgress 回到 null——这时整棵树才算 complete。然后调度器检查退出状态是 RootCompleted，才调 commitRoot 对整棵树一次性提交。绝不会边 complete 边 commit，因为 commit 要改真实 DOM 不可打断，而且要等 subtreeFlags 冒泡完整才能剪枝。"

---

## Q3（Day5）commit 三个子阶段 —— 你答错成了 render 阶段

### 面试怎么问
"React 的 commit 阶段分几步？每步干什么？`root.current` 什么时候切换？"

### 你的错误
你把 `beginWork`/`completeWork` 说成了 commit 的子阶段。**这是两个完全不同的大阶段**：
- **render 阶段** = beginWork（下钻构建）+ completeWork（回溯 diff/建 DOM/冒泡 flags）——可打断
- **commit 阶段** = Before Mutation / Mutation / Layout 三个子阶段——不可打断

记这个分界：**render 阶段结束的标志是 wip 树 complete 完；commit 阶段才开始操作真实 DOM。**

### 完整回答（commit 三子阶段）

已核实源码 `commitRoot` 内部依次调用三个函数：`commitBeforeMutationEffects` → `commitMutationEffectsOnFiber` → （切 current）→ `flushLayoutEffects`。

| 子阶段 | 源码函数 | 做什么 |
|---|---|---|
| **① Before Mutation** | `commitBeforeMutationEffects` | 类组件调 `getSnapshotBeforeUpdate`（读取变更前的 DOM 状态，如滚动位置）；异步调度 useEffect（用 MessageChannel 宏任务，保证 paint 后才跑） |
| **② Mutation** | `commitMutationEffectsOnFiber` | 按 flags 真正改 DOM（Placement 插入 / Update 更新属性 / Deletion 删除）；卸载旧 ref；**跑上一次 useLayoutEffect 的 cleanup** |
| **（切换）** | `root.current = finishedWork` | 在 Mutation 结束后、Layout 开始前切换 |
| **③ Layout** | `flushLayoutEffects` | 同步跑 useLayoutEffect 的 create；类组件 componentDidMount/DidUpdate；绑定新 ref |
| **（paint 后异步）** | `flushPassiveEffects` | 浏览器绘制后，异步跑本次 useEffect 的 create（和上次的 cleanup） |

### `root.current` 为什么切在 Mutation 末尾（高频追问）

已核实源码：`root.current = finishedWork` 这行在 `commitMutationEffectsOnFiber` 执行**之后**、Layout 阶段**之前**（源码里紧跟在 mutation 的 `finally` 块后面，然后 `pendingEffectsStatus = PENDING_LAYOUT_PHASE`）。

为什么不能放最前面：
- `root.current` 指向"当前屏幕上显示的是哪棵树"。
- 如果一开始就切到 wip，但此时 Mutation 还没改 DOM——`current` 指针和真实 DOM 就不一致了，中途要是出错根本没法回滚。
- 放在 Mutation 末尾：此时 DOM 已经全部改完，是一致状态，切过去正好；而且 Layout 阶段里 componentDidMount/useLayoutEffect/ref 读取的都是"新树"的信息，这时 current 已经指新树，读到的才对。

**面试记忆点**：**"Mutation 改完 DOM，current 才切；切完再跑 Layout"** —— DOM、指针、生命周期回调三者顺序严格对齐。

---

## Q8（Day10）isSubsetOfLanes —— 你答成了"父子 fiber 关系"

### 面试怎么问
"`isSubsetOfLanes` 判断什么？在哪里用？"

### 你的错误
你说"a是父组件lanes，b是子组件lanes，判断b是否是a的子集"。**跟父子 fiber 完全没关系**——你可能是跟 `fiber.lanes` vs `fiber.childLanes`（那个才是父子/子树关系）搞混了。

### 完整回答

签名 `isSubsetOfLanes(set, subset)`，实现就一行位运算：

```js
function isSubsetOfLanes(set, subset) {
  return (set & subset) === subset;  // subset 的每一位都在 set 里 → subset 是 set 的子集
}
```

**它判断的是两个 lane 集合的子集关系，跟组件层级无关。** 最典型的调用在 `updateReducerImpl`（处理 useState/useReducer 更新队列时）：

```js
// 逐条检查更新队列里每个 update
if ((renderLanes & updateLane) === updateLane) {   // update.lane 是本次 renderLanes 的子集？
  // 是 → 这条 update 属于本次渲染批次 → 应用它，算进新 state
} else {
  // 否 → 这条 update 不属于本批次 → 跳过，原样留在 baseQueue 里等它自己的批次
}
```

- **第一个参数 = renderLanes**（本趟渲染要处理的批次，可能含多个 lane）
- **第二个参数 = update.lane**（某一条具体更新挂的 lane）
- **判断**：这条更新的 lane 是否被本趟渲染的批次"完全覆盖"。覆盖了才处理，没覆盖就跳过留到下次。

### 为什么这个机制重要（深挖）
这正是**"低优先级更新不会丢，只是被推迟"**的底层实现。比如你在 transition 里 setState（TransitionLane），紧接着一个高优先级点击触发 SyncLane 渲染——SyncLane 渲染的 renderLanes 里没有 TransitionLane，所以 `isSubsetOfLanes(SyncLane, TransitionLane)` 返回 false，那条 transition 更新被跳过、留在队列里，等轮到 TransitionLane 批次时才应用。（这就是 Day21 你观察到的"SlowItem 打印旧 tag 值"现象的根因。）

**面试记忆点**：**"isSubsetOfLanes 是批次 vs 单条更新的关系，不是父子组件的关系。判断这条 update 该不该被这次渲染处理。"**

---

## Q13（Day19）Scheduler 两套机制 —— 你的描述自相矛盾

### 面试怎么问
"Scheduler 内部有哪两套机制？`shouldYieldToHost` 属于哪一套？"

### 你的错误（这是最需要警惕的，因为自相矛盾会被面试官当场抓）
你说"一套回答是否超过5ms，一套回答是否有更高优先级，shouldYieldToHost 属于后者"。**第一句描述的'是否超过5ms'恰恰就是 shouldYieldToHost 本身**，但你又把它归到"更高优先级"那套——自己打自己。

### 完整回答（把两套机制彻底分开）

Scheduler 内部两套**互相独立**的机制：

| | 机制① 任务排序 | 机制② 时间片让出 |
|---|---|---|
| 回答的问题 | **谁先跑** | **跑多久该歇** |
| 数据结构/手段 | 最小堆（taskQueue），按 `expirationTime` 排序 | 计时器，`shouldYieldToHost` 判断是否够 5ms |
| 跟优先级的关系 | **直接相关**（优先级越高 expirationTime 越小，排堆顶） | **完全无关**（不管什么优先级，跑够 5ms 就该让） |
| 典型函数 | `push`/`pop` 最小堆、`advanceTimers` | `shouldYieldToHost` |

**`shouldYieldToHost` 属于机制②**——它只看"当前这个时间片（从任务开始算）有没有用满 5ms"，跟"有没有更高优先级任务在等"没有任何关系。

### 为什么容易搞混（讲清楚这个，面试官知道你真懂）
直觉上会觉得"让出主线程是为了让更高优先级任务插队"——但在 Scheduler 这一层，**让出和优先级是解耦的**：
- `shouldYieldToHost` 只负责"我跑够 5ms 了，礼貌性地把主线程还给浏览器"（让浏览器有机会处理绘制、输入）。
- 让出之后，**下一轮跑谁**才是机制①的事——重新从最小堆 peek 堆顶（最高优先级的那个）。
- 所以是"机制②先让出 → 机制①再决定下一个跑谁"，两步分工，不是一回事。

### 补一个高频追问：过期任务会不会被时间片打断？
不会。`workLoop` 的让出条件是 `currentTask.expirationTime > currentTime && shouldYieldToHost()`——**任务一旦过期，`&&` 左边为 false 直接短路，`shouldYieldToHost` 根本不被调用**，任务强制跑完。这是防止高优先级任务被时间片反复推迟"饿死"的兜底（认知纠正 #75）。

**面试记忆点**：**"机制①排序管'谁先跑'（跟优先级有关），机制②时间片管'跑多久'（跟优先级无关），shouldYieldToHost 是机制②。"**

---

## Q10（Day13）useActionState vs useReducer —— 你完全讲不出来

### 面试怎么问
"`useActionState` 和 `useReducer` 有什么本质区别？至少说 3 个维度。"

### 完整回答

先说定位：两者都是"根据上一个 state 算下一个 state"，但 `useActionState` 是 React 19 为**表单/异步提交**场景专门造的，内建了一大堆 useReducer 需要你手写的东西。

| 维度 | useReducer | useActionState |
|---|---|---|
| **同步/异步** | reducer 必须是纯同步函数，不能 await | action **可以是 async 函数**，内部会 await 它的返回/Promise |
| **loading 状态** | 要自己额外 `useState` 维护 isPending | **内建返回 isPending**（第三个返回值），自动 true→false |
| **错误处理** | reducer 里 throw 会直接崩，要自己 try-catch | action throw 会被自动捕获，转成 state（rejected），不崩 |
| **返回值** | `[state, dispatch]` | `[state, dispatchFn, isPending]` |
| **transition** | 无 | 自动把 action 包进 transition（低优先级，不阻塞输入） |
| **与表单集成** | 无 | dispatchFn 可直接传给 `<form action={fn}>`，自动收 FormData |

### 源码层面的证据（讲这个直接碾压）
已核实源码 `dispatchActionState` + `runActionStateAction`：

1. **action 队列串行执行**：多次 dispatch 的 action 会串成一个环形链表（`actionQueue.pending`），**一个跑完（Promise resolve）才跑下一个**（`onActionSuccess` 里递归调 `runActionStateAction` 跑 next）。这保证了并发提交不会乱序——useReducer 完全没有这个机制。

2. **isPending 的来源**：`dispatchActionState` 里有 `setPendingState(true)`，action 完成后再 setPendingState(false)。这个 pending 是 useActionState 内部自己管的一个 state hook，你拿到的 isPending 就是它。

3. **async + 自动 transition**：`runActionStateAction` 里，如果 `node.isTransition`，会把 `ReactSharedInternals.T` 设成一个 transition 上下文再执行 action——所以 action 里的 setState 天然是低优先级的。

4. **prevState 语义**：`runActionStateAction` 里 `prevState = actionQueue.state`，第一次是你传的 initialState，之后是上一个 action 的返回值——串行执行保证了 prevState 永远是"上一次的最终结果"。

**面试记忆点**：**"useReducer 是纯同步状态机；useActionState 是它的异步超集——内建 isPending、自动捕获错误转 state、action 队列串行执行、自动包 transition、直接对接 form。本质是把'异步表单提交'这个高频模式的样板代码全内建了。"**

---

## Q1（Day3）Diff 三个假设 —— 答对内容但漏了"牺牲了什么"

### 面试怎么问
"React 怎么把树 diff 从 O(n³) 降到 O(n)？靠哪几个假设？**每个假设的代价是什么**？"

### 你的问题
三个假设内容都点到了，但表述糊，而且**完全没答"牺牲了什么"**——这半个问题恰恰是考点（说明你理解这是"用假设换性能"的权衡，不是天上掉下来的）。

### 完整回答

通用树 diff 是 O(n³)（要对比两棵树所有节点的所有可能配对 + 求最小编辑距离）。React 用三个假设砍到 O(n)：

| # | 假设 | 换来的优化 | **牺牲（代价）** |
|---|---|---|---|
| 1 | **type 不同就直接重建**，不递归比较子树 | 不用对比"不同类型节点"的内部结构 | 极少数情况下会多创建/销毁 DOM（比如 div 换 span 其实内部结构一样，但也会整个重建） |
| 2 | **只在同层比较**，不做跨层级移动 | 把跨层匹配的 O(n²) 干掉 | 如果你真的把一个节点从一层移到另一层，React 会当成"旧的删除+新的创建"，**组件 state 会丢** |
| 3 | **同层用 key 标识身份** | 列表 reorder 时能 O(n) 复用而不是逐个重建 | 要求开发者**写稳定且唯一的 key**（用 index 当 key 会导致身份错乱——正确性 bug） |

复杂度跃迁：O(n³) --假设1--> O(n²) --假设2--> O(n) --假设3--> O(n) 但常数更小（列表复用高效）。

### 追问：为什么 key=index 是"正确性问题"不是"性能问题"
性能问题 = 慢但结果对；正确性问题 = 结果错。key=index 时，列表头部插入一个新元素，所有元素的 index 后移，React 按 index 匹配会把"语义上不同的节点当成同一个"复用——非受控 input 的值、focus、组件内部 state 会跟错行。这是**数据跟错对象**，属于 bug。

**面试记忆点**：**"三个假设 = 三次'用极端情况的正确性换普遍情况的性能'的工程权衡：type不同重建（换递归成本）/ 只同层比（换跨层移动能力）/ key标身份（换开发者写稳定key的义务）。"**

---

## Q2（Day4）"父 memo 了子还渲染" —— 你答成了 props 引用问题

### 面试怎么问
"父组件 bailout 了（memo 命中），子组件一定不渲染吗？为什么？"

### 你的错误
你说"如果子组件props引用不一致，子还是会渲染"——这说的是**另一个话题**（memo 失效场景：父传给子的 props 引用变了）。这题问的是**父都 bailout 了，子凭什么还能渲染**。

### 完整回答

bailout（跳过渲染）不代表整棵子树都跳过。beginWork 里 bailout 时会检查 `childLanes`：

- `fiber.lanes`：**本节点自己**有没有待处理的更新
- `fiber.childLanes`：**后代子树里**有没有待处理的更新（setState 时会沿 return 链冒泡累加到所有祖先的 childLanes）

bailout 的逻辑（`bailoutOnAlreadyFinishedWork`）：
```js
if (!includesSomeLane(renderLanes, fiber.childLanes)) {
  return null;  // 子树里也没活 → 整棵子树彻底跳过
}
// 否则：当前 fiber 自己 bailout，但 cloneChildFibers 后继续处理子树
cloneChildFibers(current, workInProgress);
return workInProgress.child;
```

**所以"父 memo 了子还能渲染"的真正原因**：子组件**自己调了 setState**，这个更新冒泡时把 `childLanes` 标到了父身上。父虽然自己 bailout（props 没变），但发现 `childLanes` 命中本次 renderLanes，就会 clone 子 fiber 继续往下走，让那个真正有更新的子组件重新渲染。

**跟"父传给子的 props 引用"没有关系**——父都 bailout 了，说明父没重新执行，压根没有"给子传新 props"这回事。是子自己内部的 state 变了。

**面试记忆点**：**"父 bailout 后看 childLanes：子树没活就整棵跳过，子树有活（子自己 setState）就 clone 子 fiber 继续下钻。父 memo 挡的是'父传下来的 props 变化'，挡不住'子自己的 setState'。"**

---

## Q4（Day6）setN 被调用后 —— 你讲了渲染流程，没讲 Hook 内部机制

### 面试怎么问
"`setN(x)` 被调用时发生了什么？state 立即变吗？"

### 你的问题
你讲的是"批处理 + render 打断 + commit"（这些对，但属于 Day10/21 的宏观流程），**没讲到这题真正的考点：setState 在 Hook 内部到底做了什么**。

### 完整回答（聚焦 Hook 内部）

`setN` 实际是 `dispatchSetState.bind(null, fiber, queue)`，调用时做两件事：

1. **创建 update 对象，入队**：
```js
var update = {
  lane: requestUpdateLane(fiber),  // 当场算这次更新的优先级 lane
  action: x,                        // 你传的值或函数
  hasEagerState: false,
  eagerState: null,
  next: null,
};
// 塞进 hook.queue.pending —— 这是个环形链表
enqueueConcurrentHookUpdate(fiber, queue, update, lane);
```

2. **调度重渲染**：`scheduleUpdateOnFiber(root, fiber, lane)`——注意这里只是"安排"一次渲染，不是立即渲染。

**state 不立即变**。真正的新 state 是在**下次 render** 时，`updateReducer`/`updateReducerImpl` 从 `baseState` 出发，把 queue 里所有 update 按顺序 reduce 出来的：

```js
// 下次 render 时
do {
  var action = update.action;
  newState = typeof action === 'function' ? action(newState) : action;
  update = update.next;
} while (update !== null);
```

### 两个高频追问

**追问A：`setN(n+1)` 三次和 `setN(x=>x+1)` 三次结果为什么不同？**
- `setN(n+1)`：三个 update 的 action 都是**值**，且 n 是这次 render 闭包锁定的旧值（比如 0），reduce 时 `0→1→1→1`，互相覆盖，结果 1。
- `setN(x=>x+1)`：三个 action 是**函数**，reduce 时每次拿上一步的结果当参数 `0→1→2→3`，结果 3。

**追问B：为什么 setN 之后立刻 console.log(n) 还是旧值？**
因为 n 是这次 render 的闭包变量，被锁定了。setN 只是入队+调度，不会回头改当前作用域的 n。新的 n 只在下次 render 重新执行函数体时，通过 `updateReducer` 算出来赋值。

**面试记忆点**：**"setN = 创建 update 入队（hook.queue.pending 环形链表）+ scheduleUpdateOnFiber 调度。state 不立即变，下次 render 时 updateReducer 从 baseState reduce 整个队列才算出新值。值式更新会互相覆盖，函数式更新会链式累加。"**

---

## Q6（Day8）useMemo 缓存的是什么 —— "变量地址引用"表述不准

### 面试怎么问
"useMemo 和 useCallback 的关系？useCallback 单独用有意义吗？"

### 你的小问题
"一个是将函数引用缓存，一个是将变量地址引用"——后半句不准。useMemo 缓存的是 `factory()` **执行后的返回值**，这个值可以是任意类型（数字、对象、数组、甚至函数），不是笼统的"变量地址"。

### 完整回答

两者底层是同一套逻辑，`memoizedState` 都存 `[value, deps]`，唯一区别在存什么：

```js
// useMemo：存 factory 执行后的结果
const nextValue = nextCreate();
hook.memoizedState = [nextValue, deps];

// useCallback：存 callback 函数本身（不执行）
hook.memoizedState = [callback, deps];
```

所以等价关系：`useCallback(fn, deps) ≡ useMemo(() => fn, deps)`。

deps 比较用 `areHookInputsEqual`，`Object.is` 逐项比较——任一项引用变了就重新计算/重新缓存。

### useCallback 单独用（不配 React.memo）有没有意义
基本没有。useCallback 的唯一价值是**让传给子组件的函数引用保持稳定**，从而让子组件的 `React.memo` 浅比较命中、子组件 bailout。如果子组件没包 memo，你传的函数引用稳不稳定它都照样重渲染——这时 useCallback 不但没用，反而多了一次 deps 比较 + 一个 hook 对象的开销，净亏。

**面试记忆点**：**"useMemo 存 factory 的返回值，useCallback 存函数本身，底层同一套 [value, deps] + Object.is 比较。useCallback 单独用没意义，必须配 React.memo 才能让子组件 bailout。"**

---

## Q7（Day9）Context 穿透 memo —— 缺了 mergeLanes 破坏 bailout 这一步

### 面试怎么问
"Context value 变了，React 怎么找到消费者并让它们更新？为什么能穿透 React.memo？"

### 你的问题
你说"遍历找到订阅自己的组件就触发重渲染"——大方向对，但**缺了最关键的机制细节**："怎么触发"。不是"找到就直接 rerender"，是通过改 lanes 破坏 bailout。

### 完整回答（两段）

**第一段：怎么记录消费者。**
组件调 `useContext(Ctx)` 时，`readContext` 把这个依赖记到 `fiber.dependencies.firstContext` 链表上（不是 memoizedState，那是 hook 链表）。

**第二段：value 变了怎么找 + 怎么强制更新。**
Provider 的 value 引用变化时，`propagateContextChanges` 做的事：
```js
// DFS 遍历 Provider 下的所有子 fiber
// 对每个 fiber，检查它的 dependencies.firstContext 链表
if (dependency.context === changedContext) {  // 引用比较，匹配上了
  // ★ 关键：改这个消费者 fiber 的 lanes
  fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
  fiber.alternate && (fiber.alternate.lanes = mergeLanes(...));
  // 还要沿 return 链把 childLanes 冒泡上去，保证父路径不被 bailout 剪掉
}
```

**穿透 memo 的真正原因**：beginWork 的 bailout 判断里有一步 `checkScheduledUpdateOrContext`——它检查 `fiber.lanes` 是否命中 renderLanes。`propagateContextChanges` 把消费者的 lanes 改了（非空且命中），**bailout 条件被破坏**，即使 memo 的 props 浅比较通过，也得走完整渲染。

**不是 memo 主动放行，是 bailout 的前置条件（lanes 为空）被 propagateContextChanges 打破了。**

**面试记忆点**：**"readContext 把依赖记到 fiber.dependencies；value 变了 propagateContextChanges 做 DFS，对匹配的消费者用 mergeLanes 改 lanes、冒泡 childLanes；改了 lanes 就破坏了 bailout 的前置条件，所以能穿透 memo。核心是'改 lanes'，不是'直接 rerender'。"**

---

## Q11（Day14）memo 比较函数返回 true 的语义 + 和 filter 的反直觉对比

### 面试怎么问
"`React.memo(Comp, (prev, next) => ...)` 的比较函数返回 true 表示什么？和 Array.filter 有什么反直觉的地方？"

### 你的问题
你说"返回true表示新旧props引用都一样，返回的是地址不一样的组件"——绕，而且没直接命中核心结论。

### 完整回答

**返回 true = 你告诉 React"这两次 props 等价" = 跳过渲染（bailout）。**
**返回 false = "props 变了" = 重新渲染。**

反直觉点在于和 `Array.filter` **语义相反**：

| | 返回 true 的含义 |
|---|---|
| `Array.filter(fn)` | **保留**该元素（true = 留下） |
| `React.memo(C, fn)` | **跳过**渲染（true = 不更新，即"什么都不做"） |

很多人凭 filter 的直觉以为"memo 返回 true = 触发点什么"，其实相反——memo 返回 true 是"**啥也别干，用上次的**"。

记忆技巧：memo 的第二个参数官方叫 `arePropsEqual`——"props 相等吗？相等（true）就不用重渲染"，从函数名理解就不会反。

默认情况（不传第二个参数）React 用浅比较：先 `Object.is(prevProps, nextProps)`，再逐 key `Object.is`。注意浅比较对嵌套对象无能为力（`{a:{b:1}}` 每次新建引用都不等）。

**面试记忆点**：**"memo 比较函数 arePropsEqual 返回 true = props 等价 = 跳过渲染，和 filter 的 true=保留刚好相反。从函数名'props 相等吗'理解就不会记反。"**

---

## Q12（Day15）Zustand 的 store 存在哪 —— "react组件全局"表述不准

### 面试怎么问
"Zustand 为什么不需要 Provider？它的 store 存在哪里？"

### 你的问题
你说"存储在 react 组件全局"——这个表述会让人以为它跟 React 有绑定。实际上它**跟 React 完全无关**。

### 完整回答

对比 Redux 就清楚了：
- **Redux**：store 通过 React Context 往下传，所以必须用 `<Provider store={store}>` 包住组件树。
- **Zustand**：`create(fn)` 在**模块顶层**调用，返回的 `{ getState, setState, subscribe }` 存在**模块级闭包变量**里——就是个普通 JS 闭包，跟 React 的组件树、Context 没有任何关系。

因为 store 不在 React 体系内，所以：
1. 不需要 Provider（没有"往组件树下传"这回事，谁想用直接 import）。
2. 组件通过 `useSyncExternalStore(store.subscribe, () => selector(store.getState()))` 订阅——这个官方 Hook 就是专门用来把"React 之外的数据源"接进 React 渲染系统的桥。
3. store 甚至可以在 React 之外的普通 JS 代码里读写（`store.getState()`），组件只是它的订阅者之一。

**面试记忆点**：**"Zustand 的 store 是模块级闭包变量，跟 React 无关、不走 Context，所以不需要 Provider。组件靠 useSyncExternalStore 订阅它。这跟 Redux 用 Context 传 store 是根本区别。"**

---

## Q15（Day22）⚠️ 撕裂修复 —— 回归性错误：又说成了"丢弃重构建"

### 面试怎么问
"useSyncExternalStore 怎么解决渲染撕裂？"

### 你的错误（重点，因为已经纠正过一次）
你又说成了"重新对比新旧快照，如果不匹配直接丢弃重新构建"。**Day22 §八点五（认知纠正 #79）已经专门纠正过这个点**：不是"丢弃"，没有任何数据被丢弃。

### 为什么"丢弃"这个词是错的
`checkIfSnapshotChanged` 只是**比较**，它不销毁、不丢弃任何东西。真实的 state 从头到尾都好好地待在外部 store 里。所谓的"不一致"只是说"组件这次渲染时读到的快照，和 commit 后此刻 store 里的真实值对不上了"——发现这个不一致后，React 的动作是**让这个组件重新渲染一次，去读最新的值**，而不是"丢弃"什么。

### 完整回答（撕裂问题 + 解法）

**先说撕裂是什么**：并发渲染下，一次渲染可能被打断、分几段跑。如果手写 `useState + useEffect` 订阅：`getState()` 在 render 阶段读，但订阅要等 useEffect（commit 后）才建立。中间这段"读了但还没订阅上"的窗口期，如果外部 store 的值变了，同一次渲染里不同组件可能读到**不同版本**的数据——这就是撕裂（tearing）。

**useSyncExternalStore 的三层防护**（已核实源码 `mountSyncExternalStore`）：
```js
function mountSyncExternalStore(subscribe, getSnapshot) {
  var nextSnapshot = getSnapshot();          // ① render 阶段直接同步读一次（首屏就拿到最新值）
  hook.memoizedState = nextSnapshot;
  mountEffect(subscribeToStore.bind(...));   // ② useEffect 里才真正订阅
  pushSimpleEffect(updateStoreInstance...);  // ③ 额外挂一个"提交后检查"的 effect
  return nextSnapshot;
}
```

关键是第③步——**每次 commit 完成后**：
```js
function checkIfSnapshotChanged(inst) {
  var nextValue = inst.getSnapshot();
  return !Object.is(inst.value, nextValue);   // 比较：commit 时记的快照 vs 现在读到的
}
function forceStoreRerender(fiber) {
  var root = enqueueConcurrentRenderForLane(fiber, 2);  // 2 = SyncLane
  scheduleUpdateOnFiber(root, fiber, 2);                 // 用最高优先级强制重渲染
}
```

commit 后重新读一次快照跟渲染时的比，**如果不一致，就用 SyncLane 强制这个组件重新渲染一遍去读最新值**。这样即使中间有并发渲染钻了空子，commit 后也会立刻纠正。代价是：外部 store 的更新总是被当作最高优先级（SyncLane）处理。

### 一句话把"丢弃"和"重渲染"的区别钉死
- ❌ 错误说法："发现不一致就**丢弃**（数据/渲染结果）重新构建"
- ✅ 正确说法："发现不一致就**触发组件重新渲染去读最新值**，数据一直在 store 里没动过"

**下次开口前的自检**：讲到这里先默念"数据没丢，是逼组件重新读"，再往下说。

**面试记忆点**：**"三层防护：render 阶段同步读快照 + useEffect 建订阅 + commit 后 checkIfSnapshotChanged 重新比对，不一致就 forceStoreRerender（SyncLane 强制重渲染去读新值）。全程没有丢弃任何数据，撕裂是'读到旧快照'，修复是'重新读'不是'丢弃'。"**

---

## 追问 A：Fiber 树的遍历用的是同一套算法吗？从上而下是 DFS 吗？哪些操作会遍历树？

### 面试怎么问
"React 里对 Fiber 树的遍历是一套算法吗？render 的遍历是深度优先吗？除了 render，还有哪些操作会遍历树？"

### 先给结论
- **主干遍历（render 阶段的 workLoop）是深度优先（DFS），而且是"可中断的手写 DFS"**——不用递归、不用栈数据结构，靠 fiber 节点上的 `child / sibling / return` 三个指针手动实现。
- **但不是"所有遍历都用同一套"**——React 里存在**好几种不同目的的遍历**，它们共享"child/sibling/return 三指针 + DFS"这个大骨架，但**剪枝规则和触发时机各不相同**。

### 一、为什么是"手写 DFS"而不是递归

普通树的 DFS 一般写成递归（`traverse(child)`）。React 不能这么干——递归一旦开始就必须一口气跑到底，**没法在中间暂停**（Day21 讲的可打断渲染就废了）。所以 React 把递归拆成了"用指针的循环"：

```js
function performUnitOfWork(fiber) {
  var next = beginWork(fiber);      // 处理当前节点，返回第一个子节点
  if (next === null) {
    completeUnitOfWork(fiber);       // 没有子节点了 → 回溯
  } else {
    workInProgress = next;           // 有子节点 → 下钻
  }
}
```

遍历顺序完全由三个指针驱动：
```
优先走 child（往下钻，深度优先）
  → 没有 child 了，走 sibling（处理兄弟）
    → 没有 sibling 了，走 return 回到父，再找父的 sibling
```

这就是标准 DFS 的"前序下钻 + 后序回溯"，只是用 `workInProgress` 这个全局指针一步步挪，**每挪一步都能停下来检查 `shouldYield()`**——这正是可中断的关键。

### 二、下钻（beginWork）和回溯（completeWork）是 DFS 的两个方向

同一趟 DFS，一个节点会被"经过两次"：
- **下钻时**：调 `beginWork`（对应 DFS 的"前序访问"）——构建/diff 子节点、打自己的 flags。
- **回溯时**：调 `completeWork`（对应 DFS 的"后序访问"）——创建 DOM、`bubbleProperties` 把子树的 subtreeFlags 冒泡上来。

为什么 completeWork 必须在回溯（后序）做：因为它要"汇总所有子节点的信息"（subtreeFlags、DOM 挂载），必须等子节点全处理完才能做——这是后序遍历的天然用途。

### 三、React 里到底有几种遍历（回答"哪些操作会遍历树"）

| 遍历 | 时机 | 骨架 | 剪枝规则（关键区别） |
|---|---|---|---|
| **① render 主循环** | render 阶段 | child/sibling/return DFS，可中断 | 靠 `childLanes`：子树没有命中 renderLanes 的更新就 bailout 跳过 |
| **② commit 三阶段遍历** | commit 阶段 | 同样 DFS，但**不可中断**（同步跑完） | 靠 `subtreeFlags`：子树 flags 为 0 就整棵跳过（O(log n) 剪枝） |
| **③ propagateContextChanges** | Context value 变化时（在 beginWork 里） | DFS 遍历 Provider 子树 | 靠匹配 `dependencies.firstContext`：找到消费了该 context 的 fiber 就标 lanes；`forcePropagateEntireTree` 决定要不要继续深入 |
| **④ 卸载时的 deletion 遍历** | commit mutation 阶段删除子树时 | DFS 深入被删子树 | 无剪枝——要跑完每个后代的 cleanup/componentWillUnmount/解绑 ref |

**共性**：都用 `child/sibling/return` 三指针 + DFS 大骨架（React 里没有别的树形结构，就这一套指针）。
**差异**：**剪枝依据不同**——render 看 childLanes，commit 看 subtreeFlags，context 看 dependencies 匹配，deletion 不剪枝。

### 一句话面试版
**"Fiber 树遍历统一是 child/sibling/return 三指针驱动的深度优先，render 阶段做成可中断的手写 DFS（不用递归以便随时 shouldYield 让出）。beginWork 是前序下钻、completeWork 是后序回溯。但'同一套骨架'下有多种遍历：render 靠 childLanes 剪枝、commit 靠 subtreeFlags 剪枝、Context 变化靠 dependencies 匹配遍历、卸载靠不剪枝的 deletion 遍历——骨架同，剪枝规则不同。"**

---

## 追问 B：React 什么时候 commit 一次？一次刷新会 commit 几次，能写代码前算准吗？

### 面试怎么问
"一次页面更新会触发几次 commit？能在写代码之前就确定 commit 次数吗？组件很复杂时呢？"

### 先给最核心的结论
**commit 次数不等于 setState 次数，也不能在写代码前"精确算出一个固定数字"——因为它取决于运行时这些更新被合并进了几个"批次（lane 批次）"，而合并规则依赖运行时上下文（是否在同一事件、优先级是否相同、是否被 Suspense/打断拆开）。但你可以按规则推出一个"大概率的次数"和"上界"。**

### 一、什么叫"commit 一次"
一次 commit = render 阶段跑出一棵完整的 wip 树（`RootCompleted`）→ `commitRoot` 把它一次性提交到真实 DOM。**一次 commit 对应"屏幕更新一帧的内容"**，不管这次 render 里改了 1 个组件还是 1000 个组件，都算**一次** commit。

### 二、决定 commit 次数的是"批次"，不是 setState 次数

关键机制是**自动批处理（Automatic Batching，React 18+）**：**同一个批次里的多次 setState，只会触发一次 render + 一次 commit。**

```jsx
function handleClick() {
  setA(1);   // ┐
  setB(2);   // ├─ 同一个事件回调里，同一优先级 → 合并成 1 个批次 → 1 次 commit
  setC(3);   // ┘
}
```

上面 3 次 setState → **1 次 commit**。这在写代码前就能确定，因为它们在同一个同步事件回调、同一优先级。

### 三、什么情况会拆成多次 commit（这就是"算不准"的来源）

| 场景 | commit 次数 | 为什么 |
|---|---|---|
| 同一事件里多次同优先级 setState | 1 次 | 自动批处理合并 |
| `flushSync(() => setX())` 包裹 | 强制多一次 | flushSync 跳出批处理，立即同步 commit |
| 不同优先级混合（如 SyncLane + TransitionLane） | ≥2 次 | 高优先级先单独 commit，低优先级后单独 commit（Day21 你实测过的现象） |
| `startTransition` 里的更新 | 可能被打断→丢弃重来 | 被打断的那次**不 commit**（丢弃的 wip 不算 commit），最终成功的才算 |
| Suspense 挂起 | ≥2 次 | 先 commit 一次 fallback，数据回来后再 commit 一次真实内容 |
| useEffect 里再 setState | 多一轮 | effect 在 commit 后异步跑，里面 setState 会触发**新一轮** render+commit |
| useLayoutEffect 里 setState | 多一次同步 commit | layout effect 在 paint 前同步跑，其 setState 会在 paint 前强制再 render+commit 一次 |

### 四、所以"能不能写代码前算准"——分情况

- **能确定的部分**：同一事件、同一优先级的 N 次 setState = 1 次 commit。这是可预测的。
- **算不准的部分**：一旦涉及**不同优先级、Suspense、被打断、effect 里再触发更新**，commit 次数取决于运行时（网络何时返回、有没有更高优先级插队、effect 链条多深），**无法在写代码前给出一个精确固定值**。
- **能给的是"上界估计"**：把"每个独立优先级批次 + 每个 Suspense 边界的 fallback/内容切换 + 每个会 setState 的 effect 轮次"加起来，是次数的上界。

### 五、组件复杂时，变的是"每次 commit 的耗时"，不是"commit 次数"

这是最容易搞反的点，必须讲清楚：
- **组件复杂/树很大 → 影响的是单次 render 的耗时**（要遍历、diff、completeWork 的节点多），以及单次 commit 的 DOM 操作量。
- **commit 的"次数"只由"批次怎么切"决定，跟组件多复杂无关**——1000 个组件的树,一次 setState 同样只 commit 一次(只是这一次更慢)。

换句话说:**复杂度决定"每次多慢",批次决定"commit 几次",两者正交。** 优化时也要分开:减次数靠合并批次/useTransition;减单次耗时靠 memo/虚拟列表/代码分割。

### 六、怎么实测验证（呼应 Day21 I2 的 Console 方案）
想知道真实 commit 次数,别数 setState,用 `useEffect(() => { console.log('commit', ++count, Date.now()) })`（effect 在每次 commit 后跑）或 React DevTools Profiler 的 commit 条形图,直接数真实提交了几次。

### 一句话面试版
**"commit 次数由'更新被合并进几个 lane 批次'决定,不等于 setState 次数——同一事件同优先级的多次 setState 自动批处理成 1 次 commit。能写代码前确定的只有这种同批次场景;一旦涉及不同优先级、Suspense、被打断、effect 里再 setState,次数取决于运行时,只能估上界。组件复杂度影响的是'单次 commit 多慢',不影响'commit 几次'——次数和耗时是正交的两件事。"**

---

## 收尾：这批题的共性

四道 ❌ 里，Q3/Q8/Q13 都是**把两个相邻概念的边界搞混了**（render vs commit / 父子lanes vs 批次lanes / 排序机制 vs 时间片机制）。Q15 是**已纠正过又回退**。面试时这类"边界模糊"最容易被追问戳穿，所以每题的"面试记忆点"都特意用一句话把边界钉死——背记忆点比背长篇更实用。

追问 A/B 补充的两个高频概念：**遍历（一套骨架、多种剪枝）** 和 **commit 次数（批次决定次数、复杂度决定耗时，两者正交）**——后者的"次数 vs 耗时正交"是面试高频陷阱，务必分清。
