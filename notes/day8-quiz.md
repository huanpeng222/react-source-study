# Day 8 自测（答案折叠，先自己答）

## Q1
useRef 的 `updateRef` 源码只有一行，是哪一行？这说明了什么？

<details><summary>答案</summary>

`return hook.memoizedState;`

说明 update 阶段**不新建** `{current}`、**不读** initialValue 参数，直接返回 mount 时那个盒子 → 跨 render 引用稳定。
</details>

## Q2
ref 盒子存在"全局"吗？如果不是，存在哪？

<details><summary>答案</summary>

不是全局（全局会导致同组件多实例共用一个 ref 而串台）。存在**该组件实例的 fiber 的 Hook 链表节点**上（`hook.memoizedState`）。每个组件实例有自己的 fiber → 自己的 ref。
</details>

## Q3
为什么 `setN(1)` 会触发 render，`ref.current = 1` 不会？

<details><summary>答案</summary>

`setN` 是 React 的 dispatch，内部 `scheduleUpdateOnFiber` 会调度 render；`ref.current = 1` 只是**普通 JS 对象属性赋值**，React 没有监听/拦截/dispatch 通路，完全不知道，所以不 render。值立即变，视图不变。
</details>

## Q4
useMemo 的 `memoizedState` 结构是什么？缓存值和 deps 分别在哪一项？

<details><summary>答案</summary>

`[value, deps]`。缓存值在 `[0]`，依赖数组在 `[1]`（deps 仅用于下次比较，不是缓存值本身）。
</details>

## Q5
useMemo 和 useCallback 的源码唯一区别是什么？

<details><summary>答案</summary>

useMemo：`const nextValue = nextCreate(); memoizedState = [nextValue, deps]` → 存**执行结果**。
useCallback：`memoizedState = [callback, deps]` → 存**函数本身（不执行）**。
等价：`useCallback(fn, d) ≡ useMemo(() => fn, d)`。
</details>

## Q6
`areHookInputsEqual` 怎么比 deps？用 `==` 还是别的？

<details><summary>答案</summary>

用 `Object.is`（源码 `is` 来自 `shared/objectIs`）**逐项**比较，不是比整个数组引用。任一项不等返回 false。基本类型比值，引用类型比引用。
</details>

## Q7
`const cfg = {n:1}; useMemo(() => f(), [cfg])`，cfg 每次 render 新建。这个 useMemo 能命中缓存吗？

<details><summary>答案</summary>

不能。cfg 每次是新对象，`Object.is(新cfg, 旧cfg)` 永远 false → areHookInputsEqual 永远 false → 每次重算。等于没缓存还更慢。
</details>

## Q8
`useCallback(fn, [])` 单独用（不配 React.memo），有意义吗？

<details><summary>答案</summary>

基本没意义。useCallback 的价值是让传给子组件的函数引用稳定，从而让子组件的 `React.memo` 浅比较 props 命中、子组件 bailout。如果子组件没包 memo，函数引用稳不稳定都照样重渲染。
</details>

## Q9（开放题）
把 Day 6/7/8 的 Hook 按"是否发起 render"分类，并说明判断标准。

<details><summary>思路</summary>

- **能发起 render**：useState / useReducer（有 dispatch 通路 → 入队 → 调度）
- **不能发起 render**：useRef / useMemo / useCallback（render 阶段纯读写）/ useEffect（只是把副作用延迟到 commit，本身不发起更新，但回调里调 setState 可以间接触发）

判断标准：**有没有 dispatch 通路 / 会不会 scheduleUpdateOnFiber**。
</details>
