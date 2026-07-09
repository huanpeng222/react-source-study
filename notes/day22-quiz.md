# Day 22 自测题 — 自研 mini-store

<details>
<summary><b>Q1</b>：为什么改一个普通的全局变量（比如 `globalState.count++`）不会触发 React 组件重渲染？</summary>

因为 `useState`/`useReducer` 只认自己内部的 `dispatch` 机制，普通对象属性赋值不会走这套通知路径。React 完全不知道这行代码发生了什么。外部状态想触发重渲染，必须自己维护一套"通知机制"，再通过 `useSyncExternalStore` 这个官方桥接入 React 的渲染系统。
</details>

<details>
<summary><b>Q2</b>：一个组件用 `useStore(store, s => s.count)` 订阅，另一个组件改了 store 里的 `name` 字段，前者会重新渲染吗？为什么？</summary>

不会。原因不是"广播时区分了谁该收到通知"——`setState` 通知是无差别的（`listeners.forEach` 无条件通知所有订阅者）。真正的过滤发生在 `useSyncExternalStore` 内部：每个组件收到通知后自己重新执行一次 `selector(store.getState())`，React 拿这次算出的值跟上次的值做 `Object.is` 比较，没变的组件会被自动挡住不渲染。
</details>

<details>
<summary><b>Q3</b>：批量更新去重为什么用 `queueMicrotask` 而不是 `setTimeout`？</summary>

`setTimeout` 需要指定一个固定延迟时间，设太短可能来不及合并，设太长会让通知变慢。`queueMicrotask` 不需要猜时间，语义是"这一轮同步代码全部跑完之后立刻执行"，比 `setTimeout`（宏任务）更快更精确。注意：这不是"让出主线程"（那是Scheduler的`shouldYield`在做的事），微任务恰恰是"不让出、立刻执行"。
</details>

<details>
<summary><b>Q4</b>：`subscribe(listener)` 为什么要返回一个"取消订阅"的函数？是不是每次通知完都要重新绑定？</summary>

不是重新绑定。订阅是长期有效的登记，一旦加入 `listeners` 会一直接收未来所有次的通知，直到主动取消。返回取消订阅函数的真正原因是配合 `useEffect` 的清理机制——`subscribe` 的返回值最终会成为某次 `useEffect` 的 cleanup 函数，组件卸载时 React 自动调用它，把这个组件从 `listeners` 里摘掉。如果不这样做会导致内存泄漏，且 store 后续更新会尝试给"已卸载的组件"强制重渲染，触发 React 报错。
</details>

<details>
<summary><b>Q5</b>：`useSyncExternalStore` 是怎么解决"渲染撕裂"问题的？（说出具体的源码机制）</summary>

手写版本（`useState`强制刷新+`useEffect`订阅）的问题：`getState()`在render阶段被调用，但订阅要等`useEffect`（commit之后）才建立，中间这段窗口期如果store值变了，会读到不一致的快照。

`useSyncExternalStore`的解法：①render阶段直接同步调用`getSnapshot()`；②`useEffect`里才真正建立订阅；③额外挂一个"提交后检查"的effect——每次commit完成后，用`checkIfSnapshotChanged`重新读一次快照，跟渲染时读到的比较（`Object.is`），如果不一致，用`forceStoreRerender`以SyncLane（最高优先级）强制重渲染纠正。注意：这个过程**不会丢弃任何数据**，真实state一直在store里，只是触发组件重新去读最新值。
</details>

<details>
<summary><b>Q6</b>：外部store的更新为什么总是走SyncLane（最高优先级）？这带来什么潜在问题？</summary>

因为`forceStoreRerender`内部固定调用`scheduleUpdateOnFiber(root, fiber, 2)`，2就是SyncLane的数值。这保证了撕裂纠正总能"立刻"生效，不会被其他优先级的渲染拖延。但代价是：如果订阅了一个"频繁变化但不重要"的字段（比如鼠标坐标），每次变化都会以最高优先级强制重渲染，可能造成不必要的性能开销——这是需要谨慎选择订阅哪些字段的原因。
</details>

<details>
<summary><b>Q7</b>：`mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe])` 这行代码里，`.bind()` 在做什么？和箭头函数写法有什么区别？</summary>

`.bind()`不是在"调用"函数，是在"打包"一个函数——`fn.bind(null, a, b, c)`返回一个新函数，将来被调用时等价于执行`fn(a, b, c)`。这一行执行时`subscribeToStore`并没有被调用，只是生成了一个"稍后才会被调用的函数"传给`mountEffect`。跟你平时写的`useEffect(() => subscribe(callback), [subscribe])`是完全等价的写法，只是用了不同的语法糖，源码选bind纯粹是内部代码风格/性能考量。
</details>

<details>
<summary><b>Q8</b>：mini-store 和 Zustand 真实源码相比，最大的差异是什么？</summary>

核心骨架几乎一致（getState/setState/subscribe）。主要差异：①批量更新——mini-store用`queueMicrotask`主动去重，Zustand不做批量去重，每次`set`同步通知，依赖React的自动批处理来合并渲染；②Zustand支持自定义`equalityFn`（如`shallow`浅比较）；③Zustand有完整的中间件系统（persist/devtools/immer）和TypeScript类型支持，这些才是它的主要价值所在，核心存储机制并不比mini-store复杂多少。
</details>

<details>
<summary><b>Q9</b>：mini-store 和 useReducer 有什么本质区别？</summary>

`useReducer`的状态存在组件的fiber上，跟组件生命周期绑定，组件卸载状态就没了。mini-store的状态存在模块级闭包里，跟任何组件的生命周期无关，可以被多个不相关的组件树共享，甚至可以在React之外的代码里读写。
</details>

<details>
<summary><b>Q10</b>：如果 `setState` 实现里忘记调用 `notify()`，会出现什么现象？为什么容易被误判成"selector写错了"或"useSyncExternalStore有bug"？</summary>

现象：store内部的`state`数据确实被正确更新了（用`console.log`打印能看到新值），但页面上组件显示的值永远不变。原因：数据更新（`state = {...}`）和通知订阅者（`notify()`）是两个独立的步骤，缺了`notify()`，`listeners`里的回调永远不会被调用，`useSyncExternalStore`就没有机会知道"该重新检查快照了"。容易被误判的原因是现象表现为"页面不更新"，很容易先怀疑selector写错、比较逻辑出问题，但实际上更基础的一步——通知本身——就没有发出去。排查时应该先确认"数据层是否变了"（打印state）和"通知是否发出"（在notify里打印），再往上排查渲染层。
</details>
