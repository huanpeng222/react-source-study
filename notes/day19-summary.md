# Day19 精简笔记 — Scheduler：最小堆 + MessageChannel 时间片

> 学完后的速查卡，面试前看这份就够。教程详见 `notes/day19.md`。

## 核心心智模型：两套独立机制

```
机制① 任务排序    → 回答"谁先跑"
  实现：taskQueue 最小堆，排序键 = expirationTime = now + timeout(优先级)
  堆顶永远是最紧急任务

机制② 时间片让出  → 回答"跑多久该歇"
  实现：shouldYieldToHost()，连续跑够 frameYieldMs(5ms) 就让出
  跟优先级无关！纯计时器

类比：①=排队叫号，②=看诊限时5分钟，互不干扰
```

## 五个优先级 = 五个 timeout

| 优先级 | timeout | expirationTime | 语义 |
|---|---|---|---|
| ImmediatePriority | -1 | 比 now 还小 | 必须马上跑 |
| UserBlockingPriority | 250 | 250ms 内跑完 | 用户交互 |
| NormalPriority | 5000 | 5 秒内跑完 | 默认更新 |
| LowPriority | 10000 | 10 秒内跑完 | 不太紧急 |
| IdlePriority | 1073741823 | 几乎不设限 | 有空再做 |

> 源码：`packages/scheduler/src/SchedulerFeatureFlags.js`

## 双队列设计

```
taskQueue  —— 按 expirationTime 排序的最小堆（已就绪任务）
timerQueue —— 按 startTime 排序的最小堆（延迟任务，还没到点）

advanceTimers(currentTime)：
  检查 timerQueue 堆顶 → startTime <= currentTime → 转移到 taskQueue
  只在 workLoop 每轮开头 / handleTimeout 时调用
```

## 为什么不用 requestIdleCallback

| 问题 | 说明 |
|---|---|
| 触发频率不稳定 | 完全取决于浏览器空闲情况，可能几十ms才触发一次 |
| 兼容性不完整 | Safari 长期不支持 |
| deadline 不可控 | 没法按自己的 5ms 策略切分 |

## 为什么用 MessageChannel 而非 setTimeout

```
setTimeout 嵌套超过一定层数 → 浏览器强制 clamp 到最低 4ms（HTML 规范历史遗留）
MessageChannel.postMessage → 走宏任务队列，无 4ms 限制 → 调度更精确

三级降级策略（源码 Scheduler.js ~L531-561）：
  setImmediate (Node.js) > MessageChannel (浏览器) > setTimeout (兜底)
```

## shouldYieldToHost 的判断逻辑

```js
function shouldYieldToHost(): boolean {
  if (needsPaint) return true;        // 浏览器急着绘制 → 提前让出
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameInterval) return false;  // 还没到 5ms
  return true;                         // 够 5ms 了
}
// frameInterval = frameYieldMs = 5（可通过 unstable_forceFrameRate 调整）
// startTime = performWorkUntilDeadline 每次被唤醒时记录的时间戳
```

## workLoop 的让出条件（关键！）

```js
if (currentTask.expirationTime > currentTime && shouldYieldToHost()) {
  break;
}
```

**两个条件是 `&&`（与）关系，短路求值**：
- 任务**没过期** + 够 5ms → 让出（正常时间片行为）
- 任务**已过期** → `&&` 左边 false → **短路，不调用 shouldYield，强制继续跑**（防止饿死的兜底）

## 续体函数（可中断渲染的基础）

```js
const continuationCallback = callback(didUserCallbackTimeout);
if (typeof continuationCallback === 'function') {
  currentTask.callback = continuationCallback;  // 留队列不删
  return true;   // 立即让出，不管时间片剩多少
} else {
  pop(taskQueue);  // 当场 pop 出队
}
```

- **返回函数** = 任务没做完，下次从续体接着跑（同优先级分片）
- **返回非函数** = 任务完成，当场 pop 出队
- **被 cancel** = `task.callback = null`（软删除），留堆里等下次遍历到才 pop（因为数组堆不能删中间节点）

## 协作式 vs 抢占式

```
抢占式（OS 线程那种）：高优任务到 → 强行暂停当前 → 立刻切过去
  React Scheduler 【没有】这个能力

协作式（Scheduler 用的）：正在跑的任务只能自己主动让出
  到点的任务只是"排进队列等着"，不能打断正在跑的任务
  advanceTimers 只在 workLoop 间隙调用 → 无抢占
```

## "高优先级打断低优先级"的完整链路

```
① 低优 render 每处理完一个 Fiber → shouldYield()【Scheduler 机制②】
② 时间片到 → break → 返回续体给 Scheduler → 让出主线程【Scheduler 驱动】
③ 高优 setState → 新任务 expirationTime 更小 → 插到堆顶【Scheduler 机制①】
④ 下轮 workLoop peek 到高优 → 高优先跑 → commit
⑤ 低优 wip 树作废重来（renderLanes 变了，旧 wip 不能用）
   → 不是"续体接着跑"，是"从头重做"
```

> **续体 = 断点续传（同优先级分片）**；**打断 = 推翻重来（高优插队后低优作废）**。两者都靠 shouldYield 制造的间隙，但让出后命运不同。

## Scheduler vs Lane 分工

| | Lane 模型 | Scheduler |
|---|---|---|
| 回答 | 这次更新有多急 | 轮到你时能跑多久 |
| 数据结构 | 31 位位掩码 | 5 个离散常量 → timeout |
| 作用层 | reconciler 内部 | 独立通用调度包 |
| 关系 | lane → 映射成 → Scheduler priority → timeout → expirationTime |

---

## 我的疑问追问记录

### Q1：超过 5ms 任务没结束，还会让出吗？
**分情况**：没过期 → 让出（正常）；已过期 → `&&` 短路不调 shouldYield → 强制继续（防饿死兜底）。

### Q2：shouldYield 是判断"有没有更高优先级需求"吗？
**不是**。shouldYield 只看"这一轮连续跑够 5ms 没"，跟优先级无关。优先级竞争在机制①（最小堆排序）里就解决了。

### Q3："打断"是 Scheduler 之外发生的吗？
**不是，Scheduler 全程驱动**。reconcile 每处理完一个 Fiber 就问 Scheduler shouldYield → 让权 → Scheduler 调度高优插队。没有 Scheduler 就没有打断。

### Q4：被取消的任务怎么从堆里删？
**软删除**：`task.callback = null`，不真的从堆里删（数组堆删中间节点是 O(n)）。等下次 workLoop/advanceTimers 遍历到发现 callback 是 null 才 pop 丢弃。

---

## 我的踩坑记录（认知纠正）

1. **我之前以为** shouldYield 是判断"有没有更高优先级需求"
   **其实是** shouldYield 只判断"这一轮跑够 5ms 没"。优先级竞争在最小堆排序（机制①）里就解决了，跟 shouldYield 无关。

2. **我之前以为** 到点的延迟任务能打断正在执行的任务
   **其实是** Scheduler 是协作式调度，不能抢占。到点任务只是从 timerQueue 转正进 taskQueue，还得等当前任务让出才有机会。

3. **我之前以为** 返回 undefined 的任务下次走到才跳过
   **其实是** 当场 pop 出队。我说的是"被取消"（callback=null）的情况，那才是延迟清理。

4. **我之前以为** "打断"发生在 reconcile 阶段，还没到 Scheduler
   **其实是** Scheduler 全程驱动打断——shouldYield 制造让出间隙、最小堆排序让高优插队、MessageChannel 控制下一轮唤醒。

5. **我之前以为** 5ms 是绝对的时间片上限
   **其实是** 只对"没过期"的任务有效。过期任务 `&&` 短路，shouldYield 根本不被调用，强制跑完。
