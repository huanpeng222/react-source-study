# Day19 — Scheduler：requestIdleCallback 的替代方案 + MessageChannel 时间片

> 📌 **回归主线说明**：Day17/Day18 是跨电脑接力时带偏的 Next.js 支线（已标注，暂停）。今天拉回 `meta/roadmap.md` 原定的 **D12 Scheduler** 主题——这是 Day10 Lane 模型、Day11 Suspense 里反复出现的"调度让出主线程"能力的真正实现层，也是 W3 剩余缺口（useTransition/useDeferredValue/高优先级打断实战）的前置知识。
>
> 日期：2026-07-03
> 主题：`packages/scheduler` 包——最小堆任务队列、五级优先级超时、MessageChannel 时间片让出机制
> 状态：📖 教程完成，待跟练
> 源码出处（facebook/react main 分支，已逐行抓取核实）：
> - `packages/scheduler/src/forks/Scheduler.js`（主实现：`workLoop`/`unstable_scheduleCallback`/`shouldYieldToHost`/`performWorkUntilDeadline`）
> - `packages/scheduler/src/SchedulerFeatureFlags.js`（五个超时常量的具体数值）
> - `packages/scheduler/src/SchedulerMinHeap.js`（`push`/`pop`/`peek` 最小堆实现，本篇引用其接口，未逐行展开算法本身）

---

## 零、入场自测（先答，不会就写"不会"）

1. Day10 讲过 `workLoopConcurrent` 里会调用 `shouldYield()` 判断要不要让出主线程。这个 `shouldYield` 和 Scheduler 包里的东西是什么关系？

2. 为什么 React 不直接用浏览器原生的 `requestIdleCallback`（这东西听起来就是干这个事的），反而要自己写一个调度器？

3. `setTimeout(fn, 0)` 和 `MessageChannel` 都能做到"异步执行一个回调"，Scheduler 选 MessageChannel，你猜是为什么？

4. 如果我同时调度了一个"立即"优先级任务和一个"空闲"优先级任务，Scheduler 内部是怎么保证前者先跑的？是按谁先调度算，还是按优先级算？

---

## 一、先搞清楚 Scheduler 是谁、不是谁

### 1.1 一个常见的误解

> ⚠️ **微检查点 0（现在就想一下）**：Scheduler 是 React 用来决定"这个 setState 应该走高优先级还是低优先级"的东西吗？

**不是**。这是本篇最容易搞混的一点，先讲清楚分工：

```
┌─────────────────────────────────────────────────┐
│  Lane 模型（Day10 讲的）                          │
│  ─────────────────────                           │
│  职责：给"一次更新"打上优先级标签（SyncLane /       │
│  DefaultLane / TransitionLane...）                │
│  回答的问题："这次更新有多急？"                     │
└─────────────────────────────────────────────────┘
                    ↓ lane 会被转换成
┌─────────────────────────────────────────────────┐
│  Scheduler（今天讲的）                            │
│  ─────────────────────                           │
│  职责：给定一个"优先级 + 回调函数"，安排它在合适的   │
│  时机执行，并且能在执行过程中随时被要求"让出"        │
│  回答的问题："轮到你跑的时候，你还能再跑多久？"      │
└─────────────────────────────────────────────────┘
```

**关键区别**：Lane 是 React reconciler 自己的概念（一次更新有多急）；Scheduler 是一个**完全独立的、和 React 本身没有耦合关系的通用调度包**——理论上你可以把它单独拿出来，给任何"需要分片执行任务、避免卡死主线程"的场景用，不一定要跟 React 绑在一起。

> 💡 **验证这个独立性**：`packages/scheduler` 是 npm 上单独发布的包（`scheduler`），`react-reconciler` 通过 `Scheduler.js` 这层桥接文件去调用它的 API（`unstable_scheduleCallback` 等），reconciler 内部看到的是 `scheduleCallback`、`shouldYield` 这些包了一层的名字。

### 1.2 Day10 里的 `shouldYield` 到底是谁

> 📌 **回答入场自测 Q1**

Day10 提到的 `workLoopConcurrent` 里调用的 `shouldYield()`，实际上是 reconciler 对 Scheduler 包 `shouldYieldToHost()` 的**再包装**（`react-reconciler/src/Scheduler.js` 里会 `export const shouldYield = Scheduler_shouldYield`，这层桥接文件本身不是本篇重点，只需知道它是转发关系，不是自己重新实现了一套逻辑）。

也就是说：`workLoopConcurrent` 每处理完一个 Fiber 单元，就问一次"我还能继续吗"——这个问题最终问到的是**今天要讲的** `shouldYieldToHost`。

---

## 二、为什么不用浏览器原生 `requestIdleCallback`？

> 📌 **回答入场自测 Q2**

`requestIdleCallback`（简称 rIC）听起来完美契合需求——"浏览器空闲的时候告诉我，我趁机干点活"。但它有三个致命问题（这是社区广泛讨论的已知限制，不是我编的，你可以自己搜 `requestIdleCallback` 的兼容性和调用频率文档验证）：

| 问题 | 具体表现 |
|---|---|
| **触发频率不稳定** | 空闲回调的调用频率完全取决于浏览器主线程还剩多少空闲时间，可能几十毫秒才触发一次，也可能很久不触发（比如页面在做别的高频动画） |
| **兼容性不完整** | Safari 长期不支持 `requestIdleCallback`（本篇写作时仍需确认最新支持情况，但 React 需要支持所有主流浏览器，不能依赖一个非全兼容 API） |
| **deadline 不可控** | 浏览器给的"空闲时间"长度不是 React 自己能精确控制的，没法按自己的时间片策略（比如固定 5ms）来切分工作 |

**React 的解法**：自己实现一套调度机制，用 `MessageChannel` 模拟"下一个宏任务"的时机，自己控制时间片长度（`frameYieldMs = 5`，见下面 §四），完全不依赖浏览器的空闲检测。

---

## 三、任务队列：最小堆 + 双队列设计

### 3.1 两个队列，各管一段时间轴

```js
// packages/scheduler/src/forks/Scheduler.js
var taskQueue: Array<Task> = [];   // 已经到达可执行时间的任务
var timerQueue: Array<Task> = [];  // 还没到执行时间的延迟任务
```

- `taskQueue`：按 **`expirationTime`（过期时间）** 排序的最小堆，堆顶永远是最紧急（最早过期）的任务
- `timerQueue`：按 **`startTime`（预定开始时间）** 排序的最小堆，用于还没轮到的延迟任务

两个都是**最小堆**（数组实现，`push`/`pop`/`peek` 来自 `SchedulerMinHeap.js`），保证"拿堆顶元素"是 O(1)，"插入/弹出"是 O(log n)——比每次用 `Array.sort()` 重排全量任务高效得多。

### 3.2 `unstable_scheduleCallback`：新任务进哪个队列？

```js
// 简化版逻辑（源码 packages/scheduler/src/forks/Scheduler.js ~L335-427）
if (startTime > currentTime) {
  // 还没到点 → 扔进 timerQueue，用 startTime 排序
  newTask.sortIndex = startTime;
  push(timerQueue, newTask);
  // 如果它是 timerQueue 里最早的，且当前没有立即任务在排队
  // → 用 setTimeout 定一个"到点唤醒"的钩子
  requestHostTimeout(handleTimeout, startTime - currentTime);
} else {
  // 已经到点了 → 直接扔进 taskQueue，用 expirationTime 排序
  newTask.sortIndex = expirationTime;
  push(taskQueue, newTask);
  // 触发一次调度请求（如果还没在排队）
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback();
  }
}
```

**`expirationTime` 是怎么算出来的**？

```js
var expirationTime = startTime + timeout;
```

`timeout` 就是下面讲的"优先级对应的超时数值"。**优先级越高，timeout 越小，expirationTime 越早，堆里排得越靠前，越早被执行。**

### 3.3 延迟任务怎么"转正"

`workLoop` 每次开始工作前，都会调用 `advanceTimers(currentTime)`——检查 `timerQueue` 堆顶的任务是否 `startTime <= currentTime` 已经到点了，到点就把它从 `timerQueue` 弹出，`push` 进 `taskQueue`。这就是"延迟任务 → 就绪任务"的转移机制。

> 📌 **微检查点 1**：如果 `timerQueue` 里有一个任务 A 的 `startTime` 是 100ms 后，`taskQueue` 里已经有一个任务 B 在排队且正在执行中，A 到点后会打断 B 的执行吗？（提示：想想 `advanceTimers` 是什么时候被调用的）

---

## 四、五个优先级 = 五个超时数值

### 4.1 源码里的确切数值

> 源码出处：`packages/scheduler/src/SchedulerFeatureFlags.js`（已核实抓取，非推断）

```js
export const frameYieldMs = 5;                   // 时间片长度：5ms
export const userBlockingPriorityTimeout = 250;   // UserBlocking：250ms 后过期
export const normalPriorityTimeout = 5000;        // Normal：5000ms（5秒）后过期
export const lowPriorityTimeout = 10000;          // Low：10000ms（10秒）后过期
```

`ImmediatePriority` 的 timeout 是 `-1`（在 `Scheduler.js` 里单独处理，意味着**立即过期**——一进队列就已经"迟到"了，必须马上执行）。`IdlePriority` 的 timeout 是 `maxSigned31BitInt`（`1073741823`，一个巨大的数，等于"几乎永不过期"）。

### 4.2 完整对照表

| 优先级常量 | timeout | expirationTime = now + timeout | 语义 |
|---|---|---|---|
| `ImmediatePriority` | `-1` | 比 now 还小 → 立刻算"过期" | 必须马上跑（比如离散事件的同步更新） |
| `UserBlockingPriority` | `250` | 250ms 内必须跑完 | 用户交互相关（点击、输入） |
| `NormalPriority` | `5000` | 5 秒内跑完就行 | 大部分默认更新 |
| `LowPriority` | `10000` | 10 秒内跑完就行 | 不太紧急的更新 |
| `IdlePriority` | `1073741823` | 几乎不设限 | 真正的"有空再做"（如离屏预渲染） |

**这张表回答了一个关键问题**：Scheduler 的"优先级"本质上就是"给你多长的容忍窗口"。优先级不是一个抽象的高低标签，是**具体换算成了一个时间戳**，然后所有任务在同一个最小堆里按这个时间戳排序竞争。

> 💡 这也解释了为什么"优先级"和"任务是否该被打断"能统一处理——不需要写一堆 `if (priority === 'high')` 的分支逻辑，堆自己会把 expirationTime 最小（最紧急）的排到最前面。

---

## 五、时间片让出：MessageChannel 而非 setTimeout

### 5.1 三级降级策略

> 📌 **回答入场自测 Q3**

源码里 `schedulePerformWorkUntilDeadline` 的选择逻辑（`packages/scheduler/src/forks/Scheduler.js` ~L531-561）：

```js
if (typeof localSetImmediate === 'function') {
  // Node.js 环境：优先用 setImmediate
  schedulePerformWorkUntilDeadline = () => localSetImmediate(performWorkUntilDeadline);
} else if (typeof MessageChannel !== 'undefined') {
  // 浏览器/Worker 环境：用 MessageChannel
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = performWorkUntilDeadline;
  schedulePerformWorkUntilDeadline = () => port.postMessage(null);
} else {
  // 兜底：setTimeout
  schedulePerformWorkUntilDeadline = () => localSetTimeout(performWorkUntilDeadline, 0);
}
```

**为什么 MessageChannel 优于 `setTimeout(fn, 0)`？**

浏览器对 `setTimeout` 有一个众所周知的限制：**嵌套调用 `setTimeout` 达到一定层数后，即使传入延迟是 0，浏览器也会强制把它节流（clamp）到至少 4ms**（这是 HTML 规范里的历史遗留行为，不是 React 编的）。而 `MessageChannel` 的 `postMessage` 走的是浏览器的宏任务队列，**没有这个 4ms 强制延迟**，能让"让出主线程后立刻重新排队"这个动作尽可能快地被重新调度，调度粒度更精确。

**为什么 Node.js 环境优先用 `setImmediate`？** 源码注释给出的原因：`setImmediate` 不会阻止 Node 进程退出（`setTimeout`/`MessageChannel` 在某些场景可能会让 event loop 一直转），而且它的执行时机比 `MessageChannel` 更早。

### 5.2 完整的"让出→恢复"流程图

```
① unstable_scheduleCallback 把任务放进 taskQueue
                ↓
② requestHostCallback() 被调用
                ↓
③ isMessageLoopRunning = true
   schedulePerformWorkUntilDeadline() → port.postMessage(null)
                ↓
   （让出主线程，浏览器有机会去做其他事：绘制、响应用户输入……）
                ↓
④ MessageChannel 的 onmessage 触发 → performWorkUntilDeadline() 执行
                ↓
⑤ 记录 startTime = getCurrentTime()
   调用 flushWork(currentTime) → 内部调 workLoop(currentTime)
                ↓
⑥ workLoop 循环处理 taskQueue，每处理一个任务前先问 shouldYieldToHost()
                ↓
   如果 shouldYieldToHost() 返回 true → break 跳出循环
                ↓
⑦ flushWork 返回 hasMoreWork
   若为 true → 再调一次 schedulePerformWorkUntilDeadline()（回到步骤③，排下一轮宏任务）
   若为 false → isMessageLoopRunning = false（工作彻底做完，停止循环）
```

**这就是"时间片"的完整含义**：不是"给你分配了一段专属的 CPU 时间"，而是"每次通过 MessageChannel 拿到一次执行机会，在这次机会里尽量多做一点，但做够 `frameYieldMs`（5ms）就必须主动让出，把主线程还给浏览器"。

---

## 六、`shouldYieldToHost`：怎么判断"够 5ms 了"

### 6.1 源码逻辑（已核实，非推断）

```js
// packages/scheduler/src/forks/Scheduler.js ~L459-472
function shouldYieldToHost(): boolean {
  if (!enableAlwaysYieldScheduler && enableRequestPaint && needsPaint) {
    return true;   // 浏览器明确表示"需要绘制了"，立刻让出，不等时间片用完
  }
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameInterval) {
    return false;  // 还没到 5ms，继续跑
  }
  return true;      // 超过 5ms 了，必须让出
}
```

`frameInterval` 默认就是 `frameYieldMs = 5`（可以通过 `unstable_forceFrameRate` 动态调整，内部按 `Math.floor(1000 / fps)` 反算，`fps` 限制在 `0 < fps ≤ 125`）。

`startTime` 是 `performWorkUntilDeadline` 每次被唤醒时记录的时间戳（见 §5.2 步骤⑤）——**注意这不是"任务开始的时间"，是"这一轮宏任务被唤醒的时间"**，`timeElapsed` 算的是"这一轮宏任务里我已经连续跑了多久"。

### 6.2 `workLoop` 里怎么用这个判断

```js
// 简化版（源码 ~L193-243）
function workLoop(initialTime) {
  let currentTime = initialTime;
  advanceTimers(currentTime);
  currentTask = peek(taskQueue);
  while (currentTask !== null) {
    if (currentTask.expirationTime > currentTime && shouldYieldToHost()) {
      break;   // 任务没过期 且 该让出了 → 跳出循环
    }
    const callback = currentTask.callback;
    if (typeof callback === 'function') {
      currentTask.callback = null;
      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();
      if (typeof continuationCallback === 'function') {
        // 返回了"续体函数"——任务没做完，下次接着跑这个续体
        currentTask.callback = continuationCallback;
        return true;   // 立即让出，不管时间片还剩多少
      } else {
        if (currentTask === peek(taskQueue)) pop(taskQueue);
      }
    } else {
      pop(taskQueue);   // callback 已被取消（置为 null），直接丢弃
    }
    currentTask = peek(taskQueue);
  }
  return currentTask !== null;   // 还有没处理完的任务吗？
}
```

**这里有个关键细节要挑出来**（面试常问）：

> ⚠️ **判断顺序很重要**：`currentTask.expirationTime > currentTime && shouldYieldToHost()`——**先判断任务是否已经过期**，只有在"没过期"的前提下才会问"该不该让出"。如果任务已经过期（`expirationTime <= currentTime`），**不会调用 `shouldYieldToHost`**，会强制继续执行，不管时间片用了多久。这是为了避免"高优先级任务因为时间片耗尽而被无限期推迟"。

### 6.3 "续体函数"是什么——这才是可中断渲染的关键

`workLoop` 执行 `callback(didUserCallbackTimeout)` 后，如果返回值**还是一个函数**（`continuationCallback`），Scheduler 会把它重新存回 `currentTask.callback`，**任务留在队列里不删除**，然后**立即** `return true` 让出（不管还剩多少时间片，注释原文写的是 "regardless of how much time is left"）。

> 💡 **这正是 React reconciler 里"可中断渲染"的实现基础**：`performConcurrentWorkOnRoot` 这类 reconciler 函数，如果在被打断时还没渲染完，就会 `return performConcurrentWorkOnRoot.bind(...)`（返回自身的绑定版本）——Scheduler 看到这是个函数，就知道"这个任务只做了一部分，下次从这继续"，而不是重新从头跑一遍。Day10 讲的"高优先级打断后 wip 重做"和这里的"续体"是两个不同的机制：续体是"同优先级任务分片执行"，Day10 的重做是"更高优先级插队导致旧的 render 阶段作废"。

> 📌 **微检查点 2**：如果一个任务的 callback 执行完之后，返回的不是函数而是 `undefined`，`workLoop` 会怎么处理这个任务？

---

## 七、优先级如何决定执行顺序（不是先来先服务）

### 7.1 回答入场自测 Q4

> 📌 你猜"立即优先级"和"空闲优先级"谁先跑——现在有确切答案了。

**不是按谁先调度算，是按 `expirationTime`（在堆里的排序依据）算。** 即使空闲优先级任务先被 `unstable_scheduleCallback` 调用、立即优先级任务后调用，只要立即优先级任务的 `expirationTime` 更小（因为 timeout 是 -1，几乎必然更小），它在 `taskQueue` 这个最小堆里就会排到堆顶，`peek(taskQueue)` 取到的永远是它，**空闲任务要等它跑完才有机会**。

### 7.2 一张图串起来

```
调度顺序 = 谁的 expirationTime 更小
         = 谁的 (startTime + timeout) 更小
         = timeout 越小（优先级越高）越靠前

Immediate(-1)  <  UserBlocking(250)  <  Normal(5000)  <  Low(10000)  <  Idle(~10亿)
   最先跑                                                              最后跑
```

---

## 八、把 Scheduler 放回 React 全景里

```
用户交互/setState 触发更新
        ↓
requestUpdateLane 决定这次更新的 Lane（Day10 讲的）
        ↓
lane 被映射成一个 EventPriority / SchedulerPriority
        ↓
reconciler 调用 scheduleCallback(priority, performConcurrentWorkOnRoot)
        ↓
  ────────────── 今天讲的部分 ──────────────
  Scheduler.unstable_scheduleCallback(priority, callback)
    → 算出 timeout → expirationTime → push 进 taskQueue（最小堆）
    → requestHostCallback() → MessageChannel.postMessage
    → （让出主线程）
    → onmessage 触发 → performWorkUntilDeadline → workLoop
    → 每跑一段就 shouldYieldToHost() 检查 5ms 时间片
    → 没做完就返回续体函数，继续排队；做完就 pop 出队
  ──────────────────────────────────────────
        ↓
performConcurrentWorkOnRoot 实际执行 beginWork/completeWork（Day4 讲的）
```

**一句话总结分工**：Lane 回答"这事有多急"，Scheduler 回答"轮到你的时候，你能连续跑多久、什么时候必须把主线程还回去"。

---

## 九、几个容易搞混的点（面试向）

**Q1：Scheduler 的"优先级"和 Lane 模型的"优先级"是同一套东西吗？**

不是。Lane 是 31 位掩码，可以表示"多个更新合并成一批"；Scheduler 优先级是 5 个离散常量，转换成一个具体的 timeout 数值。两者之间有映射关系（由 reconciler 的桥接代码负责转换），但数据结构和语义都不同。

**Q2：`shouldYieldToHost` 里的 5ms，是"这个任务最多跑 5ms"还是别的意思？**

是"这一轮从 MessageChannel 唤醒开始算，最多连续跑 5ms 就必须让出"，不是针对单个任务的限制——如果一个任务本身很小，5ms 内可能好几个任务都跑完了；如果一个任务很大（比如没有做时间分片的同步计算），Scheduler 也没办法在任务内部强行打断它，只能在任务与任务之间的间隙检查时间片。**这也是为什么 React 的 `beginWork` 要设计成"一个 Fiber 一个 Fiber 处理"而不是一次性递归到底**——粒度足够小，才有机会在合适的间隙触发 yield 检查。

**Q3：`unstable_cancelCallback` 是怎么把任务从堆里删掉的？**

不是真的删。源码注释直说了："基于数组的堆只能弹出堆顶，不能删除任意节点"。所以取消操作只是把 `task.callback` 置为 `null`，等 `workLoop` 或 `advanceTimers` 遍历到这个任务时，发现 `callback` 是 `null`，直接 `pop` 丢弃，是一种"软删除、延迟清理"。

---

## 十、动手实验（写入 demos/day19/）

| 实验 | 验证什么 |
|---|---|
| E1 | 用最小堆模拟 taskQueue，验证不同 timeout 任务的实际执行顺序是否符合 expirationTime 排序 |
| E2 | 用真实浏览器环境对比 `setTimeout(fn, 0)` 连续嵌套调用 vs `MessageChannel.postMessage` 连续调用的实际触发间隔，验证 4ms 节流是否存在 |
| E3 | 模拟一个"返回续体函数"的任务，观察它是否会在时间片未用完时就被立即让出 |

> ⚠️ 按 STUDY_PROTOCOL 的硬规则：所有实验预期必须先本地实测，不能凭源码推断直接写"预期结果"。跟练时会先跑出真实结果再定案。

---

## 十一、验收清单

- [ ] 能说出 Scheduler 和 Lane 模型的分工区别（"多急" vs "能跑多久"）
- [ ] 能说出 React 不用原生 `requestIdleCallback` 的原因
- [ ] 能画出 taskQueue / timerQueue 双最小堆结构，并说明 expirationTime / startTime 分别用来排序哪个队列
- [ ] 能背出五个优先级对应的 timeout 数值（-1 / 250 / 5000 / 10000 / ~10亿）
- [ ] 能说出为什么用 MessageChannel 而不是 setTimeout（4ms 节流问题）
- [ ] 能解释 `shouldYieldToHost` 的判断逻辑和 5ms 时间片
- [ ] 能解释"续体函数"是什么，以及它和可中断渲染的关系
- [ ] 完成 3 个实验

---

## 十二、Day20 预告

**主题**：`useTransition` / `useDeferredValue` 源码级实现（原 roadmap D14）——今天讲完 Scheduler 后，这两个 Hook 底层怎么利用 startTransition 把更新标记成 TransitionLane、以及 Scheduler 怎么配合完成"低优先级更新可以被高优先级打断"的完整链路就都能讲透了。

**预读问题**：
1. `startTransition(callback)` 内部是怎么让 `callback` 里触发的所有 `setState` 都变成低优先级的？
2. `useDeferredValue` 和 `useTransition` 解决的是同一个问题吗？API 形态为什么不一样？
3. "高优先级打断低优先级"具体打断的是什么——是 Scheduler 层面的任务，还是 reconciler 层面的 Fiber 树？
4. 被打断的低优先级更新，之后是重新完整跑一遍，还是能接着上次的进度继续？
