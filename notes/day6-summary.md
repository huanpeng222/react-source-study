# Day 6 精简笔记：useState 源码 + Hook 链表 + 批处理

> 这是学完 Day 6 后的"压缩 + 个人化"笔记，不是 day6.md 的删减版。
> 只留要点 + 我跟练时真实的疑问追问 + 踩坑。
>
> ⚠️ 源码事实出处：`packages/react-reconciler/src/ReactFiberHooks.js`
> （`mountState` / `updateReducer` / `dispatchSetState` / `mountWorkInProgressHook`）

---

## 🎯 一句话主轴

> **setN 不是立即改 state，而是往 Hook 的 queue 里塞一个 update；下次 render 进 updateReducer，从 baseState 开始把 queue 里的 update 逐个 reduce 出新 state。**

---

## 📦 三个核心数据结构（务必区分清楚）

```
hook = {
  memoizedState,   // ★ 当前 state 的【值】（比如 n=5）
  baseState,       // reduce 的起点
  queue,           // ★ 队列【容器】（不是 action！）
  next,            // 下一个 Hook
}

queue = {
  pending,         // 环形链表，指向最后一个 update
  dispatch,        // ★ setN 函数本身（mount 时 bind 出来缓存）
  lastRenderedReducer,
  lastRenderedState,
}

update = {         // queue.pending 链表里的节点
  action,          // ★ 你传给 setN 的东西（值 或 函数）
  lane,
  next,
}
```

⭐ **背死这三层**（我验收时这里翻车了）：
- `memoizedState` = 结果值
- `queue` = 任务容器（含 pending / dispatch）
- `action` 在 update 节点上，**不在 hook 上**

---

## 🔑 4 个核心结论

| 问题 | 结论 |
|---|---|
| setN(n+1) vs setN(prev=>prev+1) | action 一个存值、一个存函数；update 阶段 `typeof action === 'function' ? action(newState) : action` 分流 |
| 3 次 setN(n+1) | n 只 +1（三个 action 都是值 1，互相覆盖）；触发 1 次 render（批处理） |
| 3 次 setN(prev=>prev+1) | n=3（prev 是上次 reduce 的中间结果，链式累积） |
| lazy init | mount 跑 1 次，update 阶段 initialState 参数被完全忽略 |
| dispatch 引用 | mount bind 一次缓存进 queue.dispatch，update 直接复用 → 引用永远稳定 |

---

## ❓ 我跟练时的真实疑问追问

### 追问 1（23:11）：我代码里 setN(n+1) 点几次 n 就加几，为啥没出现闭包问题？

**我的困惑**：以为单次 setN(n+1) 也会暴露闭包陷阱。

**真相**：闭包陷阱**不是每次点击都出问题**，只在两种场景暴露：
1. **同一次事件里多次 setN(n+1)** → 三个都基于同一闭包 n=0 → 只 +1
2. **异步引用 n**（setTimeout / Promise / 空依赖 useEffect 里的 setInterval）→ 永远拿 render 时锁定的旧 n

**我的代码每次点击之间隔着一次 render，闭包早刷新了**，所以正常 +1。
`console.log(n)` 打印的是旧值——那才是闭包的体现，只是它不影响 setState 结果。

### 追问 2（23:18）：useState(expensiveCompute()) 和 useState(() => expensiveCompute()) 只差一个箭头，为啥行为差这么多？

**真相**：差异**不在 useState，在 JS 函数参数立即求值**。
- `useState(expensiveCompute())`：JS 先把 expensiveCompute() 跑完再传值 → 每次 render 都跑（即使 update 阶段结果被忽略）
- `useState(() => expensiveCompute())`：只传一个函数对象 → useState 内部 mountState 才决定调不调

实战坑：`useState(JSON.parse(localStorage.getItem('x')))`、`useState(new Array(10000).fill(0))` 都该用 lazy 形式。

判断规则：**昂贵计算 / IO / 大对象 → 必须 lazy；便宜字面量随意**。

### 追问 3（23:23）：lazy init 到底什么时候跑？

mount 阶段跑 1 次（`mountState` 里 `typeof initialState === 'function'` 时调用）。
update 阶段 `updateReducer` 完全不看 initialState 参数 → 不会再跑。

---

## 🐛 我的踩坑记录

### 坑 1：以为单次 setN(n+1) 也会出闭包 bug
**纠正**：闭包陷阱只在"同事件多次调用"或"异步引用"时暴露。单次同步调用每次点击之间隔着 render，闭包自然刷新。

### 坑 2（最大错点）：把 memoizedState 和 queue 含义讲反了
**我答**："memoizedState 存 actions 值，queue 存需要调用执行的函数"。
**纠正**：
- `memoizedState` = 当前 state 的**值**（不是 action）
- `queue` = update 队列**容器**（含 pending / dispatch）
- `action` 在 **update 节点**上，不在 hook 上

### 坑 3：以为 lazy init 差异在 useState 内部逻辑
**纠正**：根源是 **JS 函数参数立即求值**——参数在 useState 被调用之前就算好了，useState 内部控制不了。

### 坑 4：3 次 setN(n+1) 措辞"action 没更新"
**纠正**：不是 action 没更新，是**三个 update 的 action 计算结果都是同一个值 1**（n 闭包都是 0），reduce 时互相覆盖。

---

## 🎤 5 句"面试直接背"的口诀

1. **setN 本质**："setN 只入队不立即改值，下次 render 进 updateReducer 才 reduce 出新 state"
2. **值 vs 函数式**："action 存值会被同闭包锁定互相覆盖；存函数则 prev 拿上次 reduce 结果，链式累积"
3. **lazy init**："mount 跑一次，update 忽略参数；不要直接传函数的调用，要传函数本身"
4. **dispatch 稳定**："mount bind 一次缓存进 queue.dispatch，所以 setN 不用写进 useEffect deps"
5. **批处理**："React 18 自动批处理扩展到 Promise/setTimeout/原生事件，flushSync 是反批处理逃生口"

---

## ✅ 验收结果（23:44）

6 项里：4 项完全对（值/函数式、lazy init、自动批处理、dispatch 稳定），1 项措辞偏（3 次 setN），1 项错（Hook 字段含义反了，已重看 §1 修正）。

下一站：Day 7 · useEffect / useLayoutEffect 源码 + effect list 链表。
