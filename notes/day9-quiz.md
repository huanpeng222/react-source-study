# Day 9 自测（答案折叠，先自己答）

## Q1
`useContext` 和其他 Hook（useState/useRef/useMemo）在"是否占 Hook 链表节点"上的区别是什么？为什么会有这个区别？

<details><summary>答案</summary>

useContext **不占** Hook 节点（不走 mountWorkInProgressHook）。因为它**不需要跨 render 持久化存储**——state/ref/缓存值需要存，但 context 的 `_currentValue` 本身就是权威来源，每次 render 直接 `readContext` 读一下就行。
</details>

## Q2
`pushProvider` 和 `popProvider` 分别在哪两个阶段调用？核心作用是什么？为什么要分两处？

<details><summary>答案</summary>

- `pushProvider`：beginWork（下钻时）：旧值压栈 → `_currentValue = 新值`
- `popProvider`：completeWork（回溯时）：弹栈恢复旧值

分两处是因为**消费发生在遍历子 fiber 的过程中**（子 fiber 的 beginWork 调 readContext），不是当前 fiber 自己。嵌套 Provider 必须有栈机制才能正确隔离作用域，防止内层值泄漏。
</details>

## Q3
`readContext` 把"当前组件消费了哪个 context"记录到哪？用的是 `fiber.memoizedState` 还是别的字段？

<details><summary>答案</summary>

记录到 **`fiber.dependencies.firstContext`** 链表。不是 `fiber.memoizedState`（那是 Hook 节点链表）。
</details>

## Q4
Provider 的 value 变化时，`propagateContextChanges` 怎么找到所有消费者？找到后怎么强制它们更新？

<details><summary>答案</summary>

DFS 遍历 Provider 的所有子 fiber，检查每个 fiber 的 `dependencies.firstContext` 链表。当 `dep.context === changedContext`（引用比较）匹配时，`consumer.lanes = mergeLanes(consumer.lanes, renderLanes)`。改 lanes → 破坏 bailout 条件 → 强制渲染。
</details>

## Q5
Context 更新为什么能"穿透" React.memo？

<details><summary>答案</summary>

`propagateContextChanges` 改了消费者 fiber 的 `lanes`。beginWork 里的 bailout 判断检查 `hasScheduledUpdateOrContext()` — 发现 lanes 不为空 → bailout 失败 → 即使 memo 的 props 浅比较通过，也要走完整渲染路径。**不是 memo 主动放行，是 bailout 条件被破坏了。**
</details>

## Q6
`<MyContext.Provider value={{ count }}>`，每次 App render 这个 value 都是新对象。这个有什么性能问题？

<details><summary>答案</summary>

每次 value 引用都变 → `propagateContextChanges` 触发 → 所有消费了 MyContext 的 fiber 被标记 lanes → **全部强制重渲染**（即使它们只用了别的字段，即使用了 memo 也拦不住）。修复：`useMemo` 稳定 value 引用 + 拆分 Context。
</details>

## Q7（开放题）
如果 `useContext` 也像其他 Hook 一样占 Hook 节点并挂到 `memoizedState` 链表上，会有什么问题？

<details><summary>思路</summary>

- 它就必须保持调用顺序稳定（不能放 if/for 里）
- 它就必须在 mount 时分配节点、update 时按位置克隆——比当前直接 `readContext` 重
- 它本不需要跨 render 持久化存储，白占一个节点和遍历成本

所以 React 把它设计成"不占节点 + 直接读 _currentValue + dependencies 记录依赖"的轻量路径，和其他 Hook 完全不同。
</details>
