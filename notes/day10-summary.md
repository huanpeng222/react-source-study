# Day 10 精简笔记：Lane 优先级模型 + 并发渲染

> 复习只看这一份。源码出处：`ReactFiberLane.js` / `ReactFiberWorkLoop.js` / `ReactFiberConcurrentUpdates.js` / `ReactFiberHooks.js` / `ReactEventPriorities.js` / `ReactFiber.js`（行号对照 facebook/react `main`，会随版本漂移）

## 一句话总纲

> **Lane 用一个 31 位的位掩码（bitmask）表示优先级：bit 越靠右优先级越高。它取代了 React 16/17 的 expirationTime，好处是能 O(1) 做集合运算（合并/交集/子集/差集）和"表达一批更新"。Lane 贯穿调度→render→commit 全程。**

## 一、为什么是 bitmask 而非数字

| | expirationTime（旧） | Lane（新） |
|---|---|---|
| 表示 | 一个过期时间戳数字 | 31 位掩码的一位/一批 |
| 比大小 | 数字比较 | `a & -a` 取最低位=最高优先级 |
| 集合运算 | 做不到 | O(1) 位运算 |
| 表达"一批" | 做不到 | 多位 OR 在一起 |

- `SyncLane`=2（离散事件，最高）；`InputContinuousLane`（连续事件）；`DefaultLane`=32（普通 setState）；`TransitionLanes`（更高位，startTransition）；`IdleLane`/`OffscreenLane`（最低）。
- **bit 越靠右（值越小）优先级越高**，所以 `lanes & -lanes` 取最低位就是取最高优先级。

## 二、五个工具函数 + 各自调用时机（定义在 ReactFiberLane.js，调用方散在各文件）

| 函数 | 位运算 | 干什么 | 主要调用点 |
|---|---|---|---|
| `mergeLanes` | `a\|b` | 并进集合 | 冒泡 `markUpdateLaneFromFiberToRoot`(ConcurrentUpdates L195-208) / completeWork `bubbleProperties`(L809-887) |
| `getHighestPriorityLane` | `l & -l` | 取最低位=最高优先级 | `getHighestPriorityLanes`(Lane.js L185/213) → getNextLanes 选批次 |
| `includesSomeLane` | `(a&b)!==0` | 有没有交集 | beginWork bailout(BeginWork L3807/3816) 判断子树要不要往下走 |
| `isSubsetOfLanes` | `(s&b)===b` | subset 是否 set 子集 | `updateReducer`(Hooks L1378-1379) 决定 update 跑不跑 |
| `removeLanes` | `s & ~b` | 从集合抹掉 | WorkLoop L1796-1797 / BeginWork L2351 清账 |

> 🔑 易混：`includesSomeLane` = 两批"有交集就成立"（要不要碰这棵子树）；`isSubsetOfLanes(set, subset)` = "subset 每一位都在 set 里才成立"（这条 update 够不够格本趟生效）。**第二个参数才是被检查的子集。**

## 三、lane 怎么算出来 + 存哪

### lane 是触发时当场算的（requestUpdateLane，WorkLoop L810）

短路顺序：① legacy 模式→恒 `SyncLane`(L813)　② render 阶段内 setState→`pickArbitraryLane` 借当前 wip(L829)　③ 在 startTransition 里→`requestTransitionLane` 领 TransitionLane(L853上)　④ 默认→`eventPriorityToLane(resolveUpdatePriority())`(L853)。

④ 映射固定（ReactEventPriorities.js）：离散→SyncLane / 连续→InputContinuousLane / 默认→DefaultLane / 空闲→IdleLane。

③ 领车道靠轮转计数器 `claimNextTransitionUpdateLane`：`lane = next; next <<= 1; 用完一圈绕回 TransitionLane1`——让相邻 transition 错开车道。

⭐ 优先级**不是你手填的**，是 React 按上下文自动判定（输入=渲染模式/是否transition/事件类型）。唯一手动入口=startTransition / useDeferredValue（主动降级）。

### 每个 fiber 都有 lane，而且两个字段（ReactFiber.js L174-175）

```js
this.lanes = NoLanes;       // 本节点自己欠的
this.childLanes = NoLanes;  // 子树欠的（冒泡汇总，自己不一定有）
```
setState 时：触发的 fiber 标 `lanes`；沿 return 链每个父 fiber 标 `childLanes`（含 alternate 同步标）；root 标 `pendingLanes`。`childLanes===0` → beginWork 整棵 bailout 跳过。createWorkInProgress 会把两字段从 current 拷给 wip(L388-389)。

## 四、并发渲染：可中断 + 插队

- 两个 workLoop（WorkLoop.js），**唯一区别是 `!shouldYield()`**：`workLoopSync` 一口气做完不可中断；`workLoopConcurrent` 每个 Fiber 后问"该让出吗"。
- 触发：SyncLane→workLoopSync（用户交互立即响应）；TransitionLane/DefaultLane（并发下）→workLoopConcurrent。
- **高优先级插队**：低优先级 render 中断 → **未完成 wIP 整棵丢弃**（不 commit，current 毫发无损）→ 先做高优先级 → 低优先级**从头重做**。能安全丢弃是因为 reconcile 只改内存 wIP，用户看的永远是 current 对应的 DOM。

## 五、useTransition vs useDeferredValue

| | useTransition | useDeferredValue |
|---|---|---|
| 包什么 | 一段 **setState 代码** | 一个 **值** |
| 何时用 | 你能改 setState | 值来自 props/第三方，改不到 setState |
| 底层 | 都是把更新标成 TransitionLane（低优先级、可打断/丢弃重做） | 同左 |

- `startTransition(fn)`：**fn 同步执行**，只是执行期间打开全局 transition 标志，里面 setState 走 requestUpdateLane 时被分到 TransitionLane。**它不是异步。**
- "低优先级"体现在**调度/渲染阶段**（选批次排后、可被打断），**不是 commit 时跳过 update**。
- `useDeferredValue(v)`：紧急渲染时先返回旧值 + 调度低优先级追新；低优先级轮到时返回最新 v。

## 六、本次踩坑（入场自测暴露，已纠正）

1. **startTransition 标在哪**：标在 **update 对象（update.lane）** 上，机制是"设全局上下文 → requestUpdateLane 据此发 TransitionLane"，**不是"在 fiber 单元内打标"**。
2. **isSubsetOfLanes 方向**：`(set, subset)`，判断**第二参数是不是第一参数的子集**。`isSubsetOfLanes(0b110,0b010)=true` 因为 0b010 是 0b110 的子集。
3. **低优先级体现在哪个阶段**：调度+渲染（getNextLanes 排后、可中断丢弃），**不是 commit 跳过**；回调本身是同步的。

## 主管道（接 Day 1-9）

```
setState → requestUpdateLane 算 lane（事件类型/transition）
  → fiber.lanes / 沿途 childLanes / root.pendingLanes 标记（mergeLanes）
  → getNextLanes 挑最高优先级一批 = renderLanes（getHighestPriorityLane）
  → SyncLane:workLoopSync(不可断) | TransitionLane:workLoopConcurrent(shouldYield 可断)
      → 高优先级插队？丢弃 wIP（current 不动）→ 先做高优先级 → 低优先级从头重来
  → beginWork(includesSomeLane 判子树) / updateReducer(isSubsetOfLanes 判 update)
  → commit（同步不可断）→ removeLanes 清掉已完成
```
