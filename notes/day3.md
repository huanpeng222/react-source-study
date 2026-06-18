# Day 3 笔记：Reconcile 的 diff 算法

> 日期：2026-06-18
> 主题：从 O(n³) 到 O(n) 的思想跃迁 + 多节点 diff 双轮遍历算法
> 状态：📖 学习中

---

## 零、入场自测（5 分钟，先自己答再往下看）

1. React diff 复杂度被压到 O(n)，用了哪 3 个假设？
2. 同层节点列表 diff，**key 不写 / 用 index 当 key / 用 id 当 key** 三种情况分别会发生什么？
3. 节点类型变了（`<div>` 改 `<span>`，或 `<App>` 改 `<Page>`），React 会复用 DOM 吗？为什么？
4. `<Fragment>` 在 diff 时算一个节点还是零个节点？子节点的 key 写在哪个层级生效？

<details>
<summary>📌 我自己的回答</summary>

1. 不清楚
2. index 会因数组的插入删除而变化，前后同一个 index 可能会出现对应不同的结构，会造成渲染异常；id 如果唯一的话用做 key 是没有问题的
3. 不会，因为会根据 fiber 节点的 type 来判断到底能不能复用
4. 第零个节点，不清楚

</details>

---

## 一、为什么 React 必须把 diff 砍到 O(n)

### 1.1 通用树 diff 是 O(n³)

学术界经典算法 **Zhang-Shasha**（1989）解决"给两棵任意结构的树 T1 和 T2，找最少编辑操作"：

```
n = 节点数
外层遍历 T1 所有节点          O(n)
对每个节点遍历 T2 候选        O(n)
对每对节点考虑子树编辑        O(n)
─────────────────────────
总计                          O(n³)
```

数学题：React 应用 1000 节点 → 10⁹ 次操作 → **1 秒级卡顿** → 商用不可能。

### 1.2 React 的工程哲学

> **"不要最优解，要够用的解。语义清晰、行为可预测优先于算法精妙。"**

React 团队观察大量真实应用，发现 UI 变化有 3 个**统计规律**，把它们变成"假设"，从而砍掉绝大部分对比工作。

---

## 二、React 的 3 个核心假设

### 假设 1：不同类型的元素产生不同的树

> **type 变了（`<div>` → `<span>`、`<App>` → `<Page>`），整棵子树丢弃 + 重建**，不尝试比对内部。

```jsx
// before              // after
<div>                  <span>
  <Counter />            <Counter />
</div>                 </span>
```

理论上 Counter 在两边都在，应该可以复用——React 说"算了，连带 Counter 一起销毁重建"。

**牺牲**：极少数情况下多创建 DOM。
**换来**：复杂度砍掉一维 + 省掉一堆"如何复用不同类型节点"的语义歧义。

### 假设 2：只在同层比对，不跨层移动

> **节点从 A 父亲移到 B 父亲**，React 视为"A 处删除 + B 处新建"。

```jsx
// before                  // after
<App>                      <App>
  <Header>                   <Logo />
    <Logo />                 <Header />
  </Header>                </App>
</App>
```

`<Logo />` 实际是"跨层移动"，React 却看作 2 步：Header 内 Logo 删除 + App 内 Logo 新建。

**牺牲**：跨层移动会丢失组件状态。
**换来**：每个节点只跟同层兄弟比对，无需跨层查找。

### 假设 3：同层比对用 key 标识身份

> **列表渲染时 key 是"语义身份证"**，没 key 只能按下标硬比。

```jsx
// before                       // after
<ul>                            <ul>
  <li key="a">A</li>              <li key="c">C</li>
  <li key="b">B</li>              <li key="a">A</li>
  <li key="c">C</li>              <li key="b">B</li>
</ul>                           </ul>
```

有 key：一眼看出"顺序变了"，**移动 DOM 节点**即可。
没 key：按下标比，"位置 0 的 A 变 C，位置 1 的 B 变 A..." → **整体删除重建**。

### 三个假设组合后的复杂度跃迁

```
通用 O(n³)
   ↓ 假设 1：type 不同直接重建（不递归对比子树）
O(n²)
   ↓ 假设 2：只同层比对（不跨层）
O(n)
   ↓ 假设 3：key 加速同层对比
O(n)，且常数小
```

---

## 三、3 个假设带来的 3 类正确性 bug

### 3.1 key=index 的"身份认错"（最经典坑）

```jsx
function TodoList({ todos }) {
  return todos.map((todo, i) => (
    <li key={i}>
      <input defaultValue={todo.text} />   {/* 非受控 input */}
      <span>{todo.text}</span>
    </li>
  ));
}
```

**操作流程**：

1. 初始 `[{id:1,text:'A'}, {id:2,text:'B'}, {id:3,text:'C'}]`
2. 用户在第二行 input 改成 "BBB"
3. 在数组头部插入 `{id:0,text:'NEW'}`

**React 的视角**（key=index）：

| 新位置 | 新 key | 新 text | 旧 key=index 节点 | 动作 |
|---|---|---|---|---|
| 0 | 0 | NEW | key=0（原 A） | 同 key 复用，更新 span 文本 |
| 1 | 1 | A | key=1（原 B，input 是 BBB） | **同 key 复用！input 内部 value 仍是 "BBB"** 🤯 |
| 2 | 2 | B | key=2（原 C） | 同 key 复用 |
| 3 | 3 | C | 不存在 | 新建 |

**结果**（错位）：

```
[ A   ] NEW     ← input 仍是 A（原 key=0 行的 input）
[ BBB ] A       ← input 仍是 BBB，但 span 显示 A 🤯
[ C   ] B
[     ] C
```

**用户输入的 "BBB" 神奇地跟在了错的行上**。

**这是正确性 bug，不是性能 bug**：
- 性能 bug = 慢，但结果对
- 正确性 bug = 结果错（**认错人**）

#### 什么时候 key=index 是安全的

3 条件全满足：

1. 列表元素**只读**（无 input/focus/state）
2. 列表**永不重排**
3. 列表**永不增删**

### 3.2 显式数组没 key 的警告

```jsx
<div>{[<X />, <Y />]}</div>     // ⚠️ Warning
<div><X /><Y /></div>            // ✅ 不要求 key
```

| 写法 | React 视角 | 要 key 吗 |
|---|---|---|
| 静态 `<X /><Y />` | 编译期已知 2 个子节点，位置固定 | ❌ |
| 数组 `[<X/>, <Y/>]` | 假设动态（可能重排/增删） | ✅ |

警告目的：**防身份认错**，不是防性能。

### 3.3 type 变化导致 state 丢失

```jsx
{ isDiv 
    ? <div><Counter /></div>
    : <span><Counter /></span> }
```

切换 div ↔ span → Counter 销毁重建 → state 重置。这是假设 1 的副作用。

---

## 四、Fragment 在 diff 里算几个节点

### 精确答案

> Fragment 在 Fiber 树里**有自己的节点**（tag = 7），但**不会创建 DOM**。diff 时影响"层级关系"，不影响"DOM 操作"。

### 对比

```jsx
// 场景 A                    // 场景 B
<>                           <div>
  <li>A</li>                   <li>A</li>
  <li>B</li>                   <li>B</li>
</>                          </div>
```

Fiber 树：

```
场景 A:                  场景 B:
  Fragment(tag=7)           div(tag=5)
    li                        li
    li                        li
```

**渲染结果**：
- A：直接 `<li>A</li><li>B</li>`
- B：`<div><li>A</li><li>B</li></div>`

### Fragment 的 key

```jsx
<>...</>                              // ❌ 短语法不支持 key
<React.Fragment key="x">...</>        // ✅ 完整写法支持
```

短语法 `<>` 不支持 key，是常见踩坑。

---

## 五、单节点 diff（源码级）

当 newChild 是一个 React Element 时，走 `reconcileSingleElement`。

### 5.1 三步判定

```
拿到旧 fiber 的第一个 child
  ↓
循环遍历它的 sibling 链表，找匹配项
  ↓
匹配项 = (key 相同) && (type 相同)
  ↓
匹配上 → 复用 alternate；其他兄弟标 Deletion
没匹配 → 整段兄弟标 Deletion，新建 wIP
```

### 5.2 源码简化版

```js
function reconcileSingleElement(returnFiber, currentFirstChild, element) {
  const key = element.key;
  let child = currentFirstChild;

  while (child !== null) {
    if (child.key === key) {
      if (child.type === element.type) {
        // ✅ key + type 都同 → 复用
        deleteRemainingChildren(returnFiber, child.sibling);
        const existing = useFiber(child, element.props);
        existing.return = returnFiber;
        return existing;
      } else {
        // key 同 type 不同 → 整段删除，新建
        deleteRemainingChildren(returnFiber, child);
        break;
      }
    } else {
      // key 不同 → 删除这个，看下一个兄弟
      deleteChild(returnFiber, child);
    }
    child = child.sibling;
  }

  const created = createFiberFromElement(element);
  created.return = returnFiber;
  return created;
}
```

### 5.3 关键洞察

| 关键点 | 说明 |
|---|---|
| 双条件复用 | `key 相同 && type 相同` 才复用 |
| key 不同直接删 | 不保留 fiber 等"以后再用" |
| 复用 = `useFiber()` | 即 `createWorkInProgress`（Day 2 §4.7 对象复用机制） |
| 复用后整段兄弟全删 | 因为新 child 只有一个 |

---

## 六、多节点 diff（源码级，重点）

> React 源码里最精彩的算法之一，面试高频。

当 newChild 是数组时，走 `reconcileChildrenArray`。

### 6.1 核心思想：双轮遍历

```
第一轮（快速路径）：从左往右逐个比对
  - key 相同 → 复用
  - type 不同 → 旧标 Deletion + 新建 wIP（但不 break，继续）
  - key 不同 → break，进第二轮
  - 直到新数组或旧链表走完

第二轮（通用路径）：处理剩下的
  - 旧 fiber 剩余兄弟存进 Map（key → fiber）
  - 继续遍历新数组，从 Map 找 key 匹配的复用
  - 找不到就新建
  - 用 lastPlacedIndex 检测节点是否需要移动
```

### 6.2 第一轮：快速路径

```js
let oldFiber = currentFirstChild;
let lastPlacedIndex = 0;
let newIdx = 0;

for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
  const newChild = newChildren[newIdx];

  if (oldFiber.key !== getKey(newChild)) break;   // key 不同 → 进第二轮

  const newFiber = updateSlot(oldFiber, newChild);
  // updateSlot 内部：
  //   - type 相同 → 复用 alternate
  //   - type 不同 → 删旧 + 新建（但继续走第一轮）

  lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
  oldFiber = oldFiber.sibling;
}
```

**第一轮能搞定的场景**：

| 场景 | 第一轮表现 |
|---|---|
| 末尾追加 `[A,B,C] → [A,B,C,D]` | 一遍走完旧链表 → 第二轮新建 D |
| 删尾 `[A,B,C] → [A,B]` | 新数组遍历完，剩余旧节点标 Deletion |
| 全量更新 `[A,B,C] → [A',B',C']` | 一遍跑完，全部复用 |
| 中间重排 `[A,B,C] → [A,C,B]` | B vs C 时 key 不同 → break 进第二轮 |

⭐ **设计哲学**：React 假设"真实业务大部分是末尾追加 / 整体更新"——这是统计规律。

### 6.3 第二轮：通用路径

第一轮 break 后三种情况：

**情况 A：旧链表走完，新数组还没完** → 剩下全新建

```js
if (oldFiber === null) {
  for (; newIdx < newChildren.length; newIdx++) {
    const newFiber = createChild(newChildren[newIdx]);
    placeChild(newFiber, lastPlacedIndex, newIdx);
  }
  return;
}
```

**情况 B：新数组走完，旧链表还有剩** → 剩下全删

```js
if (newIdx === newChildren.length) {
  deleteRemainingChildren(returnFiber, oldFiber);
  return;
}
```

**情况 C（最复杂）：双方都没完 → Map 算法**

```js
const existingChildren = new Map();
let child = oldFiber;
while (child !== null) {
  existingChildren.set(child.key ?? child.index, child);
  child = child.sibling;
}

for (; newIdx < newChildren.length; newIdx++) {
  const newChild = newChildren[newIdx];
  const newFiber = updateFromMap(existingChildren, newChild, newIdx);

  if (newFiber !== null) {
    if (newFiber.alternate !== null) {
      existingChildren.delete(newFiber.key ?? newIdx);
    }
    lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
  }
}

// Map 里剩下的全删除
existingChildren.forEach(fiber => deleteChild(returnFiber, fiber));
```

### 6.4 lastPlacedIndex 移动检测（最绕的地方）

```js
function placeChild(newFiber, lastPlacedIndex, newIndex) {
  newFiber.index = newIndex;
  const current = newFiber.alternate;

  if (current !== null) {
    const oldIndex = current.index;
    if (oldIndex < lastPlacedIndex) {
      // ★ 旧位置 < 最后放置位置 → 需要"右移"
      newFiber.flags |= Placement;
      return lastPlacedIndex;
    } else {
      // 旧位置 ≥ lastPlacedIndex → 不动，更新柱子
      return oldIndex;
    }
  } else {
    // 新建节点
    newFiber.flags |= Placement;
    return lastPlacedIndex;
  }
}
```

**直觉**：`lastPlacedIndex` 像一根"最右端柱子"。

```
新位置 0：复用旧 idx=2 → lastPlacedIndex = 2 ✓
新位置 1：复用旧 idx=0 → 0 < 2，标记移动，柱子不动
新位置 2：复用旧 idx=3 → 3 ≥ 2，柱子推到 3 ✓
新位置 3：复用旧 idx=1 → 1 < 3，标记移动，柱子不动
```

**算法本质**：贪心——"能不动就不动"，只有旧位置在柱子左边的标记需要移动。
可能不是最优（理论最优 = LIS），但 O(n) 够用。

---

## 6.5、深入：key vs type 独立判定 + Vue 3 对比

> 这一节解决两个高频误区：
> 1. 第一轮 break 的条件到底是什么（key 同 type 不同会 break 吗？）
> 2. lastPlacedIndex 的移动规则在复杂场景里到底怎么走

### 6.5.1 关键澄清：key 和 type 是两个独立判定

| 状态 | 第一轮动作 | 是否 break |
|---|---|---|
| key 同 + type 同 | **复用 alternate**（沿用旧 Fiber 对象，更新 props） | ❌ 不 break，继续下一对 |
| key 同 + type 不同 | **删除旧 + 新建 wIP**（不复用对象） | ❌ 不 break，继续下一对 |
| **key 不同** | — | ✅ **break，进第二轮** |

⭐ **核心区分**：
- **key 不同** → React 觉得"对应关系乱了，整个数组顺序可能变了" → break 进第二轮 Map 算法
- **key 同 type 不同** → React 觉得"位置还对得上，只是这个位置上的东西换了一种" → 就地销毁重建对象，**继续走第一轮**

### 6.5.2 源码验证

```js
function updateSlot(returnFiber, oldFiber, newChild) {
  const key = oldFiber !== null ? oldFiber.key : null;

  // ① key 不匹配 → 返回 null，外层 break 进第二轮
  if (oldFiber === null || newChild.key !== key) {
    return null;
  }

  // ② key 匹配 → 进入 updateElement
  return updateElement(returnFiber, oldFiber, newChild);
}

function updateElement(returnFiber, current, element) {
  // ③ type 也同 → 复用对象
  if (current !== null && current.elementType === element.type) {
    return useFiber(current, element.props);
  }

  // ④ key 同 type 不同 → 新建（外层会顺手把旧的标 Deletion）
  const created = createFiberFromElement(element);
  created.return = returnFiber;
  return created;
}
```

源码里"复用对象"判定（`elementType === type`）和"break 第一轮"判定（key）在不同函数里，**独立**。

### 6.5.3 示例 A：key 同 type 不同（不 break）

```jsx
// 旧                              // 新
[<div key="a">A</div>,             [<p   key="a">A</p>,    ← key 同 type 变了
 <span key="b">B</span>]            <span key="b">B</span>]
```

第一轮：
- 步 0：div(a) → p(a)。key 同 type 不同 → **删 div + 新建 p，不 break**
- 步 1：span(b) → span(b)。key 同 type 同 → **复用** span 的 fiber

⭐ **关键**：步 0 销毁重建对象**没有打乱后面的 diff 顺序**——步 1 还能按部就班复用 span。

### 6.5.4 示例 B：key 不同（break）

```jsx
// 旧                              // 新
[<div key="a">A</div>,             [<p   key="X">X</p>,    ← key 不同
 <span key="b">B</span>]            <span key="b">B</span>]
```

第一轮：
- 步 0：key 不同 (a ≠ X) → **break**

进第二轮，Map = `{a: div_fiber, b: span_fiber}`，从 newIdx=0 重新走 Map 算法。

### 6.5.5 lastPlacedIndex 深入：完整 5 节点示例

#### 设定

```
旧：A(0), B(1), C(2), D(3), E(4)
新：[C, A, B, E, D]
```

第一轮一上来 `C.key !== A.key` → break，进第二轮。

#### Map 算法逐步走

`existingChildren = {A, B, C, D, E}`，初始 `lastPlacedIndex = 0`。

**步 0：处理 C**
```
new C 复用 Map[C]，oldIndex = 2
oldIndex(2) >= lastPlacedIndex(0)? ✅
→ 不动，lastPlacedIndex 推到 2
```

直觉：C 之前在第 2 位，让它当"最右端柱子"。

**步 1：处理 A**
```
new A 复用 Map[A]，oldIndex = 0
oldIndex(0) < lastPlacedIndex(2)? ✅
→ ⭐ Placement（移动），柱子不变
```

直觉：A 原本在 C 的左边（idx=0 < 柱子=2），现在要放到 C 后面 → 必须"跳过"C 的旧位置 → 移动。

**步 2：处理 B**
```
new B 复用 Map[B]，oldIndex = 1
1 < 2 → ⭐ Placement
```

**步 3：处理 E**
```
new E，oldIndex = 4
4 >= 2 → 不动，柱子推到 4
```

**步 4：处理 D**
```
new D，oldIndex = 3
3 < 4 → ⭐ Placement
```

#### 统计

| 节点 | 移动 |
|---|---|
| C | ❌ |
| A | ✅ |
| B | ✅ |
| E | ❌ |
| D | ✅ |

**3 次 DOM 移动**。

#### 算法直觉

lastPlacedIndex 像"赛跑里的最右端选手"：
- 它**只能往右走，不能往左退**
- 我从左到右遍历新数组：旧位置在它右边/同位 → 让它当新柱子；旧位置在它左边 → 拽过来标 Placement

⭐ **贪心的本质**：React 假定"右边的不动，左边的拽过来"。可能不是最优，但 O(n)。

### 6.5.6 为什么 lastPlacedIndex 初始 = 0

`lastPlacedIndex` 语义是**"最后一个已放置的、不需要移动的节点的旧 index"**。

- 初始时还没放置任何节点
- 用 0 而不是 -1：因为 fiber.index 最小就是 0，用 0 作"基准哨兵"和实际值类型一致，避免源码里到处写 `lastPlacedIndex === -1 || oldIndex >= lastPlacedIndex` 这种丑陋判断

效果上 0 和 -1 几乎等价（任何合法 oldIndex 都 ≥ 0），选 0 是工程美学。

### 6.5.7 Vue 3 diff 对比

#### 总体对比

| | React | Vue 2 | Vue 3 |
|---|---|---|---|
| 算法 | 贪心 + lastPlacedIndex | 双端比较 | 双端 + LIS |
| 复杂度 | O(n) | O(n) | O(n) + O(n log n) |
| 移动次数 | 不一定最优 | 多数场景较优 | **最优** |

#### Vue 3 双端比较

```
旧：[A, B, C, D, E]
新：[A, C, B, D, E]

oldStart=A ─────────────── oldEnd=E
newStart=A ─────────────── newEnd=E
```

每轮尝试 4 种命中：

| 场景 | 判断 | 动作 |
|---|---|---|
| 头对头 | `old[oldStart].key === new[newStart].key` | 复用，两个 Start ++ |
| 尾对尾 | `old[oldEnd].key === new[newEnd].key` | 复用，两个 End -- |
| 老头新尾 | `old[oldStart].key === new[newEnd].key` | 复用 + **移到末尾**，oldStart++ newEnd-- |
| 老尾新头 | `old[oldEnd].key === new[newStart].key` | 复用 + **移到开头**，oldEnd-- newStart++ |

后两种用于**快速识别整体反转**：

```
旧：[A, B, C]    新：[C, B, A]

老头 A vs 新尾 A → 命中场景 3，A 移到末尾
新 = [C, B, _]   oldStart → B
老头 B vs 新尾 B → 命中，B 移到末尾
...
```

#### 4 种都没命中 → 走 Map + LIS

LIS = **最长递增子序列**。

```
旧：[A, B, C, D, E]   旧 idx = [0, 1, 2, 3, 4]
新：[C, A, B, E, D]

把新数组里每个节点对应的"旧 idx"列出：
  source = [2, 0, 1, 4, 3]

找最长递增子序列：
  [2, 4] 长度 2
  [0, 1, 4] 长度 3 ✅
  [0, 1, 3] 长度 3 ✅

选 [0, 1, 4]（对应 A, B, E）—— 这 3 个保持相对顺序不动
移动剩下的：C, D —— 共 2 次移动
```

#### 同一场景对比

```
旧：[A, B, C, D, E]
新：[C, A, B, E, D]

React 贪心：3 次移动（A, B, D）
Vue 3 LIS： 2 次移动（C, D）

差 1 次
```

#### React 团队的解释

> "We have evaluated LIS-based algorithms and find that the marginal performance improvement does not justify the implementation complexity."

**取舍**：源码复杂度 +30%，性能 +0.5%。React 选源码简单。

### 6.5.8 决策树速查

```
新旧 key 同？
  ├─ 否 → break，进第二轮（Map 算法）
  └─ 是 → 新旧 type 同？
           ├─ 是 → 复用 alternate（O(1)）
           └─ 否 → 删旧 + 新建（但不 break）

第二轮 placeChild：
  复用旧 fiber？
    ├─ 是 → oldIndex >= lastPlacedIndex？
    │        ├─ 是 → 不移动，lastPlacedIndex = oldIndex
    │        └─ 否 → 标 Placement，lastPlacedIndex 不变
    └─ 否（新建）→ 标 Placement
```

---

## 6.6、"复用"的边界 + DOM 移动会触发 useEffect 重跑

> 这一节澄清两个跟练实验暴露的盲点：
> 1. type 同 = 一定复用？**不对**——必须"同位置 + type 同"
> 2. Fiber 复用 = useEffect 不跑？**不对**——DOM 移动会触发 effect 重跑

### 6.6.1 复用的严格条件：同位置 + type 同

假设 1 的准确表述应该是：

> **同一位置的 Fiber，如果 type 变了，整棵子树丢弃 + 重建。**

⭐ **注意 "同一位置" 这 4 个字**。React 按位置判断，不会"深入到子树里找同 type 的复用对象"。

### 6.6.2 反直觉案例：input 内容会重置

```jsx
{wrapper === 'div' 
  ? <div><input defaultValue="hello" /></div>
  : <span><input defaultValue="hello" /></span>
}
```

直觉上你会想："input 还是 input，type 没变，应该复用啊。"

**错。** React 看到的是：

```
旧：div(位置0) > input(位置0.0)
新：span(位置0) > input(位置0.0)
```

第 0 层位置 0：div → span，type 变了 → **整棵子树重建**（包括内部 input）→ DOM 是新的 → 用户输入丢失。

**对比实验**（type 同，只 className 变）：

```jsx
<div><input /></div> ↔ <div className="x"><input /></div>
```

div type 同 → input 不重建 → 用户输入保留 ✅

### 6.6.3 为什么 React 这么"粗暴"地判定子树重建

工程效率来源：**判断在最浅一层就完成，不深入**。

如果 React 要"递归进去看 input 是不是同一个"：
- 复杂度从 O(n) 退化
- 还要回答"`<div>` 的 attribute 怎么迁移到 `<span>`"等一堆边界规则
- 用户更难预期"我的 input 到底会不会保留"

**取舍**：粗暴判定 → 简单 + 行为可预测。这是 React"够用就好"哲学的体现。

### 6.6.4 DOM 移动触发 useEffect 重跑（Day 3 实验 D2 揭示）

`[A, B, C, D]` → `[B, A, D, C]`，被标 Placement 的节点（A、C）的 useEffect：

```
[A] UNMOUNT   ← effect cleanup
[A] MOUNT     ← effect 重跑
[C] UNMOUNT
[C] MOUNT
```

B、D 没被标 Placement → DOM 没动 → useEffect 不重跑。

#### 为什么会 unmount + mount？

Placement 在 commit 阶段执行 `parent.insertBefore(node, anchor)`：

> 浏览器原生 API 行为：**已存在的 node 被 insertBefore 时，先 detach 再 attach**。

React 的 effect 系统在这个过程里观察到：
- detach 时 → useEffect 清理函数被调用
- attach 后 → useEffect 重新跑

⭐ **核心洞察**：

> **Fiber 对象是复用的（同一个引用），但 DOM 节点的"移动"被 React 解释为"重新挂载"，触发 useEffect cleanup + rerun。**

#### 怎么验证 Fiber 真的没重建

```jsx
function Item({ id, name }) {
  // Fiber 第一次创建时记下随机编号
  const personalId = useRef(Math.random().toString(36).slice(2, 6));

  useEffect(() => {
    console.log(`[${id}-${name}] MOUNT (Fiber编号=${personalId.current})`);
    return () => console.log(`[${id}-${name}] UNMOUNT (Fiber编号=${personalId.current})`);
  }, []);

  return <li>{id} - {name}</li>;
}
```

shuffle 后 A 的 UNMOUNT + MOUNT 打印的 `personalId.current` **仍然是初始值**——说明 useRef 没重新初始化 → Fiber 对象没被销毁重建。

### 6.6.5 抽屉模型（核心心智模型）

```
React Fiber = 一个抽屉
  ├─ props（每次 render 重新塞进来 → "标签"换得快）
  ├─ state（抽屉里的玩具 → 跟抽屉走）
  ├─ ref（抽屉里的便条 → 跟抽屉走）
  └─ DOM 引用（抽屉对应的实物 → 跟抽屉走）

key 决定的事：哪个抽屉对应哪个语义身份
  - key=id：抽屉跟着身份走（A 永远是同一个抽屉，搬家也搬着抽屉走）
  - key=index：抽屉钉死在位置，身份是贴在抽屉外的标签，可以换贴
                ↑ 这就是错乱的根源
```

**`console.log(id, name)`** 看的是**贴在抽屉外的标签** —— 当然对得上。
**错乱发生在抽屉里的东西**（state、ref、input.value、focus、scroll、动画进度）。

### 6.6.6 key=index 出 bug 的根本前提

⭐ "key=index 出 bug" 必须依赖 **"index 与语义身份的对应关系发生了改变"**：
- 数组顺序变了（重排）
- 数组长度变了（增删）

如果能保证"index 永远对应同一个语义实体"（只更新、不增不删不重排），key=index 没问题。

**但这种保证非常脆弱**——今天保证不重排，下次迭代加排序就崩了。

**最佳实践**：永远用 id，永远不要赌。

### 6.6.7 useEffect 依赖数组能阻止移动触发的 rerun 吗

**不能**。useEffect 在 commit 阶段被 React 强制 cleanup（无论依赖变没变），DOM 移动后再重新跑 effect。这个行为**和依赖数组无关**。

如果不想让移动触发 effect 重跑，唯一办法：**不要移动**（即不重排列表，或在只读场景用 key=index）。

---

## 七、实战演练：`[A,B,C,D] → [B,A,D,C]`

旧链表：`A(idx=0) → B(idx=1) → C(idx=2) → D(idx=3)`

### 第一轮

| 新 idx | 新 key | 旧 key | 同 key? | 动作 |
|---|---|---|---|---|
| 0 | B | A | ❌ | break，进第二轮 |

第一轮一步就 break。**lastPlacedIndex=0，oldFiber 还指向 A**。

### 第二轮：建 Map

```
existingChildren = {
  A → A_fiber(idx=0),
  B → B_fiber(idx=1),
  C → C_fiber(idx=2),
  D → D_fiber(idx=3),
}
```

| 新 idx | 新 key | Map 命中 | oldIndex | vs lastPlacedIndex | 动作 |
|---|---|---|---|---|---|
| 0 | B | ✅ | 1 | 1 ≥ 0 | 不动，lastPlacedIndex=1 |
| 1 | A | ✅ | 0 | 0 < 1 | **Placement**（移动） |
| 2 | D | ✅ | 3 | 3 ≥ 1 | 不动，lastPlacedIndex=3 |
| 3 | C | ✅ | 2 | 2 < 3 | **Placement**（移动） |

Map 最终为空。**只移动 2 次 DOM**。

### 反例：不写 key

按 idx 0,1,2,3 硬比：
- 位置 0 的 A 内容改成 B（updateProps）
- 位置 1 的 B 内容改成 A
- 位置 2 的 C 内容改成 D
- 位置 3 的 D 内容改成 C

**4 次 update，所有 Fiber 状态全错乱**。

---

## 八、React vs Vue 3 diff 对比

| | React | Vue 3 |
|---|---|---|
| 算法 | 贪心 + lastPlacedIndex | 双端 + LIS（最长递增子序列） |
| 复杂度 | O(n) | O(n log n) |
| 移动次数 | 不一定最优 | 最优 |
| 工程取舍 | 简单 + 够用 | 复杂 + 极致 |

React 团队解释：真实业务中"完全乱序"列表极少，**贪心已够用，多花算法复杂度收益不大**。

---

## 九、动手实验

详见 `demos/day3/README.md`，3 个实验：

| 实验 | 目标 | 产出 |
|---|---|---|
| D1. key=index 身份认错 | 复现非受控 input 错位 | screenshots/D1-input-mismatch.png |
| D2. 多节点 diff 追踪 | 用 mount/unmount 日志验证 React 的复用决策 | `D2-console.txt` |
| D3. type 变化导致 state 重置 | 切换 div ↔ span，看 Counter state 重置 | `D3-state-reset.gif` |

---

## 十、我之前以为 …，其实是 …（5 条认知纠正）

1. **我以为** key=index 主要是性能问题。
   **其实** 是**正确性问题**——会让 React"身份认错"，input value / focus / state 跟错人。性能问题是慢但结果对，正确性问题是结果错。

2. **我以为** 没写 key React 警告是因为 diff 会变慢。
   **其实** 是因为 React 看到数组就默认动态，无法可靠识别身份，**警告是防身份认错**，不是防性能。

3. **我以为** Fragment 在 diff 里完全不存在。
   **其实** Fragment 是 Fiber 树里真实节点（tag=7），有 child/sibling/return 指针，**只是不创建 DOM**。

4. **我以为** React diff 是某种精妙的最优算法。
   **其实** 是**贪心算法**，刻意不追求最优。比 Vue 3 的 LIS 多移动节点，但 React 团队认为差距不显著，**用简单算法换可维护性**。

5. **我以为** React 三大假设是"为了优化做的妥协"。
   **其实** 每条假设同时解决"性能 + 语义歧义"两个问题。React 的设计哲学是**"语义清晰、行为可预测 > 算法精妙"**，性能只是顺便。

---

## 十一、Day 3 验收清单

- [x] 能默写 React diff 的 3 个假设
- [x] 能解释 key=index 为什么是正确性问题（不是性能问题）
- [x] 能默写单节点 diff 的 key+type 双条件复用规则
- [x] 能讲清多节点 diff 的双轮遍历
- [x] 能用 lastPlacedIndex 手算 `[A,B,C,D]→[B,A,D,C]` 的移动次数
- [x] 能说出 React vs Vue 3 diff 算法的取舍
- [ ] 完成动手实验 D1 / D2 / D3
- [x] 写下 5 条认知纠正

---

## 十二、Day 4 预告

**主题**：beginWork / completeWork 工作循环源码（reconcile 阶段的完整执行流程）

**预读问题**：

1. beginWork 内部对函数组件 / 类组件 / DOM 节点的处理有什么区别？
2. 什么场景下 React 会走 "bailout"（提前退出）？
3. completeWork 为什么要分两步：自己的工作 + 冒泡 effect？
4. Hook 链表是在 beginWork 还是 completeWork 里建立的？

明天见 👋
