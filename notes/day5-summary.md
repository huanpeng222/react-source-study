# Day 5 精简笔记 · commit 阶段三子阶段

> 📌 给"未来要复习/面试"的我看的速查卡。完整教程见 `day5.md`。
> 跟练时间：2026-06-19 下午 ~ 2026-06-20 凌晨
> 状态：✅ 深度吃透（追问 4 次，从 commit 三阶段拓展到事件循环底层）

---

## 🎯 一句话总结 Day 5

> **commit 阶段分 3 子阶段：Before Mutation 拍快照 + 调度 useEffect / Mutation 改 DOM + 同步跑 cleanup + 切 root.current / Layout 同步跑 useLayoutEffect + 生命周期。paint 后异步跑 useEffect 回调。commit 永远不可中断，useTransition 影响的是 reconcile。**

---

## 📋 必背知识点（面试前 5 分钟过）

### 1. commit 三子阶段 + 各自做的事

```
Phase 1: Before Mutation
  - getSnapshotBeforeUpdate（类组件）
  - 调度 useEffect（不立即跑）

Phase 2: Mutation
  - 按 flags 改 DOM（Placement/Update/Deletion）
  - 卸载旧 ref
  - 跑上次留下的 useEffect cleanup
  - ★ root.current = wIP（双缓存身份对换）★

Phase 3: Layout
  - 同步跑 useLayoutEffect
  - cDM / cDU
  - 绑定新 ref

→ 浏览器 paint
→ 异步 flushPassiveEffects（跑这次的 useEffect 回调）
```

### 2. useLayoutEffect vs useEffect 时机（必背口诀）

> **Layout 看不到（绘制前），Effect 看到了（绘制后）。**

| | useLayoutEffect | useEffect |
|---|---|---|
| DOM 就位 | ✅ | ✅ |
| 浏览器绘制 | ❌ 还没 | ✅ 已绘制 |
| 阻塞 paint | ✅ | ❌ |
| 适用 | 测量 DOM + 同步改 | 数据请求 / 订阅 |

### 3. cleanup vs effect 时机对比

| | Mutation 跑的 cleanup | flushPassiveEffects 跑的 effect |
|---|---|---|
| 跑什么 | 上次 effect 返回的函数 | 这次新建的回调 |
| 同步 or 异步 | 同步 | 异步（宏任务） |
| dep 是哪版 | 上次的（闭包捕获） | 这次的 |

### 4. root.current 切换时刻

> **Mutation 末尾、Layout 开始前**。这样 Layout 阶段的 this / ref 才是新的。

### 5. commit 不可中断 + Transition 澄清

- commit 始终同步、不可中断（用户视觉一致性）
- useTransition 只让 **reconcile 可丢弃**（标记低优先级 Lane）
- useTransition ≠ Suspense（两个独立机制，经常配合）

### 6. getSnapshotBeforeUpdate 真实场景

**顶部插入历史消息**（不是底部追加新消息！）：

```
顶部插入 100px → 原内容向下挤 100px → scrollTop +100 抵消 → 视觉不变 ✅
```

口诀：**记相对底部距离，不记绝对位置。**

### 7. 为什么 useEffect 是宏任务

```
微任务调度 → commit → 清空微任务（跑 effect）→ paint  → 阻塞 paint ❌
宏任务调度 → commit → paint → 下个宏任务（跑 effect）→ 用户先看到 ✅
```

React 用 `MessageChannel.postMessage` 调度，**故意选宏任务**让 paint 先发生。

---

## ❓ 我的疑问追问记录（4 次深度追问）

### 追问 1：scrollHeight 和 scrollTop 是什么

跟练时 §3.2 给了聊天框例子但 DOM 概念没讲。

**纠正补充**：

| 属性 | 含义 | 类比 |
|---|---|---|
| scrollHeight | 内容总高度（包括看不见的） | 整本书厚度 |
| scrollTop | 内容被向上滚了多少 | 翻到第几页 |
| clientHeight | 容器可视区高度（固定） | 一页纸高度 |

### 追问 2：scrollTop 700→800 这不就是把画面往上滑了吗，怎么不算打扰

**抓到了原例子的歧义**——AI 之前用"聊天框新消息"，但底部追加根本不需要 getSnapshotBeforeUpdate。

**真正适用场景是顶部插入历史消息**：DOM 向下挤 → scrollTop 主动 +100 抵消 → 视觉不变。

| 场景 | scrollTop 该不该动 | 需要 getSnapshotBeforeUpdate |
|---|---|---|
| 底部追加新消息 | 不动 | ❌ |
| 顶部插入历史消息 | += 增长量 | ✅ |

### 追问 3：JS 单线程下，微任务等待时宏任务会等吗

**答**：
- 同步阻塞（死循环）→ 宏任务永远不能跑
- 异步让出（await）→ 微任务挂起，队列继续推进

**核心**：宏任务必须等微任务**全部清空**才能跑。这就是 React 用宏任务调度 useEffect 的原因——避免阻塞 paint。

### 追问 4：Mutation 跑的 cleanup 和异步跑的 effect 是不是同一个 useEffect

**抓到了 Day 5 最容易混的点**——不是同一个：

```jsx
useEffect(() => {
  console.log('effect');    // ← flushPassiveEffects 异步跑（这次新建）
  return () => {
    console.log('cleanup'); // ← 下次 Mutation 同步跑（上次留下）
  };
}, [dep]);
```

时序示意：

```
render 1：effect_1 异步跑 → 返回 cleanup_1 存起来
render 2：cleanup_1 同步跑 → effect_2 异步跑 → 返回 cleanup_2 存起来
```

⭐ cleanup 的 dep 是**上次的闭包值**，effect 的 dep 是**这次的**。

---

## 🐛 我的踩坑记录

### 坑 1：以为 useEffect 在"DOM 还没就位"时跑

入场自测 Q2 我答："useEffect 是在组件挂载阶段执行，此时 dom 还没有就位"。

**纠正**：两者都在 DOM 已就位之后跑。**区别只在 paint 前后**：
- useLayoutEffect：paint 前同步（看不到）
- useEffect：paint 后异步（看到了）

### 坑 2：以为 useTransition "用 Suspense 接住"

入场自测 Q4 把两个机制混了。

**纠正**：
- useTransition = 标记 setState 为低优先级 Lane（reconcile 可丢弃）
- Suspense = 捕获 throw promise 显示 fallback
- 两者经常配合但**本质独立**
- useTransition **不让 commit 可中断**

### 坑 3：以为 getSnapshotBeforeUpdate 用于"聊天框新消息"

跟练中发现：底部追加新消息根本不需要这个 API（浏览器自动保持 scrollTop 就是视觉不变）。

**真正场景是顶部插入**（上拉加载历史消息）。

### 坑 4：以为 Mutation 跑的 cleanup 和异步 effect 是同一个

**追问 4 才彻底搞清**：两者跑的是**前后相继的两份代码**，不是同一个。

记忆口诀：**"上次的 cleanup 同步跑，这次的 effect 异步跑。"**

### 坑 5：不知道 React 故意用宏任务调度 useEffect

**追问 3 才理解**：用宏任务 = paint 优先；用微任务 = 阻塞 paint。

React 19 用 `MessageChannel.postMessage` 实现宏任务调度——这是 useEffect 不阻塞画面的物理基础。

---

## 🎨 5 条认知纠正

详见 `meta/cognitive-corrections.md` Day 5 段落。挑 5 条最重要：

1. commit 分 3 子阶段（不是一步到位）
2. useLayoutEffect 和 useEffect 都在 DOM 就位后跑，区别在 paint 前后
3. root.current 切换在 Mutation 末尾（不是第一步也不是最后）
4. useTransition ≠ Suspense（两个独立机制）
5. cleanup 在 Mutation 跑、effect 在 flushPassiveEffects 跑（不是同时）

---

## 🧪 实验状态

- [ ] F1：useLayoutEffect vs useEffect 时序
- [ ] F2：用 useLayoutEffect 修复闪烁
- [ ] F3：验证 root.current 切换时机

⚠️ 三个实验都还没跑，明天补。理论已吃透。

---

## 🎯 最值得记的几句话

1. **commit 三阶段口诀**：Before Mutation 拍快照 / Mutation 改 DOM + 切 current / Layout 同步 effect
2. **useEffect vs useLayoutEffect 口诀**：Layout 看不到（绘制前），Effect 看到了（绘制后）
3. **cleanup vs effect 口诀**：上次 cleanup 同步跑，这次 effect 异步跑
4. **顶部插入 vs 底部追加**：只有顶部插入需要 getSnapshotBeforeUpdate
5. **宏任务 vs 微任务**：React 用宏任务调度 useEffect 是为了让 paint 先发生

---

## 📌 Day 6 衔接

Day 5 把 commit 阶段拆透。Day 6 进入 **W2 Hooks 实现原理**：useState 源码 + dispatch 函数 + Hook 链表细节 + 批处理。

预读问题已写在 `day5.md` 末尾。

---

_最后更新：2026-06-20 凌晨，含 4 次深度追问的真实回填_
