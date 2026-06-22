# Day 6 笔记：useState 源码 + Hook 链表 + 批处理

> 日期：2026-06-20
> 主题：W2 第一天——拆开 useState 看里面到底是什么
> 状态：✅ 已完成
> 前置：Day 4 Hook 链表挂在 fiber.memoizedState
>
> ⚠️ **源码出处（本文件所有源码事实均来自此处，已 WebFetch 核对 facebook/react main）**：
> `packages/react-reconciler/src/ReactFiberHooks.js`
> 涉及：`mountState` / `updateReducer` / `dispatchSetState` / `basicStateReducer` / `mountWorkInProgressHook` / `updateWorkInProgressHook`

---

## 零、入场自测（先自己答，"不会"明确说"不会"）

1. `setN(n + 1)` 和 `setN(prev => prev + 1)` 在源码里有什么区别？
2. 多次连续 `setN(n + 1)` 会触发几次 render？最终 n 是几？
3. `useState(() => expensiveCompute())` 的函数什么时候跑？
4. 函数式更新 `setN(prev => prev + 1)` 的 prev 来自哪里？

---

## 一、Hook 的数据结构

### 1.1 Hook 链表（Day 4 见过）

```
fiber.memoizedState
    ↓
  Hook1 → Hook2 → Hook3 → ... → null
```

每个 useState / useEffect / useRef 调用对应一个 Hook 节点，按**调用顺序**串成单向链表。

### 1.2 Hook 节点全字段

```js
type Hook = {
  memoizedState: any,       // ★ 当前生效的 state【值】
  baseState: any,           // reduce 的起点（处理被跳过的 update 时用）
  baseQueue: Update | null, // 上次没处理完、被跳过的 update 链
  queue: UpdateQueue | null,// ★ 待处理 update 的队列【容器】
  next: Hook | null,        // 链表指针
};
```

⚠️ **务必区分**（这是最容易错的）：
- `memoizedState` = **结果值**（比如 n=5）
- `queue` = **任务队列容器**（不是值、不是 action）
- `baseState` / `baseQueue` = 处理"部分 update 被高优先级跳过"时的断点续传（并发渲染才用到）

### 1.3 queue（UpdateQueue）结构

```js
type UpdateQueue<S, A> = {
  pending: Update<S, A> | null,   // 环形链表尾指针（pending.next 是头）
  lanes: Lanes,                   // 优先级
  dispatch: (A => void) | null,   // ★ setN 函数本身（mount 时 bind 出来缓存）
  lastRenderedReducer: (S, A) => S, // 上次用的 reducer（eagerState 优化用）
  lastRenderedState: S,           // 上次渲染的 state（eagerState 优化用）
};
```

### 1.4 Update（每次 setN 产生一个）

```js
type Update<S, A> = {
  lane: Lane,           // 这次更新的优先级
  action: A,            // ★ 你传给 setN 的东西（值 或 函数）
  hasEagerState: boolean, // 是否已提前算好结果（eagerState 优化）
  eagerState: S | null,   // 提前算好的结果
  next: Update | null,  // 环形链表
};
```

⭐ **三层包含关系**：`hook.queue.pending` → 一串 Update → 每个 Update 里有 `action`。
**action 在 Update 上，不在 hook 上。**

---

## 二、useState 源码：mount vs update

### 2.1 mount 阶段（mountState）

```js
function mountState(initialState) {
  const hook = mountWorkInProgressHook();   // 在链表追加新节点

  // ① lazy init：是函数就跑一次
  if (typeof initialState === 'function') {
    initialState = initialState();
  }
  hook.memoizedState = hook.baseState = initialState;

  // ② 建 queue
  const queue = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: initialState,
  };
  hook.queue = queue;

  // ③ 创建 dispatch（setN），bind 死 fiber + queue
  const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
  queue.dispatch = dispatch;

  return [hook.memoizedState, dispatch];
}
```

3 件事：① lazy init 只在这里跑一次；② 建 queue；③ `bind` 出 dispatch 缓存进 `queue.dispatch`（**这是 dispatch 引用稳定的根**）。

### 2.2 update 阶段（updateReducer）

```js
function updateState(initialState) {
  return updateReducer(basicStateReducer, initialState);
  //                                       ↑ update 阶段完全忽略这个参数！
}

function updateReducer(reducer, initialArg) {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue;

  // 合并 baseQueue 和 pendingQueue
  let baseQueue = current.baseQueue;
  const pendingQueue = queue.pending;
  if (pendingQueue !== null) {
    baseQueue = pendingQueue;
    queue.pending = null;
  }

  if (baseQueue !== null) {
    let newState = current.baseState;   // 从基线开始
    let update = baseQueue.next;        // 环形链表第一个
    do {
      const action = update.action;
      // ★★ 核心：action 是函数就调用，是值就直接赋
      newState = typeof action === 'function' ? action(newState) : action;
      update = update.next;
    } while (update !== baseQueue.next); // 走完一圈

    hook.memoizedState = newState;
  }

  return [hook.memoizedState, queue.dispatch];
}
```

⭐ **3 个关键**：
1. update 阶段**不用 initialState 参数**——`useState(0)` 的 0 在 update 时是死的
2. newState 从 `baseState` 出发，按 reducer 顺序消费 update 链表
3. `basicStateReducer` 就是 `(s, a) => typeof a === 'function' ? a(s) : a`——**值更新和函数式更新在这里分流**

---

## 三、setN(n+1) vs setN(prev => prev+1)（Q1 + Q4）

### 3.1 存进 action 的东西不同

```js
setN(n + 1);            // action = 1（调用时已算好的值）
setN(prev => prev + 1); // action = (prev) => prev + 1（函数）
```

### 3.2 update 阶段处理（同一行代码分流）

```js
newState = typeof action === 'function' ? action(newState) : action;
```

| | setN(n + 1) | setN(prev => prev + 1) |
|---|---|---|
| action | 值（render 时闭包 n 已锁定）| 函数 |
| 计算依据 | 闭包里的 n | 上一次 reduce 的 newState |
| 同步多次调用 | 都基于同一个旧 n | 链式累积 |

### 3.3 经典例子：3 次为什么不同

**值更新**（onClick 里连调 3 次 `setN(n+1)`，n 闭包=0）：

```
queue = [ {action:1}, {action:1}, {action:1} ]   // 三个都是 0+1=1
reduce: 0 → 1 → 1 → 1                              // 互相覆盖
最终 = 1 ❌
```

**函数式**（连调 3 次 `setN(prev=>prev+1)`）：

```
queue = [ {action:fn}, {action:fn}, {action:fn} ]
reduce: fn(0)=1 → fn(1)=2 → fn(2)=3               // 每次拿上次结果
最终 = 3 ✅
```

⭐ **Q4 答案**：`prev` 来自**上一次 reducer 计算的中间结果**（reduce 累积值），不是闭包，也不是直接读 fiber 某字段。

### 3.4 闭包陷阱：什么时候才暴露

```jsx
const handle = () => {
  setN(n + 1);   // n 是这次 render 锁定的闭包值
  console.log(n); // 打印旧值——这就是闭包，但不影响 setState 结果
};
```

⚠️ **单次点击不会出 bug**（每次点击之间隔着一次 render，闭包刷新）。闭包陷阱只在**两种场景**暴露：
1. **同一次事件里多次 `setN(n+1)`** → 都基于同一闭包 → 只 +1
2. **异步引用 n**（setTimeout / Promise / 空依赖 useEffect 里的 setInterval）→ 永远拿 render 时锁定的旧 n

修复：用函数式 `setN(prev => prev + 1)`，prev 不依赖闭包。

### 3.5 工程建议

| 场景 | 写法 |
|---|---|
| 新值是固定结果 | `setN(5)` |
| 基于当前值递增 | `setN(prev => prev + 1)` |
| 异步回调里更新 | **必须函数式**（避免陈旧闭包）|

---

## 四、批处理 + eagerState（Q2）

### 4.1 dispatchSetState 做两件事

```js
function dispatchSetState(fiber, queue, action) {
  const update = { lane, action, hasEagerState: false, eagerState: null, next: null };

  // ① eagerState 优化（见 4.2）
  // ② 入队 + 调度
  enqueueConcurrentHookUpdate(fiber, queue, update, lane);
  scheduleUpdateOnFiber(root, fiber, lane);
}
```

### 4.2 ⭐ eagerState 优化（提前 bailout，常被忽略的细节）

源码里 dispatch 时有一段"**抢跑计算**"：如果当前 fiber **没有待处理更新**（lanes 为空），React 会**在 dispatch 阶段就提前用 lastRenderedReducer 算出新 state**：

```js
// 简化逻辑
if (fiber.lanes === NoLanes && (alternate === null || alternate.lanes === NoLanes)) {
  const lastReducer = queue.lastRenderedReducer;
  const eagerState = lastReducer(queue.lastRenderedState, action);
  update.hasEagerState = true;
  update.eagerState = eagerState;
  // ★ 如果新旧 state Object.is 相等 → 直接 return，根本不调度 render！
  if (Object.is(eagerState, queue.lastRenderedState)) {
    enqueueConcurrentHookUpdateAndEagerlyBailout(fiber, queue, update);
    return;   // 不触发重渲染
  }
}
scheduleUpdateOnFiber(...);  // 否则正常调度
```

⭐ **意义**：`setN(相同的值)` 时，React **连 render 都不会触发**。比如：

```jsx
const [n, setN] = useState(0);
<button onClick={() => setN(0)}>点我</button>   // 点了也不 render（eagerState 命中）
```

字段 `hasEagerState` / `eagerState` 就是为这个优化存的——render 时如果已经算过就直接用，不再重算。

⚠️ 注意：eagerState 只在"队列为空"时尝试。如果已经有别的 update 排队，就不抢跑（因为 reducer 要按顺序算）。

### 4.3 批处理：多次 setState 只 render 一次

```js
scheduleUpdateOnFiber 内部：
  - 已经有 scheduled work → 不再调度（合并）
  - 没有 → 调度一次
```

```
点击事件
  ↓
setN(1) → 入队 + 调度
setN(2) → 入队 + 已调度，跳过
setN(3) → 入队 + 已调度，跳过
  ↓ 事件回调结束 → 调度器触发
一次 render → updateReducer 消费 3 个 update
```

### 4.4 React 17 vs 18 批处理范围

| | React 17 | React 18 |
|---|---|---|
| 合成事件里多次 setState | ✅ 批处理 | ✅ |
| Promise/setTimeout/原生事件里 | ❌ 不批（各 render 一次）| ✅ 自动批处理 |

React 18 的 Automatic Batching 把批处理下沉到调度器层，不再依赖事件类型。

### 4.5 跳出批处理：flushSync

```js
import { flushSync } from 'react-dom';
flushSync(() => setN(1));  // 立即 commit
flushSync(() => setM(2));  // 又一次立即 commit
```

适用：setState 后需立即读 DOM（如 FLIP 动画测量、滚动定位）。是性能反模式，非必要不用。

---

## 五、lazy init（Q3）

### 5.1 两种写法

```js
useState(expensiveCompute());        // ❌ 每次 render 都跑
useState(() => expensiveCompute());  // ✅ 只 mount 跑一次
```

### 5.2 根本原因：JS 函数参数立即求值

差异**不在 useState 内部，在 JS 语法**：
- `useState(expensiveCompute())`：JS 先把 `expensiveCompute()` 跑完再把结果传进去 → 每次 render 都跑（即使 update 阶段结果被忽略，钱已经花了）
- `useState(() => expensiveCompute())`：只传一个函数对象（零成本），useState 内部 mountState 才决定调不调

源码 mountState 只在 mount 时 `typeof initialState === 'function'` 才调用；updateReducer 完全不看 initialState → update 阶段不会再跑。

### 5.3 实战坑 + 判断规则

```js
useState(JSON.parse(localStorage.getItem('user')));     // ❌ 每次读+解析
useState(() => JSON.parse(localStorage.getItem('user'))); // ✅
useState(new Array(10000).fill(0));                       // ❌ 每次建大数组
useState(() => new Array(10000).fill(0));                 // ✅
```

⭐ 规则：**昂贵计算 / IO / 大对象 → 必须 lazy；便宜字面量随意。**

### 5.4 类比

| 写法 | 类比 |
|---|---|
| `useState(expensiveCompute())` | 每天先做满汉全席摆桌上，再问"要不要吃"，不吃就倒掉 |
| `useState(() => expensiveCompute())` | 先给菜单，要吃才做（只 mount 那天做一次）|

useReducer 第三参数 init、useMemo 本身也是同款 lazy 设计。

---

## 六、Hook 节点的复用策略（接 Day 2，Day 7 会深入）

update 时 `updateWorkInProgressHook` 从 current 对应位置**克隆**新 hook：

```js
const newHook = {
  memoizedState: currentHook.memoizedState,  // 浅拷贝
  baseState: currentHook.baseState,
  baseQueue: currentHook.baseQueue,
  queue: currentHook.queue,                  // ★ 共享同一个 queue
  next: null,
};
```

⭐ **hook 外壳每次新建，但 queue 共享** → `queue.dispatch`（setN）跨 render 永远同一引用。这就是为什么 setN 不用写进 useEffect deps。

---

## 七、把整个 setState 流程串起来

```
mount:
  mountState → 建 hook + queue + bind dispatch（setN）

setN(x) 触发:
  dispatchSetState:
    ① 尝试 eagerState：队列空就提前算，新旧相等直接 return 不 render
    ② 否则 enqueueConcurrentHookUpdate（入队）+ scheduleUpdateOnFiber（调度，合并）
  ↓ 事件结束，调度器跑 render（批处理：多次 setN 一次 render）
  beginWork → renderWithHooks → updateState → updateReducer:
    从 baseState 出发，消费 queue 里的 update，逐个 reduce 出 newState
  ↓ commit
  用户看到新值
```

---

## 八、动手实验

详见 `demos/day6/README.md`：

| 实验 | 目标 |
|---|---|
| G1 闭包陷阱 | setN(n+1)×3 → n+1；prev=>prev+1×3 → n+3 |
| G2 lazy init 性能 | expensiveCompute 跑 100ms，对比 6 次/1 次执行 |
| G3 自动批处理 | 合成事件/setTimeout/Promise 都只 1 次 render |

---

## 九、我之前以为 …，其实是 …（5 条认知纠正）

1. **我以为** `setN(n+1)` 和 `setN(prev=>prev+1)` 效果一样。**其实** action 一个存值一个存函数，同步多次调用时值更新互相覆盖（只 +1），函数式链式累积（到 3）。

2. **我以为** Hook 的 memoizedState 存 action、queue 存函数。**其实** 反了：memoizedState=当前 state 值，queue=队列容器，action 在 update 节点上。

3. **我以为** 单次 setN(n+1) 也会出闭包 bug。**其实** 只在"同事件多次调用"或"异步引用"时暴露，单次每次点击隔着 render 闭包自动刷新。

4. **我以为** lazy init 差异在 useState 内部。**其实** 根源是 JS 函数参数立即求值。

5. **我以为** `setN(相同值)` 也会触发 render。**其实** eagerState 优化：dispatch 时提前算，Object.is 相等就直接 bailout，连 render 都不触发。

> 已追加到 `meta/cognitive-corrections.md` #40-#44。

---

## 十、自我验收记录（学习者 23:44 默写）

> 学习者主动默写 6 项验收，最大错点：**Hook 字段 memoizedState/queue 含义讲反了**（已重看 §1 修正）。其余：值/函数式、lazy init、自动批处理、dispatch 稳定都对；3 次 setN 措辞偏（"action 没更新"→ 精确是"三个 action 计算结果都是 1"）。

---

## 十一、Day 6 验收清单

- [x] 能讲清 setN 值更新 vs 函数式的源码差异（action 存值/函数）
- [x] 能解释 3 次 setN(n+1) 只 +1、函数式到 3
- [x] 能说出 lazy init 只 mount 跑一次 + JS 参数立即求值
- [x] 能讲清 React 17/18 批处理范围差异
- [x] 能默写 Hook 全字段（memoizedState/baseState/baseQueue/queue/next）
- [x] 知道 eagerState 优化（setN 相同值不 render）
- [x] 知道 dispatch 引用稳定的原因（bind 缓存 + queue 共享）
- [ ] 完成 3 个动手实验
- [x] 写下 5 条认知纠正

---

## 十二、Day 7 预告

**主题**：useEffect / useLayoutEffect 源码 + effect 链表

**预读问题**：
1. useEffect 和 useLayoutEffect 在源码里只差哪两个 flag？
2. effect 对象挂在 fiber 哪里？和 Hook 链表什么关系？
3. deps 浅比较精确发生在什么时候？比什么？
4. cleanup 什么时候、存到哪里？

明天见 👋
