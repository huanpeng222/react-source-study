# Day 5 笔记：commit 阶段三子阶段

> 日期：2026-06-19
> 主题：reconcile 之后，React 怎么把工作"落地"到真实 DOM
> 状态：📖 学习中

---

## 零、入场自测（5 分钟，先自己答再往下看）

> ⚠️ 答完再往下看，"不会"明确说"不会"。

1. **commit 阶段的 three sub-phases 是哪三个？分别干什么？**
2. **useLayoutEffect 和 useEffect 触发的时机精确差在哪？**
3. **getSnapshotBeforeUpdate 在哪个 sub-phase 调用？为什么需要"快照"？**
4. **commit 真的完全不可中断吗？React 19 的 useTransition 是怎么影响 commit 的？**

<details>
<summary>📌 我自己的回答（保留作为对比基线）</summary>

1. 不清楚
2. useEffect 是在组件挂载阶段执行，此时 dom 还没有就位；useLayoutEffect 是在组件挂载时使用，此时 dom 已经就位，可以操作 dom（⚠️ 时机点反了，下文纠正）
3. 不清楚
4. commit 阶段不可中断 ✅；useTransition 是先将优先级不高的渲染用 Suspense 接住，展示 suspense 的 fallback（⚠️ 把 Transition 和 Suspense 混了，下文纠正）

</details>

---

## 一、回顾：commit 阶段在主管道中的位置

```
JSX → Element → Fiber 树（reconcile，可中断）
                                   ↓
                         wIP 树构建完成 + detached DOM 在内存里
                                   ↓
                    ★ commit 阶段开始（同步，不可中断）★
                                   ↓
                              真实 DOM 更新
                                   ↓
                         浏览器接管 layout/paint
```

**Day 4 你学过**：DOM 节点（detached）在 completeWork 已经创建好。

**Day 5 要回答**：commit 怎么把这些 detached DOM **挂到 document**，怎么触发 effect，怎么处理 ref 绑定，怎么调用类组件生命周期。

---

## 二、commit 三子阶段（核心）

```
                 commit 阶段总入口：commitRoot()
                             ↓
        ┌────────────────────────────────────────────┐
        │ Phase 1: Before Mutation（变更前）          │
        │   - 调 getSnapshotBeforeUpdate（类组件）   │
        │   - 异步调度 useEffect（Passive Effects） │
        │   - DOM 还没变，可以"读取旧 DOM"做快照     │
        └────────────────────────────────────────────┘
                             ↓
        ┌────────────────────────────────────────────┐
        │ Phase 2: Mutation（变更）                   │
        │   - 真正操作 DOM（appendChild / setAttribute）│
        │   - 卸载旧 ref / 处理 useEffect 旧 cleanup │
        │   - ★ root.current = wIP（双缓存身份对换）★│
        └────────────────────────────────────────────┘
                             ↓
        ┌────────────────────────────────────────────┐
        │ Phase 3: Layout（布局后，绘制前）           │
        │   - 同步执行 useLayoutEffect              │
        │   - 调 componentDidMount / componentDidUpdate │
        │   - 绑定新 ref                              │
        │   - 此时 DOM 已更新但浏览器还没绘制         │
        └────────────────────────────────────────────┘
                             ↓
                        浏览器开始绘制（paint）
                             ↓
                useEffect 异步触发（在下一帧前）
```

⭐ **核心心智模型**：commit 把"变更前的快照 / 真正变更 / 变更后的同步反应" 切成三步。

### 三子阶段对比表（背下来）

| 子阶段 | DOM 状态 | 主要做什么 | 类比 |
|---|---|---|---|
| Before Mutation | 还是旧的 | 读取旧 DOM 状态做快照 + 调度 useEffect | "拍照留念" |
| Mutation | 正在变 | 改 DOM / 切 root.current | "施工现场" |
| Layout | 已是新的，未绘制 | useLayoutEffect / cDM / cDU / 绑 ref | "验收 + 微调" |

---

## 三、Phase 1：Before Mutation（变更前）

### 3.1 主要做 2 件事

#### A. 调用 `getSnapshotBeforeUpdate`（类组件生命周期）

```jsx
class Chat extends Component {
  getSnapshotBeforeUpdate(prevProps, prevState) {
    // DOM 变更前，读取旧 DOM 状态
    const list = this.listRef.current;
    return list.scrollHeight - list.scrollTop;   // 返回快照
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    // DOM 变更后，用快照恢复滚动位置
    const list = this.listRef.current;
    list.scrollTop = list.scrollHeight - snapshot;
  }
}
```

#### B. 异步调度 useEffect（不立即跑）

```js
if (fiber.flags & Passive) {
  scheduleCallback(NormalPriority, flushPassiveEffects);
}
```

⭐ useEffect 在 commit 阶段**只是被"安排"**，不立即执行。等 Phase 3 + 浏览器绘制完，才异步执行。

### 3.2 为什么需要快照（聊天框真实场景）

#### 先补两个 DOM 概念（前置）

如果你看不懂下面的例子，先把这两个属性弄清楚：

```
┌──────────────────────┐  ← 浏览器窗口可见区域顶部
│  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │  ↑
│  ▒▒▒  消息 6  ▒▒▒▒▒  │  │  scrollTop（被往上滚动了多少）
│  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │  │  = 内容顶部到可视区顶部的距离
│  ─────────────────  │  ↓
│  ┌───────────────┐  │  ← 容器可视区开始（用户看到这里）
│  │  消息 7        │  │
│  │  消息 8        │  │     clientHeight（容器可视高度，固定 300px）
│  │  消息 9        │  │     = 用户实际看得到的窗口大小
│  │  消息 10       │  │
│  └───────────────┘  │  ← 容器可视区结束
│  ▒▒▒  消息 11  ▒▒▒  │  ↑
│  ▒▒▒  消息 12  ▒▒▒  │  │  内容溢出（继续往下滚才看得到）
│  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │  ↓
└──────────────────────┘
                        scrollHeight = 整个内容总高度（包括看不见的）
                                     = 1000px（不管可视区多大）
```

**精确定义**：

| 属性 | 含义 | 类比 |
|---|---|---|
| `scrollHeight` | 内容**总高度**（包括滚动条外看不到的） | 整本书的厚度 |
| `clientHeight` | 容器**可视区**高度（固定不变） | 一页纸的高度 |
| `scrollTop` | 内容**被向上滚动了多少**（顶部不可见的部分） | 你翻到第几页 |

**关键关系**：

```
当 scrollTop = 0 时              → 用户在内容最顶部
当 scrollTop = scrollHeight - clientHeight → 用户在内容最底部
当 scrollTop 越大                → 用户越往下滚
```

#### 聊天框场景（精确版：加载历史消息）

⚠️ **重要澄清**：聊天框场景里，**新消息追加（底部）和历史消息加载（顶部）需要不同处理**。

| 场景 | DOM 增长位置 | scrollTop 该不该动 | 是否需要 getSnapshotBeforeUpdate |
|---|---|---|---|
| 新消息追加（底部） | 末尾 | **不动** | ❌ 不需要（浏览器自动保持） |
| 加载历史消息（顶部） | 头部 | **+= 增长量** | ✅ 需要（不主动调就跳） |

下面的例子讲的是**第二种**——加载历史消息。

#### 加载历史消息的具体过程

用户原本在屏幕中间看消息：

```
clientHeight = 300（容器固定 300px 高）
scrollHeight = 1000（已经有 1000px 的消息内容）
scrollTop = 700（用户滚到了快底部，距离底部 300px）

DOM 内容布局：
  [位置 0~700]    旧聊天记录 1~6                     
  [位置 700~1000] 旧聊天记录 7~10（用户正在看这里）  ← 可视区
```

**用户往上翻，触发"加载 100px 的更早历史消息"，插入到顶部**：

```
变更后（无快照修正）：
  scrollHeight = 1100（多了 100px）
  scrollTop = 700（浏览器没动）
  
DOM 内容布局（所有内容向下挤 100px）：
  [位置 0~100]    更早的消息（新插入）         
  [位置 100~800]  原来的旧记录 1~6（被挤下来 100）
  [位置 800~1100] 原来的旧记录 7~10（被挤下来 100）  ← 但用户的可视区还停在 700~1000
  
用户看到的：旧 6 末尾 + 旧 7~9 → 画面跳了 ❌
```

#### 快照怎么修复

```jsx
class Chat extends Component {
  getSnapshotBeforeUpdate(prevProps, prevState) {
    // 在 DOM 变更前读：当前距离底部多少
    const list = this.listRef.current;
    return list.scrollHeight - list.scrollTop;
    //     1000           - 700      = 300（距底部 300px）
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    // 在 DOM 变更后写：根据快照恢复
    const list = this.listRef.current;
    list.scrollTop = list.scrollHeight - snapshot;
    //               1100           - 300      = 800
    //               把 scrollTop 推到 800，抵消顶部插入带来的下挤
  }
}
```

#### 用数字验证

| 时刻 | scrollHeight | scrollTop | 用户看到的位置 |
|---|---|---|---|
| 变更前 | 1000 | 700 | 700~1000（旧 7~10） |
| 快照 | — | — | snapshot = 1000 - 700 = **300** |
| 顶部插入 100px（未修正）| 1100 | 700 | 700~1000（变成 旧 6末尾+旧 7~9）⚠️ 跳 |
| componentDidUpdate 修正 | 1100 | **800** | 800~1100（仍是 旧 7~10）✅ 不变 |

**核心思想**：

> 顶部插入 100px 内容 → 所有原内容向下挤 100px → 我们也把 scrollTop 加 100 来抵消 → 用户视觉不变。
>
> 不记"绝对位置"，记**"相对底部距离"**。变更前后保持相对距离不变 = 用户感觉滚动位置没动。

#### 反问：底部追加新消息时呢？

⭐ **底部追加时不需要 getSnapshotBeforeUpdate**——因为 DOM 增长在末尾，原内容位置完全没动，浏览器保持 scrollTop 不变就是"视觉不变"。

如果你也对底部追加用了 `scrollTop = scrollHeight - snapshot`，反而会**主动把画面挤上去**——这就是常见错用。

#### 没有快照会怎样（仅顶部插入场景）

| 时刻 | 用户体验 |
|---|---|
| 正在看消息 7 | 滚动条停在中间偏下 |
| 触发"加载更早消息" → 顶部插入 100px | **画面"跳"了一下，被往下挤** 😡 |
| 想找回刚才看的消息 | 必须手动往上滚 |

→ 微信、Slack、Discord 的**"上拉加载更早消息"**功能都用了类似机制。

#### 其他典型场景

| 场景 | 需要"快照→恢复" 的状态 |
|---|---|
| 聊天框 | 距底部的滚动距离 |
| 虚拟列表 | 当前 viewport 看到的第一个 item |
| 富文本编辑器 | 光标位置（selection range） |
| input 输入 | 选中的文字范围 |

这些都是"DOM 变更前能拿到但变更后丢失"的状态——必须在 Phase 1 抢救出来。

---

## 四、Phase 2：Mutation（变更）

### 4.1 真正操作 DOM

```js
function commitMutationEffects(root, finishedWork) {
  let nextEffect = finishedWork;
  while (nextEffect !== null) {
    const flags = nextEffect.flags;
    
    if (flags & Placement) commitPlacement(nextEffect);     // appendChild / insertBefore
    if (flags & Update)    commitUpdate(nextEffect);        // setAttribute / nodeValue
    if (flags & Deletion)  commitDeletion(nextEffect);      // removeChild
    if (flags & Ref)       commitDetachRef(nextEffect);     // 卸载旧 ref
    if (flags & Passive)   commitPassiveUnmount(nextEffect);// 跑 useEffect 旧 cleanup
    
    nextEffect = ...; // 子树有 effect 才进入（subtreeFlags 剪枝）
  }
  
  // ★★ 关键：切换 root.current ★★
  root.current = finishedWork;
}
```

### 4.2 操作动作

| flag | DOM 操作 |
|---|---|
| `Placement` | `parent.insertBefore(child, anchor)` 或 `appendChild` |
| `Update` | `setAttribute / element.style.x / textNode.nodeValue` |
| `Deletion` | `parent.removeChild(child)` |
| `Ref` | 先调 `oldRef.current = null` |
| `Passive` | 跑上次 useEffect 的 return cleanup |

⭐ Day 3 §6.6 "DOM 移动触发 useEffect 重跑"就是在这一步——`insertBefore` 把已存在 DOM 先 detach 再 attach，触发 useEffect cleanup + rerun。

### 4.2.5 关键澄清：Mutation 跑的 cleanup ≠ flushPassiveEffects 跑的 effect

> 这是 Day 5 最容易混的一个点——两个"跑 useEffect"跑的根本不是同一个东西。

```jsx
useEffect(() => {
  console.log('effect 跑');       // ★ flushPassiveEffects 异步跑（这次新建的）
  return () => {
    console.log('cleanup 跑');    // ★ 下次 Mutation 同步跑（上次留下的）
  };
}, [dep]);
```

#### 两次 render 时间线

dep 从 0 → 1 → 2，连续 3 次 render：

```
首次渲染（dep=0）
   ↓
[commit 1]
   Phase 1: 调度 useEffect 第 1 次的回调
   Phase 2 Mutation:（没有旧 cleanup，第一次 mount）
   Phase 3 Layout
   ↓
[浏览器 paint]
   ↓
[异步 flushPassiveEffects 1]
   - 跑 effect_1: 'effect 跑' (dep=0)
   - effect_1 返回 cleanup_1
   - React 把 cleanup_1 挂在 hook 上存起来

────── setDep(1) ──────

第 2 次渲染（dep=1）
   ↓
[commit 2]
   Phase 1: 调度 useEffect 第 2 次回调
   Phase 2 Mutation:
     ★ 跑上次留下的 cleanup_1: 'cleanup 跑' (dep=0 闭包) ★
   Phase 3 Layout
   ↓
[浏览器 paint]
   ↓
[异步 flushPassiveEffects 2]
   - 跑 effect_2: 'effect 跑' (dep=1)
   - 返回 cleanup_2 存起来
```

#### 实际 console 输出（操作：点击按钮 2 次）

```
首次渲染（dep=0）：
  effect: 0     ← flushPassiveEffects 跑的

点击 1 次（dep=1）：
  cleanup: 0    ← Mutation 阶段跑的（上次留下的，dep 是闭包捕获的旧值）
  effect: 1     ← flushPassiveEffects 跑的（本次新值）

点击 2 次（dep=2）：
  cleanup: 1
  effect: 2
```

#### 对比表（必背）

| | Mutation 跑的 cleanup | flushPassiveEffects 跑的 effect |
|---|---|---|
| 跑的内容 | 上次 effect 返回的函数 | 这次 render 新建的回调 |
| 同步 or 异步 | **同步**（commit 阶段内） | **异步**（commit 后宏任务） |
| 阻塞 paint 吗 | ✅ 是（commit 整体阻塞） | ❌ 否 |
| dep 是哪一版 | 上次 render 的（闭包） | 这次 render 的 |

#### 为什么 cleanup 必须同步

```js
useEffect(() => {
  document.addEventListener('click', handler);
  return () => document.removeEventListener('click', handler);
}, [handler]);
```

如果 cleanup 放异步：
- 一瞬间"旧 handler 已经被新组件销毁，但事件还绑着"
- 用户点击 → 触发旧 handler → 闭包里指向已销毁的 state → bug 或报错

**Mutation 同步跑 cleanup = 干净退出，不留残余监听**。

#### 为什么 effect 必须异步

effect 里可能跑很重的代码（数据请求、订阅、计算）：
- 同步跑 → 阻塞 paint → 画面卡顿
- 异步（宏任务）跑 → paint 先完成 → 用户看到画面 → 再跑 effect

⭐ React 19 用 `MessageChannel.postMessage` 调度 = **宏任务** = 浏览器能在中间 paint。

#### useLayoutEffect 也一样吗

⚠️ 特别注意：

| | useEffect | useLayoutEffect |
|---|---|---|
| effect 跑的阶段 | flushPassiveEffects（异步宏任务） | Phase 3 Layout（同步） |
| cleanup 跑的阶段 | 下次 commit 的 Mutation（同步） | 下次 commit 的 Mutation（同步） |

⭐ **两种 Hook 的 cleanup 都在 Mutation 同步跑**——cleanup 必须同步是统一规则。

---

### 4.2.6 附录：JS 事件循环与 useEffect 异步调度

> 学习者追问："JS 单线程下，微任务一直等待，宏任务会等还是继续？"
> 这跟 useEffect 为什么是宏任务直接相关。

#### 事件循环精确流程

```
1. 取一个【宏任务】执行
   ↓
2. 执行完后，立刻清空整个【微任务队列】
   - 队列里的微任务一个个执行
   - 微任务里又添加新微任务？继续执行直到队列空
   ↓
3. 浏览器可能渲染（paint）
   ↓
4. 回到步骤 1
```

⭐ **核心**：宏任务**结束的"附加阶段"** = 清空所有微任务。两者不在同一个层级。

#### 微任务"等待"的两种情况

**情况 A：同步阻塞（死循环）**

```js
queueMicrotask(() => { while (true) {} });
setTimeout(() => console.log('timeout'), 0);
```

→ 微任务死循环 → 永远清不完 → **timeout 永远不打印** → 浏览器卡死

**情况 B：异步让出（await）**

```js
queueMicrotask(async () => {
  await fetch('/api');
  console.log('done');
});
setTimeout(() => console.log('timeout'), 0);
```

→ `await` 让出控制权 → 微任务队列继续推进 → 下一个宏任务（timeout）先跑 → fetch resolve 后 done 才打印

⭐ **结论**：宏任务必须等微任务**全部清空**才能跑。微任务卡住 = 事件循环卡死。

#### 为什么 React 用宏任务调度 useEffect

| 调度方式 | 时序 | 后果 |
|---|---|---|
| 微任务（queueMicrotask） | commit → 微任务清空（跑 effect）→ paint | **阻塞 paint** |
| 宏任务（MessageChannel） | commit → paint → 下一宏任务（跑 effect） | **paint 优先** ✅ |

React 团队故意选了 `MessageChannel.postMessage` 调度 useEffect，就是为了让浏览器**先 paint 给用户看，再跑 effect**。

#### 经典面试题验证

```js
console.log('1');
setTimeout(() => console.log('2'), 0);          // 宏任务
Promise.resolve()
  .then(() => { console.log('3'); return Promise.resolve(); })   // 微任务
  .then(() => console.log('4'));                                  // 微任务
queueMicrotask(() => console.log('5'));                           // 微任务
console.log('6');
```

输出：`1 → 6 → 3 → 5 → 4 → 2`

观察：
- 同步代码先跑（1, 6）= 当前宏任务
- 微任务队列清空（3 → 5 → 4，按入队顺序+连锁追加）
- 下一个宏任务（2）

#### 常见 API 分类

| 类型 | 包含 |
|---|---|
| **宏任务** | setTimeout / setInterval / I/O / UI 事件 / MessageChannel.postMessage |
| **微任务** | Promise.then/catch/finally / queueMicrotask / MutationObserver |
| 特殊 | requestAnimationFrame（paint 前同步） |

---

### 4.3 root.current 切换的精确时刻

```
Mutation 末尾 → root.current = finishedWork（wIP 升格 current）
```

**为什么放在 Mutation 末尾、Layout 开始前？**

因为 Phase 3 的：
- `componentDidMount` 里访问 `this`
- `useLayoutEffect` 里访问 `ref.current`
- `componentDidUpdate(prev, prev, snapshot)` 里访问 `this`

这些都需要"我现在是 current 树上的"语义。如果 root.current 还指向旧树，Layout 阶段所有 this/ref 都是错的。

⭐ Day 2 §4.7 学的"createWorkInProgress 复用 alternate"，今天补全了"alternate 指针切换的精确时刻 = Mutation 末尾"。

---

## 五、Phase 3：Layout（布局后，绘制前）

### 5.1 主要做 4 件事

#### A. 同步执行 `useLayoutEffect`

```jsx
function MyComp() {
  const ref = useRef(null);
  
  useLayoutEffect(() => {
    // 此时 DOM 已更新，但浏览器还没绘制
    // 可以同步读 DOM 尺寸 + 改 DOM，浏览器只 paint 一次
    const { width } = ref.current.getBoundingClientRect();
    if (width > 100) {
      ref.current.style.fontSize = '12px';
    }
  });
  
  return <div ref={ref}>...</div>;
}
```

⭐ **核心**：`useLayoutEffect` **同步阻塞**——浏览器在等它跑完才绘制。

#### B. 调 `componentDidMount` / `componentDidUpdate`

#### C. 绑定新 ref

```js
if (flags & Ref) {
  commitAttachRef(fiber);  // ref.current = fiber.stateNode
}
```

#### D. 处理 setState 排队

如果 useLayoutEffect 里调 setState，**会立刻进入下一轮 reconcile**——但保证在浏览器绘制前完成。这就是 useLayoutEffect 的"阻塞代价"。

### 5.2 useLayoutEffect vs useEffect 时序图（必背）

```
[reconcile 完成，wIP 树就绪]
        ↓
[Phase 1: Before Mutation]
   - getSnapshotBeforeUpdate
   - 调度 useEffect（不立即跑，进 schedule 队列）
        ↓
[Phase 2: Mutation]
   - 操作 DOM（appendChild / setAttribute / removeChild）
   - 卸载旧 ref / 跑 useEffect 旧 cleanup
   - ★ root.current = wIP ★
        ↓
[Phase 3: Layout]
   - ★ useLayoutEffect 同步跑 ★ DOM 已变，未绘制
   - componentDidMount / componentDidUpdate
   - 绑定新 ref
        ↓
   [浏览器 paint] ← 用户看到画面
        ↓
[异步任务]
   - ★ useEffect 异步跑 ★ DOM 已变，已绘制
        ↓
   [完成]
```

### 5.3 useLayoutEffect vs useEffect 对比表

| | useLayoutEffect | useEffect |
|---|---|---|
| DOM 就位了吗 | ✅ 已就位 | ✅ 已就位 |
| 浏览器绘制了吗 | ❌ 还没绘制 | ✅ 已绘制 |
| 阻塞绘制 | ✅ 阻塞 | ❌ 不阻塞 |
| 用户看到的内容 | 还是上一帧 | 已经是新一帧 |
| 适合场景 | 测量 DOM 尺寸 + 同步改 DOM（避免闪烁） | 数据请求 / 订阅 / 不影响视觉的副作用 |
| 性能 | 慢（阻塞绘制） | 快（绘制后异步） |

**记忆口诀**：

> **Layout 看不到（绘制前），Effect 看到了（绘制后）。**

### 5.4 经典面试题

```jsx
function App() {
  const [n, setN] = useState(0);
  
  console.log('render:', n);
  
  useLayoutEffect(() => {
    console.log('useLayoutEffect:', n);
  }, [n]);
  
  useEffect(() => {
    console.log('useEffect:', n);
  }, [n]);
  
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
```

第一次点击，console 顺序：

```
render: 1                 ← reconcile 阶段（用户函数）
useLayoutEffect: 1        ← Phase 3 同步
（浏览器绘制，用户看到 1）
useEffect: 1              ← 异步触发
```

⭐ **必背时序**。

---

## 六、commit 真的不可中断吗

### 6.1 严格说

| | 是否可中断 |
|---|---|
| Phase 1 Before Mutation | ❌ 不可中断 |
| Phase 2 Mutation | ❌ 不可中断 |
| Phase 3 Layout（含 useLayoutEffect）| ❌ 不可中断 |
| useEffect 触发（异步）| ✅ 在 schedule 队列里，可被高优先级打断 |

### 6.2 为什么 commit 必须同步

```
如果 commit 可中断：

[Mutation 跑到一半] ← 用户输入打断
   - 已经 setAttribute('class', 'new')
   - 还没 setAttribute('style', 'color:red')
[让出主线程]
   - 浏览器 paint：用户看到 "类名是 new 但颜色还是旧的"
[Mutation 恢复]

= 残缺画面 ❌
```

### 6.3 useTransition 怎么影响 commit

⚠️ **澄清两个常见误解**：

1. **useTransition ≠ Suspense**（两件不同的事）
2. **useTransition 不让 commit 可中断**（只让 reconcile 可中断）

| | useTransition | Suspense |
|---|---|---|
| 干啥 | 把 setState **标记**为低优先级 | 在数据/组件加载时显示 fallback |
| 关系 | 经常配合 | 但本质独立 |

**useTransition 的真实作用**：

```jsx
const [isPending, startTransition] = useTransition();

startTransition(() => {
  setSearchQuery(input);  // 标记为 Transition Lane（低优先级）
});
```

- 这次 reconcile 走低优先级
- 中间有高优先级 setState 进来 → **丢弃这次 wIP，先处理高优先级**
- 一旦进入 commit → **同步跑完，不可中断**

⭐ **本质**：useTransition 让 reconcile **可被丢弃重做**，commit 始终原子。

### 6.4 Suspense 真实作用（顺便讲）

```jsx
<Suspense fallback={<Loading />}>
  <SlowComponent />  {/* 内部 throw promise */}
</Suspense>
```

`<SlowComponent>` 内部 throw 一个 Promise（如 `use(promise)`），Suspense 捕获并显示 fallback。

**Transition + Suspense 经典配合（搜索场景）**：

```jsx
const [isPending, startTransition] = useTransition();
const [query, setQuery] = useState('');

const handleChange = (e) => {
  startTransition(() => {
    setQuery(e.target.value);
  });
};

return (
  <>
    <input value={query} onChange={handleChange} />
    <Suspense fallback={<Spinner />}>
      <SearchResults query={query} />
    </Suspense>
  </>
);
```

两者**叠加**，不是 Transition "用了" Suspense。

---

## 七、整个 commit 流程串起来

```
[reconcile 完成 → wIP 树 + detached DOM 都准备好]
                  ↓
         commitRoot(finishedWork)
                  ↓
┌─────────────────────────────────────────────┐
│ Phase 1: Before Mutation                    │
│   - getSnapshotBeforeUpdate                 │
│   - 调度 useEffect（不立即跑）               │
└─────────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│ Phase 2: Mutation                           │
│   - 按 flags 操作 DOM                        │
│   - 卸载旧 ref + 跑 useEffect 旧 cleanup    │
│   - ★ root.current = finishedWork ★         │
└─────────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────┐
│ Phase 3: Layout                             │
│   - 同步跑 useLayoutEffect                  │
│   - 调 cDM / cDU                            │
│   - 绑定新 ref                               │
└─────────────────────────────────────────────┘
                  ↓
[浏览器 paint]
                  ↓
[异步：flushPassiveEffects]
   - 异步跑 useEffect
                  ↓
                完成
```

---

## 八、自测点评（学习者答完后回填）

### Q1 三子阶段：⚪ 不清楚

→ 见 §2-§5 详解。三阶段名背下来：**Before Mutation / Mutation / Layout**。

### Q2 useEffect vs useLayoutEffect：🟡 时机点反了

学习者答："useEffect 是在组件挂载阶段执行，此时 dom 还没有就位；useLayoutEffect 是在组件挂载时使用，此时 dom 已经就位"

**纠正**：两者**都在 DOM 已就位之后跑**。区别只在 **paint 之前还是之后**：

| | useLayoutEffect | useEffect |
|---|---|---|
| DOM 就位 | ✅ | ✅ |
| 浏览器绘制 | ❌ 还没 | ✅ 已绘制 |

**记忆口诀**：**Layout 看不到（绘制前），Effect 看到了（绘制后）。**

### Q3 getSnapshotBeforeUpdate：⚪ 不清楚

→ 见 §3.2。核心场景：聊天框新消息追加时保持滚动位置。

### Q4 commit 中断 + useTransition：🟡 部分对

✅ commit 不可中断（答对）

⚠️ "useTransition 用 Suspense 接住" → **混淆了两个独立机制**。
- useTransition = 把 setState 标记为低优先级 Lane（让 reconcile 可丢弃）
- Suspense = 捕获 throw promise 显示 fallback
- 两者经常配合但本质独立
- useTransition **不让 commit 可中断**，只让 reconcile 可丢弃

→ 见 §6 详解。

---

## 九、动手实验

详见 `demos/day5/README.md`，3 个实验：

| 实验 | 目标 | 产出 |
|---|---|---|
| F1. useLayoutEffect vs useEffect 时序 | console 看精确顺序 | `F1-console.txt` |
| F2. 用 useLayoutEffect 修复闪烁 | 反例：用 useEffect 会闪烁 | `F2-flicker.gif` |
| F3. 验证 root.current 切换时机 | DevTools 看 alternate 切换 | `F3-screenshots/` |

---

## 十、我之前以为 …，其实是 …（5 条认知纠正）

1. **我以为** commit 是一步到位地"把 DOM 改了"。
   **其实** 分 **3 个子阶段**：Before Mutation（快照）→ Mutation（改 DOM + 切 current）→ Layout（同步 effect）。

2. **我以为** useLayoutEffect DOM 就位、useEffect DOM 还没就位。
   **其实** 两者都在 DOM 已就位之后跑。区别只在 paint 之前还是之后。**口诀：Layout 看不到，Effect 看到了。**

3. **我以为** root.current 切换是 commit 阶段第一步。
   **其实** 切换发生在 **Mutation 阶段末尾、Layout 开始前**。这样 Layout 阶段的 cDM / useLayoutEffect 才能拿到正确的 this 和 ref。

4. **我以为** useTransition 是用 Suspense 接住低优先级渲染。
   **其实** useTransition 和 Suspense 是**两个独立机制**。useTransition = 标记 setState 为低优先级 Lane（让 reconcile 可丢弃）；Suspense = 捕获 throw promise。两者经常配合但本质独立。**useTransition 不让 commit 可中断，只让 reconcile 可丢弃。**

5. **我以为** getSnapshotBeforeUpdate 是个生僻 API。
   **其实** 它解决了非常真实的问题：DOM 变更前后保持滚动位置 / 焦点 / 选区。在聊天框、虚拟列表场景里几乎是必备。

---

## 十一、Day 5 验收清单

- [x] 能默写 commit 三子阶段名 + 各自做的事
- [x] 能解释 useLayoutEffect 和 useEffect 触发时机的精确差异
- [x] 能说清 root.current 切换的时机和原因
- [x] 能讲清 getSnapshotBeforeUpdate 解决什么问题
- [x] 能解释 commit 为什么不可中断（用户视觉一致性）
- [x] 能讲清 useTransition 和 Suspense 的独立性
- [ ] 完成 3 个动手实验
- [x] 写下 5 条认知纠正

---

## 十一·五、自我验收 + AI 纠正（00:39 用户主动默写）

### 学习者答 vs 标准答（逐条对照）

#### 1. commit 三子阶段名 + 各自做的事

学习者答：
> Phase 1 before mutation：存快照，发起 useEffect 的调度，不是真正执行
> Phase 2 mutation：进行 Current.root 的切换，执行上一次 useEffect 的 cleanup
> Phase 3 layout/point：同步执行 useLayoutEffect，浏览器等她调度完才执行，调度 componentDidMount / componentDidUpdate，处理 setState 的排队执行

🟢 **方向 90% 正确**，3 处精度需补：

| Phase | 漏的关键点 |
|---|---|
| Phase 1 | useEffect 是被"调度"，回调真正跑是在 paint 之后异步 |
| Phase 2 | **漏了"按 flags 改 DOM"——这是 Mutation 的主菜**！cleanup（含 useEffect + useLayoutEffect 两种）+ 卸载旧 ref + 切 root.current 都是顺带做的 |
| Phase 3 | 漏了"绑定新 ref"。"layout/point"是 layout 拼成 point，应是 paint |

#### 2. 学习者的疑问：Layout 阶段也跑 useEffect 吗

🔴 **不**。精确答案：

```
Layout 阶段只跑 useLayoutEffect 回调 + 类组件 cDM/cDU + 绑 ref
useEffect 回调跑在 paint 之后的宏任务（flushPassiveEffects）里
```

| Hook | 回调跑的阶段 | 同步/异步 |
|---|---|---|
| useLayoutEffect 回调 | Phase 3 Layout | 同步（阻塞 paint） |
| useEffect 回调 | paint 后 flushPassiveEffects | 异步（不阻塞 paint） |

⭐ useEffect 在 commit 里只被"调度"（Phase 1），**回调真正执行在 paint 之后**。

#### 3. useLayoutEffect vs useEffect 时机

学习者答：
> useLayoutEffect 看不到新 dom。但是已经加载了，只是还没有渲染，useEffect 是在 dom 已经完全渲染后执行

🟢 **完全正确**，措辞精确化：
- "加载了" → DOM 已就位
- "渲染" → paint（绘制）

口诀：**Layout 看不到（绘制前），Effect 看到了（绘制后）。**

#### 4. root.current 切换时机 + 原因

学习者答：
> 时机在 commit 的第二步，mutation 阶段，原因不清楚

🟢 时机对（更精确：**Mutation 末尾**），原因没答。

**完整原因**：
Layout 阶段的 cDM / useLayoutEffect / this / ref.current 都需要"我现在是 current 树上的"语义。
- 如果切换放 Phase 1 开始 → Mutation 操作 DOM 出错都没法回滚
- 如果切换放 Layout 之后 → Layout 阶段的 this 和 ref 都是旧的，cDM 就拿不到新 DOM

切换时机必须**在"DOM 已完全改好"之后、"Layout 访问 this/ref"之前**夹住——即 Mutation 末尾。

#### 5. getSnapshotBeforeUpdate

学习者答：
> 记住上一次更新的快照，防止在下一次渲染时丢失状态，给用户造成页面抖动

🟢 **完全正确**。

精确补充：抖动根源是 **DOM 变更前后用户可视区"相对位置"漂移**。快照记的是"相对位置"，变更后恢复。
真实场景：聊天框上拉加载历史消息（顶部插入 → 原内容下挤 → 必须 scrollTop += 增长量抵消）。

#### 6. commit 为什么不可中断

学习者答：
> 更新到一半中断时，会出现展示割裂，一半新数据一半老数据

🟢 **完全正确**。这就是核心理由——**用户视觉一致性**。

#### 7. useTransition

学习者答：
> useTransition 是延缓组件的 commit 时机，不是中断 commit

🔴 **不是延缓 commit，是延缓 reconcile**。

```
普通 setState：reconcile（高优先级）→ commit
useTransition setState：reconcile（低优先级 Lane，可被高优先级丢弃重做）→ commit
                              ↑
                          这里可中断、可重做

一旦进入 commit → 同步跑完，不可中断（commit 永远原子）
```

**精确版**：useTransition 让 **reconcile 阶段可中断、可丢弃重做**——给紧急更新（如用户输入）让路。
**不影响 commit**。

记忆口诀：**Transition 影响 reconcile，不影响 commit。**

#### 8. Suspense

学习者答：
> Suspense 是 Promise 未 resolve 时展示的 fallback 样式

🟢 **完全正确**。

### 自我验收得分

| 项 | 评分 |
|---|---|
| commit 三子阶段 | 🟢 90% |
| 学习者疑问（Layout 跑 useEffect？） | 🔴 不 |
| useLayoutEffect vs useEffect 时机 | 🟢 95% |
| root.current 切换 | 🟢 70%（时机对、原因没答） |
| getSnapshotBeforeUpdate | 🟢 100% |
| commit 不可中断 | 🟢 100% |
| useTransition | 🔴 错（延缓的是 reconcile，不是 commit） |
| Suspense | 🟢 100% |

⭐ **最值得记的两个纠正**：
1. **useEffect 回调跑在 paint 后异步**，不在 Layout 阶段
2. **useTransition 影响 reconcile，不影响 commit**

---

## 十二、Day 6 预告（W2 开始：Hooks 实现原理）

**主题**：useState 源码——dispatch 函数、Hook 链表、updateQueue

**预读问题**：

1. `setN(n + 1)` 和 `setN(prev => prev + 1)` 在源码里有什么区别？
2. 多次连续 `setN` 调用，React 怎么批处理？
3. useState 的 lazy init `useState(() => expensiveCompute())` 是什么时候跑的？
4. 函数式更新 `setN(prev => prev + 1)` 的 prev 来自哪里？

明天见 👋
