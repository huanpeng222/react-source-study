# Day 6 自测（答案折叠，先自己答）

> 主题：useState 源码 + Hook 链表 + 批处理
> 源码出处：`packages/react-reconciler/src/ReactFiberHooks.js`

---

## Q1
`setN(x)` 被调用时，state 是立即改变了吗？如果不是，发生了什么？

<details><summary>👉 答案</summary>

**不是立即改变**。`dispatchSetState` 做两件事：
1. 创建一个 `update = { action: x, lane, next }`，塞进 `hook.queue.pending`（环形链表）
2. 调用 `scheduleUpdateOnFiber` 调度一次重渲染

真正的 state 计算发生在下次 render 的 `updateReducer` 里——从 baseState 开始把 queue 里的 update 逐个 reduce。
</details>

## Q2
`memoizedState`、`queue`、`action` 三者分别是什么？分别挂在哪个对象上？

<details><summary>👉 答案</summary>

- `memoizedState`：当前 state 的**值**（比如 n=5），挂在 **hook** 上
- `queue`：update 队列**容器**（含 pending / dispatch / lastRenderedReducer），挂在 **hook** 上
- `action`：你传给 setN 的东西（值或函数），挂在 **update 节点**上（在 queue.pending 链表里）

⭐ 易错：memoizedState 不是存 action，queue 不是存函数本身。
</details>

## Q3
下面点击一次，n 最终是几？触发几次 render？

```jsx
const [n, setN] = useState(0);
// onClick:
setN(n + 1);
setN(n + 1);
setN(n + 1);
```

<details><summary>👉 答案</summary>

**n = 1，触发 1 次 render**。

三个 update 的 action 都是值 1（n 闭包都是 0）：reduce 时 `0 → 1 → 1 → 1`，互相覆盖。

批处理：同步事件里 3 次 setN 只调度 1 次 reconcile。
</details>

## Q4
把 Q3 改成 `setN(prev => prev + 1)` 三次，n 最终是几？为什么？

<details><summary>👉 答案</summary>

**n = 3**。

三个 action 是函数，reduce 时每次拿上次结果当 prev：
```
action_1(0) = 1
action_2(1) = 2
action_3(2) = 3
```

prev 来自**上一次 reducer 计算的中间结果**，不是闭包，也不是直接读 fiber 字段。
</details>

## Q5
`useState(expensiveCompute())` 和 `useState(() => expensiveCompute())` 有什么区别？根源是什么？

<details><summary>👉 答案</summary>

- 前者：每次 render 都跑 expensiveCompute()（即使 update 阶段结果被忽略）
- 后者：只在 mount 跑一次

**根源是 JS 函数参数立即求值**——`expensiveCompute()` 在 useState 被调用之前就执行了，跟 useState 内部逻辑无关。后者传的是函数对象，没立即调用。

判断规则：昂贵计算 / IO / 大对象初始化 → 必须用 lazy 形式。
</details>

## Q6
lazy init 函数在 update 阶段会再跑吗？为什么？

<details><summary>👉 答案</summary>

**不会**。`updateState` → `updateReducer` 完全不使用 initialState 参数，state 从 Hook 链表的 memoizedState / baseState 读取。lazy init 函数只在 `mountState` 阶段执行一次。
</details>

## Q7
为什么 React 官方说 `setN` / `dispatch` 不需要写进 useEffect 依赖数组？

<details><summary>👉 答案</summary>

因为 dispatch 引用稳定。mount 时通过 `dispatchSetState.bind(null, fiber, queue)` 创建一次，存进 `queue.dispatch`；update 阶段直接复用同一个引用。引用永远不变 → 写不写进 deps 都不会触发 effect 重跑。
</details>

## Q8
React 17 和 React 18 在批处理范围上有什么差异？

<details><summary>👉 答案</summary>

- React 17：只在**合成事件回调**里自动批处理。Promise / setTimeout / 原生事件回调里多次 setState 会**逃逸**，每次都触发 render。
- React 18：**Automatic Batching**——扩展到所有异步上下文（Promise / setTimeout / 原生事件）都自动批处理。

逃生口：`flushSync(() => setState(...))` 强制立即 commit，跳出批处理。
</details>

## Q9（陷阱题）
下面代码点击一次，控制台打印的 `n` 是几？为什么？

```jsx
const [n, setN] = useState(0);
const handle = () => {
  setN(n + 1);
  console.log(n);   // ← 打印几？
};
```

<details><summary>👉 答案</summary>

**打印 0**。

setN 不会同步改变当前作用域里的 n（n 是这次 render 的闭包值，被锁定为 0）。新的 n=1 只会在下次 render 时通过重新执行函数体生效。

这就是闭包：`console.log(n)` 读的是 render 时锁定的旧值，不是 setN 后的新值。
</details>

## Q10（开放题）
如果让你用 50 行实现一个 mini useState（支持函数式更新 + 多 Hook），你会怎么组织数据结构？

<details><summary>👉 思路</summary>

```js
let hooks = [];      // Hook 数组（简化版，真实是链表）
let cursor = 0;      // 当前 Hook 索引

function useState(initial) {
  const i = cursor;
  hooks[i] = hooks[i] ?? (typeof initial === 'function' ? initial() : initial);
  const setState = (action) => {
    hooks[i] = typeof action === 'function' ? action(hooks[i]) : action;
    rerender();   // 触发重渲染，重置 cursor=0
  };
  cursor++;
  return [hooks[i], setState];
}
```

关键点：
- 用 cursor 按调用顺序对应 Hook（所以 Hook 不能放 if 里）
- 函数式更新用 `typeof action === 'function'` 分流
- 真实 React 用链表 + 双缓存，且 setState 是入队不是立即改
</details>

---

## 完成后

答错的题回 `notes/day6.md` 对应章节重读。下一站：Day 7 useEffect 源码。
