# Day 2 自测（答案折叠，先自己答）

## Q1
React Element 树到屏幕真实 DOM，至少经过几个阶段？哪几个是 React 干的，哪几个是浏览器干的？

<details><summary>👉 答案</summary>

4 阶段：
1. **Reconcile**（React，可中断）：Element 对比生成 Fiber wIP 树
2. **Commit**（React，同步不可中断）：把 effect 应用到 DOM
3. **Style + Layout + Paint**（浏览器）
4. **Composite**（浏览器/GPU）
</details>

## Q2
Fiber 的 `return / child / sibling` 三指针，为什么不用 `parent / children: []`？

<details><summary>👉 答案</summary>

- `children: []` 数组遍历必须递归，调用栈一塌进度全没。
- 链表式 `child + sibling` 可以纯循环遍历，状态全在 `workInProgress` 一个变量里。
- 这是 Fiber **可中断**的物理基础。
</details>

## Q3
`alternate` 字段什么时候是 `null`，什么时候有值？

<details><summary>👉 答案</summary>

- **mount 阶段（首次渲染）**：只有 wIP 树，无 current 配对，alternate = null。
- **首次 commit 完成后**：wIP 升格成 current。
- **第二次 setState 触发更新时**：基于 current clone 出新 wIP，alternate 才有值。
</details>

## Q4
双缓存解决了什么问题？为什么不能"边算边渲染"？

<details><summary>👉 答案</summary>

边算边渲染会导致：
- 算到一半被中断 → 用户看到残缺画面（**画面撕裂**）。
- reconcile 抛异常 → DOM 已经改了一半，无法回退。

双缓存让"正在画的"和"正在看的"是两块独立内存：
- 中断安全
- 出错可整棵丢弃
- 节点复用省内存
</details>

## Q5
`fiber.flags = 4194816`，怎么知道它意味着什么？

<details><summary>👉 答案</summary>

flags 是**位运算掩码**。React 源码里每个副作用类型对应一个位：
```
Placement = 0b10            = 2
Update    = 0b100           = 4
Deletion  = 0b10000         = 16
Ref       = 0b1000000000    = 512
Passive   = 0b100000000000  = 2048
...
```

通过位与判断：`if (flags & Update) { ... }`。
</details>

## Q6（开放题）
如果让你设计 React 19，你会保留 `alternate` 字段吗？还是换成数组 `[currentNode, wIPNode]`？为什么？

<details><summary>👉 我的思考方向</summary>

保留 alternate 的优势：
- 双向访问 O(1)
- 不需要额外索引

换数组的优势：
- 三缓冲、四缓冲扩展容易
- 调试更直观

React 团队选了 alternate，是因为**绝大多数场景只需要"另一份"**，不需要三缓冲。
</details>

---

## 完成后

把答错的题对应的章节，在 `notes/day2.md` 里重读一遍。

下一站：Day 3 · Reconcile diff 算法。
