# Day 10 实验：Lane 优先级 / 自动批处理 / Transition / DeferredValue

> ⚠️ 所有"预期输出"均在本地 jsdom + react@19.2.7 真实跑出（见 observations.md），非凭印象。
> 运行方式（脚本须放在 workspace 内，ESM 不认 NODE_PATH）：
> ```bash
> cp k*.mjs /Users/guest_1/.workbuddy/binaries/node/workspace/
> cd /Users/guest_1/.workbuddy/binaries/node/workspace
> /Users/guest_1/.workbuddy/binaries/node/versions/22.22.2/bin/node k1.mjs
> ```

> ⚠️ **能测什么 / 不能测什么（重要）**
> jsdom + node **没有真正的时间分片调度**，所以"低优先级 wIP 树被高优先级打断后丢弃重做"这种**并发中断行为观察不到**——本目录不模拟、不编造它（那部分只在 day10.md §4 讲源码机制）。
> 这里只测**能在 jsdom 跑出确定输出**的三件事：自动批处理、transition 的 isPending、useDeferredValue 的值滞后。

---

## K1 · 自动批处理：同一事件里多次 setState 只渲染一次

`k1.mjs`：一个组件两个 state，在同一个 `act`（模拟同一事件回调）里连续 `setA` + `setB`，数 render 次数。

**源码依据**：两次 setState 各自入队、各自 `requestUpdateLane` 拿到同一条 lane（同一事件 → 同 DefaultLane/SyncLane），`scheduleUpdateOnFiber` 在 microtask 里只调度一次 render（Day 6 自动批处理）。

**实测预期（react@19.2.7）**：
```
[mount] renderCount = 1
两次 setState 后 renderCount 增量 = 1     ← 关键：两次 set 只多渲染 1 次
最终 DOM = a=1 b=1
```

---

## K2 · useTransition：直接更新 vs transition 更新的 isPending

`k2.mjs`：用 `useTransition` 拿到 `[isPending, startT]`，对比"直接 `_setN`"和"`startT(() => _setN)`"两条路径下 `isPending` 的渲染序列。

**源码依据**：`startTransition` 设全局 transition 上下文，回调里的 setState 走 `requestUpdateLane` 时 `transition !== null` → 领 TransitionLane（低优先级）。`isPending` 由一个高优先级占位更新驱动：transition 进行中为 true，完成后回 false。

**实测预期（react@19.2.7）**：
```
[mount] isPending 序列 = [false]
直接更新后 isPending 序列 = [false]              ← 直接更新，从不 pending
transition 更新后 isPending 序列 = [true,false]  ← 先 true(过渡中) 再 false(完成)
```
> ⭐ 关键对比：直接 setState 全程 `false`；transition 出现 `true→false`，这就是"低优先级更新被单独调度、期间标记 pending"的可观察证据。

---

## K3 · useDeferredValue：deferred 值滞后于源值

`k3.mjs`：`const deferred = useDeferredValue(text)`，setText('a') 后打印每次渲染的 `(text, deferred)`。

**源码依据**（`ReactFiberHooks.js` updateDeferredValueImpl）：紧急更新先返回**旧的 deferred 值** + 调度一个低优先级更新去追新；低优先级轮到时再返回新值。所以一次 setText 会触发**两次渲染**。

**实测预期（react@19.2.7）**：
```
[mount] 渲染序列: text="" deferred=""
setText("a") 后渲染序列:
    text="a" deferred=""      ← 第1次：text 已更新，deferred 仍是旧值 ""
    text="a" deferred="a"     ← 第2次：低优先级追上，deferred 变 "a"
最终 DOM = text=a deferred=a
```
> ⭐ 这就是 useDeferredValue 的本质：源值立刻变，deferred 慢一拍——在 jsdom 里表现为"同一次更新里多渲染一帧旧 deferred"。

---

## 一句话收束

| 实验 | 观察到的现象 | 对应 lane 机制 |
|---|---|---|
| K1 | 两次 set 只渲 1 次 | 同事件同 lane → 批量调度一次 |
| K2 | transition 出现 `isPending: true→false` | 低优先级更新被单独调度 |
| K3 | deferred 比 text 慢一帧 | 紧急渲染返回旧值 + 调度低优先级追新 |
