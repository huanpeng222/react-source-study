# Day 10 笔记：Lane 优先级模型 + 并发渲染

> 日期：2026-06-23
> 主题：React 18+ 用 Lane 位掩码表达优先级，实现可中断、可插队的并发渲染
> 状态：📖 学习中
> 源码出处（已 WebFetch 核对 facebook/react main）：
> - `packages/react-reconciler/src/ReactFiberLane.js`（Lane 常量 + 工具函数）
> - `packages/react-reconciler/src/ReactFiberWorkLoop.js`（workLoopConcurrent / shouldYield）
> - `packages/react-reconciler/src/ReactFiberHooks.js`（mountTransition / updateDeferredValue）

---

## 零、入场自测（5 分钟，先自己答再往下看，"不会"明确说不会）

1. Lane 是什么？和"用数字比大小表示优先级"有什么区别？
2. `startTransition(() => setState(x))` 是怎么让这次 setState 变成"低优先级"的？
3. Concurrent 渲染可中断——中断后高优先级更新插队，之前那棵低优先级 wIP 树怎么办？
4. `useDeferredValue` 和 `useTransition` 区别是什么？

---

## 一、为什么需要 Lane —— 从"过期时间"到"位掩码"

### 1.1 旧模型（React 16/17）：expirationTime（过期时间）

旧调度用一个**数字时间戳**表示优先级：每个更新算一个"过期时间"，越早过期越紧急，靠**比大小**决定先做谁。

致命缺陷：**它是一维标量，无法表达"一批互不相关的更新"**。
- 没法表示"这几个更新属于同一批 Transition，那几个属于另一批"
- 没法 O(1) 做"集合运算"（这批里有没有包含某个优先级 / 求交集 / 求差集）

### 1.2 新模型（React 18+）：Lane（车道，位掩码）

把优先级做成**31 位二进制的每一位**——一位就是一条"车道"。源码 `ReactFiberLane.js`：

```js
export const TotalLanes = 31;
export const NoLanes = 0b0000000000000000000000000000000; // = 0
export const NoLane  = 0b0000000000000000000000000000000; // = 0

export const SyncLane            = 0b0000000000000000000000000000010; // = 2
export const InputContinuousLane = 0b0000000000000000000000000001000; // = 8
export const DefaultLane         = 0b0000000000000000000000000100000; // = 32
const TransitionLanes            = 0b0000000001111111111111100000000; // 一组 14 条
export const IdleLane            = 0b0010000000000000000000000000000;
export const OffscreenLane       = 0b0100000000000000000000000000000;
```

⭐ **核心规则（重要，别记反）**：**bit 越靠右（越低位），优先级越高**。
- `SyncLane`（第 2 位，值 2）= 最高优先级（离散事件如 click、input）
- `DefaultLane`（值 32）= 普通 setState
- `TransitionLanes`（更高位）= 低优先级（startTransition 标记的）
- `IdleLane` / `OffscreenLane` = 最低

### 1.3 为什么位掩码碾压"比大小"

| 操作 | expirationTime（标量）| Lane（位掩码）|
|---|---|---|
| 合并两个优先级 | 做不到（只能取一个）| `a \| b` O(1) |
| 判断"有没有交集" | 做不到 | `(a & b) !== 0` O(1) |
| 取最高优先级 | 比大小 | `lanes & -lanes` O(1) |
| 表达"一批更新" | 做不到 | 一组连续 bit（如 TransitionLanes）|

> 🔍 微检查点 1：`SyncLane=2`、`DefaultLane=32`，哪个优先级高？为什么？

---

## 二、Lane 的五个核心工具函数（源码逐字）

全部来自 `ReactFiberLane.js`，都是纯位运算，**背下来**：

```js
// 取最高优先级 lane（最低位的 1）
export function getHighestPriorityLane(lanes) {
  return lanes & -lanes;
}

// a 里有没有 b 的任意一位（求交集是否非空）
export function includesSomeLane(a, b) {
  return (a & b) !== NoLanes;
}

// subset 是不是 set 的子集（renderLanes 是否覆盖某 update.lane 时用）
export function isSubsetOfLanes(set, subset) {
  return (set & subset) === subset;
}

// 合并优先级
export function mergeLanes(a, b) {
  return a | b;
}

// 从 set 中去掉 subset
export function removeLanes(set, subset) {
  return set & ~subset;
}
```

### 2.1 `lanes & -lanes` 为什么能取最低位的 1

补码原理：`-lanes` = `~lanes + 1`。原数最低位的 1 在取反 +1 后，恰好只有那一位仍是 1，其余高位全相反 → 相与只剩最低位的 1。

```
lanes  = 0b0010100   (20)
-lanes = 0b1101100   (补码)
& 结果 = 0b0000100   (4) ← 最低位的 1 = 最高优先级
```

⭐ 这就是 Day 9 你问 lanes 时我提的那个"取最低位 trick"的源码实现。

### 2.2 这些函数在哪用到（串前几天）

- **Day 6 batching**：同 lane 的多次 setN 合并 → `mergeLanes`
- **Day 6 updateReducerImpl 的 lane 跳过**：`isSubsetOfLanes(renderLanes, update.lane)` 判断这个 update 本次要不要执行
- **Day 9 Context 穿透**：`consumer.lanes = mergeLanes(consumer.lanes, renderLanes)`

> 🔍 微检查点 2：`isSubsetOfLanes(0b110, 0b010)` 结果是什么？它在 updateReducer 里判断什么？

---

### 2.3 五个工具函数各自"什么时候被调用"（源码逐行核对）

> 这五个函数定义在 `packages/react-reconciler/src/ReactFiberLane.js`
> （`includesSomeLane` L784 / `isSubsetOfLanes` L788 / `mergeLanes` L792 / `removeLanes` L796 / `getHighestPriorityLane` 在 `getHighestPriorityLanes` L180 内被调用）。
> 它们本身只是裸位运算，**真正的调用方散在 reconciler 各文件**。下面行号对照 facebook/react `main` 分支（2026-06 抓取核对）。

| 函数 | 位运算 | 干什么 | 主要调用阶段 |
|---|---|---|---|
| `mergeLanes` | `a \| b` | 把 lane 并进集合 | 更新冒泡 / completeWork 汇总 childLanes |
| `getHighestPriorityLane` | `l & -l` | 取最低位=最高优先级 | 选批次 getNextLanes |
| `includesSomeLane` | `(a&b)!==0` | 有没有交集（OR 关系） | beginWork 判断要不要重渲 |
| `isSubsetOfLanes` | `(s&b)===b` | 是不是子集（AND 关系） | hook update 队列取舍 |
| `removeLanes` | `s & ~b` | 从集合里抹掉 | 重置 baseLanes / suspended 清账 |

**① `mergeLanes`（最高频，全程都在用）**
- `ReactFiberConcurrentUpdates.js` `markUpdateLaneFromFiberToRoot`（L195-208）：把这条 lane 累加到 sourceFiber.lanes 及沿 `return` 链每个 `parent.childLanes`（含 alternate）。这是更新冒泡的核心。
- `ReactFiberCompleteWork.js` `bubbleProperties`（L809-887）：completeWork 回溯时把子节点 `lanes|childLanes` 往上汇总成父 `newChildLanes`。
- `ReactFiberHooks.js` L3859 `updateReducer` 入队：`newQueueLanes = mergeLanes(queueLanes, lane)`，记录队列里还欠哪些 lane。

**② `getHighestPriorityLane`**
- `ReactFiberLane.js` `getHighestPriorityLanes`（L185、L213）内部：选批次时先取最急的一条来归类。`getNextLanes`（L286+）层层调用它决定本趟 renderLanes。**唯一在 Lane 文件里就被反复调用的函数。**

**③ `includesSomeLane`（"沾边就算"）**
- `ReactFiberBeginWork.js`（17 处）：核心在 `bailoutOnAlreadyFinishedWork`（L3807、L3816）——`if (!includesSomeLane(renderLanes, workInProgress.childLanes))` 子树没活就整棵跳过；Context 消费判断 L1013、L3029 `includesSomeLane(renderLanes, current.childLanes)`。
- `ReactFiberWorkLoop.js` L4325-4327：判断本趟是否含 `UpdateLanes`/`SyncUpdateLanes`。

**④ `isSubsetOfLanes`（"必须完全包含"）**
- `ReactFiberHooks.js` `updateReducer`（L1378-1379）：`shouldSkipUpdate = !isSubsetOfLanes(renderLanes, updateLane)`——update 的 lane 没被本趟 renderLanes 完全覆盖就**跳过、攒到下趟**。这是低优先级 update 被保留的核心机制。
- `ReactFiberWorkLoop.js` L5019：ping 回来的 lane 是否仍是当前 render 的子集，决定能否复用。

**⑤ `removeLanes`（从集合抹掉）**
- `ReactFiberWorkLoop.js` L1796-1797：`suspendedLanes = removeLanes(suspendedLanes, pingedLanes)`——被 ping 唤醒的 lane 从挂起集合移除。
- `ReactFiberBeginWork.js` L2351 / L670：离开 Offscreen 边界时 `removeLanes(current.childLanes, renderLanes)`，把已渲染的从剩余里减掉。
- `ReactFiberHooks.js` L922：`current.lanes = removeLanes(current.lanes, lanes)` 清掉已处理的 hook lane。

> ⚠️ 诚实标注：本地 `react@19.2.7` 的 `react-dom` 打包构建里，这四个函数（除 `getHighestPriorityLanes`）已被**内联成裸位运算、函数名消失**，无法本地 grep 行号。以上行号全部来自官方源码仓库 facebook/react `main` 分支核对；不同版本/tag 行号会漂移，函数名级别的调用关系稳定。

> 🔑 区分易混点：`includesSomeLane` 是"两批有交集就成立"（"要不要碰这棵子树"）；`isSubsetOfLanes` 是"subset 每一位都在 set 里才成立"（"这条 update 够不够格本趟生效"）。

---

## 三、一次更新如何被分配 Lane

### 3.1 入口：requestUpdateLane（lane 值到底怎么算出来的）

`setState` → `dispatchSetState` → `requestUpdateLane(fiber)`（`ReactFiberWorkLoop.js` L810）决定这次更新走哪条车道。**lane 不是"存"出来的，是触发时按上下文当场算的**，从上到下短路判断：

```js
function requestUpdateLane(fiber) {
  // ① legacy（非并发）模式：根本不分车道，永远 SyncLane         L813
  if (!disableLegacyMode && (mode & ConcurrentMode) === NoMode) return SyncLane;

  // ② render 阶段里又 setState（非官方支持）：借用当前 wip 的车道  L829
  if ((executionContext & RenderContext) !== NoContext && wipRenderLanes !== NoLanes)
    return pickArbitraryLane(workInProgressRootRenderLanes);

  // ③ 在 startTransition 回调里：领一条 TransitionLane             L853 上
  const transition = requestCurrentTransition();
  if (transition !== null) return requestTransitionLane(transition);

  // ④ 默认：看"当前事件优先级"翻译成 lane                          L853
  return eventPriorityToLane(resolveUpdatePriority());
}
```

**④ 的映射是固定常量**（`ReactEventPriorities.js` L25-28 + `eventPriorityToLane` L51）：

| 事件类型 | EventPriority | → Lane |
|---|---|---|
| 离散 click / input / keydown | DiscreteEventPriority | `SyncLane`(2) |
| 连续 scroll / mousemove | ContinuousEventPriority | `InputContinuousLane` |
| setTimeout / 网络回调 | DefaultEventPriority | `DefaultLane`(32) |
| 空闲 / offscreen | IdleEventPriority | `IdleLane` |

**③ 的 TransitionLane 怎么领**（`ReactFiberLane.js` `claimNextTransitionUpdateLane`）——唯一带"状态记忆"的分配，靠一个轮转计数器让相邻 transition 错开车道：

```js
const lane = nextTransitionUpdateLane;
nextTransitionUpdateLane <<= 1;                 // 左移一位 = 下一条车道
if ((nextTransitionUpdateLane & TransitionUpdateLanes) === NoLanes)
  nextTransitionUpdateLane = TransitionLane1;    // 用完一圈绕回开头
return lane;
```

⭐ **关键认知**：优先级**不是你手动指定的**，是 React 按"触发更新的运行上下文"自动判定的（输入只有三个：渲染模式 / 是否在 transition 里 / 当前事件类型）。唯一的手动入口是 `startTransition` / `useDeferredValue`——主动降级为低优先级。

### 3.2 lane 算出来后存哪：每个 fiber 都有，而且是两个字段

构造 FiberNode 时就初始化（`ReactFiber.js` L174-175），所以**每个 fiber 都有，平时都是 `NoLanes`(0) = 没活**：

```js
this.lanes = NoLanes;       // 本节点自己有没有待处理 update
this.childLanes = NoLanes;  // 它的子树里有没有待处理 update（自己不一定有）
```

| 字段 | 含义 | 谁来写 |
|---|---|---|
| `fiber.lanes` | **本节点自己**欠的 lane | `markUpdateLaneFromFiberToRoot` 给 sourceFiber 写；hook 入队写 |
| `fiber.childLanes` | **后代子树**欠的 lane（冒泡汇总） | 冒泡时沿途父节点累加；completeWork `bubbleProperties` 回溯汇总 |

一次 setState 发生时（`markUpdateLaneFromFiberToRoot` `ReactFiberConcurrentUpdates.js` L195-208）：
1. 触发的 fiber → `lanes = mergeLanes(lanes, lane)`；
2. 沿 `return` 链到 root，每个父 fiber → `childLanes = mergeLanes(childLanes, lane)`（**含 alternate 一起标**，双缓存两棵树 lane 要同步）；
3. root → `root.pendingLanes |= lane`。

这正是 beginWork 能靠 `includesSomeLane(renderLanes, fiber.childLanes)` 判断"这棵子树要不要往下走"的原因——`childLanes` 是 0 就整棵 bailout 跳过。

> ⚠️ `createWorkInProgress` 复用 alternate 时会 `wip.lanes = current.lanes` / `wip.childLanes = current.childLanes` 一起拷（`ReactFiber.js` L388-389），这就是为什么标记时必须给 alternate 也标一遍。

> 🔍 微检查点 3：在 `onClick` 里直接 `setN(1)`，和在 `startTransition(() => setN(1))` 里，这两次更新被分到的 lane 一样吗？

---

## 四、并发渲染：可中断 + 插队（接 Day 2 的 workLoop）

### 4.1 同步 vs 并发两种 workLoop

Day 2 学过 workLoop 是"循环处理 Fiber"。源码 `ReactFiberWorkLoop.js` 里其实有**两个**：

```js
// 同步：一口气做完，不检查是否该让出
function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

// 并发：每个 Fiber 处理完都检查 shouldYield()
function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}
```

⭐ 唯一区别就是那个 **`!shouldYield()`**——并发模式下每处理完一个 Fiber 就问一句"该让出主线程了吗"（时间片到了 / 有更高优先级任务），是就暂停（保留 `workInProgress` 指针，下次接着干，正是 Day 2 学的"可中断的物理基础"）。

### 4.2 谁触发并发 workLoop

- SyncLane（点击等）→ 走 `workLoopSync`，**同步做完不可中断**（用户交互要立即响应）
- TransitionLane / DefaultLane（在并发特性下）→ 走 `workLoopConcurrent`，**可中断**

### 4.3 高优先级插队，低优先级 wIP 树怎么办（入场 Q3）

场景：正在用 `workLoopConcurrent` 渲染一棵 Transition 的 wIP 树（低优先级），渲染到一半，用户点击（SyncLane 高优先级）进来。

React 的处理（源码 `getNextLanes` 那段"避免中断更高优先级"反过来的情况）：

```
1. 当前低优先级 render 被中断（shouldYield 返回 true，因为有更高优先级 pending）
2. 这棵【未完成的 wIP 树直接丢弃】（不 commit）—— current 树毫发无损
3. 先处理高优先级更新（同步渲染 + commit 点击的结果）
4. 高优先级做完后，低优先级更新【从头重新开始】renderLanes 重新走一遍
```

⭐ **核心**：被打断的 wIP **不是"暂停后接着用"，而是丢弃重做**（除非时间片到期这种同优先级让出，才是保留指针续跑）。这正是 Day 2 §4 学的"reconcile 可丢弃 = 因为没 commit，current 还是完整旧状态"。

⭐ **为什么能安全丢弃**：因为 reconcile 阶段只在内存改 wIP 树，用户看到的永远是 current 树对应的 DOM。丢弃 wIP 用户毫无感知。

> 🔍 微检查点 4：低优先级渲染被高优先级打断后，是"暂停接着跑"还是"丢弃重做"？为什么这样不会让用户看到残缺画面？

---

## 五、useTransition：把更新降级为低优先级（入场 Q2）

### 5.1 用法

```jsx
const [isPending, startTransition] = useTransition();

startTransition(() => {
  setSearchQuery(input);   // 这次 setState 被标记为 TransitionLane（低优先级）
});
```

### 5.2 源码做了什么（`ReactFiberHooks.js` mountTransition + startTransition）

```
startTransition(scope):
  1. 把全局变量 ReactCurrentBatchConfig.transition 设为一个非 null 的 transition 对象
  2. 同步执行 scope()  ← 你的回调，里面的 setState 此刻被调用
     · 这些 setState 走 requestUpdateLane 时，发现 transition !== null
       → 分配 TransitionLane（低优先级）而非 SyncLane
  3. 恢复 transition = 之前的值
  4. isPending 通过一个高优先级的占位更新驱动（Transition 进行中显示 true）
```

⭐ **本质**：`startTransition` 就是给"包在它回调里的所有 setState"打上"我是低优先级"的标记。它**不是异步**——回调是同步执行的，只是产生的更新被分到了低优先级车道，可被打断/延后/丢弃重做。

### 5.3 经典场景：搜索框不卡顿

```jsx
const handleChange = (e) => {
  setInput(e.target.value);              // 高优先级：输入框立即响应（SyncLane）
  startTransition(() => {
    setQuery(e.target.value);            // 低优先级：搜索结果可以慢慢算（TransitionLane）
  });
};
```

用户狂敲键盘时：每次输入 → input 立即更新（不卡），搜索结果的 render 反复被新输入打断、丢弃重做，直到用户停手才完整算完。

> 🔍 微检查点 5：startTransition 的回调是同步执行还是异步执行的？它"低优先级"体现在哪？

---

## 六、useDeferredValue：值的"延迟版本"（入场 Q4）

### 6.1 用法

```jsx
const deferredQuery = useDeferredValue(query);
// query 变化时，deferredQuery 会"滞后"更新——先返回旧值（低优先级地追上新值）
```

### 6.2 和 useTransition 的区别

| | useTransition | useDeferredValue |
|---|---|---|
| 操作对象 | 一段 **setState 代码**（你主动包） | 一个 **值**（你传进去） |
| 谁触发降级 | 你把 setState 放进 startTransition | React 内部对这个值做"低优先级追更" |
| 典型用法 | 你能改 setState 的地方 | 值来自 props / 第三方，你改不到 setState |
| 本质 | 都是把更新标记成 TransitionLane（低优先级） | 同左 |

⭐ **一句话区分**：
> **useTransition 包"动作"（setState），useDeferredValue 包"值"。** 两者底层都是用 Transition 优先级实现"低优先级地更新，可被高优先级打断"。能改 setState 就用 transition，只拿得到值就用 deferredValue。

### 6.3 源码（`ReactFiberHooks.js` updateDeferredValueImpl）

```
useDeferredValue(value):
  if (当前是高优先级渲染 / 紧急更新):
    返回上一次的旧值 prevValue（先不追新）
    同时调度一个低优先级更新去"追上" value
  else (低优先级渲染轮到它了):
    返回最新 value
    更新 hook.memoizedState = value
```

> 🔍 微检查点 6：手头只有一个从 props 传进来的 `keyword`（改不到它的 setState），想让依赖它的重计算不卡输入，用哪个 Hook？

---

## 七、串成主管道（接 Day 1-9）

```
setState
  ↓ requestUpdateLane：根据上下文/transition 分配 lane
  ↓   离散事件→SyncLane / startTransition→TransitionLane / 其他→DefaultLane
root.pendingLanes |= lane
  ↓ getNextLanes：挑最高优先级的一批 = renderLanes
  ↓
  ├─ SyncLane → workLoopSync（不可中断，一口气做完）
  └─ TransitionLane → workLoopConcurrent（每个 Fiber 后 shouldYield 检查）
        ↓ 渲染中高优先级插队？
        → 丢弃当前 wIP 树（current 不动）→ 先做高优先级 → 低优先级从头重来
  ↓ renderLanes 跑 beginWork/completeWork（Day 4）
  ↓   updateReducer 里 isSubsetOfLanes(renderLanes, update.lane) 决定每个 update 跑不跑（Day 6）
  ↓ commit（Day 5，同步不可中断）
  ↓ root.pendingLanes 移除已完成的 lanes（removeLanes）
```

⭐ Lane 是贯穿"调度 → render → commit"全程的优先级线索：分配（requestUpdateLane）→ 挑选（getNextLanes）→ 筛选执行（isSubsetOfLanes）→ 清除（removeLanes）。

---

## 八、动手实验

详见 `demos/day10/README.md`，3 个实验（K1 自动批处理 / K2 useTransition isPending / K3 useDeferredValue 值滞后），全部本地 jsdom + react@19.2.7 实测，原始输出见 `demos/day10/observations.md`。

⚠️ 诚实边界：jsdom + node 无真实时间分片，"低优先级 wIP 被打断丢弃重做"观察不到，故不做实验、不编造（只在 §4 讲源码机制）。

---

## 九、我之前以为 …，其实是 …（5 条认知纠正，跟练后回填）

1. **我以为** startTransition 是"在 setState 的那个 fiber 单元内打上低优先级标"；**其实是** startTransition 只设置一个**全局 transition 上下文**（`requestCurrentTransition()` 能取到），真正打标发生在 `requestUpdateLane` 里检测到 `transition !== null` → 领一条 TransitionLane，而这条 lane 最终是标在 **update 对象上（`update.lane`）**，不是"fiber 单元内"。

2. **我以为** `isSubsetOfLanes(a, b)` 判断"a 是不是 b 的子集"；**其实是反的**——签名是 `isSubsetOfLanes(set, subset)`，`(set & subset) === subset`，判断**第二个参数 subset 是否为第一个参数 set 的子集**。记法：第一个是"大池子 renderLanes"，第二个是"被检查的小东西 update.lane"。

3. **我以为** transition 的"低优先级"体现在"commit 时跳过 update"；**其实**低优先级体现在**调度 + 渲染阶段**：① `getNextLanes` 选批次时排在 SyncLane 之后先不被选；② 渲染中可被高优先级打断、整棵 wIP 丢弃重做。到 commit 阶段已是"确定要提交的一批",不存在跳过 update。

4. **我以为** lane 是某处算好存起来的固定值；**其实** lane 是**每次更新触发时由 `requestUpdateLane` 按上下文当场算的**（输入=渲染模式/是否在transition/当前事件类型），只有 `claimNextTransitionUpdateLane` 那个 `<<=1` 轮转计数器带状态记忆。

5. **我以为** 只有"有活的"fiber 才有 lane 字段；**其实**每个 FiberNode 构造时就有 `lanes` 和 `childLanes` 两个字段（初始 `NoLanes=0`），且语义不同：`lanes`=自己欠的，`childLanes`=子树欠的（冒泡汇总），后者是 beginWork bailout 整棵跳过的依据。

### 9.5 入场自测 / 微检查点对答（2026-06-23 本人作答 → 教练判定）

| 题 | 判定 | 关键纠正 |
|---|---|---|
| Q1 lane 是什么 | ✅ | bitmask 一位/批；O(1) 集合运算 |
| Q2 startTransition 怎么降级 | ⚠️ | 标在 update 上、设全局上下文，非"fiber 单元内打标"（见纠正1） |
| Q3 低优先级 wIP 怎么办 | ✅ | 丢弃重做 |
| Q4 useDeferredValue vs useTransition | ✅ | 包值 vs 包动作 |
| 检查点2 `isSubsetOfLanes(0b110,0b010)` | ⚠️ | 结果 true 对，子集方向反了（见纠正2） |
| 检查点3 onClick vs transition | ✅ | Sync vs TransitionLane，不同 |
| 检查点4 打断后暂停/丢弃 | ✅ | 丢弃重做，靠 commit 切 current 指针 |
| 检查点5 回调同步? 低优先级体现在哪 | ⚠️ | 回调同步✅；但体现在调度/渲染阶段非 commit（见纠正3） |
| 检查点6 改不到 setState 用啥 | ✅ | useDeferredValue |

> 成绩：6 对 3 偏。三个偏差都属"机制定位"（标在哪 / 谁是子集 / 在哪个阶段让步），概念方向均正确。

---

## 十、Day 10 验收清单

- [x] 能说清 Lane 相比 expirationTime 的优势（位掩码 = 可做集合运算 + 表达一批更新）
- [x] 知道"bit 越靠右优先级越高"，SyncLane > DefaultLane > TransitionLane > IdleLane
- [x] 能默写 5 个工具函数（getHighestPriorityLane / includesSomeLane / isSubsetOfLanes / mergeLanes / removeLanes）
- [x] 能解释 `lanes & -lanes` 为什么取最低位
- [x] 能说清 workLoopSync vs workLoopConcurrent 的唯一区别（shouldYield）
- [x] 能解释高优先级插队时低优先级 wIP 树被"丢弃重做"而非暂停续跑
- [x] 能讲清 useTransition（包动作）vs useDeferredValue（包值）的区别
- [x] 完成 3 个动手实验（K1/K2/K3，本地实测）
- [x] 写下 5 条认知纠正

---

## 十一、Day 11 预告（W3：Suspense 原理）

**主题**：Suspense 的挂起机制（throw promise + 捕获 + fallback）

**预读问题**：

1. `<Suspense>` 是怎么"捕获"子组件还没准备好的状态的？（提示：throw 一个 promise）
2. 组件 throw promise 后，React 怎么知道"等它 resolve 再重试"？
3. Suspense 和 Error Boundary 在实现上有什么相似之处？
4. `use(promise)`（React 19）和老的 throw promise 写法有什么关系？

明天见 👋
