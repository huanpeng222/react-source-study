# Day 4 精简笔记 · beginWork / completeWork 工作循环

> 📌 给"未来要复习/面试"的我看的速查卡。完整教程见 `day4.md`。
> 跟练时间：2026-06-18 傍晚 ~ 夜（中间饱和过一次，睡前默写串通）
> 状态：✅ 概念吃透

---

## 🎯 一句话总结 Day 4

> **reconcile 阶段被 workLoop 驱动。每个 Fiber 走 beginWork（向下钻）+ completeWork（向上爬）两步——前者创建子 Fiber 单元 + 打 flags，后者创建 detached DOM + 冒泡 subtreeFlags 为 commit 剪枝服务。**

---

## 🌟 我亲手默写的"主管道"（睡前真实战果）

> 这是我在跟练完一整天 Day 1~4 后，**晚上 22:43 凭脑子默写出来的版本**。
> AI 已经精准化校对，仅做了 2 处措辞修正。这是我自己理解到位的证明——面试时直接讲这一段就行。

### 主管道（精准化版）

```
JSX
  ↓ babel 编译为 _jsx() 函数调用
React Element（虚拟 DOM，普通对象）
  ↓ reconcile 阶段（可中断）
  
  ┌─ beginWork（向下钻）
  │   1. 按 fiber.tag 分发（FunctionComponent / ClassComponent / HostComponent）
  │   2. 跑用户函数 / 调 render() / 取 props.children
  │   3. reconcileChildren 用 Element diff 出新 Fiber 子链表，并打 flags
  │
  └─ completeWork（向上爬）
      1. HostComponent 创建 detached 真实 DOM（在内存里，不挂载）
      2. 冒泡子节点 flags 到父节点 subtreeFlags（为 commit 剪枝服务）
  
  ↓ wIP 树构建完成
commit 阶段（同步）：
  1. 按 flags 把 detached DOM 挂到 document
  2. 切换 root.current 指针（双缓存身份对换，O(1) 操作）
  3. 触发 useLayoutEffect / useEffect
  
  ↓
浏览器接管：layout / paint / composite
  ↓
屏幕像素
```

### useState 触发更新流程（精准化版）

```
首次 mount：
  beginWork → renderWithHooks → 用户函数执行
    → 每个 useState 创建 Hook 节点
    → 挂到 fiber.memoizedState 链表（按调用顺序）

setState 触发更新：
  1. React 通过 current.alternate 拿到旧 wIP（不 new，复用对象）
     → 改写 pendingProps，清零 flags
  2. workLoop 处理 wIP
     → beginWork（renderWithHooks 重跑用户函数）
       → useState 沿 Hook 链表走，从对应位置拿出旧值
     → reconcileChildren diff 出新子 Fiber + 打 flags
     → completeWork 创建 DOM + 冒泡 subtreeFlags
  3. wIP 树完成 → commit
     → 按 flags 操作真实 DOM
     → root.current = wIP（身份对换）
     → 触发 effect
     
  最终：用户看到 n 从 0 变成 1
```

---

## 📋 必背知识点（面试前 5 分钟过）

### 1. 三种 tag 的处理对比

| | FunctionComponent | ClassComponent | HostComponent |
|---|---|---|---|
| tag | 0 | 1 | 5 |
| 调用什么 | `Component(props)` | `instance.render()` | 不调函数 |
| state 存哪 | fiber.memoizedState | instance.state | 无 |
| Hook 链表 | ✅ 这里建立 | ❌ | ❌ |

### 2. bailout 的 3 个条件（同时满足）

```js
oldProps === newProps          // ① 引用相等（不是值相等）
&& !contextChanged()           // ② Context 没变
&& !hasScheduledUpdate()       // ③ 自己没 setState 排队
```

⚠️ bailout 只跳过当前 Fiber 自身。**子树是否跳过看 `childLanes`**：
- `childLanes = 0` → 整棵子树跳过
- `childLanes` 命中 → 子继续走

### 3. completeWork 两件事

```
第 1 件：HostComponent 创建 detached DOM；HostText 创建 textNode；函数/类组件几乎啥也不做
第 2 件：bubbleProperties 冒泡 child.flags 到 parent.subtreeFlags
```

### 4. flags 在哪打 / subtreeFlags 在哪冒（核心）

| 字段 | 时机 | 含义 |
|---|---|---|
| `fiber.flags` | beginWork（reconcileChildren 内部）| 我自己要不要变 |
| `fiber.subtreeFlags` | completeWork（bubbleProperties）| 子树有没有人要变 |

口诀：**flags 在 beginWork 打，subtreeFlags 在 completeWork 冒。**

### 5. 冒泡的价值（O(n) → O(log n)）

| | 没冒泡 | 有冒泡 |
|---|---|---|
| commit 复杂度 | O(n) 挨个查 | O(深度) ≈ O(log n) 沿路径走 |
| 1000 节点单点更新 | 1000 次函数调用 | ~10 次 |

### 6. Hook 链表

- 挂在 `fiber.memoizedState` 上，单向链表
- beginWork 阶段建立（renderWithHooks 内部）
- 按**调用顺序**对应 → 必须顶层调用
- mount 时 new；update 时复用 alternate 的链表

### 7. DOM 创建在 completeWork（不在 commit）

3 个原因：
1. 子 DOM 必须先存在（appendChild 要求）
2. 子 effect 必须先冒泡
3. beginWork 可中断重做时不浪费

---

## ❓ 我的疑问追问记录

### 追问 1：updateFunctionComponent 没看明白

跟练时一开始 AI 把它写得太复杂，我说"没看明白"。**精简版理解**：

```
3 件事：
1. 跑用户函数（renderWithHooks 内部 = Component(props)）
2. 拿到 JSX 后 reconcileChildren（这就是 Day 3 学的 diff）
3. 返回子 Fiber 让 workLoop 继续下钻
```

### 追问 2：diff 是新旧虚拟 DOM 树对比吗？wIP 是新虚拟 DOM 吗？

**纠正**：
- diff = **新 Element + 旧 Fiber 树 → 新 Fiber 树**（不是两棵 Element 树对比）
- wIP 是 **Fiber 树**，不是虚拟 DOM 树
- 虚拟 DOM（Element）只在 reconcile 输入时存在，用完即弃

三层关系：

```
Element（虚拟 DOM，输入）→ Fiber（中间结构，长期持有）→ DOM（输出）
```

### 追问 3：为啥实验只看到 beginWork

- `console.log` 写在用户函数开头 → 用户函数本身就在 beginWork 阶段被调用
- completeWork 是 React 内部函数，**没有用户钩子**
- 想"看到" completeWork → 用 useLayoutEffect / useEffect / Profiler

### 追问 4：completeWork 的"冒泡"是干啥？beginWork 不是已经创建 Fiber 了吗

**这是 Day 4 最关键的问题**。

| 阶段 | 创建什么 | 标记什么 |
|---|---|---|
| beginWork | 子 Fiber 对象 | fiber.flags（自己的） |
| completeWork | detached DOM | fiber.subtreeFlags（子树汇总） |

**冒泡不创建 Fiber，不操作 DOM**——只把 child.flags 通过位运算合并到 parent.subtreeFlags，**为 commit 阶段剪枝服务**。

### 追问 5：冒泡的具体复杂度收益

```
1000 节点 + 单点更新：
  没冒泡 → O(n) = 1000 次
  有冒泡 → O(log n) ≈ 10 次
  
1000 倍性能差距 = 60fps 大型应用的物理基础
```

---

## 🐛 我的踩坑记录

### 坑 1：把 React Element 当成"虚拟 DOM 之外的另一层"

跟练初期反复犯。Element 本身就是虚拟 DOM，**中间真正的另一层是 Fiber 树**。

### 坑 2：以为 beginWork 创建 Fiber，completeWork 啥也不干

**Day 4 最大的认知盲点**。修正后：

- beginWork 创建子 Fiber + 打 fiber.flags
- completeWork 创建 detached DOM + 冒泡到 subtreeFlags

**两者都重要，且职责完全不同**。

### 坑 3：以为 DOM 节点在 commit 阶段创建

**实际上 detached DOM 在 completeWork 已经创建好了**。commit 只是 appendChild 挂到 document。

记忆：**装修完家具在 completeWork 已经造好了（detached），commit 是搬进新家**。

### 坑 4：以为 bailout = 跳过整棵子树

bailout 只跳过当前 Fiber 自身渲染，**子 Fiber 的 childLanes 命中时仍会继续遍历**。

### 坑 5：傍晚饱和了硬学

19:30 时跟练了快 8 小时大脑过载，AI 主动建议休息，我选了"睡前默写主管道图"（B 选项）。

22:43 默写出来时**之前散点知识自动串通了**——证明：

> **饱和时硬塞 = 死记硬背。短暂离线 + 默写 = 真正消化。**

记忆：**"默写 > 重读"是源码学习方法论的灵魂。**

---

## 🎨 5 条认知纠正

详见 `meta/cognitive-corrections.md` Day 4 段落。挑 5 条最重要：

1. DOM 在 completeWork 创建（不是 commit）
2. beginWork 按 tag 分发到 30+ case（不是同一套逻辑）
3. bailout 只跳过自己，子树看 childLanes（不是跳过整棵）
4. Hook 链表挂在 fiber.memoizedState（不是全局变量）
5. completeWork 干两件事：创建 DOM + 冒泡 subtreeFlags（不是清理）

---

## 🧪 实验状态

- [ ] E1：console 打印 beginWork 时序
- [ ] E2：React.memo 验证 bailout
- [ ] E3：把 useState 放 if 里看错乱

⚠️ 三个实验都还没跑，明天补。理论已吃透，跑实验是把"知道"变成"看到"。

---

## 🎯 最值得记的两句话

1. **"flags 在 beginWork 打，subtreeFlags 在 completeWork 冒。"**
2. **"冒泡的唯一目的：让 commit 阶段沿着'有事干的路径'前进，整棵子树剪枝。"**

---

## 📌 Day 5 衔接

Day 4 把 reconcile 阶段两个核心函数拆透了。Day 5 进入 **commit 阶段** 的三个子阶段（before mutation / mutation / layout）+ useLayoutEffect / useEffect 触发时机。

预读问题已写在 `day4.md` 末尾。

---

_最后更新：2026-06-18 夜，跟练完成后回填_
