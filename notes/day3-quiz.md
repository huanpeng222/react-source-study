# Day 3 自测题（答案折叠，先自己答）

## Q1
React 把通用树 diff 从 O(n³) 砍到 O(n)，用了哪 3 个假设？每个假设牺牲了什么？

<details><summary>👉 答案</summary>

| 假设 | 内容 | 牺牲 |
|---|---|---|
| 1 | type 不同直接重建（不递归对比子树） | 极少情况多创 DOM |
| 2 | 只在同层比对（不跨层移动） | 跨层移动会丢组件 state |
| 3 | 同层比对用 key 标识身份 | 要求开发者写稳定 key |

复杂度跃迁：O(n³) → 假设 1 → O(n²) → 假设 2 → O(n) → 假设 3 加速 → O(n) 常数小。

</details>

## Q2
为什么说 `key={index}` 不是性能问题，是正确性问题？给一个具体例子。

<details><summary>👉 答案</summary>

性能问题 = 慢但结果对；正确性问题 = 结果错。

key=index 会让 React 把"语义身份不同的节点当同一个"，导致：
- 非受控 input 的 value 留在错误的行上
- focus 状态跑偏
- 组件内 state（useState、useReducer）跟错人

例：todos 列表 `[{id:1,A}, {id:2,B}, {id:3,C}]`，用户在第二行 input 输入 "BBB"，然后头部插入 `{id:0,NEW}`。key=index 时 React 复用了 key=1 的 fiber（input value=BBB 仍在），但内容更新成 A → "BBB" 跟在了 A 那一行上 = 用户输入的数据跟错了对象。

</details>

## Q3
单节点 diff 复用的"双条件"是什么？key 相同但 type 不同会发生什么？

<details><summary>👉 答案</summary>

双条件：`key 相同 && type 相同`。

key 同 type 不同：整段兄弟全部标记 Deletion，**新建 wIP**——不会"借用旧 Fiber 的子树"或"先存着以后再用"。

</details>

## Q4
多节点 diff 第一轮什么时候 break？第二轮的 Map 算法处理什么场景？

<details><summary>👉 答案</summary>

**第一轮 break 条件**：从左往右逐对比较，**遇到 key 不同**立即 break。
（注意：type 不同时不 break，会把旧 fiber 标 Deletion + 新建后继续走第一轮。）

**第二轮 Map 算法**处理"中间重排"场景：
- 把剩余旧 fiber 按 key 装进 Map
- 继续遍历新数组，从 Map 找 key 匹配的复用
- 用 lastPlacedIndex 检测是否需要移动
- Map 里没被复用的最后全删除

</details>

## Q5
`lastPlacedIndex` 算法是怎么判断"节点要不要移动"的？为什么是贪心算法不是最优？

<details><summary>👉 答案</summary>

判断规则：
- 复用旧 fiber 时：`oldIndex >= lastPlacedIndex` → 不动，更新 lastPlacedIndex 为 oldIndex
- `oldIndex < lastPlacedIndex` → 标记 Placement（需要"右移"）

直觉：lastPlacedIndex 是"最右放置位置柱子"，能往右推就推、推不动就标记移动。

**贪心而不是最优**：理论最优是 LIS（最长递增子序列）——找出旧序列中保持相对顺序的最长子序列保持不动，只移动其余。Vue 3 用 LIS。React 用贪心是因为：真实场景中差距不显著，简单算法换可维护性。

</details>

## Q6
`<Fragment>` 在 Fiber 树中算几个节点？子节点的 key 写在哪里生效？

<details><summary>👉 答案</summary>

Fragment 在 Fiber 树里**有 1 个节点**（tag=7），但**不创建 DOM**。

子节点 key 直接写在子节点上即可，比如：
```jsx
<>
  <li key="a">A</li>
  <li key="b">B</li>
</>
```

如果 Fragment 自身在父级数组里需要 key（比如外层在 map），必须用完整写法：
```jsx
{items.map(item => (
  <React.Fragment key={item.id}>
    <dt>{item.term}</dt>
    <dd>{item.desc}</dd>
  </React.Fragment>
))}
```

短语法 `<>...</>` **不支持 key**。

</details>

## Q7
为什么 React 没 key 时还会警告 `<div>{[<X/>, <Y/>]}</div>` 这种写法？是性能原因吗？

<details><summary>👉 答案</summary>

**不是性能原因**，是**防身份认错的语义保险**。

React 看到显式数组就默认它是"动态的"（下次 render 可能重排/增删）。没 key 时，diff 只能按下标对应，下次重排时会出现"身份认错"——和 key=index 一样的正确性 bug。

警告的目的是让你**主动给出语义身份**，避免 bug。

</details>

## Q8（开放题）
有人说"React 的 diff 比 Vue 差，因为不是最优"。你怎么回应？

<details><summary>👉 我的思考方向</summary>

- "不是最优"在算法层面是真的（贪心 vs LIS）
- 但**最优≠最好**：算法越复杂，维护成本、bug 风险、源码可读性都越高
- React 团队的取舍是"心智模型简单 + 行为可预测 > 算法精妙"
- 真实业务里"完全乱序"列表罕见，多数场景是末尾追加/局部重排，贪心已够用
- Vue 3 选了另一头：极致优化 + 复杂实现
- **没有谁对谁错，只有不同取舍**

更深一层：React 整个设计哲学贯穿"够用就好"——比如 Hooks 用 useEffect 也不是性能最优（每次都跑），但心智模型简单到没人吐槽。

</details>

---

## 完成后

把答错的题对应的章节，在 `notes/day3.md` 里重读一遍。

下一站：**Day 4 · beginWork / completeWork 工作循环**。
