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

## 2.5、Fiber 循环怎么"中断" + 蚂蚁爬树规则

> 这一节解答 Day 2 三个高频疑问：
> 1. JS 单线程，"中断"到底是什么意思？
> 2. workLoop 怎么知道该让出？让出之后怎么续接？
> 3. performUnitOfWork 内部 child/sibling/return 三指针到底怎么走？

### 2.5.1 JS 的"中断"本质上是"主动 return"

JS 是**单线程**的，所谓"中断"，本质就一个姿势：

```js
while (有活儿) {
  doOneSmallThing();
  if (该让出主线程了) {
    return;        // ← 这就是"中断"！函数主动退出
  }
}
```

**JS 没法被强制打断**。你不主动 return，浏览器没办法——这就是 React 15 卡顿的根因。

要"还了控制权后能继续"，需要两件事配合：
1. **把进度存到全局变量**里（不能存在函数局部变量，return 就丢了）
2. **再调度一次**：告诉浏览器"等你空了再回来叫我"（`MessageChannel` / `requestIdleCallback`）

### 2.5.2 shouldYield 怎么判时间

```js
const FRAME_BUDGET = 5;   // 每次时间片占 5ms
let frameDeadline = 0;

function shouldYield() {
  return performance.now() >= frameDeadline;
}

function scheduleCallback(cb) {
  channel.port2.postMessage(null);
  channel.port1.onmessage = () => {
    frameDeadline = performance.now() + FRAME_BUDGET;
    cb();
  };
}
```

**5ms 是 React 实际使用的时间片**。每 5ms 让出一次，浏览器有空就处理点击/动画/scroll，处理完再回来 React 接着干。

⚠️ 注意：**单个 Fiber 节点的 beginWork 不可中断**。所以时间片要切到"单 Fiber"这么细的粒度。一个 Fiber 通常 < 1ms，5ms 时间片够跑 5-10 个节点。**这是 React "纤程级"调度的物理依据**。

### 2.5.3 三指针 + 蚂蚁爬树规则

每个 Fiber 节点身上挂三根指针：

```
return  →  父节点
child   →  第一个孩子
sibling →  下一个兄弟
```

**蚂蚁爬树规则**（必须背下来）：

```
站在某个节点 N 上：

规则 1：先往下钻（向 child 走）
  • N.child 存在 → 下一站是 N.child
  • 没 child 才进规则 2

规则 2：找兄弟（向 sibling 走）
  • N.sibling 存在 → 下一站是 N.sibling
  • 没 sibling 才进规则 3

规则 3：回父亲，再找父亲的兄弟（往上 + 横移）
  • N = N.return
  • 回到规则 2，找 N.sibling
  • 一直往上爬，直到找到一个有 sibling 的祖先
  • 如果爬回到 root，整棵树走完了
```

### 2.5.4 配套示例：蚂蚁走完整棵树

```
        A
       /│\
      B C D
     /|
    E F
```

| 步 | 当前节点 | 应用规则 | 下一站 |
|---|---|---|---|
| 1 | A | 规则 1（有 child） | B |
| 2 | B | 规则 1（有 child） | E |
| 3 | E | 规则 2（有 sibling F） | F |
| 4 | F | 规则 3：回 B → B.sibling=C | C |
| 5 | C | 规则 2（有 sibling D） | D |
| 6 | D | 规则 3：回 A → A 是 root | 结束 |

**遍历顺序**：`A → B → E → F → C → D` —— 即**先序深度优先（DFS）**。

### 2.5.5 把"中断"和"遍历"拼起来

```
[scheduler] 喊：workLoop！
   ↓
┌──────────────────────────────────┐
│ while (workInProgress && !yield) │
│   workInProgress =               │
│       performUnitOfWork(wIP)     │ ← 每次只前进 1 个节点
│ end                              │
└──────────────────────────────────┘
   ↓
退出循环：要么干完了，要么时间到了
   ↓
       ├─ 干完了 → commit() 同步上 DOM
       └─ 没干完 → scheduleCallback(workLoop)
                  浏览器：处理点击/动画/输入...
                  ↓ 5ms 后
                  从 [scheduler] 那行重新开始
```

**精髓**：进度活在 `workInProgress` 这个全局变量里，下一次回来时**它还在原来那个节点上**，蚂蚁继续爬。

### 2.5.6 三个常见追问

| 追问 | 答案 |
|---|---|
| 单个组件 render 跑 50ms 会怎样？ | React 帮不了你。Fiber 可中断只保证"树太大不会卡"，保证不了"单组件慢"。这是 `React.memo` / `useMemo` 的意义 |
| beginWork 内部不也用循环吗？为啥它不能中断？ | 它会，但每个 beginWork 通常 < 1ms，是"原子单元"。中断粒度刻意切到这个层级 |
| completeWork 是干嘛的？ | 回溯到节点时调用。冒泡 effect 标记到父节点 `subtreeFlags` + 完成 DOM 创建/属性设置 |

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

#### 4.6 alternate 为什么必须双向（3 个原因）

如果只有 `current.alternate → wIP`，会出 3 个问题：

| 问题 | 说明 |
|---|---|
| **commit 后身份对换困难** | wIP 升格 current 后，原 current 想找新 current 得从 root 遍历，违背 O(1) 设计 |
| **节点没法对象复用** | 第二次更新时 React 想复用上一次的 wIP 对象，单向时 wIP 自己不知道 current 是谁 |
| **判断节点新旧失效** | `alternate === null` 是"我是新节点"的判据，单向时永远是 null |

#### 4.7 双向 alternate 的对象复用机制（源码核心）

```js
function createWorkInProgress(current, pendingProps) {
  let workInProgress = current.alternate;
  if (workInProgress === null) {
    // 第一次更新：new 一个新 Fiber
    workInProgress = createFiber(current.tag, pendingProps, current.key);
    workInProgress.alternate = current;
    current.alternate = workInProgress;       // ★ 双向互指
  } else {
    // 第二次及以后：直接复用旧 alternate，省内存
    workInProgress.pendingProps = pendingProps;
    workInProgress.flags = 0;                 // 清掉上次的标记
  }
  return workInProgress;
}
```

**双向 = 直接复用 = 不爆内存**。这就是 Fiber 内存可控的根本。

#### 4.8 怎么判断我手里这个 fiber 是 current 还是 wIP

**Fiber 节点自己没有 `isCurrent` 字段**——身份是个全局概念，不是节点属性。

判别的权威源头：`FiberRoot.current`

```js
fiberRoot = {
  current: <Fiber>,           // ← 这个字段指向当前 current 树根
  containerInfo: <DOM>,       // 就是 document.getElementById('root')
}

function isCurrent(fiber) {
  let node = fiber;
  while (node.return) node = node.return;   // 爬到 HostRoot
  const fiberRoot = node.stateNode;
  return fiberRoot.current === node;        // 是不是 root 持有的那个？
}
```

**实战经验规律**（不用调 isCurrent）：

| 你在哪里抓到 fiber | 它是谁 |
|---|---|
| 函数组件函数体内 / class render() | **wIP** —— React 正在构建中 |
| useEffect 回调里 | **current** —— commit 已结束 |
| useLayoutEffect 回调里 | **current** —— commit 已结束但浏览器还没绘制 |
| DevTools 控制台抓 `__reactFiber$xxx` | **current** —— 用户已看到 DOM |

**所以你截图里抓到的 button fiber 是 current 树上的**，它的 alternate 是上次更新留下、等待复用的 wIP。

#### 4.9 旧 current 不会销毁，新 wIP 是复用不是重建（重点澄清）

> 这一小节回答两个高频误解：
> 1. 旧 current 在 commit 后会被销毁吗？
> 2. 新 wIP 是在旧 current 上"重建"出来的吗？

**核心一句话**：

> Fiber 整个生命周期里，**同一个组件位置永远只有 2 个 Fiber 对象在轮流坐庄**，不会持续创建/销毁。

##### 4 帧动画拆解（盯着 button 这一个节点看）

**帧 1：首次 mount**

```
root.current = Fiber_A         对象数：1
Fiber_A.alternate = null       （wIP 还没出现）
Fiber_A ←─ 用户看到的 DOM
```

**帧 2：第一次 setState（reconcile 阶段）**

```
root.current = Fiber_A         对象数：2（new Fiber_B）
Fiber_A.alternate = Fiber_B
Fiber_B.alternate = Fiber_A

Fiber_A ←─ 用户仍看到的（current）
Fiber_B ←─ React 正在改的（wIP）
```

**帧 3：第一次 commit 完成（身份对换）**

```
root.current = Fiber_B  ★ 指针变了！   对象数：仍是 2
Fiber_A.alternate = Fiber_B
Fiber_B.alternate = Fiber_A

Fiber_B ←─ 用户现在看到的（新 current）
Fiber_A ←─ 旧 current，现在是"下次 wIP 候选"
```

⭐ 关键变化：**只动了一个指针**（`root.current` 从 A 改指到 B）。Fiber_A 没动、没销毁，字段还是上次的 props/state。

**帧 4：第二次 setState（复用旧 current 当 wIP）**

```js
function createWorkInProgress(current, pendingProps) {
  let workInProgress = current.alternate;  // ← 这里！
  if (workInProgress === null) {
    // 第一次更新走这里：new 新对象
    workInProgress = createFiber(...);
    workInProgress.alternate = current;
    current.alternate = workInProgress;
  } else {
    // 第二次及以后走这里：直接复用！
    workInProgress.pendingProps = pendingProps;
    workInProgress.flags = 0;          // 清掉上次的 effect 标记
    workInProgress.subtreeFlags = 0;
    workInProgress.deletions = null;
  }
  return workInProgress;
}
```

第二次 setState 时：

```
root.current = Fiber_B（用户看的）       对象数：仍是 2
Fiber_A 被改写：
  - pendingProps ← 新 props
  - flags = 0
  - 准备接受 reconcile 在它身上打新标记
Fiber_A 现在是新的 wIP！
```

**Fiber_A 没有"重建"**，只是字段被改写了。对象引用、对象身份完全没变。

##### 整个循环示意

```
mount:
   只有 Fiber_A      (current)
                  ↓ setState
update 1:
   new Fiber_B      Fiber_A (current) ←─alt─→ Fiber_B (wIP)
                  ↓ commit
                  ↓ root.current = B
   身份对换：       Fiber_A (旧 current → 下次 wIP)  Fiber_B (新 current)
                  ↓ setState
update 2:
   不 new！复用 A   Fiber_B (current) ←─alt─→ Fiber_A (wIP)
                  ↓ commit
                  ↓ root.current = A
   再次对换：       Fiber_A (新 current)  Fiber_B (旧 current → 下次 wIP)
                  ↓ setState
update 3:
   不 new！复用 B   Fiber_A (current) ←─alt─→ Fiber_B (wIP)
                  ↓ ...

⭐ 整个过程，每个组件位置永远只有 2 个 Fiber 对象在轮换使用
⭐ 没有"销毁"，没有"重建"，只有指针交换 + 字段改写
```

##### Fiber 真的会销毁的 3 种情况

| 场景 | 触发条件 |
|---|---|
| 组件卸载 | 整棵子树从 JSX 中移除（条件渲染、列表删除），对应 Fiber 不再被引用 |
| 整个应用 unmount | `root.unmount()` 调用 |
| diff 时类型变化 | `<div>` 改 `<span>`，旧 Fiber 标记 Deletion，新 Fiber 是新对象 |

⚠️ "组件一直存在、只是 setState 更新"的场景下，**Fiber 永远不会销毁**。

##### 关键澄清：其实不是"两棵完整树"

```
current 树           wIP 树
   A                    A'   (A.alternate = A')
   ├ B                  ├ B'
   │  ├ C               │  ├ C ←── 没变化的子节点直接共享
   │  └ D               │  └ D ←── 没变化的子节点直接共享
   └ E                  └ E'  (变了，走 alternate)
```

**严格说，wIP 和 current 是两条"路径"，不是两棵"完整树"**：
- 有变化的节点：wIP 上有对应的 alternate 节点
- 没变化的节点（bailout）：wIP 直接**共享 current 的子树引用**

这就是为什么 React 内存远小于"双倍 Fiber 树"——也是 `React.memo` 性能优化的物理实现。

##### 速查表

| 阶段 | Fiber_A | Fiber_B | root.current |
|---|---|---|---|
| 首次 mount | new，是 current | 不存在 | → A |
| 首次 setState reconcile | current（用户看） | new，是 wIP | → A |
| 首次 commit | 旧 current（保留） | 新 current（用户看） | → B（指针变） |
| 第二次 setState reconcile | **复用为 wIP**（字段改写） | 仍是 current | → B |
| 第二次 commit | 新 current（用户看） | 旧 current（保留） | → A（指针又变） |
| 第三次 setState reconcile | 仍是 current | **复用为 wIP**（字段改写） | → A |

**精髓**：A 和 B 这两个对象**轮流坐庄**，每次 commit 切换 `root.current` 指针。**对象不死，身份对换**。

##### 动手验证（30 秒跑出来）

```js
useEffect(() => {
  if (!btnRef.current) return;
  const fiberKey = Object.keys(btnRef.current).find(k => k.startsWith('__reactFiber$'));
  const fiber = btnRef.current[fiberKey];

  if (window.__lastFibers) {
    const [lastCurrent, lastAlternate] = window.__lastFibers;
    console.log('本次 current === 上次 alternate ?', fiber === lastAlternate);
    console.log('本次 alternate === 上次 current ?', fiber.alternate === lastCurrent);
  }
  window.__lastFibers = [fiber, fiber.alternate];
}, [count]);
```

**预期**：从第 2 次点击开始，两个判断**都是 true** —— 证明对象引用没新建，只是身份对换。

---

## 4.5、reconcile 阶段到底在干嘛

> 这一节解答："reconcile 这个词出现这么多次，它到底是什么动作？"

### 4.5.1 一句话定义

**reconcile = 拿新的 React Element 树，去 diff 旧的 current Fiber 树，生成新的 workInProgress Fiber 树，并在每个节点打上"该干嘛"的标记。**

它**不操作 DOM**，只是在做"计划"。计划做完了交给 commit 阶段去执行。

### 4.5.2 生活类比：装修公司的总监

业主提需求（= 新 Element）：客厅要换沙发、餐厅要加吊灯、卧室不变。

装修总监量房（= reconcile）：拿新需求 vs 现状（current 树）一项一项比对——

| 现状 vs 需求 | 标记 |
|---|---|
| 客厅沙发 A → B | 🟡 Update |
| 餐厅原本没吊灯 → 新加 | 🟢 Placement |
| 厨房水槽：旧有、新没了 | 🔴 Deletion |
| 卧室完全没变 | 不标记，直接复用 |

施工队（= commit）拿着这张"标记清单"动手干活，**不思考、只执行**。

### 4.5.3 reconcile 的 3 个具体子任务

| 子任务 | 做什么 | 在哪 |
|---|---|---|
| 创建/复用 Fiber | 同 type 同 key 复用旧 fiber 的 alternate；不同则新建 | `createFiberFromElement` |
| 跑组件渲染 | 调用 `Component()` 拿到子 Element，进入下一层 | `beginWork` 内部 |
| 打 effect 标记 | 给当前 Fiber 的 `flags` 字段写位运算标记 | `markUpdate / placeChild` |

### 4.5.4 reconcile 的边界

```
reconcile 阶段（可中断、异步）
  ├─ beginWork（向下钻）：处理当前节点，diff 子 Element 生成子 Fiber
  ├─ completeWork（向上爬）：把当前节点的 effect 冒泡到父节点
  └─ 整棵 wIP 树遍历完 → reconcile 结束
      ↓
commit 阶段（同步、不可中断）
  └─ 按 effect 标记动手改 DOM
```

### 4.5.5 关键洞察：reconcile 可以反复打断、反复重来

**只要不进 commit，就没有副作用**。用户看到的是 current 树对应的 DOM，wIP 树折腾 100 次用户都看不见。

这就是 React 18 **并发渲染**的物理基础——高优先级事件（输入、点击）来了，可以直接丢弃当前 wIP，从头再来。

---

## 4.6、effect 标记到底在干嘛

> 这一节解答："flags 这个数字是怎么影响 DOM 操作的？"

### 4.6.1 一句话定义

**effect 标记 = 在 Fiber 节点上贴小纸条，告诉 commit 阶段"对应的 DOM 要做什么操作"。**

### 4.6.2 类比：给装修工人贴指示

装修总监在每个家具上贴一张彩色便利贴：

| 颜色 | 含义 | flag 名 |
|---|---|---|
| 🟢 绿色 | 新增 | Placement |
| 🟡 黄色 | 改属性 | Update |
| 🔴 红色 | 拆掉 | Deletion |
| 🔵 蓝色 | 重绑 ref | Ref |
| 🟣 紫色 | 跑 useEffect | Passive |

工人来了之后**只看便利贴，不思考**：
- 绿色 → `appendChild`
- 黄色 → `setAttribute`
- 没贴纸条的家具完全跳过

### 4.6.3 为什么 effect 要在 reconcile 阶段就算好

| 阶段 | 任务 | 特点 |
|---|---|---|
| Reconcile | 思考（决定每个节点要做什么） | 可中断、可重做、零副作用 |
| Commit | 动手（按标记改 DOM） | 同步、一次性、不可打断 |

**为什么 commit 必须同步**：如果 commit 到一半被中断，DOM 就是残缺状态——用户会看到半个组件。所以设计是：
- **思考阶段反复来都没事**（reconcile）
- **动手阶段一次性搞完**（commit）

→ effect 必须在 reconcile 阶段**提前算好**，commit 不能再做"判断"，只能"执行"。

### 4.6.4 为什么用位运算（不用字符串数组）

```js
// 假设用数组
fiber.effects = ['Update', 'Ref', 'Passive']
if (fiber.effects.includes('Update')) { ... }   // O(n)，慢

// 位运算
fiber.flags = Update | Ref | Passive            // 4 | 512 | 2048 = 2564
if (fiber.flags & Update) { ... }               // O(1)，超快
```

**Fiber 树几千节点，commit 阶段每个节点都判一遍**——位运算性能差距巨大。

### 4.6.5 你截图里 `flags = 4194816` 怎么解读

```
4194816 = 4194304 + 512
        = (1 << 22) + (1 << 9)
        = RefStatic + Ref
```

意思：**这个 button 需要绑定 ref**（你代码里 `btnRef`）。每个版本的 flag 位定义不完全一样，可以查 `react-reconciler/src/ReactFiberFlags.js`。

### 4.6.6 effect 还要"冒泡"到父节点（subtreeFlags 剪枝）

```js
function completeWork(fiber) {
  // ...
  if (fiber.return) {
    fiber.return.subtreeFlags |= fiber.subtreeFlags | fiber.flags;
    //                ↑
    //  把自己和后代的 flags 全部"冒泡"到父节点的 subtreeFlags
  }
}
```

**为什么冒泡**：commit 阶段如果 `node.subtreeFlags === 0`，**整棵子树直接跳过**。

```
        A (subtreeFlags = Update)  ← 有事干，进入
       /│\
      B  C  D (subtreeFlags = 0)   ← D 整棵跳过 ✂️
     /|
    E F
       ↑ E.flags = Update（实际要干活的）
```

这就是 React 17+ 的**整棵子树剪枝**，千万级 Fiber 树 commit 只走"有事的"分支。

---

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
