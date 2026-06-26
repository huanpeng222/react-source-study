# Day 11 自测题：Suspense 原理

> 不翻看笔记和教程，先自己答。答案默认折叠，点击展开。

---

## Q1：Suspense 解决的根本矛盾是什么？传统做法有什么缺点？

<details>
<summary>点击查看参考答案</summary>

**矛盾**：React 的 render 函数是同步执行的，但数据加载（网络请求）是异步的——render 里不可能"暂停等一下"。

**传统做法的缺点**：每个需要数据的组件都要手写 loading 状态 + useEffect 发请求 + 错误处理 → **boilerplate 爆炸**。而且每个组件独立管理自己的加载状态，难以协调多个并行请求。

**Suspense 做法**：数据没好就 throw promise → React 放弃这轮渲染该子树 → 先显示 fallback → promise resolve 后重新 render。

</details>

---

## Q2：throwException 函数内部怎么区分捕获到的是 promise 还是 Error？判断条件是什么？

<details>
<summary>点击查看参考答案</summary>

```js
if (typeof value.then === 'function') {
  // → thenable → 走 Suspense 路线
} else {
  // → Error → 走 Error Boundary 路线
}
```

**判断条件**：`typeof value.then === 'function'`。有 `.then` 方法的就是 promise/thenable，走 Suspense；没有的走 Error Boundary。

这是 `throwException` 内部的第一层路由分发，**面试必考**。

</details>

---

## Q3：throwException 找到 Suspense 边界后做了哪三件事？

<details>
<summary>点击查看参考答案</summary>

1. **标记 ShouldCapture flag**：`suspenseBoundary.flags |= ShouldCapture` —— 告诉 beginWork "这次要显示 fallback"
2. **存入 retryQueue**：把 wakeable（promise）加进边界的 updateQueue Set 中
3. **attachPingListener**：给 promise 挂 `.then(ping, ping)` 回调 —— resolve/reject 后自动触发重试调度

三件事的核心目的：**记录"谁在等我" + 安排"好了之后怎么办"**

</details>

---

## Q4：beginWork 遇到 SuspenseComponent 时三个分支分别什么条件下进入？OffscreenComponent 的作用是什么？

<details>
<summary>点击查看参考答案</summary>

**三分支**：
- `fiber.flags & ShouldCapture` → **显示 fallback**（本轮检测到子组件 throw 了 promise）
- `!ShouldCapture && previousState === Suspended` → **切回 primary child**（上一轮是 fallback，这轮没新 throw = promise 已 resolve）
- 其他 → **正常显示 primary child**

**OffscreenComponent 作用**：包裹主内容实现"隐藏但不卸载"。不只是 DOM 不渲染——**hooks 状态、effect 链表、用户输入全部内存封存**。切回来时零成本恢复，不需要重新执行组件函数。类似 CSS `display:none` 但连 JS 计算都省了。

</details>

---

## Q5：attachPingListener 给 promise 挂了 `then(ping, ping)`，为什么 reject 也调 ping？这样设计合理吗？

<details>
<summary>点击查看参考答案</summary>

**reject 也调 ping 是合理的**。原因：

ping 的作用不是"假装成功了"，而是**"无论结果如何都重新试一次"**：

- **resolve 时调 ping**：新一轮 render → ShouldCapture 已清 → 切回 primary → 组件重新执行 → 数据已缓存不 throw → 正常渲染 ✅
- **reject 时调 ping**：新一轮 render → 组件重新执行 → 这次 throw 的是 rejection（Error）→ 冒泡给 **Error Boundary** 处理 ✅

如果 reject 不调 ping，失败的请求就会永远卡在 fallback 状态，用户看不到任何错误提示。

</details>

---

## Q6：promise resolve 后的重试是从上次中断的地方续跑吗？为什么一般不会再 throw 一次？

<details>
<summary>点击查看参考答案</summary>

**不是从断点续跑，是整棵 Suspense 边界的 primary child 子树从头重新 render**（就像第一次 mount 一样）。

**不会再次 throw 的原因**：数据获取库（Relay / React Query / SWR / 你自己写的 Map 缓存）已经把 API 返回结果缓存了。第二次执行同一个 fetch 函数时，返回的是**同一个 promise 实例引用**（带 `.status='fulfilled'` 和 `.value=真实数据`），直接返回值，不会创建新 promise 也不会再次 throw。

前提：你的代码保证了相同参数的请求返回同一个 promise 引用（通过 Map / 库内置缓存）。

</details>

---

## Q7：`use(promise)` 和手动 `throw promise` 有什么关系？use 多出了哪些能力？

<details>
<summary>点击查看参考答案</summary>

**关系**：`use()` 底层最终还是 `throw promise`，走的完全是同一套 Suspense 路径。它是对手动 throw 的语法糖封装。

**多出的能力**：
1. **可在条件语句和循环中使用** —— 手动 throw 会跳出整个函数体；use 在第二次调用时发现 status=fulfilled 直接 return，控制流不被打断
2. **不用自包资源对象** —— 手动 throw 需要 createResource 工厂函数包装 .read()；use 直接传原始 promise
3. **幂等性** —— 同一 promise 多次 use 只在第一次 throw，后续直接返回缓存值

**use 内部机制**：第一次调用时给 promise 对象挂 `.status` 和 `.value`/`.reason`；后续调用根据 status 直接返回或抛出。

</details>

---

## Q8：Suspense 和 Error Boundary 共享什么？区别在哪？它们能嵌套使用吗？

<details>
<summary>点击查看参考答案</summary>

**共享**：
- 同一个 try-catch（`performUnitOfWork` 的 catch 块）
- 同一个入口函数（`throwException`）
- 同样的沿 return 链向上查找模式

**区别**：

| | Error Boundary | Suspense |
|---|---|---|
| 抛出物 | `throw new Error()` | `throw promise` |
| 判断条件 | 无 `.then` 方法 | 有 `.then` 方法 |
| 处理者 | 类组件（componentDidCatch 等）| `SuspenseComponent` fiber |
| 结果 UI | error UI | fallback UI |
| 自恢复 | 不能 | 能（ping 自动重试）|

**能嵌套使用** —— 各管各的，互不干扰。外层 Suspense 捕获内层抛出的 promise，Error Boundary 捕获 Error，两者各走各的 if-else 分支。

典型嵌套：
```jsx
<ErrorBoundary fallback={<ErrorUI />}>
  <Suspense fallback={<Spinner />}>
    <MightThrowPromise />
    <MightThrowError />
  </Suspense>
</ErrorBoundary>
```
</details>

---

## Q9（进阶）：如果子组件 throw 了 promise 但往上找不到 Suspense 边界，会发生什么？

<details>
<summary>点击查看参考答案</summary>

`getSuspenseHandler()` 沿 return 链一路找到 root 都没有 `SuspenseComponent` tag 的 fiber → 返回 null。

此时这个未处理的 promise 会被当作 **unhandled rejection**：
- 开发模式下控制台会打印 warning（类似 unhandled promise rejection）
- 这个 fiber 标记为 Incomplete 但没有边界来处理它
- 整棵 wip 树的状态可能不一致

**所以规则很简单：<Suspense> 必须包住任何可能 throw promise 的组件。** 这就是为什么 React 官方文档反复强调"Suspense 需要 boundary"。

</details>

---

## Q10（进阶）：Legacy 模式和 Concurrent 模式下 Suspense 的关键差异是什么？为什么 Concurrent 模式更流畅？

<details>
<summary>点击查看参考答案</summary>

| | Legacy (ReactDOM.render) | Concurrent (createRoot) |
|---|---|---|
| Fallback 展示时机 | **立即**替换 | **可延迟** ~500ms（拥塞节流）|
| 可被打断 | 不能（同步一口气跑完）| 能（Concurrent 可中断）|
| Ping 机制 | 无（commit 后直接 remount）| 有（attachPingListener 异步调度）|

**为什么 Concurrent 更流畅**：拥塞节流机制 —— 如果一个请求在 ~500ms 内就完成了，fallback 还来不及展示就已经被切换回主内容了。用户根本感知不到"闪烁"。只有真正慢的请求才会展示 fallback。Legacy 模式下即使是 50ms 的请求也会闪一下 fallback，体验差很多。

</details>

---

> **评分标准**：Q1-Q8 为基础题（必须全对），Q9-Q10 为加分题。每题 10 分，满分 100。
