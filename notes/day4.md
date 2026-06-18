# Day 4 笔记：beginWork / completeWork 工作循环

> 日期：2026-06-18 傍晚 ~ 夜
> 主题：reconcile 阶段两个核心函数的协作机制
> 状态：✅ 概念吃透（傍晚有过认知饱和，睡前默写串通）

---

## 零、入场自测（5 分钟，先自己答再往下看）

1. beginWork 内部对函数组件 / 类组件 / DOM 节点的处理有什么区别？
2. 什么场景下 React 会走 "bailout"（提前退出）？
3. completeWork 为什么要分两步：自己的工作 + 冒泡 effect？
4. Hook 链表是在 beginWork 还是 completeWork 里建立的？

<details>
<summary>📌 我自己的回答（保留作为对比基线）</summary>

1. 完全没概念
2. 没听过
3. 不清楚
4. 我猜是在 beginWork 里建立的（✅ 猜对）

</details>

---

## 一、回顾：Day 2 的 workLoop 和今天的关系

Day 2 学过 workLoop 这个大循环：

```js
function workLoop() {
  while (workInProgress !== null && !shouldYield()) {
    workInProgress = performUnitOfWork(workInProgress);
  }
}

function performUnitOfWork(fiber) {
  const next = beginWork(fiber);        // ← Day 4 重点 1：往下钻
  if (next !== null) return next;

  let node = fiber;
  while (node !== null) {
    completeWork(node);                 // ← Day 4 重点 2：往上爬
    if (node.sibling !== null) return node.sibling;
    node = node.return;
  }
  return null;
}
```

**Day 4 = 把 `beginWork` 和 `completeWork` 两个函数撕开看**。

---

## 二、beginWork 的工作流程

### 2.1 总体逻辑

```js
function beginWork(current, workInProgress, renderLanes) {
  // ① 尝试 bailout（性能优化）
  if (current !== null && oldProps === newProps && !contextChanged && !hasUpdate) {
    return bailoutOnAlreadyFinishedWork(...);
  }

  // ② 按 tag 分发
  switch (workInProgress.tag) {
    case FunctionComponent: return updateFunctionComponent(...);
    case ClassComponent:    return updateClassComponent(...);
    case HostRoot:          return updateHostRoot(...);
    case HostComponent:     return updateHostComponent(...);
    case HostText:          return updateHostText(...);
    case Fragment:          return updateFragment(...);
    // ... 30+ 种 tag
  }
}
```

⭐ **核心结构**：先 bailout 判断 → 再按 tag 分发。

### 2.2 类比：邮件分拣中心

- Fiber = 待分拣的包裹
- tag = 包裹上的"分类标签"
- beginWork = 分拣员

分拣员看到标签 "FunctionComponent" 就送到"函数组件车间"加工；看到 "HostComponent" 就送到"DOM 节点车间"。**车间内部加工流程完全不同**。

### 2.3 三种主要"车间"

#### A. updateFunctionComponent（函数组件）

```js
function updateFunctionComponent(current, workInProgress, Component, props) {
  // ━━ Step 1: 跑用户函数，拿 JSX ━━
  const nextChildren = renderWithHooks(...);
  // 等价于：
  //   nextChildren = Component(props)  ← 真的执行用户写的函数
  //   函数体内 useState/useEffect 在这一步把 Hook 节点挂到 fiber.memoizedState
  //   函数返回的 JSX 就是 nextChildren

  // ━━ Step 2: 用 JSX 去 diff（Day 3 学的）━━
  reconcileChildren(current, workInProgress, nextChildren);
  // 拿 nextChildren（Element 树）去 diff workInProgress.alternate.child（旧 Fiber）
  // 生成新的子 Fiber 链表，挂到 workInProgress.child

  // ━━ Step 3: 返回第一个子 Fiber ━━
  return workInProgress.child;
}
```

⭐ **3 件事**：跑函数 → diff → 返回子 Fiber。

#### B. updateClassComponent（类组件）

```js
function updateClassComponent(current, workInProgress, Component, props) {
  if (current === null) {
    constructClassInstance(...);  // mount：new 实例
    mountClassInstance(...);
  } else {
    updateClassInstance(...);     // update：复用实例
    // 这里调 sCU / getDerivedStateFromProps
  }

  const nextChildren = instance.render();  // 调 render() 拿 JSX
  reconcileChildren(current, workInProgress, nextChildren);
  return workInProgress.child;
}
```

#### C. updateHostComponent（DOM 节点）

```js
function updateHostComponent(current, workInProgress) {
  const type = workInProgress.type;          // "div"、"span"
  const nextProps = workInProgress.pendingProps;

  // 不调用任何用户函数，直接取 children
  let nextChildren = nextProps.children;

  // 单文本子节点优化（不创建 HostText Fiber）
  if (shouldSetTextContent(type, nextProps)) {
    nextChildren = null;
  }

  reconcileChildren(current, workInProgress, nextChildren);
  return workInProgress.child;
}
```

### 2.4 三种 tag 对比表

| | FunctionComponent | ClassComponent | HostComponent |
|---|---|---|---|
| **tag** | 0 | 1 | 5 |
| **调用什么** | `Component(props)` 函数 | `instance.render()` 方法 | 不调用任何函数 |
| **是否有实例** | ❌ | ✅ 跨 render 保留 | ❌ |
| **state 存哪** | fiber.memoizedState | instance.state | 无 state |
| **Hook 链表** | ✅ 这里建立 | ❌ 不用 | ❌ |
| **children 来源** | 函数返回的 JSX | render() 返回的 JSX | props.children |

---

## 三、bailout：性能优化

### 3.1 一句话定义

**bailout = 提前退出**——React 判断"这个 Fiber 不需要重做了"，**直接复用旧 Fiber 的子树**，不进入完整的 beginWork 流程。

### 3.2 触发 bailout 的 3 个条件（同时满足）

```js
if (
  oldProps === newProps &&         // ① props 引用相同（不是值相等）
  !contextChanged() &&             // ② Context 没变
  !hasScheduledUpdate()            // ③ 自己没 setState 排队
) {
  // 走 bailout 路径
}
```

⚠️ **注意 ① 是引用相等**（`===`），不是值相等。`{a:1} === {a:1}` 是 false。

### 3.3 3 个常见触发场景

| 场景 | 触发原因 |
|---|---|
| `React.memo(Component)` | memo 保证传入的 props 引用稳定 → bailout |
| 父 setState 但传给我的 props 引用稳定 | `oldProps === newProps` 命中 |
| 自己内部无更新且 props 没变 | 自动 bailout |

### 3.4 bailout 不是"跳过整棵子树"⚠️

**最大误解**：以为 bailout = 砍掉子树不管了。

**真相**：bailout 只跳过**当前 Fiber 自身渲染**，**子 Fiber 还可能继续遍历**。

```js
function bailoutOnAlreadyFinishedWork(current, workInProgress) {
  if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
    return null;   // 子树也没更新 → 整棵跳过
  }
  cloneChildFibers(current, workInProgress);
  return workInProgress.child;   // 子树有更新 → 继续遍历
}
```

⭐ 关键区分：
- `subtreeFlags / childLanes = 0` → **真正整棵跳过**
- `childLanes` 命中 → 当前 bailout，子继续走

这就是为什么"父 memo 了，子还能渲染"——子可能自己有 setState。

---

## 四、completeWork 的工作流程

### 4.1 时机

子树全部 beginWork 完之后，从叶子开始往上爬时调用。

### 4.2 两件事

#### 第 1 件：自己的工作（按 tag 分发）

| tag | completeWork 干什么 |
|---|---|
| HostComponent（div、button）| **创建真实 DOM 节点**（detached，不挂载） |
| HostText（文本） | **创建 textNode** |
| FunctionComponent / ClassComponent | 几乎啥都不做（没有 DOM 要创建） |

⚠️ **DOM 节点是在 completeWork 创建的，不是 commit 阶段**：

```
reconcile 阶段（可中断）：
  beginWork 决策 + completeWork 创建 detached DOM
  → 最终产出：一棵完整的、未挂载的 DOM 树（在内存里）
       ↓
commit 阶段（不可中断）：
  把整棵 detached DOM 树 appendChild 到真实文档
  浏览器只 reflow 一次
```

**装修类比**：
- beginWork = 设计图纸
- completeWork = 工厂预制家具（造好但还没运到现场）
- commit = 一口气搬进新家

#### 第 2 件：冒泡 effect（bubbleProperties）

```js
function bubbleProperties(completedWork) {
  let subtreeFlags = NoFlags;
  let child = completedWork.child;
  while (child !== null) {
    subtreeFlags |= child.subtreeFlags | child.flags;
    child = child.sibling;
  }
  completedWork.subtreeFlags |= subtreeFlags;
}
```

⭐ **不创建任何 Fiber，不操作任何 DOM**——只做位运算合并。

### 4.3 为什么必须冒泡（commit 剪枝的物理基础）

假设 1000 节点 Fiber 树，只有最深处 1 个 input 要更新：

| | 没冒泡 | 有冒泡 |
|---|---|---|
| commit 复杂度 | O(n) = 1000 次函数调用 | O(深度) ≈ O(log n) = 10 次 |
| 比喻 | 邮递员挨家敲门问"有信吗" | 每户贴邮政编码，邮递员只去有信的区域 |

⭐ **冒泡的唯一目的**：让 commit 阶段沿着"有事干的路径"前进，整棵子树剪枝。

### 4.4 关键澄清：flags 不是冒泡时打的

```
flags（自己要不要变）  在 beginWork 阶段（reconcileChildren 内部）就打好了
subtreeFlags（子树要不要变）  在 completeWork 阶段冒泡得到
```

记忆：**flags 在 beginWork 打，subtreeFlags 在 completeWork 冒。**

### 4.5 为什么 DOM 创建放 completeWork（3 个原因）

| 原因 | 说明 |
|---|---|
| **子 DOM 必须先存在** | `div.appendChild(span)` 要求 span 已创建。completeWork 是回溯阶段，子已经 complete 完 |
| **子 effect 必须先冒泡** | 父的 subtreeFlags 依赖子的 flags 已确定 |
| **可中断重做时不浪费** | beginWork 阶段可能丢弃 wIP 重做。DOM 创建放 completeWork = 子树已稳定时再创建 |

---

## 五、Hook 链表在 beginWork 里建立

### 5.1 精确位置

```
beginWork(fiber)
  ↓ tag === FunctionComponent
updateFunctionComponent(...)
  ↓
renderWithHooks(...)
  ↓ 设置 currentlyRenderingFiber = workInProgress
  ↓ 调用 Component(props)  ← 用户的 JSX 函数
                          ↓
                          函数体内有 useState、useEffect...
                          ↓
                          每个 Hook 调用都建一个 Hook 节点
                          ↓
                          挂到 workInProgress.memoizedState 链表
```

### 5.2 Hook 链表实物

```
fiber.memoizedState
    ↓
  Hook1 (useState)
    memoizedState: 'count = 0'
    next ↓
  Hook2 (useState)
    memoizedState: 'name = ""'
    next ↓
  Hook3 (useEffect)
    memoizedState: effect 对象
    next ↓
  null
```

### 5.3 为什么 Hook 必须顶层调用

```jsx
// ❌ 错误
function MyComponent({ flag }) {
  if (flag) {
    const [a, setA] = useState(0);   // 条件 Hook
  }
  const [b, setB] = useState(0);     // 位置会错乱
}
```

React 完全按"**调用顺序**"对应链表节点：

- 第一次 render flag=true → Hook 链表：[a, b]
- 第二次 render flag=false → 只调一次 useState，对应链表第 1 个 → 拿到 a 的数据 → **赋给变量 b**

变量名 b 在 React 眼里**毫无意义**——React 只看调用顺序。

### 5.4 mount vs update 的差异

**mount**：`mountWorkInProgressHook` → new Hook 节点
**update**：`updateWorkInProgressHook` → 沿 `current.memoizedState` 链表往下走，复用 Hook 节点

---

## 六、完整时序：一棵小树

```jsx
<App>
  <Counter />
</App>
```

```
step 1: beginWork(App)
        → FunctionComponent → renderWithHooks 跑 App 函数 → 返回 [Counter]
        → reconcileChildren 生成子 Fiber Counter
        → 返回 Counter（继续下钻）

step 2: beginWork(Counter)
        → FunctionComponent → renderWithHooks 跑 Counter 函数 → 返回 <button>
        → reconcileChildren 生成子 Fiber button
        → 返回 button

step 3: beginWork(button)
        → HostComponent → 不跑函数，children = '0'
        → reconcileChildren 生成子 Fiber HostText
        → 返回 HostText

step 4: beginWork(HostText)
        → 返回 null（叶子节点）

step 5: completeWork(HostText)
        → 创建 textNode '0'
        → 冒泡 flags 到 button.subtreeFlags

step 6: completeWork(button)
        → 创建 <button> DOM
        → 把 textNode appendChild 到 button
        → 冒泡 flags 到 Counter.subtreeFlags

step 7: completeWork(Counter)
        → FunctionComponent → 几乎不做事
        → 冒泡 flags 到 App.subtreeFlags

step 8: completeWork(App)
        → 同上
        → 冒泡 flags 到 HostRoot

step 9: workInProgress 树构建完成 → 进入 commit
```

⭐ **观察规律**：
- beginWork **深度优先下钻**
- completeWork **回溯时创建 DOM**
- 每个 Fiber 自己的 beginWork 在子树之前，completeWork 在子树之后

---

## 七、动手实验

详见 `demos/day4/README.md`，3 个实验：

| 实验 | 目标 | 产出 |
|---|---|---|
| E1. console 打印 beginWork 时序 | 看到真实的递归顺序 | `E1-console.txt` |
| E2. React.memo 验证 bailout | 父 setState 但子 props 不变，子不重 render | `E2-screenshots/` |
| E3. 验证 Hook 链表顺序敏感 | 把 useState 放 if 里看错乱 | `E3-error-msg.txt` |

---

## 八、我之前以为 …，其实是 …（5 条认知纠正）

1. **我以为** DOM 节点是在 commit 阶段创建的。
   **其实** DOM 节点在 **completeWork** 阶段就创建好了（detached、不在 document 里）。commit 阶段只负责把整棵 detached DOM 树 appendChild 到真实文档。

2. **我以为** beginWork 处理所有 Fiber 类型用同一套逻辑。
   **其实** 是按 `fiber.tag` 分发到 30+ 种 case。函数组件走 renderWithHooks、类组件复用 instance、DOM 节点直接从 props 取 children。

3. **我以为** bailout 就是"跳过整个子树"。
   **其实** bailout 只跳过当前 Fiber 自身渲染，**子 Fiber 的 childLanes 命中时仍会继续遍历**。只有 `childLanes` 也不命中才整棵跳过。

4. **我以为** Hook 链表是某种全局变量。
   **其实** Hook 链表挂在**每个函数组件 Fiber 的 `memoizedState` 字段**上，按调用顺序建立。这就是"Hook 不能放 if/for 里"的根本原因。

5. **我以为** completeWork 主要是"清理工作"。
   **其实** completeWork 干两件极重要的事：**创建/diff DOM 节点** + **冒泡 effect 到父 subtreeFlags**。后者是 commit 阶段整棵子树剪枝的物理基础。

---

## 九、Day 4 验收清单

- [x] 能说出 beginWork 的整体结构（bailout + tag 分发）
- [x] 能默写 FunctionComponent / ClassComponent / HostComponent 三种 tag 处理的关键差异
- [x] 能解释 bailout 的 3 个触发条件
- [x] 能说出"bailout 只跳过自己，子树要看 childLanes"
- [x] 能解释 DOM 节点为什么在 completeWork 创建（不在 commit）
- [x] 能讲清 Hook 链表建立位置和"必须顶层调用"的根本原因
- [x] 能解释 flags 在 beginWork 打、subtreeFlags 在 completeWork 冒泡
- [x] 能用复杂度对比解释"冒泡的价值"
- [ ] 完成 3 个动手实验
- [x] 写下 5 条认知纠正

---

## 十、Day 5 预告

**主题**：commit 阶段（before mutation / mutation / layout 三子阶段）

**预读问题**：

1. commit 阶段的 three sub-phases 是哪三个？分别干什么？
2. useLayoutEffect 和 useEffect 触发的时机精确差在哪？
3. getSnapshotBeforeUpdate 在哪个 sub-phase 调用？为什么需要"快照"？
4. commit 真的完全不可中断吗？React 19 的 useTransition 是怎么影响 commit 的？

明天见 👋
