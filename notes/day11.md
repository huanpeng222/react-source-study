# Day 11 笔记：Suspense 原理（throw promise + 捕获 + fallback + 重试）

> 日期：2026-06-26
> 主题：React 如何用"抛 promise"实现异步加载的同步感知
> 状态：📖 学习中
> 源码出处（已 WebFetch 核对 facebook/react main）：
> - `packages/react-reconciler/src/ReactFiberThrow.js`（throwException / attachPingListener）
> - `packages/react-reconciler/src/ReactFiberWorkLoop.js`（performUnitOfWork 的 try-catch）
> - `packages/react-reconciler/src/ReactFiberBeginWork.js`（updateSuspenseComponent）

---

## 零、入场自测（5 分钟，先自己答再往下看，"不会"明确说不会）

1. `<Suspense>` 是怎么"捕获"子组件还没准备好的状态的？
2. 组件 throw 一个 promise 后，React 怎么知道"等它 resolve 再重试"？重试时从哪里开始？
3. Suspense 和 Error Boundary 在实现上有什么相似之处？
4. `use(promise)`（React 19 新 API）和老的 throw promise 写法有什么关系？

---

## 一、先搞清楚一个问题：render 是同步的，你怎么"等"一个异步请求？

这是 Suspense 要解决的根本矛盾。

你写 React 组件的时候，render 函数是这样的：

```jsx
function UserProfile() {
  const data = fetchUser();  // ← 这行要等网络请求回来
  return <div>{data.name}</div>;
}
```

**问题来了：`fetchUser()` 是个异步操作，但 render 函数是同步执行的——它不可能"暂停在这里等一下"。**

传统的做法是什么？你在组件里维护一个 `loading` 状态：

```jsx
function UserProfile() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser().then(d => { setData(d); setLoading(false); });
  }, []);

  if (loading) return <Spinner />;
  return <div>{data.name}</div>;
}
```

能跑，但你得在每个需要数据的组件里手写 loading 状态、useEffect、错误处理……** boilerplate 爆炸**。

React 团队想了另一种路子：**如果数据还没好，我不等你了，我直接把整个渲染过程"扔掉"，先显示个 fallback 占位；等数据好了我再重新来一遍。** 这就是 Suspense 的核心思想。

> 💡 你可以把它想象成去餐厅点餐：传统做法是你站在柜台前死等厨师做好（loading 状态）；Suspense 的做法是服务员给你个叫号牌（fallback），你去座位上坐着，做好了叫你（promise resolve），你再回去取餐（重试渲染）。

---

## 二、核心机制：组件可以 throw 一个 promise

这是 Suspense 最基本、也最反直觉的事实。

### 2.1 throw promise？你没看错

正常情况下我们 `throw` 的是 Error：

```js
throw new Error('出错了');
```

但 React 规定：**你也可以 throw 一个 promise**。这个 promise 代表"这个东西还没准备好，但我承诺以后会给你结果"。

```js
function fetchUser() {
  const promise = getUserFromAPI();  // 返回一个 Promise
  if (promise.status !== 'fulfilled') {
    throw promise;   // ← 数据还没好，把 promise 抛出去！
  }
  return promise.value;  // 数据好了，直接返回
}
```

**关键认知**：这不是"错误处理"，这是"暂停信号"。throw promise ≈ 对 React 说："别跑了，这活儿还没干完，等我通知你。"

### 2.2 谁来接住这个 throw？

你的组件函数是在 beginWork 里被调用的，而 beginWork 被 `performUnitOfWork` 包在一个 **try-catch** 里（`ReactFiberWorkLoop.js`）：

```js
function performUnitOfWork(unitOfWork) {
  try {
    next = beginWork(current, unitOfWork, renderLanes);
  } catch (thrownValue) {
    // ★ 这里接住了一切：Error、promise、什么都接
    throwException(thrownValue);   // 去处理它
  }
}
```

所以当你组件里 `throw promise` 的时候，它不会被浏览器报错页面吞掉——**React 的 reconciler 层面就把这个 promise 接住了**。

> 🔍 微检查点 1：throwException 接住 thrownValue 后，怎么区分它是 promise 还是普通 Error？（提示：看有没有 `.then` 方法）

---

## 三、接住之后怎么办 —— throwException 的完整流程

这一节是今天的重点，我把它拆成一步步来讲。你可以把这个流程想象成一个**"向上喊话"的过程**：子组件发现问题 → 向上层报告 → 找到能处理的人 → 安排后续。

### 3.1 第一步：标记当前 fiber "没完成"

```js
// ReactFiberThrow.js
sourceFiber.flags |= Incomplete;
```

这个 fiber 的渲染没完成，是个半成品。后面 commit 阶段不会提交它。

### 3.2 第二步：判断到底是什么被抛出来了

```js
if (typeof value.then === 'function') {
  // → 它是个 thenable（有 .then 方法的东西，通常是 Promise）
  // → 走 Suspense 路线
} else {
  // → 普通 Error / 其他东西
  // → 走 Error Boundary 路线
}
```

就这么一行判断，**两条完全不同的处理路线**。这就是为什么 Q3 说"Suspense 和 Error Boundary 底层用的是同一套机制"——它们共享同一个 catch 入口，只是在里面走了不同的 if-else 分支。

⭐ **记住这个判断条件**：`typeof value.then === 'function'`。面试常考。

### 3.3 第三步：停止往下渲染

```js
resetSuspendedComponent(workInProgress, returnFiber, sourceFiber);
```

这步做的是：**把 workInProgress 的遍历指针回退到 sourceFiber 所在的位置**。意思是"下面的兄弟节点不用跑了，整条路径停在这"。就像你在公司里发现了一个问题，你不再继续做手头的任务，而是停下来去找能解决这个问题的人。

### 3.4 第四步：沿 return 链往上找 Suspense 边界 ⭐

这是最关键的一步。`getSuspenseHandler()` 从当前 fiber 开始，沿着 `return` 链一层一层往上找：

```
App (FunctionComponent)
 └─ Suspense (SuspenseComponent)    ← 就找这个！最近的 Suspense 边界
     └─ Main (FunctionComponent)
         └─ UserProfile (FunctionComponent)
             └─ throw promise       ← 从这里出发往上找
```

```js
let handler = returnFiber;
while (handler !== null) {
  if (handler.tag === SuspenseComponent) {
    return handler;    // ★ 找到了！
  }
  handler = handler.return;
}
```

**只找最近的那个**。如果有嵌套的多个 Suspense，每个 throw 只会被最近的那个捕获。

> 💡 如果往上找了一圈都没找到 SuspenseComponent 呢？那就是你没用 `<Suspense>` 包住会 throw 的组件——这种情况下 promise 会被当作未处理的异常，控制台报 warning。

### 3.5 第五步：标记边界"应该切换到 fallback"

找到边界后，调用 `markSuspenseBoundaryShouldCapture`：

```js
suspenseBoundary.flags |= ShouldCapture;
```

给这个 Suspense 边界的 fiber 打上一个 flag。后面 beginWork 再遇到这个 fiber 时，看到这个 flag 就知道："哦，这次要显示 fallback 了"。

### 3.6 第六步：把 promise 存起来，挂上"好了叫我"的回调

两件事同时发生：

**(a)** 把这个 wakeable（就是那个 promise）存进 Suspense 边界的 retryQueue：

```js
const retryQueue = suspenseBoundary.updateQueue;
retryQueue.add(wakeable);   // 记住这个 promise
```

**(b)** 给 promise 挂一个 `.then` 回调——**这就是"好了叫我"的机制**：

```js
// attachPingListener (ReactFiberThrow.js)
function ping() {
  markRootUpdated(root, retryLane);
  ensureRootIsScheduled(root);
}
wakeable.then(ping, ping);
```

这段代码的意思是：当这个 promise resolve（或 reject）的时候，自动触发一次新的调度——相当于有人按了一下重新渲染的按钮。**你不需要手动写任何代码来实现"数据好了重新渲染"这件事，React 帮你做了。**

> 🔍 微检查点 2：attachPingListener 给 promise 挂了 `.then(ping, ping)`，那 promise reject 的时候也会调 `ping` 吗？这样设计合理吗？

---

## 四、beginWork 遇到 Suspense 边界时怎么处理

现在 workLoop 继续跑，轮到了那个被打上 `ShouldCapture` 标记的 Suspense 边界 fiber 的 beginWork。

它的逻辑其实很简单，就是一个三路分支：

```js
// updateSuspenseComponent (ReactFiberBeginWork.js)

if (fiber.flags & ShouldCapture) {
  // ★ 分支 A：本轮检测到子组件 throw 了 promise
  // → 显示 fallback，隐藏主内容

} else if (previousState === Suspended) {
  // ★ 分支 B：上一轮显示的是 fallback，但这轮没有新的 ShouldCapture
  // → 说明 promise 已经 resolve 了，切回显示主内容！

} else {
  // ★ 分支 C：啥事没有，正常显示主内容
}
```

**分支 A**（刚 throw 完）：React 会创建一个 OffscreenComponent 来包裹主内容。Offscreen 是一种特殊的 fiber——它的作用是"隐藏但不卸载"。这意味着主内容的状态全部保留在内存里，只是不渲染到 DOM 上。下次切回来时不需要重新 mount。

**分支 B**（promise 已resolve）：从 fallback 切回 primary child，Offscreen 从"隐藏模式"切换回"可见模式"。

> 💡 **OffscreenComponent 是 Suspense 的隐藏功臣**。没有它，每次切回主内容就得重新执行所有子组件、重新请求数据、丢失所有用户输入状态。有了它，切换就像 CSS 的 `display: none ↔ block` 一样轻量。

### completeWork 里的收尾

completeWork 到 Suspense 边界时，根据 `ShouldCapture` flag 更新边界的内部状态：

| 当前状态 | ShouldCapture 有无 | 切换到 |
|---|---|---|
| Normal | 有 → | **Suspended**（显示 fallback）|
| Suspended | 无 → | **Normal**（切回主内容）|

然后 `commitRoot` 时真正执行 DOM 操作——插入 fallback 的 DOM 或恢复 primary 的 DOM。

> 🔍 微检查点 3：beginWork 遇到 SuspenseComponent 时，三个分支分别什么条件下进入？OffscreenComponent 的作用是什么？

---

## 五、promise resolve 之后：重试（retry）的全过程

前面 `attachPingListener` 给 promise 挂了个 `ping` 回调。现在 promise 终于 resolve 了，发生了什么：

### 5.1 重试时间线

```
时间线 →

[t1] 用户打开页面
     ↓
[t2] UserProfile beginWork → fetchUser() throw promise
     ↓
[t3] throwException: 找到 Suspense 边界 → 标 ShouldCapture
     ↓
[t4] commit: 显示 <Spinner />（fallback），主内容藏入 Offscreen
     ↓
[t5] ... 网络请求进行中 ...
     ↓
[t6] promise.resolve! → then(ping) 触发
     ↓
[t7] ping(): markRootUpdated + ensureRootIsScheduled
     ↓
[t8] 新一轮 render:
     Suspense 边界的 ShouldCapture 已清掉（新 render 重新算 flags）
     → 走分支 B（previousState === Suspended）
     → 切回显示 primary child（Offscreen 变可见）
     ↓
[t9] UserProfile 再次 beginWork → fetchUser() 直接返回缓存值（不 throw）
     → 正常渲染出 <div>{data.name}</div>
     ↓
[t10] commit: 把真实内容切到屏幕上 ✅
```

### 5.2 几个重要细节

**① 不是"从断点续跑"，是"从头再来"**

t8 那一步不是接着 t2 断开的地方继续——而是**从 Suspense 边界的 primary child 整棵子树重新开始 render**。好在大多数数据获取库（Relay / React Query / SWR）都有缓存，第二次执行 `fetchUser()` 直接返回缓存值，不会再 throw，所以很快就能完成。

**② 重试用的是什么 lane？**

`ping` 回调里调的是 `markRootUpdated(root, retryLane)`——这个 `retryLane` 一般是一个 TransitionLane（低优先级）。也就是说，**重试默认是低优先级的**，不会打断正在进行的用户交互。这也符合直觉：数据加载好了当然重要，但不至于打断用户正在打的字。

> 🔍 微检查点 4：重试时为什么一般不会再次 throw promise？（提示：缓存）

---

## 六、Suspense vs Error Boundary —— 同一套架构的两条路

你现在应该能理解为什么 Q3 说它们"本质相同"了。

### 6.1 共享的部分

它们都依赖同一套基础设施：

| 共享机制 | 说明 |
|---|---|
| **同一个 try-catch** | `performUnitOfWork` 的 catch 块 |
| **同一个入口函数** | `throwException` |
| **同样的"向上查找"模式** | 沿 return 链找最近的处理者 |
| **同样的"标记+回调"模式** | 打 flag + 存信息 + 后续处理 |

### 6.2 不同的部分

| | Error Boundary | Suspense |
|---|---|---|
| 抛出的东西 | `throw new Error(...)` | `throw promise` |
| 判断条件 | `typeof value.then !== 'function'` | `typeof value.then === 'function'` |
| 往上找谁 | 有 `getDerivedStateFromError` 或 `componentDidCatch` 的类组件 | tag 为 `SuspenseComponent` 的 fiber |
| 处理结果 | 显示 error UI | 显示 fallback UI |
| 能否自我恢复 | 不能（除非用户操作）| 能（promise resolve 自动重试）|

### 6.3 一张图看清两条路的分叉

```
performUnitOfWork 的 try-catch
  │
  ├─ typeof value.then === 'function' ?
  │     │
  │     ├─ 是 → getSuspenseHandler()
  │     │        ├── 找到了? → markSuspenseBoundaryShouldCapture + attachPingListener
  │     │        └── 没找到? → 当作 unhandled rejection
  │     │
  │     └─ 否（是 Error）→ createCapturedValue
  │            ├── 找到了 Error Boundary? → 触发 getDerivedStateFromError / componentDidCatch
  │            └── 没找到? → 白屏 + 控制台红色报错
```

> 💡 **面试技巧**：如果你被问到"Suspense 和 Error Boundary 的关系"，先说"它们共享 try-catch 和向上查找架构"，再说"区别在于抛出物类型和处理者类型"，最后补一句"这也是为什么 Suspense 可以和 Error Boundary 嵌套使用——各管各的，互不干扰"。

---

## 七、use(promise) —— React 19 的语法糖

### 7.1 传统写法 vs use 写法

**老写法**（throw promise，需要自己包装资源）：

```jsx
function User() {
  const data = resource.read();  // 内部: if (!ready) throw promise
  return <div>{data}</div>;
}
```

**React 19 新写法**：

```jsx
function User() {
  const data = use(somePromise);  // ← 就这一行，干净多了
  return <div>{data}</div>;
}
```

### 7.2 use 的底层原理

`use(promise)` 做了什么？其实不多——它就是个"智能包装器"：

```js
function use(promise) {
  if (promise.status === 'fulfilled') {
    return promise.value;          // 已完成 → 直接拿值，零开销
  }

  if (promise.status === 'rejected') {
    throw promise.reason;          // 失败了 → 当 Error 抛，走 Error Boundary
  }

  // 还没好 → 注册回调 + throw promise（走 Suspense）
  promise.then(
    v => { promise.status = 'fulfilled'; promise.value = v; },
    e => { promise.status = 'rejected'; promise.reason = e; }
  );
  throw promise;                   // ← 最终还是走 Suspense 那套
}
```

所以 **`use(promise)` 底层还是 throw promise**，走的完全是同一套 Suspense 路径。区别在于：

1. **不用你自己管理资源对象**——直接传 promise 进去就行
2. **可以在条件语句里用**——throw 会跳出整个函数，`use` 不会（因为它内部处理完了再决定要不要 throw）
3. **语义更清晰**——读到 `use(dataPromise)` 一眼就知道"这里在等待一个异步值"

> 💡 注意：`use()` 目前只能在 **React 组件或 Hook 内部** 使用（和 useState 同级约束）。不能在普通函数或者事件处理器里用它。

> 🔍 微检查点 5：`use(promise)` 内部在 promise pending 时最终还是 `throw promise`，那它比手动 throw promise 多做了什么？为什么要多此一举？

---

## 八、Legacy 模式 vs Concurrent 模式下的 Suspense

你可能听过"Legacy Suspense"和"Concurrent Suspense"不一样。简单说一下差异：

| | Legacy（React 17 及以下，或用了 `ReactDOM.render`）| Concurrent（React 18+，用了 `createRoot`）|
|---|---|---|
| Fallback 何时展示 | **立刻**替换，同步 commit | **可延迟**（默认 ~500ms 拥塞节流，避免闪烁）|
| 能否被高优先级更新打断 | 不能（同步一口气跑完）| 能（Concurrent 可中断）|
| Ping 机制 | 无（commit fallback 后直接重新 mount）| 有（attachPingListener 异步调度重试）|
| 用户体验 | 可能闪烁（快速完成的请求也会闪一下 fallback）| 流畅（快速请求根本来不及显示 fallback）|

实际项目中你几乎都在用 Concurrent 模式（`createRoot`），所以重点是记住 **Concurrent 模式下 Suspense 有拥塞节流** 这个特性——如果一个请求在 500ms 内就完成了，用户根本看不到 fallback，体验很顺滑。

---

## 九、我之前以为 …，其实是 …（5 条认知纠正，跟练后回填）

（学完后回填）

---

> 🔍 微检查点总回顾（建议逐个口头回答，不要翻看上面的内容）：
>
> 1. throwException 怎么区分 promise 和 Error？
> 2. attachPingListener 的 ping 回调做了什么事？
> 3. beginWork 遇到 SuspenseComponent 的三个分支分别对应什么场景？
> 4. OffscreenComponent 的作用？
> 5. 为什么重试时通常不会再 throw？
> 6. `use(promise)` 相比手动 throw promise 多了什么？
> 7. Suspense 和 Error Boundary 共享什么？区别在哪？

---

## 十、明天预告

Day 12：**SuspenseList 并发模式 + 自定义 Suspense 案例（React.lazy + data fetching + use）**
