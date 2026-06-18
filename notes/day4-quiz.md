# Day 4 自测题（答案折叠，先自己答）

## Q1
beginWork 内部对函数组件 / 类组件 / DOM 节点的处理有什么核心差异？

<details><summary>👉 答案</summary>

| | FunctionComponent | ClassComponent | HostComponent |
|---|---|---|---|
| 调用什么 | `Component(props)` 函数 | `instance.render()` 方法 | 不调用任何函数 |
| 实例 | 没有 | 有，跨 render 保留 | 没有 |
| state 存哪 | fiber.memoizedState（Hook 链表） | instance.state | 无 |
| Hook 链表 | ✅ 这里建立 | ❌ | ❌ |
| children 来源 | 函数返回的 JSX | render() 返回的 JSX | props.children |

</details>

## Q2
React 的 bailout 触发条件是什么？bailout 后还会继续处理子树吗？

<details><summary>👉 答案</summary>

**3 个条件同时满足才 bailout**：
1. `oldProps === newProps`（引用相等，不是值相等）
2. Context 没变
3. 当前 Fiber 没有 scheduled update

**bailout 不一定整棵子树都跳过**：
- `childLanes = 0` → 整棵子树彻底跳过
- `childLanes` 命中 → 当前 Fiber bailout，但 cloneChildFibers 后子树继续走

这就是为什么"父 memo 了，子组件还能渲染"——子可能自己有 setState。

</details>

## Q3
`fiber.flags` 和 `fiber.subtreeFlags` 分别在哪个阶段被设置？为什么要分开？

<details><summary>👉 答案</summary>

| 字段 | 设置时机 | 含义 |
|---|---|---|
| `fiber.flags` | beginWork（reconcileChildren 内部） | 我自己要不要变（Placement / Update / Deletion / Ref / Passive 等） |
| `fiber.subtreeFlags` | completeWork（bubbleProperties） | 子树有没有人要变（位运算合并） |

**为什么分开**：
- flags 是当前节点 diff 时打的，beginWork 阶段就能确定
- subtreeFlags 必须等子节点全部 complete 完才能汇总
- commit 阶段靠 subtreeFlags 整棵子树剪枝（O(n) → O(log n)）

口诀：**flags 在 beginWork 打，subtreeFlags 在 completeWork 冒。**

</details>

## Q4
DOM 节点是在哪个阶段创建的？为什么这么设计？

<details><summary>👉 答案</summary>

**DOM 节点（detached、不挂载）在 completeWork 阶段就创建好了**。commit 阶段只负责把整棵 detached DOM 树 appendChild 到真实文档。

**3 个原因**：
1. 子 DOM 必须先存在父才能 appendChild（completeWork 是回溯，子已 complete）
2. 子 effect 必须先冒泡，父才能正确剪枝
3. beginWork 可中断重做，把 DOM 创建放 completeWork 避免反复重建

**类比**：
- beginWork = 设计图纸
- completeWork = 工厂预制家具（detached）
- commit = 一口气搬进新家

</details>

## Q5
Hook 链表挂在哪里？为什么 Hook 必须顶层调用？

<details><summary>👉 答案</summary>

**Hook 链表挂在 `fiber.memoizedState` 上**（单向链表）。

```
fiber.memoizedState
    ↓
  Hook1 (useState count)
    .next ↓
  Hook2 (useState name)
    .next ↓
  Hook3 (useEffect)
    .next ↓
  null
```

**必须顶层调用的原因**：React 完全按"调用顺序"对应链表节点。

```jsx
// ❌ 错误
if (flag) { useState(0) }   // 第一个 Hook
useState(1)                  // 第二个 Hook
```

第一次 render flag=true → 链表 [a, b]
第二次 render flag=false → 只调 1 次 useState → 取链表第 1 个节点 → 拿到 a 的值 → **赋给变量 b**！

变量名在 React 眼里毫无意义——React 只看调用顺序。

</details>

## Q6
1000 节点的 Fiber 树，只有最深处一个 input 要更新。**有冒泡**和**没冒泡**两种情况下，commit 阶段需要遍历多少节点？

<details><summary>👉 答案</summary>

**没冒泡**：commit 必须挨个查每个 Fiber 的 flags → **O(n) = 1000 次**

**有冒泡**：从根开始，看 subtreeFlags：
- subtreeFlags = 0 的子树整棵跳过
- subtreeFlags 命中 → 进入

只走"从根到 input 的一条路径" → **O(深度) ≈ O(log n) ≈ 10 次**

**1000 倍性能差距** = React 大型应用 60fps 的物理基础。

</details>

## Q7
React.memo 包裹的组件，父组件 setState 时一定会 bailout 吗？

<details><summary>👉 答案</summary>

**不一定**。看 props 引用：

```jsx
const Counter = React.memo(Counter);

// ✅ bailout 命中
<Counter initial={0} />              // initial 是字面量，引用稳定
<Counter callback={memoCallback} />  // 配合 useCallback

// ❌ bailout 失效
<Counter obj={{value: count}} />     // 每次 render 都生成新对象
<Counter onClick={() => doX()} />    // 每次 render 都新建 inline 函数
```

memo 默认是浅比较：先 `Object.is(oldProps, newProps)`，然后逐 key `Object.is(oldProps[k], newProps[k])`。

**注意是浅比较**——`{a:{b:1}} === {a:{b:1}}` 是 false（a 的引用不等）。

</details>

## Q8（开放题）
为什么 React 团队把 reconcile 设计成可中断（异步）、commit 设计成不可中断（同步）？

<details><summary>👉 我的思考方向</summary>

reconcile 阶段：
- 在内存里操作 Fiber 树和 detached DOM
- 用户看不到任何变化
- 可以反复重做（高优先级任务来了就丢弃 wIP）
- 必须可中断 → 否则千万节点会阻塞主线程

commit 阶段：
- 直接操作真实 DOM（用户能看到）
- 中断到一半 = 残缺画面（半个组件、半个属性）
- 必须同步、一次性搞完

**核心哲学**：
- 思考阶段反复来都没事 → 设计成可中断
- 动手阶段一次性搞完 → 设计成同步

这就是 React 18 并发渲染的物理基础。

</details>

---

## 完成后

把答错的题对应的章节，在 `notes/day4.md` 里重读一遍。

下一站：**Day 5 · commit 阶段（before mutation / mutation / layout 三子阶段）**。
