# Day 3 精简笔记 · Reconcile 的 diff 算法

> 📌 给"未来要复习/面试"的我看的速查卡。完整教程见 `day3.md`。
> 跟练时间：2026-06-18 下午
> 状态：✅ 理论吃透，实验待跑

---

## 🎯 一句话总结 Day 3

> **React 用 3 个工程假设把 O(n³) 砍到 O(n)，diff 不追求最优解、追求语义清晰可预测。key 是身份证，不是性能优化。**

---

## 📋 必背知识点（面试前 3 分钟过）

### 1. 三大假设 + 复杂度跃迁（必背）

| 假设 | 内容 | 代价 |
|---|---|---|
| 1. type 不同直接重建 | `<div>`→`<span>` 整树丢弃 | 极少多创 DOM |
| 2. 只同层比对 | 跨层移动 = 删 + 新建 | 跨层会丢 state |
| 3. key 标识身份 | 列表对应靠 key | 要开发者写 key |

```
O(n³) → 假设1 → O(n²) → 假设2 → O(n) → 假设3 → O(n) 但常数小
```

### 2. key=index 的"身份认错"（最坑）

| 用法 | 后果 |
|---|---|
| 不写 key | 警告 + 按 idx 硬比，状态错乱 |
| `key={index}` | 列表重排时 input/focus/state **跟错人** |
| `key={item.id}` | 唯一稳定 → 正确 |

**关键**：这是**正确性 bug**（结果错），**不是性能问题**（慢但结果对）。

### 3. type 变化 = 整树重建

```jsx
<div><Counter /></div> ↔ <span><Counter /></span>
```

切换会让 Counter 销毁重建，state 重置。

### 4. Fragment

- Fiber 树里**有节点**（tag=7），**不创建 DOM**
- `<>` 短语法不支持 key，要 key 必须 `<React.Fragment key="x">`

### 5. 单节点 diff：双条件复用

```
匹配 = (key 相同) && (type 相同)
匹配 → 复用 alternate；其他兄弟全标 Deletion
不匹配 → 整段删除，新建
```

### 6. 多节点 diff：双轮遍历

```
第一轮：从左比对（key 相同就尝试复用，key 不同 break）
  ✓ 末尾追加、删尾、全量更新一遍过

第二轮：建 Map（key→fiber），通用路径
  ✓ 中间重排走这里
  ✓ lastPlacedIndex 检测移动
  ✓ Map 剩下的全删除
```

### 7. lastPlacedIndex 算法（贪心）

```
柱子 = lastPlacedIndex（最右放置位置）
新位置复用旧 idx：
  - 旧 idx ≥ 柱子 → 不动，柱子推到旧 idx
  - 旧 idx < 柱子 → 标记 Placement（移动）
```

### 8. React vs Vue 3

| | React | Vue 3 |
|---|---|---|
| 算法 | 贪心 + lastPlacedIndex | 双端 + LIS |
| 复杂度 | O(n) | O(n log n) |
| 哲学 | 够用就好 | 极致优化 |

---

## ❓ 我的疑问追问记录

跟练时没追问，主要是入场自测的反馈和后续的反问环节。

### 入场自测我的答题情况

| Q | 我的答案 | AI 点评 |
|---|---|---|
| Q1 三大假设 | 不会 | OK，这就是 Day 3 主菜 |
| Q2 key 不写/index/id | index 会因数组插入删除变化 + id 唯一可用 | ✅ 抓到核心 |
| Q3 type 变化复用？ | 不会，根据 fiber.type 判断 | ✅ 100% 对 |
| Q4 Fragment | 第零个节点，不清楚 | 🟡 方向对但精度差 |

### AI 反问环节（我答的）

| 反问 | 我答的 | 标准答案 |
|---|---|---|
| A. key=index 为啥不是性能问题 | 渲染错乱，导致重建影响性能 | **状态错乱（input/focus 跟错人）= 正确性 bug**，不是慢 |
| B. 显式数组没 key 为啥警告 | 没 key diff 复杂度更高 | **防身份认错**（语义安全），不是防性能 |
| C. 不做假设 1 会怎样 | 复杂度 O(n²) | ✅ 答对了。补充：还有"语义复用规则爆炸"的工程地狱 |

---

## 🐛 我的踩坑记录

### 坑 1：把 key 当性能优化（最严重）

我以为"加 key 是为了 diff 更快"。

**纠正**：key 的根本作用是**语义身份证**——告诉 React"哪个对应哪个"。**没 key 会出正确性 bug**（input 错位、state 跟错人、focus 跑偏），不是慢。

记忆：**性能 bug 是慢但结果对，正确性 bug 是结果错。**

### 坑 2：以为没 key 的 React 警告是"性能提醒"

跟坑 1 一脉相承。**警告的真正动机是防 bug，不是防性能**。

### 坑 3：以为 Fragment 完全不存在

我答"第零个节点"，方向对但理解偏。**Fragment 在 Fiber 树里有真实节点**（tag=7），只是不映射到 DOM。它影响层级关系（决定哪些 li 是兄弟）。

### 坑 4：以为 React diff 是某种"最优算法"

我下意识觉得 React 团队肯定用了顶尖的论文算法。**结果发现是贪心算法**，比 Vue 3 的 LIS 都简单。

**认知转变**：源码设计是**取舍**，不是"越复杂越好"。React 在心智模型上选"简单"，Vue 在 diff 上选"极致"。

### 坑 5：以为"三大假设"是"妥协"

直觉觉得"假设 = 牺牲了正确性来换性能"。

**纠正**：每条假设同时解决两件事——**降复杂度 + 消语义歧义**。比如假设 1 不光省 O(n²)，还省了"type 不同时 attribute/event/ref/effect 怎么迁移"的一堆边界规则。

### 坑 6：以为 key 同 type 不同会"break 进第二轮"

跟练时 AI 反问 `<div key="a">` → `<span key="a">` 第一轮发生什么，我答"标记删除重建，直接 break"。

**纠正**：**不会 break**。
- key 决定"break or not"（要不要进第二轮 Map 算法）
- type 决定"复用对象 or 新建对象"

两个判定**独立**。key 同 type 不同时：销毁旧 fiber + 新建 wIP，**但保持当前位置对应，继续走第一轮下一对**。

记忆：**key 管位置对应关系，type 管对象身份。**

### 坑 7：误以为 lastPlacedIndex 初始 -1 才对

跟练时被问"为什么 lastPlacedIndex 初始 = 0 而不是 -1"，我说"说不准"。

**纠正**：fiber.index 最小就是 0，用 0 作为"基准哨兵"和实际值类型一致，避免源码里到处写 `=== -1` 判空判断。效果上 0 和 -1 在算法行为上几乎等价，选 0 是工程美学。

### 坑 8：不知道 Vue 3 diff 算法

跟练时 AI 问 React 不用 LIS 是不是"不如 Vue"，我答"Vue diff 算法是啥，不了解"。

**纠正**：
- Vue 2/3 用**双端比较**（4 指针：oldStart/oldEnd/newStart/newEnd），4 种命中场景任意一种命中就处理一对
- Vue 3 在 4 种都没命中时走 **Map + LIS**（最长递增子序列），找到旧序列里相对顺序不变的最长子序列保持不动，移动其他
- React 贪心算法对比 Vue 3 LIS，真实场景通常多移动 0-2 次
- React 团队选简单算法换源码可维护性

### 坑 9：以为 input type 没变就不会重建（忽略祖先 type 变化）

跟练时 AI 反问 "`<div><input defaultValue='hello' /></div>` ↔ `<span><input defaultValue='hello' /></span>` 切换时 input 内容会重置吗"，我答"不会，type 一致"。

**纠正**：input 内容**会重置**。准确假设 1 是 **"同一位置的 Fiber，如果 type 变了，整棵子树重建"**。

React 看到第 0 层位置 0 的 div → span，type 变了 → 立刻判定整棵子树重建（包括内部 input）→ DOM 是新的 → defaultValue='hello' 重新生效 → 用户输入丢失。

**反例**：`<div><input /></div>` ↔ `<div className="x"><input /></div>`（div type 同），input 不重建，输入保留。

**口诀**：**复用 = 同位置 + type 同。任何祖先 type 变 = 整棵子树重建。**

### 坑 10：以为 Fiber 复用 = useEffect 不跑

D2 实验里我观察到 key=id 时 shuffle 后 A 和 C 出现 UNMOUNT + MOUNT，跟我预期的"全部 UPDATE"不一致。

**纠正**：**Fiber 是复用的（对象引用没变），但 DOM 节点的"移动"被 React 解释为"重新挂载"**，触发 useEffect cleanup + rerun。

原因：Placement 在 commit 阶段执行 `insertBefore`，浏览器把已存在的 DOM 先 detach 再 attach。React 的 effect 系统观察到这个过程就触发 cleanup + rerun。

**这个行为和依赖数组无关**——即使 useEffect 写 `[id]`，DOM 移动也会触发 cleanup + rerun。唯一办法：不要让它移动。

记忆：**Fiber 复用 ≠ DOM 不动 ≠ useEffect 不跑**。三件事独立。

### 坑 11：以为 key=index "在只更新场景下也会出 bug"

跟练挑战题：写"列表只更新（不增不删不重排）"场景下 key=index 出 bug 的最小例子。我答"想不到"。

**纠正**：想不到是**对的**。"key=index 出 bug" 必须依赖 **"index 与语义身份的对应关系发生改变"**——要么重排，要么增删。

只更新不增删不重排时，i 和 id 本质上是一一对应的，key=index 没问题。

**但**：这种保证非常脆弱（今天保证，明天迭代加排序就崩）。所以最佳实践**永远用 id**，永远不要赌。

---

## 🎨 5 条认知纠正

详见 `meta/cognitive-corrections.md` Day 3 段落。挑 5 条最重要：

1. key=index 是正确性问题（不是性能问题）
2. 没 key 警告是防身份认错（不是防性能）
3. Fragment 在 Fiber 树有节点 tag=7（不是完全不存在）
4. React diff 是贪心算法（不是最优）
5. 三大假设同时省性能 + 省语义歧义（不是妥协）

---

## 🧪 实验状态

- [ ] D1：key=index 复现 input 错位
- [ ] D2：mount/unmount 日志验证多节点 diff
- [ ] D3：type 变化导致 state 重置

⚠️ 三个实验都没跑，等空了补一下。理论已吃透，跑实验是把"知道"变成"看到"。

---

## 🎯 最值得记的一句话

> **React diff 不是为了"算得快"，而是为了"语义清晰、行为可预测"。性能只是顺便。**

这句话贯穿了所有 diff 决策——为什么 type 变要重建、为什么没 key 要警告、为什么贪心而不 LIS。

---

## 📌 Day 4 衔接

Day 3 讲了 diff（reconcile 内部具体动作），Day 4 进入 **beginWork / completeWork** 工作循环——把 diff 的执行包装成"可中断、可剪枝"的工作单元。

预读问题已写在 `day3.md` 末尾。

---

_最后更新：2026-06-18，跟练完成后回填_
