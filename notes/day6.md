# Day 6 笔记：useState 源码 + Hook 链表 + 批处理

> 日期：2026-06-20
> 主题：W2 第一天——拆开 useState 看里面到底是什么
> 状态：📖 学习中
> 前置：Day 4 学的 Hook 链表挂在 `fiber.memoizedState`

---

## 零、入场自测（5 分钟，先自己答再往下看）

> ⚠️ 答完再往下看，"不会"明确说"不会"。

1. **`setN(n + 1)` 和 `setN(prev => prev + 1)` 在源码里有什么区别？**
   提示：你平时写代码两种都用过，说说你能想到的差别。

2. **多次连续 `setN` 调用，React 怎么批处理？比如下面代码会触发几次 render？**

   ```jsx
   function App() {
     const [n, setN] = useState(0);
     return <button onClick={() => {
       setN(n + 1);  // ①
       setN(n + 1);  // ②
       setN(n + 1);  // ③
     }}>{n}</button>;
   }
   ```

3. **useState 的 lazy init `useState(() => expensiveCompute())` 是什么时候跑的？**
   提示：什么时候 expensiveCompute 会执行？mount 时跑一次还是每次 render？

4. **函数式更新 `setN(prev => prev + 1)` 的 prev 来自哪里？**
   提示：是从闭包里拿 n？还是从 Fiber 上读？

---

## 一、回顾：Hook 链表的存储位置

Day 4 你学过：

```
fiber.memoizedState
    ↓
  Hook1 { memoizedState: 0, queue: ..., next ↓ }
  Hook2 { memoizedState: '', queue: ..., next ↓ }
  Hook3 (useEffect) { memoizedState: effect 对象, next ↓ }
  null
```

每个 Hook 节点的字段：

```js
type Hook = {
  memoizedState: any;       // ★ 当前生效的 state
  baseState: any;           // 计算的起点
  baseQueue: Update | null; // 上次没处理完的 update 链表
  queue: UpdateQueue | null;// 待处理的 update 链表（重点）
  next: Hook | null;        // 链表指针
};
```

### Day 6 重点：`queue` 字段是什么

`queue` 是一个**待处理 update 的环形链表**：

```js
type UpdateQueue<S, A> = {
  pending: Update<S, A> | null;  // 环形链表的最后一个（pending.next 是第一个）
  lanes: Lanes;                  // 优先级
  dispatch: (A) => void;         // ★ setN 函数本身
  lastRenderedReducer: (S, A) => S;
  lastRenderedState: S;
};

type Update<S, A> = {
  lane: Lane;
  action: A;       // ★ 你传给 setN 的东西（值或函数）
  hasEagerState: boolean;
  eagerState: S | null;
  next: Update | null;  // 环形链表
};
```

⭐ **核心**：`setN(x)` 不是立即改 state，**而是往 queue 里塞一个 Update**。

---

## 二、useState 源码（mount vs update）

### 2.1 mount 阶段

```js
function mountState<S>(initialState) {
  const hook = mountWorkInProgressHook();   // 在 fiber.memoizedState 链表追加新节点
  
  // ★ 处理 lazy init
  if (typeof initialState === 'function') {
    initialState = initialState();   // 跑一次
  }
  
  hook.memoizedState = hook.baseState = initialState;
  
  const queue = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: initialState,
  };
  hook.queue = queue;
  
  // ★ 创建 dispatch 函数（也就是 setN）
  const dispatch = dispatchSetState.bind(
    null,
    currentlyRenderingFiber,
    queue
  );
  queue.dispatch = dispatch;
  
  return [hook.memoizedState, dispatch];
}
```

⭐ **3 件事**：
1. 在 Hook 链表追加新节点
2. lazy init 函数**只在 mount 跑一次**（更新阶段直接用 memoizedState）
3. dispatch（setN）通过 `bind` 预先绑定 fiber + queue，所以你点击事件里调 setN 它知道往哪个 queue 塞 update

### 2.2 update 阶段

```js
function updateState<S>(initialState) {
  return updateReducer(basicStateReducer, initialState);
}

function updateReducer<S, A>(reducer, initialArg) {
  const hook = updateWorkInProgressHook();  // 沿 alternate 链表往下走
  const queue = hook.queue;
  
  // ★ 拿到所有待处理的 update
  let baseQueue = current.baseQueue;
  const pendingQueue = queue.pending;
  if (pendingQueue !== null) {
    // 合并 baseQueue 和 pendingQueue
    baseQueue = pendingQueue;
    queue.pending = null;
  }
  
  // ★ 遍历 update 链表，逐个 reducer 计算
  if (baseQueue !== null) {
    let newState = current.baseState;
    let update = baseQueue.next;  // 第一个 update
    do {
      const action = update.action;
      // ★★ 关键：action 可能是值，也可能是函数
      newState = typeof action === 'function' 
        ? action(newState)        // 函数式更新：跑函数
        : action;                 // 直接赋值
      update = update.next;
    } while (update !== baseQueue.next);
    
    hook.memoizedState = newState;
  }
  
  return [hook.memoizedState, queue.dispatch];
}
```

⭐ **关键观察**：
- update 阶段**完全不用 initialState 参数**——你 `useState(0)` 里的 0 在 update 时是死的
- newState 通过 reducer 顺序计算得出
- 函数式 vs 直接赋值在这里被区分处理

---

## 三、`setN(n+1)` vs `setN(prev => prev+1)` 的本质区别

回答 Q1 + Q4。

### 3.1 代码视角

```js
setN(n + 1);            // 值更新：action = 1（在调用时已计算）
setN(prev => prev + 1); // 函数式更新：action = (prev) => prev + 1
```

存进 update 的 `action` 字段——**值更新存的是结果，函数式更新存的是函数**。

### 3.2 update 阶段处理时

```js
newState = typeof action === 'function' 
  ? action(newState)   // ★ prev 是上一次 reducer 计算的结果
  : action;
```

⭐ **核心区别**：

| | setN(n + 1) | setN(prev => prev + 1) |
|---|---|---|
| action | 值（事先算好的）| 函数 |
| 计算依据 | 闭包里的 n（render 时锁定）| **prev = 上一次 reducer 的结果** |
| 多次调用 | 都基于同一个旧 n | 链式累积 |

### 3.3 经典例子（Q2 答案铺垫）

```jsx
function App() {
  const [n, setN] = useState(0);
  return <button onClick={() => {
    setN(n + 1);  // ① action = 0+1 = 1
    setN(n + 1);  // ② action = 0+1 = 1（n 是闭包，还是 0）
    setN(n + 1);  // ③ action = 0+1 = 1
  }}>{n}</button>;
}
```

3 次 setN，但 **action 都是 1**。reducer 计算：
```
update 1: newState = 1
update 2: newState = 1（直接赋值，覆盖）
update 3: newState = 1
```

→ **n 最终变成 1，不是 3** ❌

```jsx
() => {
  setN(prev => prev + 1);  // ① action = fn1
  setN(prev => prev + 1);  // ② action = fn2
  setN(prev => prev + 1);  // ③ action = fn3
}
```

reducer 计算：
```
update 1: newState = fn1(0) = 1
update 2: newState = fn2(1) = 2  ← 拿上次结果
update 3: newState = fn3(2) = 3
```

→ **n 最终变成 3** ✅

⭐ **Q4 答案**：`prev` 来自**上一次 reducer 计算的结果**，不是闭包，也不是直接读 fiber。

### 3.4 闭包陷阱可视化

```jsx
function App() {
  const [n, setN] = useState(0);
  
  // ★ 这里的 n 是 render 时的闭包值
  // 第 1 次 render：n = 0
  // 第 2 次 render：n = 1（重新进函数体，闭包是新的）
  
  const handle = () => {
    setN(n + 1);  // 这里的 n 永远是 render 时的那个 n
  };
  
  return <button onClick={handle}>{n}</button>;
}
```

如果 onClick 里连续 3 次 `setN(n + 1)`，3 次都是基于同一个 render 周期的 n（闭包锁定），所以都是 0+1。

**只有进入 update 阶段重新 render 后，n 闭包才更新**。

### 3.5 工程建议

| 场景 | 推荐写法 |
|---|---|
| 只关心新值是某个固定结果 | `setN(5)` 直接给值 |
| 基于当前值递增/递减 | `setN(prev => prev + 1)` 函数式 |
| 异步回调里更新 state | **必须用函数式**，避免拿到陈旧闭包 |

---

## 四、批处理（Q2 答案）

### 4.1 React 18 自动批处理（automatic batching）

```jsx
() => {
  setN(n + 1);
  setM(m + 1);
  setK(k + 1);
}
```

3 次 setState **只触发 1 次 reconcile + 1 次 render + 1 次 commit**——这就是批处理。

### 4.2 实现原理

```js
function dispatchSetState(fiber, queue, action) {
  const update = {
    lane: ...,
    action,
    next: null,
  };
  
  // ★ 把 update 加进 queue（环形链表）
  enqueueUpdate(fiber, queue, update);
  
  // ★ 调度一次重渲染（如果还没调度过）
  scheduleUpdateOnFiber(fiber, lane);
}
```

`scheduleUpdateOnFiber` 内部检查：
- 如果当前已经有 scheduled work → **不再调度**（合并）
- 如果没有 → 调度

所以同步调用的 3 次 setN：
```
点击事件触发
  ↓
setN(1) → 加 update + 调度 reconcile
setN(2) → 加 update + 已经调度过，跳过
setN(3) → 加 update + 已经调度过，跳过
  ↓
事件回调结束 → 微任务 / 调度器触发 → 跑 reconcile
  ↓
update 阶段一次性消费 3 个 update → 1 次 render
```

### 4.3 React 17 vs React 18 差异

| | React 17 | React 18 |
|---|---|---|
| 同步事件回调里多次 setState | ✅ 自动批处理 | ✅ |
| Promise / setTimeout / 原生事件里多次 setState | ❌ **不批处理**（每次都 render） | ✅ **自动批处理** |

```jsx
async function handleClick() {
  await fetch('/api');
  setN(1);   // React 17: 这里立即 render
  setM(2);   // React 17: 又 render 一次
  // React 18: 两个一起 render（自动批处理）
}
```

### 4.4 跳出批处理：`flushSync`

```jsx
import { flushSync } from 'react-dom';

flushSync(() => {
  setN(1);  // 立即 render，不批处理
});
flushSync(() => {
  setM(2);  // 又一次立即 render
});
```

适用场景：你需要在两次 setState 之间读 DOM 测量等。

---

## 五、lazy init（Q3 答案）

### 5.1 两种写法

```jsx
useState(expensiveCompute());        // ❌ 每次 render 都跑（即使 update 不用）
useState(() => expensiveCompute());  // ✅ 只在 mount 跑一次
```

### 5.2 源码验证

```js
function mountState<S>(initialState) {
  if (typeof initialState === 'function') {
    initialState = initialState();   // ★ 只在 mount 跑
  }
  hook.memoizedState = initialState;
  ...
}

function updateState<S>(initialState) {
  return updateReducer(basicStateReducer, initialState);
  // ↑ 注意：updateReducer 内部完全不用 initialState 参数！
}
```

⭐ **关键**：update 阶段 **initialState 参数被完全忽略**——所以 `useState(expensiveCompute())` 写法的问题是：

```jsx
// 假设 expensiveCompute 是个 1 秒的计算
function App() {
  const [n] = useState(expensiveCompute());  // ❌
  // 每次 render（哪怕是 update 阶段）都会跑 1 秒
  // update 阶段 expensiveCompute() 的结果根本不用，纯浪费
}
```

写成 lazy 形式：

```jsx
function App() {
  const [n] = useState(() => expensiveCompute());  // ✅
  // mount 时跑一次（结果存进 hook.memoizedState）
  // update 阶段不会再调这个函数
}
```

### 5.3 类比 useMemo / useReducer 的 lazy 参数

```jsx
useReducer(reducer, initialArg, init);  // 第三参数 init 也是 lazy

useMemo(() => expensiveCompute(), [deps]);  // useMemo 本身就是 lazy
```

---

### 5.4 ⭐ 学习者追问：为什么差这一对括号差距这么大？

> 学习者疑问（23:18）：`useState(expensiveCompute())` 和 `useState(() => expensiveCompute())` 看起来只差一个箭头函数包裹，为啥行为差这么多？

**关键澄清**：差异不在 useState，而在 **JS 的函数参数语义**。

#### 根本原因：JS 函数参数立即求值

```js
useState(expensiveCompute())
// 1. JS 引擎先调用 expensiveCompute() → 拿到结果（比如 999）
// 2. 把 999 传给 useState
// → expensiveCompute() 一定会被执行，与 useState 内部逻辑无关！

useState(() => expensiveCompute())
// 1. JS 引擎创建一个箭头函数对象（几乎零成本）
// 2. 把这个函数对象传给 useState
// → expensiveCompute() 没被执行，要等 useState 内部决定要不要调它
```

⭐ **核心洞察**：参数求值在调用 useState **之前**就发生了。`useState` 内部完全控制不了"传进来的 initialState 是怎么算出来的"。

#### update 阶段两种写法的对比

| 阶段 | `useState(expensiveCompute())` | `useState(() => expensiveCompute())` |
|---|---|---|
| **mount** | 跑 expensiveCompute() 拿 999，存 hook | 跑 expensiveCompute() 拿 999，存 hook |
| **update** | ❌ **仍跑 expensiveCompute()**（JS 语法决定），但 useState 直接忽略结果 | ✅ 只创建函数对象，expensiveCompute 不跑 |

**update 阶段 useState 源码**：

```js
function updateState(initialState) {
  return updateReducer(basicStateReducer, initialState);
  //                                       ↑ 这个参数压根没用，从 Hook 链表读
}
```

⭐ 你传的 999 / 函数都被无视——但 999 是 **你已经付出 1 秒计算代价才得到的**，浪费了。

#### 类比

| 写法 | 类比 |
|---|---|
| `useState(expensiveCompute())` | 你妈每天问"今晚吃啥"，你**先做了一桌满汉全席**摆桌上再问"要不要吃"。她说不用，你倒掉。**每天倒一桌菜**。 |
| `useState(() => expensiveCompute())` | 你妈每天问"今晚吃啥"，你**先给她一张菜单**。她说要吃才去做。**只有 mount 那天做了一次**。 |

#### 实战常见坑

```jsx
// ❌ 每次 render 读 localStorage + JSON.parse（看似快，频繁触发就累积）
const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));

// ✅ 只 mount 时读一次
const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user')));
```

```jsx
// ❌ 每次 render 生成新数组
const [list, setList] = useState(new Array(10000).fill(0));

// ✅ 只 mount 时生成
const [list, setList] = useState(() => new Array(10000).fill(0));
```

⭐ **判断规则**：只要初始值需要"**昂贵计算 / IO / 大对象创建**"，都用 lazy 形式。**便宜的字面量（数字/字符串/小对象）随意**。

---

## 六、回到入场自测的 4 题（标准答）

### 学习者答题记录（21:40 现场）

| Q | 学习者答 | 评 |
|---|---|---|
| Q1 值更新 vs 函数式 | "函数式更新能使避免出现闭包更新不及时问题" | 🟢 70%（答到了应用层后果，但没答源码层面的 action 存值 vs 函数） |
| Q2 多次 setN | "只触发一次 render，最终 n 还是只 +1 的那个值" | 🟢 100% ⭐ 完全正确 |
| Q3 lazy init 何时跑 | "不清楚" | ⚪ |
| Q4 prev 来自 | "fiber.memoizedState 里面维护的链表数据结构里" | 🟡 方向对（确实在 Hook 链表里），但精确说是"reducer 计算过程中的中间结果" |

### 关键纠正

#### Q1 精确化：源码层面的本质差异

学习者答"避免闭包不及时"是**应用结果**，不是**源码差异**。

源码层面：

```js
setN(1)                  // action = 1（值，已计算）
setN(prev => prev + 1)   // action = (prev) => prev + 1（函数）

// update 阶段 reducer：
newState = typeof action === 'function' ? action(newState) : action;
```

**源码区别**：action 字段一个存值、一个存函数。reducer 计算时用 `typeof === 'function'` 分流。
**应用结果**：你说的"闭包不及时"问题就是值更新会被同闭包锁定的副作用。

#### Q4 精确化：prev 不是从 fiber 直接读的某个字段

学习者方向对（在 Hook 链表里），但精确说：

```
prev 不是固定字段值，而是 update 链表 reducer 累积过程的中间结果。

具体路径：
fiber.memoizedState（Hook）.queue.pending → 拿到所有 update 的环形链表
  ↓
从 hook.baseState 开始（上次稳定的值）
  ↓
依次：newState = (typeof action === 'function') ? action(newState) : action
  ↓
prev = "上一次循环的 newState"
```

**关键**：连续 3 次 `setN(prev => prev + 1)`：
- 第 1 个 update：newState = action_1(0) = 1，prev=0
- 第 2 个 update：newState = action_2(1) = 2，prev=1
- 第 3 个 update：newState = action_3(2) = 3，prev=2

prev 是"链表 reduce 过程中累积的中间值"，不是从 fiber 里读的某个固定字段。

---

### 标准答（完整版）

### Q1：setN(n+1) vs setN(prev => prev+1) 区别

| | setN(n + 1) | setN(prev => prev + 1) |
|---|---|---|
| action 存什么 | 值（已计算） | 函数 |
| 计算依据 | 闭包里的 n | 上次 reducer 结果 |
| 同步多次调用 | 都基于同一闭包 n | 链式累积 |

### Q2：3 次 setN(n+1) 触发几次 render

**1 次**（自动批处理）。但 n 最终是 1，不是 3——因为 3 次 action 都是值 1，互相覆盖。

如果想要 n=3，必须用函数式 `setN(prev => prev + 1)`。

### Q3：lazy init 何时执行

**mount 阶段执行 1 次**。update 阶段 React 完全忽略 initialState 参数，所以函数不会再跑。

### Q4：函数式更新的 prev 来自哪里

来自 **上一次 reducer 计算的结果**——既不是闭包里的 n，也不是直接读 fiber。

具体路径：
```
fiber.memoizedState (Hook).queue.pending → 拿到所有 update
  → 从 baseState 开始
  → 依次 newState = action 是函数 ? action(newState) : action
  → prev = 上一次循环的 newState
```

---

## 七、动手实验

详见 `demos/day6/README.md`，3 个实验：

| 实验 | 目标 | 产出 |
|---|---|---|
| G1. 闭包陷阱：值更新 vs 函数式 | 复现 setN×3 但 n 只 +1 | console + 解释 |
| G2. lazy init 性能差异 | 故意让 expensiveCompute 跑 1s，对比两种写法 | 性能时间对比 |
| G3. React 18 自动批处理 | setTimeout 里多次 setState 看 render 次数 | console |

---

## 八、我之前以为 …，其实是 …（5 条认知纠正）

1. **我以为** `setN(n+1)` 和 `setN(prev => prev+1)` 只是写法不同，效果一样。
   **其实** 行为完全不同。值更新存"已算好的值"，函数式更新存"函数"。同步多次调用时，前者会互相覆盖（n 闭包锁定），后者链式累积。

2. **我以为** 多次 setState 会触发多次 render。
   **其实** 同步事件里多次 setState 自动批处理（React 18 后扩展到 Promise/setTimeout/原生事件）。3 次 setN(n+1) 只触发 1 次 render。

3. **我以为** `useState(expensiveCompute())` 性能没问题。
   **其实** 这种写法每次 render 都跑 expensiveCompute（即使 update 阶段结果根本不用）。必须写成 `useState(() => expensiveCompute())` lazy 形式。

4. **我以为** `setN(prev => prev + 1)` 的 prev 是从闭包里读的当前 n。
   **其实** prev 来自**上一次 reducer 计算的结果**。这就是为什么连续 3 次函数式 setN 能累积到 3，而 3 次值 setN 只到 1。

5. **我以为** dispatch（setN）函数每次 render 都重新创建。
   **其实** dispatch 在 mount 阶段通过 `bind` 创建一次，绑定 fiber + queue 后存进 `hook.queue.dispatch`。**update 阶段直接复用同一个 dispatch 函数**——这就是为什么 setN 引用稳定，可以放进 useEffect deps 里不会触发重跑。

---

## 九、Day 6 验收清单

- [x] 能讲清 setN 值更新和函数式更新的源码差异
- [x] 能解释为什么 3 次 setN(n+1) 只让 n 变 1，3 次 setN(prev=>prev+1) 能到 3
- [x] 能说出 lazy init 在 mount 跑一次、update 阶段被忽略
- [x] 能讲清 React 17 vs React 18 自动批处理范围差异
- [x] 能默写 Hook 节点的核心字段（memoizedState / queue / next）
- [x] 知道 dispatch 函数引用稳定的原因
- [x] 完成 3 个动手实验（demos/day6 已就绪，待跑）
- [x] 写下 5 条认知纠正（meta #40-#44）

---

## 9.5、自我验收 + AI 纠正（23:44 现场）

学习者主动默写 6 项验收点，AI 逐条对照标准答。

### 项 1：值更新 vs 函数式源码差异

> 学习者答："值更新 action 存计算好的值，函数式存函数，会在需要执行的时候才执行——疑问：执行时是 mount 还是 update？"

🟢 **方向 90% 对**，疑问命中要害。

**精确答**：action 执行在 **update 阶段**（下次 render 时跑 `updateReducer`）。

```
点 setN(prev => prev+1)
  ↓
仅入队：update = { action: 函数 } 进 queue.pending
  ↓ 触发 schedule，下次 render
beginWork → renderWithHooks → useState → updateReducer:
  for each update in queue.pending:
    newState = typeof action === 'function' ? action(newState) : action;
```

⭐ **核心时序**：dispatch 时**只入队**，update 阶段才**执行**。

### 项 2：3 次 setN(n+1) 为啥只 +1

> 学习者答："3 次 setN(n+1) 同一函数内 action 没更新，所以一直用的同一个"

🟡 **方向对，措辞偏**。

**精确版**：不是 action 没更新，是 **3 个 update 的 action 计算结果全是同一个值 1**（n 闭包都是 0）：

```
queue = [
  update { action: 1 },   // setN(0+1)
  update { action: 1 },   // setN(0+1)
  update { action: 1 },   // setN(0+1)
]
↓ update 阶段 reduce：
0 → 1 → 1 → 1   ← 用 1 覆盖 1 覆盖 1
最终 = 1
```

函数式则是：

```
queue = [
  update { action: prev => prev+1 },
  update { action: prev => prev+1 },
  update { action: prev => prev+1 },
]
↓ reduce 时每次拿"上次计算结果"作为 prev：
0 → action(0)=1 → action(1)=2 → action(2)=3
最终 = 3
```

### 项 3：lazy init

> 学习者答："mount 跑一次 update 被忽略，initState 传参最好传常量或箭头函数，不要直接传函数的调用"

🟢 **完美**。"不要直接传函数的调用"这个总结非常到位——抓到了 §5.4 的精髓（JS 函数参数立即求值）。

### 项 4：自动批处理

> "17 之前 promise/setTimeout 不批处理，18 之后也会了"

🟢 **完全正确**。

### 项 5：Hook 字段 memoizedState / queue

> 学习者答："memoizedState 存 actions 值，queue 存需要调用执行的函数"

🔴 **两个字段都讲反了**！

**精确版**：

```js
hook = {
  memoizedState: 5,           // ★ 当前 state 的【值】（不是 action）
  baseState: 5,               // 上次 reducer 计算完成的基线（处理 Suspense 中断时用）
  baseQueue: null,            // 暂留的 update 链
  queue: {                    // ★ update 队列【容器】
    pending: 环形链表,         // 还没处理的 update（每个 update 里才有 action）
    dispatch: setN,           // 缓存的 dispatch 函数（mount 时 bind 出来）
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: 5,
  },
  next: 下一个 Hook,
};

update = {                    // queue.pending 链表里的每个节点
  action: 1 或 (prev => prev+1),   // ★ 这才是 action
  next: ...,
  lane: ...,
};
```

⭐ **关键区分**（背下来）：
- `memoizedState` = **结果值**（state，比如 n=5）
- `queue` = **任务队列容器**（含 pending / dispatch / reducer 缓存）
- `queue.pending` = update 环形链表（每个 update 里有 action）
- `action` 在 update 节点上，不直接在 hook 上

### 项 6：dispatch 引用稳定

> "只在 mount 阶段创建，update 不会创建"

🟢 **对**。精确化：

```js
// mount 时
hook.queue.dispatch = dispatch = bind(dispatchReducerAction, fiber, queue);

// update 时
const dispatch = queue.dispatch;   // 直接复用 mount 时 bind 出来的引用
```

⭐ **实战意义**：setN 在 useEffect 依赖数组里写不写都不会触发 effect 重跑——引用永远稳定。这就是为什么 React 官方说"`setState` / `dispatch` 不需要写进依赖"。

---

## 9.6、6 项总结

| 项 | 我的状态 |
|---|---|
| 值更新 vs 函数式源码差异 | ✅ 方向对 + 主动提疑问 |
| 3 次 setN 差距 | 🟡 措辞偏，需精确"action 计算结果都是 1" |
| lazy init | ✅ 完美 |
| 自动批处理 | ✅ 完美 |
| **Hook 字段含义** | ❌ **memoizedState 和 queue 讲反了，必须重看 §1** |
| dispatch 引用稳定 | ✅ 对 |

⭐ **最大错点**：Hook 字段——重看 day6.md §1 把"memoizedState = 值 / queue = 队列容器 / action 在 update 里"刻进去。

---

## 十、Day 7 预告

**主题**：useEffect / useLayoutEffect 源码 + effect list 链表

**预读问题**：

1. useEffect 和 useLayoutEffect 在源码里只有一个字段不同，是哪个？
2. effect 在 fiber 上挂在哪里？和 Hook 链表是什么关系？
3. cleanup 是什么时候被存到 hook 上的？
4. deps 数组的浅比较精确发生在什么时候？

明天见 👋
