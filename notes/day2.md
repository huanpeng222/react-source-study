# Day 2 笔记：React Element → Fiber + 双缓存

> 日期：2026-06-18
> 主题：从一份"渲染描述快照"到一棵可中断的"工作树"
> 状态：✅ Day 2 完成

---

## 零、入场自测（5 分钟，先自己答再往下看）

1. JSX 编译完是 React Element，那从 Element 到屏幕真实出现 DOM，中间至少经过几个阶段？
2. 你听过 "Fiber"，用一句话描述它是什么？
3. React 15 的 Stack Reconciler 为什么会卡？Fiber 为什么不卡？
4. 双缓存——你在哪些地方见过这个概念？

<details>
<summary>📌 我自己的回答（保留作为对比基线）</summary>

1. element 对象 → 虚拟 dom → CSS 计算 → 真实 dom → 渲染
2. React 在渲染组件时把组件对象分成 fiber 单元，可暂停、继续，给更高优先级用户操作让步
3. 卡顿原因是渲染一次性执行完才能交互；Fiber 可中断，有优先级时会让出执行权
4. 没有概念

</details>

---

## 一、Element → DOM 的完整管道

```
JSX
  ↓ babel 编译
React Element（虚拟 DOM，普通对象快照）
  ↓ ① Reconcile（协调）—— 生成/更新 Fiber 树，做 diff
Fiber 树（带 effect 标记 + 优先级 lanes）
  ↓ ② Commit（提交）—— 把 effect 应用到真实 DOM
真实 DOM
  ↓ 浏览器接管：style → layout → paint → composite
屏幕像素
```

**3 个阶段必须背下来**：

| 阶段 | 是否 React 干的 | 是否可中断 | 干啥 |
|---|---|---|---|
| Reconcile | ✅ React | ✅ 可中断（并发模式） | 拿新 Element 对比旧 Fiber 树，生成新 wIP 树，打 effect 标记 |
| Commit | ✅ React | ❌ 同步、不可中断 | 把 effect 一次性应用到 DOM（增/删/改/绑 ref/跑 effect） |
| Layout/Paint | ❌ 浏览器 | — | 计算样式、布局、绘制、合成 |

### 1.1 React Element 就是"虚拟 DOM"

**澄清一个常见混淆**：React Element 本身**就是**虚拟 DOM，没有"Element → 虚拟 DOM"这一步。

虚拟 DOM 是个营销词，准确说法是 **React Element Tree**——一棵由 `_jsx(...)` 调用生成的纯 JS 对象树。

### 1.2 为什么需要 Fiber 这一层中间结构

如果直接 Element → DOM，会有 3 个致命问题：

| 问题 | 为什么 |
|---|---|
| **没法中断** | Element 是普通对象树，遍历靠递归，调用栈一塌进度全没 |
| **没法 diff** | 旧的 Element 早就被 GC 了，对比谁？ |
| **没法记录副作用** | DOM 操作要批量、要分类（增/删/改），Element 没地方挂这些标记 |

Fiber 同时解决这 3 件事：**链表结构 + alternate 双缓存 + flags 副作用标记**。

### 1.3 澄清：Fiber 之前 Element 直接渲染到 DOM 吗？

**答案：不是。从 React 0.x 到现在，Element 永远不会直接变成 DOM，中间始终有一层"协调器（Reconciler）"。** 只是这层协调器在 Fiber 之前长得不一样。

#### React 渲染架构的 3 个时代

| 时代 | 中间层 | 数据结构 | 是否可中断 |
|---|---|---|---|
| React 0.3 ~ 15 | **Stack Reconciler** | ReactInstance 树（class 实例 + ReactDOMComponent） | ❌ 不可 |
| React 16+ | **Fiber Reconciler** | Fiber 链表树（current + workInProgress） | ✅ 可 |
| React 18+ | + Concurrent Mode | + Lane 优先级模型 | ✅ 增强 |

#### React 15 也有"虚拟 DOM"，只是没人叫它 Fiber

React 15 内部对象叫 **ReactInstance**（internal instance tree），分三种：

```
ReactDOMComponent          ←→ DOM 节点（如 <div>）
ReactCompositeComponent    ←→ 组件实例（class component）
ReactDOMTextComponent      ←→ 文本节点
```

这棵树**就是 React 15 的"虚拟 DOM"**。它由 Element 创建出来，**长期持有在内存里**（不像 Element 是一次性快照）。

#### React 15 工作流

```
JSX
  ↓ React.createElement
React Element 树（一次性快照）
  ↓ Stack Reconciler 同步递归
ReactInstance 树（长期持有）
  ↓ mountComponent / receiveComponent
DOM 操作指令
  ↓ batchedUpdates 批量执行
真实 DOM
```

为什么叫 **Stack** Reconciler：整棵树是用 **JavaScript 调用栈** 一层层递归处理的——调用栈在英文里就是 call stack。

#### 三层架构对比表

| 层 | React 15 | React 16+ |
|---|---|---|
| 第 1 层（渲染描述） | React Element | React Element |
| 第 2 层（协调结构，长期持有） | **ReactInstance 树** | **Fiber 树**（双缓存） |
| 第 3 层（浏览器） | 真实 DOM | 真实 DOM |

**结论**：Element 从来没有"直接变成"真实 DOM。Fiber 不是"凭空多出来一层"，而是把原来的协调器**从同步递归改成可中断链表遍历**。

#### 配套小测（自检）

| 命题 | 对 / 错 |
|---|---|
| React 15 没有虚拟 DOM | ❌ 有，叫 ReactInstance 树 |
| React 15 直接把 Element 渲染成 DOM | ❌ 中间有 Stack Reconciler |
| Fiber 是为了引入"虚拟 DOM"才出现的 | ❌ 虚拟 DOM 早就有，Fiber 是为了"可中断" |
| Fiber 替代了 ReactInstance 树 | ✅ 对 |
| React 15 也能批量更新 DOM | ✅ 对（batchedUpdates 早就有） |
| Stack Reconciler 卡顿是因为 JS 慢 | ❌ 是因为递归无法让出主线程 |

---

## 二、Stack Reconciler 为什么卡

React 15 的 Stack Reconciler 用**函数递归**做 diff：

```js
function reconcile(element, parentDom) {
  const dom = createDom(element);
  for (const child of element.children) {
    reconcile(child, dom);  // ← 递归
  }
  parentDom.appendChild(dom);
}
```

**致命缺陷**：递归调用栈一旦开始，**没法中途让出主线程**。
- 你 `return` 了，调用栈塌了，所有进度（递归到哪个节点、局部变量）全没。
- 想恢复？只能从 root 重新跑一遍。

如果组件树 1000 个节点，递归跑 30ms+，**这 30ms 内主线程被霸占**：
- 用户点击事件排队
- 输入框输入卡顿
- 动画掉帧

### Fiber 怎么解决：递归 → 循环 + 链表

把递归改成 **while 循环 + 链表指针遍历**：

```js
function workLoop() {
  while (workInProgress !== null && !shouldYield()) {
    workInProgress = performUnitOfWork(workInProgress);
  }
  if (workInProgress !== null) {
    // 还没做完，下次 idle 时间继续
    requestIdleCallback(workLoop);
  }
}

function performUnitOfWork(fiber) {
  // 1. beginWork: 处理当前 Fiber，生成子 Fiber
  const next = beginWork(fiber);
  if (next) return next;

  // 2. 没子节点了，回溯找兄弟
  let node = fiber;
  while (node) {
    completeWork(node);  // 收集 effect
    if (node.sibling) return node.sibling;
    node = node.return;
  }
  return null;
}
```

**关键变量 `workInProgress` 是个全局指针**。想暂停就停，下次 `workInProgress` 还在原地。

**这就是 "Fiber" 名字的由来**：把"线程级"的渲染工作切成"纤程级"（fiber，比线程更细）单元。

---

## 三、Fiber 节点的字段（看实物，不背书）

> 实物来自 DevTools 抓取的 button Fiber 节点。截图见 `demos/day2/screenshots/`。

按重要性分 5 组：

### 第 1 组 · 身份标识（4 个字段）

| 字段 | 例 | 含义 |
|---|---|---|
| `tag` | `5` | Fiber 类型枚举。0=函数组件 / 1=类组件 / 3=HostRoot / 5=HostComponent (DOM) / 6=HostText |
| `type` | `"button"` | 对应 Element.type（DOM 是字符串，组件是函数） |
| `elementType` | `"button"` | 编译期类型。memo/lazy 包裹时会和 type 不一样 |
| `stateNode` | `<button>` | **真实 DOM 引用**！Fiber 通往真实世界的出口 |

💡 `stateNode` 是双向绑定的：
- Fiber → DOM：通过 `stateNode`
- DOM → Fiber：通过 `__reactFiber$xxx`（DevTools 就是靠这个反查的）

### 第 2 组 · 树形指针（核心！3 个字段）

| 字段 | 例 | 含义 |
|---|---|---|
| `return` | 父 Fiber | **父节点**。叫 return 是因为递归"返回"上去 |
| `child` | 第一个子 Fiber | **第一个孩子**（注意：只指第一个！） |
| `sibling` | 兄弟 Fiber | **下一个兄弟**。剩余兄弟串成链表 |

**关键设计**：用 `child + sibling` 链表代替 `children: []` 数组。

```
      A (root)
      │ child
      ↓
      B ────────→ C ────────→ D
   (return:A)  (return:A)  (return:A)
      │ child
      ↓
      E ────────→ F
   (return:B)  (return:B)
```

**遍历算法**（必须能默写）：

```js
function walk(root) {
  let node = root;
  while (node) {
    // 1. 处理当前节点
    doWork(node);
    // 2. 有孩子先下钻
    if (node.child) { node = node.child; continue; }
    // 3. 没孩子，找兄弟；没兄弟，回父亲找叔叔
    while (node && !node.sibling) {
      onComplete(node);  // 回溯时执行
      node = node.return;
      if (node === root) return;
    }
    node = node?.sibling;
  }
}
```

**为什么 React 这么设计**：纯循环 = 状态全在 `node` 一个变量里 = 可序列化 = **可中断**。

### 第 3 组 · Props / State（3 个字段）

| 字段 | 含义 |
|---|---|
| `pendingProps` | 本次更新要应用的新 props（来自新 Element） |
| `memoizedProps` | 上次已渲染的 props（已生效的旧值） |
| `memoizedState` | **Hooks 链表的头**！函数组件的 useState/useEffect 都挂这里 |

💡 **bailout 优化**：当 `memoizedProps === pendingProps` 且 props 浅比较相等时，React 跳过整棵子树。这就是 `React.memo` 的底层。

### 第 4 组 · 双缓存（1 个字段，Day 2 主菜）

| 字段 | 含义 |
|---|---|
| `alternate` | **指向另一棵树上的"同一个我"** |

#### 4.1 双缓存类比：显示器刷新

显示器每秒 60 帧。如果只有 1 块显存：
- GPU 写到一半 + 显示器读 = **画面撕裂**

解决：**前缓冲区 + 后缓冲区**：
- **前缓冲区**：用户正在看的"当前画面"
- **后缓冲区**：GPU 正在写的"下一帧"
- 写完了 → **指针一交换**（swap）→ 完整新画面瞬间出现

核心 4 字：**绘读分离**。

#### 4.2 搬到 React

```
   current 树（前缓冲区）         workInProgress 树（后缓冲区）
   ┌──────────────┐               ┌──────────────┐
   │  对应当前 DOM  │ ←alternate→  │ React 正在构建 │
   │  用户看到的    │               │ 可中断、可丢弃 │
   └──────────────┘               └──────────────┘
```

**setState 触发更新的完整流程**：

1. React 基于 `current` 树 **clone** 出 `workInProgress` 树（实际是按需 clone，能复用就复用）。
2. 在 wIP 上做 reconcile + diff，打 effect 标记。**这个过程可中断**，因为用户看不到 wIP。
3. reconcile 完成 → 进入 commit → **指针交换**：wIP 变 current，DOM 同步过去。
4. 旧 current 变成下次的 wIP 候选，对象复用。

#### 4.3 为什么必须两棵树（3 个原因）

| 原因 | 说明 |
|---|---|
| **中断要安全** | reconcile 一半被打断，current 还是完整的，用户画面不撕裂 |
| **出错可丢弃** | reconcile 抛异常，整棵 wIP 扔掉，回退 current，零副作用 |
| **复用省内存** | 两棵树通过 alternate 互指，节点复用，不是真 clone 一份 |

记忆口诀：**绘读分离，交换指针。**

#### 4.4 第一次渲染 alternate 为什么是 null

mount 阶段只有一棵 wIP 树（还没有 current 配对）。第一次 commit 完，wIP 升格成 current。**第二次 setState** 时才 clone 出新 wIP，alternate 才有值。

#### 4.5 alternate 是双向的

```js
A.alternate === B   // true
B.alternate === A   // true
A.alternate.alternate === A   // true（自反性）
```

### 第 5 组 · 调度（4 个字段，Day 4-5 展开）

| 字段 | 例 | 含义 |
|---|---|---|
| `flags` | `4194816` | **副作用标记**（位运算）。commit 阶段按 flags 决定干啥 |
| `subtreeFlags` | `1048576` | 子树有无 effect（剪枝优化） |
| `lanes` | `0` | 本 Fiber 的更新优先级（React 18 Lane 模型） |
| `childLanes` | `0` | 子树有无待处理更新 |

常见 flags 位运算值（cheat sheet）：

| flag 名 | 值 | 含义 |
|---|---|---|
| `Placement` | 2 | 新插入 DOM |
| `Update` | 4 | DOM 属性更新 |
| `Deletion` | 16 | 删除 DOM |
| `Ref` | 512 | 绑定 ref |
| `Passive` | 2048 | useEffect 副作用 |

---

## 四、动手实验（必做）

详见 `demos/day2/README.md`。三个实验：

| 实验 | 目标 | 产出 |
|---|---|---|
| A. 抓 Fiber | 在 DevTools 中找到任意 Fiber 节点，验证 5 大类字段 | `screenshots/A-fiber-fields.png` |
| B. 验证 alternate 自反性 | `fiber.alternate.alternate === fiber` | console 输出截图 |
| C. 遍历整棵 Fiber 树 | 手写 walk 函数打印整树 | `walk-tree-output.txt` |

---

## 五、我之前以为 …，其实是 …（5 条认知纠正）

1. **我以为** React Element → 虚拟 DOM → 真实 DOM 是三层。
   **其实** React Element 本身就是虚拟 DOM，中间隔的是 Fiber 树，不是另一个"虚拟 DOM 层"。

2. **我以为** Fiber 只是个"调度优化"的小改动。
   **其实** Fiber 同时是**数据结构**（链表式树）+ **工作单元**（可暂停的渲染粒度）+ **调度对象**（带 lanes 优先级）。它是 React 16 之后整个新架构的根基。

3. **我以为** Stack Reconciler 卡是因为"代码写得慢"。
   **其实** 是因为**递归调用栈无法中断**——快慢不是问题，**没法让出主线程**才是问题。

4. **我以为** 双缓存就是 React 内部偷偷 clone 了一份对象。
   **其实** 是两棵 Fiber 树通过 `alternate` 互相指，**节点能复用就复用**，并不是真的全量复制。这就是为什么 Fiber 内存可控。

5. **我以为** alternate 是某种"备份"。
   **其实** 它是"另一棵树上的同一个我"。current 和 wIP 互为 alternate，commit 时指针一换，**没有 src/dst 之分**。

> 这 5 条会追加到 `meta/cognitive-corrections.md`。

---

## 六、Day 2 验收清单

- [x] 能默写 Element → Reconcile → Commit → Browser 4 阶段
- [x] 能用一句话说清 Fiber 是什么（数据结构 + 工作单元 + 调度对象）
- [x] 能解释 Stack Reconciler 为什么卡（递归无法中断）
- [x] 能默写 Fiber 节点 5 组核心字段
- [x] 能默写 walk 函数（child / sibling / return 三指针遍历）
- [x] 能讲清双缓存的 3 个动机（中断安全 / 出错丢弃 / 内存复用）
- [x] 完成 3 个动手实验，截图 + 输出留档
- [x] 写下 5 条认知纠正

---

## 七、Day 3 预告

**主题**：Reconcile 阶段的 diff 算法（单节点 diff / 多节点 diff / key 的真正作用）

**预读问题**（明天入场测前先想）：

1. React diff 复杂度被压到 O(n) 用了哪 3 个假设？
2. 同层节点列表 diff，key 不写 / 用 index / 用 id 三种情况，分别会发生什么？
3. 节点类型变了（`<div>` → `<span>`），React 会复用 DOM 吗？为什么？
4. Fragment 在 diff 时算一个节点还是 0 个节点？

明天见 👋
