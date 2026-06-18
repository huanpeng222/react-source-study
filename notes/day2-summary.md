# Day 2 精简笔记 · Element → Fiber + 双缓存

> 📌 这是给"未来要复习"的我看的速查卡。完整教程见 `day2.md`。
> 跟练时间：2026-06-18 上午 ~ 下午
> 跟练对话总字数：约 30000 字
> 状态：✅ 概念吃透，待补实验

---

## 🎯 一句话总结 Day 2

> **Element 是描述，Fiber 是工作单元。Fiber 通过链表+循环+双缓存+effect 标记，把 React 15 不可中断的递归渲染，改造成可中断、可丢弃、可剪枝的并发渲染。**

---

## 📋 必背知识点（面试前 5 分钟过一遍）

### 1. Element → DOM 的 4 阶段（顺序必背）

```
JSX → React Element → [Reconcile] → wIP Fiber 树 → [Commit] → 真实 DOM → [浏览器 Layout/Paint] → 屏幕
                       ↑可中断                       ↑同步不可中断
```

### 2. 为什么 Fiber 必须存在（3 个原因）

| 旧的痛 | Fiber 怎么治 |
|---|---|
| Element 是一次性快照，没法 diff | Fiber 长期持有，可对比 |
| 递归渲染无法中断 | 链表 + 循环 + 全局 workInProgress |
| Element 没地方挂副作用标记 | Fiber 有 flags / subtreeFlags |

### 3. Fiber 字段速查（5 组）

```
身份：tag, type, elementType, stateNode（真实 DOM 引用）
指针：return, child, sibling（三指针链表）
新旧：pendingProps, memoizedProps, memoizedState（Hook 链表头）
缓存：alternate（指向另一棵树的同一个我）
调度：flags, subtreeFlags, lanes, childLanes
```

### 4. 蚂蚁爬树 3 规则（默写）

```
规则 1：有 child 就往下（DFS 深入）
规则 2：没 child 找 sibling（横移）
规则 3：没 sibling 回 return，再找它的 sibling
直到回到 root，结束
```

### 5. Fiber 中断本质（背这一句）

> **JS 无法被强制中断。Fiber 的"中断"= 主动 return 退出 while 循环 + 进度存全局 workInProgress + scheduleCallback 再调度。**

### 6. 双缓存 4 字口诀

> **绘读分离，交换指针**

- current = 用户在看的（前缓冲区）
- workInProgress = React 正在改的（后缓冲区）
- commit 时切换 `root.current` 指针 → O(1) 身份对换

### 7. 对象不死、身份对换（Day 2 最深的洞察）

| 阶段 | 发生什么 |
|---|---|
| mount | new 1 个 Fiber_A，alternate=null |
| 第一次 setState | new Fiber_B 当 wIP，A.alt=B, B.alt=A |
| 第一次 commit | `root.current` 切到 B，对象都不动 |
| 第二次 setState | **复用 A**（不 new），改写 pendingProps 当新 wIP |

⭐ **整个生命周期，同一组件位置永远只有 2 个 Fiber 在轮流坐庄。**

### 8. reconcile vs commit

| reconcile | commit |
|---|---|
| 量房 + 写施工清单 | 拿清单动手 |
| 可中断、可重做、零副作用 | 同步、一次性、不可中断 |
| 不操作 DOM | 操作 DOM |

### 9. effect 标记（位运算）

```
fiber.flags |= Placement   // 新增 DOM
fiber.flags |= Update      // 改属性
fiber.flags |= Deletion    // 删 DOM
fiber.flags |= Ref         // 绑 ref
fiber.flags |= Passive     // useEffect
```

subtreeFlags 冒泡：commit 阶段 `subtreeFlags === 0` 的整棵子树直接跳过。

### 10. wIP 与 current 不是两棵完整树

是**两条路径**——没变化的子树（bailout）wIP 直接共享 current 的子树引用。这就是 `React.memo` 的物理实现，也是 Fiber 内存远小于"双倍树"的原因。

---

## ❓ 我的疑问追问记录（跟练时真实问的）

跟练过程中我先后追问了 4 个核心问题，每一个都让理解更深：

### 追问 1：Fiber 没出来之前，React Element 直接渲染到真实 DOM 中的吗？

**答**：不是。从 React 0.x 到现在，**Element 永远不会直接变成 DOM**，中间始终有协调器（Reconciler）。

| 时代 | 中间层 | 数据结构 | 可中断？ |
|---|---|---|---|
| React 0.x ~ 15 | Stack Reconciler | ReactInstance 树（class 实例） | ❌ |
| React 16+ | Fiber Reconciler | Fiber 链表树（双缓存） | ✅ |

→ Fiber 不是"凭空多出一层"，而是把这层中间结构从**同步递归改成可中断的链表遍历**。

### 追问 2：Fiber 这个循环怎么中断呢，遍历算法我不是很理解？

**答**：核心 4 字 = **主动让出**。

```js
while (workInProgress && !shouldYield()) {
  workInProgress = performUnitOfWork(workInProgress);
}
// 退出后 workInProgress 还在全局变量上
// scheduleCallback 下次回来再继续
```

进度存全局 `workInProgress`，下次回来还在原来的节点上，蚂蚁继续爬。
**5ms 时间片**是 React 实际使用的让出周期。

### 追问 3：reconcile 是在干嘛？alternate 为什么要双向？怎么判断 alternate 指向的是 wIP 还是 current？打 effect 是干嘛呢？

四连问，每个都关键：

| 子问 | 答 |
|---|---|
| reconcile 干嘛 | 装修总监量房 + 写施工清单。不动 DOM |
| alternate 为啥双向 | commit 后身份对换 O(1) / 对象复用不爆内存 / 判断新节点 |
| 怎么判 current vs wIP | Fiber 自己没字段。看 `root.current`；或经验：组件函数体里抓的是 wIP，useEffect / DevTools 抓的是 current |
| effect 标记干嘛 | 装修总监给家具贴便利贴。commit 阶段照贴执行，不再思考 |

### 追问 4：旧 current 变成下次的 wIP 候选是什么意思？旧 current 不会销毁？新 wIP 是在旧 current 上重建的吗？

**答**：这是 Day 2 最重要的一道反问。

- **旧 current 不会销毁**——原地不动，只是身份从 "current" 改成 "下次的 wIP 候选"
- **新 wIP 不是重建**——React 通过 `current.alternate` 拿到旧 current 对象，**改写字段就直接复用**（不 new）

→ 同一个组件位置永远只有 2 个 Fiber 对象在轮流坐庄。

### 追问 5：reconcile 的中文操作是什么？

**答**：**协调** 或 **调和**。React 官方中文文档用"协调"，源自财务对账 / 人际和解的语义——把"两个不一致的状态拉回一致"。

---

## 🐛 我的踩坑记录

### 坑 1：把 React Element 当成"虚拟 DOM 之外的另一层"

入场自测 Q1 我答："element 对象 → 虚拟 dom → CSS 计算 → 真实 dom"。

**纠正**：Element 本身就是虚拟 DOM。中间真正的"另一层"是 **Fiber 树**，不是再多一层虚拟 DOM。"CSS 计算"也不是 React 干的，是浏览器拿到 DOM 后 layout/paint 时的事。

### 坑 2：以为"中断"是某种黑魔法

第一次问"循环怎么中断"，我下意识以为浏览器/React 帮我"暂停 JS 线程"。

**纠正**：JS 单线程根本无法被强制暂停。中断 = 自己主动 return + 全局变量存进度。**没有任何黑魔法**。

### 坑 3：以为 alternate 是单向的"备份"

我一度把 alternate 理解成"旧的对象指着新的对象，新的对象不需要回指"。

**纠正**：双向（A.alt=B 且 B.alt=A）。commit 切换 `root.current` 指针就完成身份对换；下次更新通过 `current.alternate` 复用旧对象——**双向是对象复用的物理前提**。

### 坑 4：以为 commit 后旧 current 会销毁

直觉觉得"既然 wIP 成了新的，旧 current 就该被回收了"。

**纠正**：旧 current 字段原地不动，等下次 setState 时它会被"清零 + 改写 pendingProps"，**升级为新的 wIP**。**没有销毁，只有身份对换。**

### 坑 5：以为 wIP 和 current 是两棵完整的树

直觉觉得 React 真的在内存里维护两份相同结构。

**纠正**：是**两条路径**——没变化的子树（`React.memo` 等 bailout）wIP 直接共享 current 的子树引用。**Fiber 内存远小于双倍树。**

---

## 🎨 5 条认知纠正（同步追加到 cognitive-corrections.md 第 #1~#5 / Day 2 段落）

> 详见 `meta/cognitive-corrections.md`，Day 2 总共追加了 11 条（#1-#14 中 Day 1 占 5 条，Day 2 占 #6-#14 共 9 条 + 加 5 条来自笔记）。

挑 5 条最重要的：

1. React 15 没有虚拟 DOM？❌ 有，叫 ReactInstance 树。
2. Fiber 中断是浏览器帮忙暂停？❌ JS 单线程根本无法暂停，靠主动 return。
3. reconcile = diff？❌ reconcile = 量房 + 写清单，diff 只是其中一步。
4. alternate 是单向备份？❌ 双向互指，commit 后切换 root.current 即可对换身份。
5. commit 后旧 current 销毁、新 wIP 是重建？❌ 同一位置 2 个 Fiber 轮流坐庄，对象不死，身份对换。

---

## 🧪 实验状态

- [ ] 实验 A：DevTools 抓 Fiber 字段（**已部分完成**，截图有了，observations.md 待补字段对照）
- [ ] 实验 B：验证 `alternate.alternate === self`
- [ ] 实验 C：手写 walk 函数遍历整棵 Fiber 树

✅ 已通过截图验证：button Fiber 的 30 个字段一一对照、alternate 字段存在。

---

## 📌 Day 3 衔接

Day 2 学完后立即进入 Day 3，主题是 **Reconcile 的 diff 算法**。
Day 2 这里的 reconcile / alternate / effect 是 Day 3 diff 算法的**前置**——diff 就是 reconcile 内部的具体动作。

---

_最后更新：2026-06-18，跟练完成后回填_
