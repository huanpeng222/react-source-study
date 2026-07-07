# Day20 — useTransition / useDeferredValue 源码级实现

> 📌 **主线位置**：衔接 Day19 Scheduler 结尾预告，对应原 `meta/roadmap.md` 的 **D14**。Day19 讲完了"任务怎么排队、怎么让出主线程"，今天讲**这套机制在 Hooks 层是怎么被 `useTransition`/`useDeferredValue` 包起来给你用的**——这两个 Hook 是 TransitionLane（Day10 讲过的概念）在用户 API 层面的两个入口。
>
> 日期：2026-07-07
> 主题：`useTransition`/`startTransition` 如何标记低优先级更新；`useDeferredValue` 如何"延迟"一个值；两者与 Lane 模型、Scheduler 的完整衔接链路
> 状态：📖 教程完成，待跟练
> 源码出处（**已通过下载 `react-dom@19.1.0` 的 `cjs/react-dom-client.development.js` 逐行核实**，非推断/非二手博客转述；此文件是打包产物，函数名保留但代码经过轻度压缩，本篇引用时保留原始变量名以便对照）：
> - `mountTransition` / `updateTransition` / `rerenderTransition`（约 L6812-6840）
> - `startTransition`（bound 函数本体，约 L6681-6737）
> - `mountDeferredValueImpl` / `updateDeferredValueImpl`（约 L6657-6680）
> - `requestUpdateLane` / `requestDeferredLane`（约 L14323-14343）
> - `getLabelForLane` / `getHighestPriorityLanes`（约 L601-668，用于核实 lane 位掩码含义）
> - ⚠️ 由于是压缩产物，行号为下载时的近似行号，跨版本会漂移；变量名如 `ReactSharedInternals.T`（对应老版本的 `ReactCurrentBatchConfig.transition`）已在正文标注新旧对照。

---

## 零、入场自测（先答，不会就写"不会"）

1. `useTransition` 返回的 `isPending` 是靠什么机制驱动更新的——是一个特殊的内部状态，还是普通的 `useState`？

2. `startTransition(callback)` 执行的时候，`callback()` 里面那些 `setState` 是"立刻变成低优先级"，还是"通过某个全局标记间接影响"？

3. `useDeferredValue(value)` 和普通的 `useState` + `useEffect` 做防抖有什么本质区别？（提示：想想它返回的到底是"新值"还是"旧值"）

4. 如果我在一个已经处于同步渲染（比如离散事件触发的紧急更新）中调用 `useDeferredValue`，它还会"延迟"吗？

---

## 一、先建立心智模型：这两个 Hook 解决的是两个不同问题

延续 Day19 的分工框架，先把 `useTransition` 和 `useDeferredValue` 也放进那张分工表里：

```
Lane 模型（Day10）    → 回答"这次更新有多急"
Scheduler（Day19）    → 回答"轮到你时能跑多久"
useTransition         → 回答"我主动把一批 setState 标记成不急"
useDeferredValue      → 回答"我想要一个值的低优先级快照"
```

**两者的本质区别**（这是最容易搞混的地方，先讲清楚）：

| | `useTransition` | `useDeferredValue` |
|---|---|---|
| 你控制什么 | 一段**代码**（callback 里的所有 setState） | 一个**值**（外部传入的 value） |
| 使用场景 | 你能改造触发更新的地方（有权限包一层 `startTransition`） | 你只能拿到别人传来的 value，改不了它的产生方式（比如父组件传的 props） |
| 返回值 | `[isPending, startTransition]` | 直接返回一个"可能滞后"的值 |
| 典型场景 | 切换 Tab、导航 | 搜索框输入实时过滤大列表 |

> 💡 一句话区分：**能改代码用 `useTransition`；只能改"读到的值"用 `useDeferredValue`。**

---

## 二、useTransition：先看 mount/update 的真实源码

### 2.1 mountTransition —— 首次渲染时发生了什么

```js
// 源码（react-dom-client.development.js，变量名已还原可读性）
function mountTransition() {
  var stateHook = mountStateImpl(false);   // ① 内部挂一个 useState(false)
  stateHook = startTransition.bind(        // ② 把 startTransition 函数预先 bind 好上下文
    null,
    currentlyRenderingFiber,               // 绑定当前 fiber
    stateHook.queue,                       // 绑定上面那个 state 的更新队列
    true,                                  // pendingState 参数：进入 transition 时设为 true
    false                                  // finishedState 参数：transition 结束后设为 false
  );
  mountWorkInProgressHook().memoizedState = stateHook;  // ③ 用另一个 hook 存这个绑定好的函数
  return [false, stateHook];               // ④ 返回 [isPending初始值, start函数]
}
```

> 📌 **回答入场自测 Q1**：`isPending` **就是一个普通的内部 `useState(false)`**，不是什么特殊状态。`mountTransition` 内部**挂了两个 hook**：第一个是 `mountStateImpl(false)`（存 isPending 的 state），第二个是存 `start` 这个绑定好的函数。`useTransition()` 表面上是一个 Hook，底层其实是"套了壳的两个 hook 拼出来的复合 Hook"。

**为什么要用 `.bind()` 把参数都预先绑好？** 因为 `start`（也就是你调用的 `startTransition`）不需要每次渲染都重新创建——`bind` 出来的函数引用是稳定的，存进 `hook.memoizedState` 后，之后每次 `updateTransition` 只需要把这个函数原样返回，不用重新生成。这也是为什么 `useTransition` 返回的 `startTransition` 函数你可以放进 `useEffect` 依赖数组而不用担心引用变化。

### 2.2 updateTransition —— 之后每次渲染怎么复用

```js
function updateTransition() {
  var booleanOrThenable = updateReducer(basicStateReducer)[0];  // 取出 isPending 的最新值
  var start = updateWorkInProgressHook().memoizedState;          // 取出之前存的 start 函数
  return [
    typeof booleanOrThenable === "boolean"
      ? booleanOrThenable
      : useThenable(booleanOrThenable),   // 如果不是布尔值，说明是个 thenable，要 unwrap
    start
  ];
}
```

**这里有个不太直观的细节**：`isPending` 的值不一定是布尔值，可能是一个 **thenable（类 Promise 对象）**——这是 React 19 引入 Actions（Day13 讲过的内容）之后新增的能力，当 `startTransition` 的 callback 是一个返回 Promise 的 async 函数时，`isPending` 需要等这个 Promise resolve 才能变回 `false`，中间状态用 thenable 来表达"还在等"，`useThenable` 负责把它 unwrap 成真正的布尔值（原理上和 Day11 讲的 `use(promise)` 是同一套机制）。

> 📌 **微检查点 1**：`rerenderTransition` 和 `updateTransition` 几乎一样，唯一区别是用 `rerenderReducer` 而不是 `updateReducer`。你还记得 Day6-9 讲 Hooks 时，什么场景下会走"rerender"这条分支吗？

### 2.3 startTransition 本体：真正的核心逻辑

```js
function startTransition(fiber, queue, pendingState, finishedState, callback) {
  // ① 提升事件优先级到 ContinuousEventPriority（保证 transition 本身的调度不会被无限拖延）
  var previousPriority = ReactDOMSharedInternals.p;
  ReactDOMSharedInternals.p =
    previousPriority !== 0 && previousPriority < ContinuousEventPriority
      ? previousPriority
      : ContinuousEventPriority;

  // ② 核心：设置全局 transition 标记
  var prevTransition = ReactSharedInternals.T;
  var currentTransition = {};
  ReactSharedInternals.T = currentTransition;   // ← 这一行是"标记进入 transition 环境"的关键

  // ③ 立刻触发一次同步的 state 更新：isPending = pendingState(true)
  dispatchOptimisticSetState(fiber, false, queue, pendingState);

  currentTransition._updatedFibers = new Set();
  try {
    // ④ 执行你传进来的 callback —— 这里面所有的 setState 都会检测到 ReactSharedInternals.T !== null
    var returnValue = callback();
    var onStartTransitionFinish = ReactSharedInternals.S;
    if (onStartTransitionFinish !== null) onStartTransitionFinish(currentTransition, returnValue);

    if (returnValue !== null && typeof returnValue === "object" && typeof returnValue.then === "function") {
      // callback 是 async 函数，返回了 Promise —— 等它 resolve 后才把 isPending 设回 false
      var thenableForFinishedState = chainThenableValue(returnValue, finishedState);
      dispatchSetStateInternal(fiber, queue, thenableForFinishedState, requestUpdateLane(fiber));
    } else {
      // 同步 callback —— 立即把 isPending 设回 false
      dispatchSetStateInternal(fiber, queue, finishedState, requestUpdateLane(fiber));
    }
  } catch (error) {
    // callback 抛错 —— isPending 状态存一个"rejected"的伪 thenable，交给上层处理
    dispatchSetStateInternal(fiber, queue, { then: function(){}, status: "rejected", reason: error }, requestUpdateLane(fiber));
  } finally {
    // ⑤ 恢复现场：优先级还原、transition 标记还原
    ReactDOMSharedInternals.p = previousPriority;
    ReactSharedInternals.T = prevTransition;
    // ⑥ 如果这是最外层的 transition（不是嵌套的），检查更新数量是否过多并警告
    if (prevTransition === null && currentTransition._updatedFibers) {
      var count = currentTransition._updatedFibers.size;
      currentTransition._updatedFibers.clear();
      if (count > 10) {
        console.warn("Detected a large number of updates inside startTransition...");
      }
    }
  }
}
```

> 📌 **回答入场自测 Q2**：`callback()` 里的 `setState` 不是"立刻变成低优先级"，是**间接**的——`startTransition` 先把全局的 `ReactSharedInternals.T` 设置成一个非 null 的对象，然后同步调用 `callback()`。`callback` 内部的每一次 `setState` 在触发时都会走到 `requestUpdateLane`，那个函数会去检查 `ReactSharedInternals.T` 是不是 null，不是 null 就走 transition 优先级分支。**这是一个"全局标记 + 执行期间检查"的模式，不是给每个 setState 单独打标签。**

**为什么 try/finally 里一定要还原 `ReactSharedInternals.T`？** 因为它是**全局共享变量**，如果 callback 执行完不还原，之后所有代码触发的更新都会被误判成"还在 transition 里"。这也解释了为什么 `startTransition` 的 callback **必须是同步执行完的**（哪怕内部是 async 函数，`ReactSharedInternals.T` 的设置/还原也是围绕这次同步调用栈的，异步部分靠单独的 thenable 链路续接，不依赖 T 一直保持设置状态）。

> ⚠️ **一个常见误区要提前防**：`ReactSharedInternals.T` 对应的就是老版本源码/文档/教程里常说的 `ReactCurrentBatchConfig.transition`——这是 React 内部字段重命名，语义完全一样，如果你看到的资料写的是后者，理解成同一个东西即可。

### 2.4 requestUpdateLane：全局标记怎么变成 TransitionLane

```js
function requestUpdateLane(fiber) {
  if ((executionContext & RenderContext) !== NoContext && workInProgressRootRenderLanes !== 0) {
    return workInProgressRootRenderLanes & -workInProgressRootRenderLanes;
  }
  var transition = ReactSharedInternals.T;
  if (transition !== null) {
    // ← 这里！检测到处于 transition 环境
    transition._updatedFibers || (transition._updatedFibers = new Set());
    transition._updatedFibers.add(fiber);
    var entangled = currentEntangledLane;
    return entangled !== 0 ? entangled : requestTransitionLane();
  }
  return resolveUpdatePriority();   // 不在 transition 里，走正常的优先级解析
}

function requestTransitionLane() {
  if (currentEventTransitionLane === 0) {
    currentEventTransitionLane = claimNextTransitionLane();
  }
  return currentEventTransitionLane;
}

function claimNextTransitionLane() {
  var lane = nextTransitionLane;
  nextTransitionLane <<= 1;                          // 每次领取后左移一位（轮转）
  if ((nextTransitionLane & 4194048) === 0) {
    nextTransitionLane = 256;                         // 超出 Transition lane 范围后回绕
  }
  return lane;
}
```

**这条链路完整串起来**：`ReactSharedInternals.T !== null` → `requestTransitionLane()` → `claimNextTransitionLane()` 从一组专属的 Transition lane 位（`4194048` 这个掩码覆盖的位区间，对应 `getLabelForLane` 里 `lane & 4194048` 命中"Transition"标签的那些位）里轮转领取一个。

> 💡 **为什么要"轮转"而不是固定用一个 Transition lane？** 这样可以让**同一事件循环内触发的多个不同 transition 互相区分**——比如你连续点了两次不同的 Tab 切换，各自的更新可以用不同的 lane 位标记，方便后续按 lane 精细化控制"哪个 transition 该被打断、哪个该保留"。

---

## 三、useDeferredValue：延迟一个"值"而不是一段代码

### 3.1 mountDeferredValueImpl —— 首次渲染

```js
function mountDeferredValueImpl(hook, value, initialValue) {
  if (initialValue === undefined || (renderLanes & 1073741824) !== 0) {
    // 没传 initialValue，或者当前渲染本身就是 Deferred lane（避免嵌套）
    return (hook.memoizedState = value);   // 直接用真实值，没有"延迟"这一说
  }
  hook.memoizedState = initialValue;        // 首次渲染先用 initialValue 占位
  var lane = requestDeferredLane();
  currentlyRenderingFiber.lanes |= lane;    // 给当前 fiber 挂上 Deferred lane
  workInProgressRootSkippedLanes |= lane;   // 记录"这个 lane 被跳过了，之后要单独补一轮"
  return initialValue;
}
```

**首次渲染的行为**：如果你传了第二个参数 `initialValue`（React 18.3+ 支持），第一次渲染会**直接用 initialValue**，然后立刻在后台标记一个 Deferred lane 的低优先级更新，等这次同步渲染完成后再"追上"真实的 `value`。

### 3.2 updateDeferredValueImpl —— 之后渲染的核心判断

```js
function updateDeferredValueImpl(hook, prevValue, value, initialValue) {
  if (objectIs(value, prevValue)) return value;   // ① 值没变，直接返回，什么都不用做

  if (currentTreeHiddenStackCursor.current !== null) {
    // ② 在一个隐藏的树里（比如 Offscreen，Day11 讲过）—— 直接采用新值，不延迟
    var deferred = mountDeferredValueImpl(hook, value, initialValue);
    if (!objectIs(deferred, prevValue)) didReceiveUpdate = true;
    return deferred;
  }

  if ((renderLanes & 42) === 0) {
    // ③ 关键判断！renderLanes 不包含"阻塞型 lane"（Sync=2 | InputContinuous=8 | Default=32 的位掩码，42 = 0b101010）
    // 说明当前这次渲染本身已经是低优先级的了（比如已经是个 transition），可以直接用新值
    didReceiveUpdate = true;
    return (hook.memoizedState = value);
  }

  // ④ 当前渲染是"阻塞型"优先级（同步/连续/默认）——不能立即用新值，得延迟
  var lane = requestDeferredLane();
  currentlyRenderingFiber.lanes |= lane;
  workInProgressRootSkippedLanes |= lane;
  return prevValue;   // 先返回旧值，把新值的展现推到后面单独的低优先级渲染里
}
```

> 📌 **回答入场自测 Q3**：`useDeferredValue` **不是"防抖"**（防抖是延迟触发，`useDeferredValue` 是"立刻触发但允许返回旧值"）。它返回的可能是"旧值"（`prevValue`），意思是：**这次高优先级渲染里，你先拿着旧值把界面撑住（不阻塞），React 会在背后单独调度一次低优先级渲染，等那次渲染完成，你的组件会重新拿到新值**。跟 `useState` + `setTimeout` 防抖的本质区别：防抖是"人为拖延调用时机"，`useDeferredValue` 是"值立刻可用，但组件消费它的时机被 React 的 Lane 调度自然错开"。

> 📌 **回答入场自测 Q4**：如果当前渲染本身已经处于同步/紧急优先级（`renderLanes & 42 !== 0` 为真，比如离散事件触发的更新），`useDeferredValue` **会**触发延迟机制——正是这种场景才需要延迟。反过来，**如果当前渲染已经是低优先级的**（`renderLanes & 42 === 0`，比如已经在一个 transition 里），`useDeferredValue` 会走 §3.2 里的第③步，**直接用新值，不再二次延迟**——因为已经不阻塞了，没必要再拖一次。

### 3.3 `renderLanes & 42` 是什么意思——一个值得记住的位运算细节

```
42 的二进制：0b101010
拆解： 2 (Sync) | 8 (InputContinuous) | 32 (Default)
```

这是源码里 `getHighestPriorityLanes` 函数用来判断"当前是否有阻塞型更新"的同一个掩码（`var pendingSyncLanes = lanes & 42`）。`renderLanes & 42 === 0` 就是在问："这次渲染里，有没有 Sync / InputContinuous / Default 这三种'紧急'lane？没有的话就说明已经是低优先级渲染了。"

> 💡 这也解释了为什么 `useDeferredValue` 常被形容为"自动检测优先级上下文"——它不是真的去"检测"什么，只是简单地做了一次位运算判断当前渲染批次的 lane 组成。

---

## 四、两者配合使用：搜索框过滤大列表的经典场景

```jsx
function SearchPage() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);   // 延迟版本的 query

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      {/* 用 deferredQuery 渲染大列表，输入框本身用 query（不延迟，保证输入流畅） */}
      <HeavyList query={deferredQuery} />
    </>
  );
}
```

**执行时序**：

```
用户敲一个字符
  ↓
setQuery(newChar) —— 这是离散事件触发的更新，走同步/InputContinuous lane
  ↓
本次渲染：query 立刻更新（输入框跟手），但 useDeferredValue(query) 内部判断
  renderLanes & 42 !== 0（当前是阻塞渲染）→ 返回 prevValue（旧的 deferredQuery）
  → HeavyList 暂时还用旧数据渲染，不卡顿
  ↓
React 后台单独调度一次 Deferred lane 的渲染
  ↓
这次低优先级渲染里，deferredQuery 的 value 已经变了 → objectIs 判断不等 →
  这次是 renderLanes & 42 === 0（低优先级）→ 走"直接采用新值"分支
  → HeavyList 重新渲染，用上最新的 query
```

**和 `useTransition` 的方案对比**：

```jsx
function SearchPage() {
  const [query, setQuery] = useState('');
  const [displayQuery, setDisplayQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleChange(e) {
    setQuery(e.target.value);            // 高优先级：输入框跟手
    startTransition(() => {
      setDisplayQuery(e.target.value);   // 低优先级：大列表用的查询词
    });
  }

  return (
    <>
      <input value={query} onChange={handleChange} />
      {isPending && <Spinner />}
      <HeavyList query={displayQuery} />
    </>
  );
}
```

**该用哪个？**

| 场景 | 选择 |
|---|---|
| 你能改造触发更新的代码（自己写的 onChange） | `useTransition`（还能拿到 `isPending` 显示 loading） |
| 你只能拿到一个外部传入的 value（比如 props、Context），改不了它的产生逻辑 | `useDeferredValue`（不需要触碰"谁在设置这个值"的代码） |
| 需要清晰的 pending 状态做 UI 反馈（比如显示 loading spinner） | `useTransition` |

---

## 五、把 Day10/Day19/Day20 串成一条完整链路

```
用户交互触发 setState
        ↓
是否包在 startTransition 里？
  是 → ReactSharedInternals.T 非 null → requestUpdateLane 走 transition 分支
       → claimNextTransitionLane() 领一个 TransitionLane 位
  否 → resolveUpdatePriority() 走正常优先级解析（Day10 讲的四分支决策树）
        ↓
lane 被 scheduleUpdateOnFiber 冒泡标记到 fiber.lanes / 沿途 childLanes（Day10）
        ↓
lane 被映射成对应的 Scheduler priority（TransitionLane → 大致对应 NormalPriority 附近）
        ↓
Scheduler.unstable_scheduleCallback(priority, performConcurrentWorkOnRoot)
  → 算出 timeout → expirationTime → push 进 taskQueue 最小堆（Day19）
        ↓
如果同时有更高优先级（比如用户又点击了别的东西）→ 新任务 expirationTime 更小 → 排到堆顶
  → 低优先级 transition 的渲染在 workLoop 里让出（shouldYieldToHost）→ 被高优插队（Day19）
        ↓
最终 transition 对应的更新完成 → isPending 变回 false（如果用了 useTransition）
  或者 deferredValue 追上最新值（如果用了 useDeferredValue）
```

---

## 六、几个容易搞混的点（面试向）

**Q1：`useTransition` 的 `isPending` 什么时候变成 `true`，什么时候变成 `false`？**

调用 `startTransition(callback)` 时**同步**触发一次更新把 `isPending` 设为 `true`（`pendingState` 参数）；`callback()` 执行完（如果是同步的）或者返回的 Promise resolve 后（如果 callback 是 async 的），再触发一次更新把它设回 `false`（`finishedState` 参数）。

**Q2：`startTransition` 会不会阻塞主线程？**

`startTransition` 本身是**同步执行**的——`callback()` 是被直接调用的，不是被丢进某个队列异步执行。"低优先级"体现在 `callback` 内部触发的 `setState` 之后走到的渲染调度上，不是说 `startTransition` 这次调用本身是异步的。

**Q3：为什么 `useDeferredValue` 判断的是 `renderLanes & 42` 而不是直接查 `ReactSharedInternals.T`？**

因为 `useDeferredValue` 关心的是"**当前这次渲染的性质**"，而不是"当前是不是在 transition 的调用栈里"。一次渲染的 `renderLanes` 是这批更新最终被批处理后的结果，可能来自 setState 直接触发，也可能来自其他机制，用 lane 位掩码判断更准确、更通用。

**Q4：`useDeferredValue` 传第二个参数 `initialValue` 是干什么的？**

React 18 的 `useDeferredValue` 只有一个参数，首次渲染直接用真实值。React 18.3+/19 加了第二个参数 `initialValue`，允许首次渲染先用一个占位值（比如空数组），把真实值的渲染也推到后台的低优先级更新里——对首屏渲染有性能收益（避免首次渲染就承担重计算）。

---

## 六点五、入场自测对答

| 题 | 学习者回答 | 判定 |
|---|---|---|
| Q1 isPending机制 | 靠抛出的 promise 状态标识 | 🟡 偏——混淆主次机制。主体是普通 `useState(false)`；promise/thenable 只是 callback 为 async 函数时的次要分支 |
| Q2 setState 怎么变低优先级 | 通过设置 lanes 的值来标识优先级 | 🟡 偏——方向对但层次反了。不是直接设 lane，是先设全局标记 `ReactSharedInternals.T` → `requestUpdateLane` 检测该标记 → 检测到才去 claim 一个 TransitionLane。"标记→检测→换算"，不是"直接赋值" |
| Q3 | 不清楚 | 正常，当天核心内容 |
| Q4 同步渲染中 useDeferredValue 会不会延迟 | 答"不会延迟，紧急更新优先级更高不会打断" | ❌ 答反——把"延迟"和"打断"两个概念混了。源码里正相反：**正是**处于同步/紧急渲染（`renderLanes & 42 !== 0`）时才触发延迟返回旧值；已经是低优先级渲染时才不需要二次延迟 |

**判定：1 对 2 偏 1 反**。核心薄弱点：Q4 暴露"延迟机制"和"打断机制"两个不同问题被当成一回事——`useDeferredValue` 管的是"当前渲染要不要用新值"，跟"这次渲染会不会被别的更高优先级更新打断"是两条不同的逻辑线，虽然都跟 lane 优先级相关，但回答的问题不一样。

---

## 七、动手实验（写入 demos/day20/）

| 实验 | 验证什么 |
|---|---|
| T1 | `startTransition` 包裹的 setState 是否真的被 Scheduler 标记为低优先级（用一个耗时组件对比有无 transition 的渲染表现） |
| T2 | 高优先级更新是否能打断正在进行的 transition 渲染（配合 Day19 的 Scheduler 让出机制观察） |
| T3 | `useDeferredValue` 在"当前渲染已是低优先级"场景下是否真的跳过二次延迟（对照 §3.2 第③步） |

> ⚠️ 按 STUDY_PROTOCOL 硬规则：所有实验预期必须先本地实测再定案，不能凭源码推断直接写"预期结果"。

---

## 八、验收清单

- [ ] 能说出 `useTransition` 和 `useDeferredValue` 的本质区别（控制代码 vs 控制值）
- [ ] 能画出 `mountTransition` 内部"两个 hook"的结构（state hook + start 函数 hook）
- [ ] 能说出 `startTransition` 靠什么机制让内部 setState 变成低优先级（`ReactSharedInternals.T` 全局标记 + `requestUpdateLane` 检测）
- [ ] 能说出为什么 `startTransition` 的 callback 执行完必须还原 `ReactSharedInternals.T`
- [ ] 能解释 `useDeferredValue` 的 `renderLanes & 42` 判断在检测什么
- [ ] 能说出 `useDeferredValue` 和防抖的本质区别
- [ ] 能画出搜索框场景下两种方案（useTransition vs useDeferredValue）的执行时序
- [ ] 完成 3 个实验

---

## 九、Day21 预告

**主题**：高优先级打断低优先级实战（原 roadmap D15）——今天讲完两个 Hook 的源码实现后，下一步是**真正动手复现"打断"这个过程**：写一个耗时的低优先级渲染，中途用高优先级更新打断它，在 DevTools/console 里观察 wip 树被丢弃重做的实际证据。这是 Day10（Lane 决策树）+ Day19（Scheduler 让出机制）+ Day20（Transition 标记机制）三天内容的综合实战验证。

**预读问题**：
1. 怎么在代码里制造一个"故意很慢"的渲染，方便观察打断效果？
2. 打断发生时，React DevTools Profiler 会显示出什么迹象？
3. 如果低优先级渲染已经完成了 `beginWork` 但还没 `completeWork`，被打断后这部分工作是完全浪费，还是能有部分复用？
4. `entangleTransitions` 这个函数名多次在源码里出现，它是解决什么问题的？
