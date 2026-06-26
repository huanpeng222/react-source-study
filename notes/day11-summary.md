# Day 11 精简笔记：Suspense 原理（throw promise + 捕获 + fallback + 重试）

> 复习只看这一份。源码出处：`ReactFiberThrow.js` / `ReactFiberWorkLoop.js` / `ReactFiberBeginWork.js`（行号对照 facebook/react `main`）

## 一句话总纲

> **Suspense 的本质是"用 throw promise 作为暂停信号"——组件在 render 中抛出 promise → 被 performUnitOfWork 的 try-catch 接住 → throwException 沿 return 链找到最近的 Suspense 边界 → 标记 ShouldCapture + attachPingListener 挂回调 → 渲染 fallback → promise resolve 后 ping 调度重试 → 切回主内容。和 Error Boundary 共享同一套 try-catch + 向上查找架构，只是捕获物（promise vs Error）和处理者不同。**

## 一、核心矛盾：render 是同步的，怎么"等"异步？

- 传统做法：组件内维护 loading 状态 + useEffect 请求 → boilerplate 爆炸
- Suspense 做法：**数据没好就 throw promise** → React 放弃这轮渲染该子树 → 先显示 fallback → promise resolve 后重新来一遍

类比：传统 = 死等厨师做好；Suspense = 拿叫号牌去坐着，做好了叫你。

## 二、完整流程六步

| 步骤 | 发生在 | 做了什么 |
|---|---|---|
| ① 组件 throw promise | beginWork 执行函数组件时 | `fetchUser()` 数据没好就 `throw promise` |
| ② try-catch 接住 | `performUnitOfWork` (WorkLoop) | catch 块接住 thrownValue |
| ③ throwException 处理 | `ReactFiberThrow.js L364` | 标 Incomplete + 判断 thenable + resetSuspendedComponent + getSuspenseHandler 向上找边界 |
| ④ 标记边界 + 挂回调 | 同上 | `ShouldCapture` flag + wakeable 存 retryQueue + `attachPingListener` 给 promise.then(ping,ping) |
| ⑤ beginWork 处理边界 | `updateSuspenseComponent` (BeginWork) | 有 ShouldCapture→显示 fallback(Offscreen 隐藏)；上一轮 Suspended 且无新 Capture→切回 primary；否则正常显示 |
| ⑥ promise resolve 后重试 | ping 回调触发 | markRootUpdated → ensureRootIsScheduled → 新一轮 render → 不再 throw → 正常渲染 |

## 三、关键判断：promise vs Error 怎么区分？

```js
// throwException 内部（ReactFiberThrow.js）
if (typeof value.then === 'function') {
  // → thenable → Suspense 路线: getSuspenseHandler() → markSuspenseBoundaryShouldCapture
} else {
  // → Error → Error Boundary 路线: createCapturedValue → 找 getDerivedStateFromError
}
```

**面试必考条件**：`typeof value.then === 'function'`。

## 四、Suspense vs Error Boundary 对比

| | Error Boundary | Suspense |
|---|---|---|
| 抛出物 | `throw new Error()` | `throw promise` |
| 判断 | 无 `.then` 方法 | 有 `.then` 方法 |
| 往上找谁 | 类组件（有 componentDidCatch / getDerivedStateFromError）| `SuspenseComponent` fiber |
| 结果 | error UI | fallback UI |
| 能否自恢复 | 不能（需用户操作）| 能（ping 自动调度重试）|

**共享架构**：同一个 try-catch + 同一个 throwException 入口 + 同样的沿 return 链向上查找。

## 五、attachPingListener —— "好了叫我"

```js
function attachPingListener(root, wakeable, lanes) {
  function ping() {
    markRootUpdated(root, retryLane);   // 根上有活了
    ensureRootIsScheduled(root);          // 调度重新渲染
  }
  wakeable.then(ping, ping);              // resolve 和 reject 都调！
}
```

- resolve → 重试后走分支 B（切回 primary）
- reject → 重试后发现是 rejection → 冒泡给 Error Boundary 处理
- retryLane 一般是 TransitionLane（低优先级，不打断交互）

## 六、beginWork 三分支（updateSuspenseComponent）

```
fiber.flags & ShouldCapture?
  ├─ 是 → 显示 fallback，主内容藏入 OffscreenComponent（隐藏但不卸载）
  ├─ 否 + previousState === Suspended?
  │     └─ 是 → promise 已resolve → 切回显示 primary（Offscreen 变可见）
  └─ 否 → 正常显示 primary child
```

### OffscreenComponent 的作用

不只是 DOM 层面的隐藏——**JS 层面也保留所有状态**：
- hooks 状态（useState 的值）
- effect 链表（useEffect 的 cleanup/setup）
- 用户输入、局部变量……全部内存封存
- 切回来时零成本恢复（不需要重新执行组件函数）

类似 CSS `display:none ↔ block`，但比它更强——连 JS 计算都省了。

## 七、use(promise) —— React 19 语法糖

### 本质：对 throw promise 的封装，底层路径完全一样

```js
function use(promise) {
  if (promise.status === 'fulfilled') return promise.value;      // 直接返回
  if (promise.status === 'rejected') throw promise.reason;        // 走 Error Boundary
  // pending:
  promise.then(
    v => { promise.status = 'fulfilled'; promise.value = v; },  // ★ 存到 promise 对象本身
    e => { promise.status = 'rejected'; promise.reason = e; }
  );
  throw promise;                                                  // 最终还是走 Suspense
}
```

### use 比手动 throw 多三个好处
1. **可在条件语句/循环中使用**——手动 throw 会跳出整个函数体；use 在第二次调用时直接返回值不 throw
2. **不用自己包资源对象**——传原始 promise 即可（手动 throw 需要 createResource 工厂函数）
3. **幂等性**——同一 promise 多次 use 只 throw 一次

### 缓存机制
`use()` 在第一次调用时给 promise 对象挂 `.status` 和 `.value`/`.reason`。**前提是两次 render 用同一个 promise 实例引用**（需要你自己或数据获取库保证）。

## 八、Legacy vs Concurrent Suspense

| | Legacy (React 17-) | Concurrent (React 18+) |
|---|---|---|
| Fallback 展示时机 | 立刻同步 | 可延迟 ~500ms（拥塞节流防闪烁）|
| 能否被打断 | 不能 | 能（Concurrent 可中断）|
| Ping 机制 | 无 | 有（attachPingListener 异步调度）|

## 九、面试口述速记（3 分钟版本）

> Suspense 解决的是 "render 是同步的但数据加载是异步的" 这个矛盾。
> 它的做法是让组件在数据没好时 **throw 一个 promise**，这个 promise 被 `performUnitOfWork` 的 try-catch 接住。
> 然后 `throwException` 函数沿 fiber 的 **return 链向上查找**最近的 `<Suspense>` 边界，
> 给它打上 `ShouldCapture` flag，同时把 promise 存进边界的 retryQueue，
> 并通过 `attachPingListener` 给 promise 挂一个 `.then` 回调——就是"好了叫我"。
> 当 beginWork 再次遇到这个 Suspense 边界时发现 ShouldCapture 标记，就**渲染 fallback**，主内容被 OffscreenComponent 包裹隐藏但**状态全部保留**。
> 等 promise resolve 后，之前挂的回调 `ping` 触发新一轮 render，这次 ShouldCapture 已清掉，就走"切回主内容"的分支。
> 整个机制和 **Error Boundary 共享同一套架构**——同一个 try-catch、同一个 throwException 入口、同样的向上查找模式；
> 区别只在于抛出的是 promise 还是 Error，找的处理者是 SuspenseComponent 还是类组件。

## 十、易错点（本次学习踩坑记录）

1. **throwException 不是自己判断要不要 suspend**——它是被动接收 performUnitOfWork catch 到的东西，然后路由分发
2. **reject 也触发 ping**——不是只监听 resolve，失败也要重新试一次（让 Error Boundary 接住）
3. **Offscreen 不只隐藏 DOM**——hooks 状态/effect/用户输入全部内存封存，不重算
4. **use(promise) 底层还是 throw**——它没有绕开 Suspense，只是封装了判断逻辑
5. **缓存不是 React 做的**——use 只往 promise 对象上挂 .status/.value；保证同一 promise 引用是你的事（Map 缓存 / RTK Query / SWR / Relay）
