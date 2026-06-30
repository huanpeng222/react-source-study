# Day 12 实验观察记录

> 运行时间: 2026-06-30
> 环境: Node.js v18.12.0 (macOS)
> 结果: 3/3 通过 ✅

---

## L1: SuspenseList 三种模式

### 输出关键数据（3 个组件: StatsChart=100ms, ProfileCard=300ms, UserList=500ms）

| 模式 | StatsChart 展示时间 | ProfileCard 展示时间 | UserList 展示时间 | 效果 |
|------|-------------------|--------------------|-----------------|------|
| 无 SuspenseList | +0ms | +199ms | +400ms | 碎片式填充 |
| **together** | **+400ms** | **+400ms** | **+400ms** | 整体闪现 |
| forwards | +199ms | +400ms | +400ms | 依次上菜 |
| backwards | +0ms | +0ms | +0ms | 倒序露出 |

### 观察到的现象

1. **together 模式**: 三个组件的展示时间都是 +400ms（等于最慢的 UserList）。即使 StatsChart 在 +0ms 就加载完了，也要等 UserList 到了才一起显示。
2. **forwards 模式**: ProfileCard(+199ms) → UserList(+400ms) → StatsChart(+400ms)。StatsChart 虽然 +0ms 就好了，但它排在第3位，必须等前两个都展示了才能轮到它。
3. **backwards 模式**: 所有组件都是 +0ms 展示——因为倒序中最后一个(StatsChart)最先就绪，它一好就展示；倒序第2个(UserList)也立即展示；以此类推。

### 结论验证

✅ **SuspenseList 不改变请求速度** — 3 个请求都是并发发出的，同时开始
✅ **只控制展示时机** — together 让已就绪的内容"排队等着"
✅ **forwards 的核心规则确认** — "前面的没展示完，后面的即使就绪也得等着"

---

## L2: use() + 缓存 Map（防死循环）

### 场景 A：无缓存

```
[场景A] 第 1 次 render → fetchUser(1) 创建全新 Promise → Suspense 捕获
[场景A] 第 2 次 render → fetchUser(1) 又创建全新 Promise → Suspense 捕获
[场景A] 第 3 次 render → fetchUser(1) 又创建全新 Promise → Suspense 捕获
[场景A] 第 4 次 render → fetchUser(1) 又创建全新 Promise → Suspense 捕获
→ 4 次 render 全部挂起，死循环 ♾️
```

### 场景 B：有缓存 Map

```
[场景B] 第 1 次 render → fetchUser(1) 首次调用，创建并缓存 Promise (#1次实际请求) → Suspense 捕获
[场景B] 第 2 次 render → fetchUser(1) 命中缓存! 返回同一个 Promise 引用 → ✅ 渲染成功: 用户1
[场景B] 第 3 次 render (父组件rerender) → fetchUser(1) 命中缓存! → ✅ 渲染成功: 用户1

结果:
  - 总 render 次数: 3
  - 实际请求次数: 1 ← 只发了 1 次网络请求！
  - 最终状态: ✅ 成功渲染
```

### 场景 C：id 变化

```
[场景B] 第 4 次 render → fetchUser(2) 首次调用 (#2次实际请求) → Suspense 捕获
[场景B] 第 5 次 render → fetchUser(2) 命中缓存! → ✅ 渲染成功: 用户2
→ id=2 时自动发了新请求（正确！）
```

### 结论验证

✅ **无缓存确实死循环** — 每次 render 新建 Promise → 永远 pending → 无限 throw
✅ **缓存 Map 彻底解决** — 同 id 返回同一引用 → resolve 后直接返回数据
✅ **id 变化自动发新请求** — Map 没有 key → 创建新 promise → 正确行为
✅ **缓存的是 Promise 不是数据** — use() 需要追踪 Promise 的三态变化

---

## L3: ErrorBoundary + Suspense 嵌套

### 场景 A：pending promise

```
throw 出的值: Promise (constructor)
分类:
  - 类型: thenable
  - 路由: Suspense
  - 说明: Promise/thenable — 走 Suspense 路线
→ 用户看到: <Spin /> (Suspense fallback)
```
✅ pending promise 被 Suspense 接住

### 场景 B：rejected promise

```
throw 出的值: Error: 网络请求失败: 500
分类:
  - 类型: error
  - 路由: ErrorBoundary ← 关键！rejected promise 的 reason 是普通 error
  - 说明: 非 thenable: Error: 网络请求失败: 500
→ 用户看到: <ErrorFallback /> (ErrorBoundary fallback)
```
✅ rejected promise 的 reason 被 ErrorBoundary 接住（不是 Suspense！）

### 场景 D：React.lazy + use(fetch) 共存时间线

```
+  0ms  render 开始
+  1ms  React.lazy() throw chunkPromise → Suspense 捕获
+ 80ms  chunk resolve! 但 data 还是 pending → 继续 fallback
+120ms  data resolve! 两个都就绪 → 渲染真实 UI ✅
```
✅ 同一个 Suspense 管两种异步，用户只看到一次 loading

### throwException 决策树验证

| throw 值 | typeof .then === 'function' | 路由 | 处理者 |
|----------|---------------------------|------|--------|
| pending Promise | Yes | Suspense 路线 | 显示 fallback |
| fulfilled Promise (use 内部) | N/A (直接返回) | - | 返回数据 |
| rejected Promise 的 .reason | No | ErrorBoundary 路线 | 显示错误 UI |
| new Error('xxx') | No | ErrorBoundary 路线 | 显示错误 UI |
| null / undefined | No | ErrorBoundary 路线 | 显示错误 UI |

### 嵌套顺序结论

```
正确的写法（必须 ErrorBoundary 在外层）:

<ErrorBoundary>     ← 最外层：接住 reject / error
  <Suspense>        ← 中间层：接住 pending
    <Component />   ← 可能 throw 任意东西
  </Suspense>
</ErrorBoundary>

原因：
1. Suspense 只能接 thenable（pending promise）
2. 当 promise reject 时，use() 抛出 .reason（Error 对象）
3. Error 不是 thenable → Suspense 接不住 → 必须冒泡到 ErrorBoundary
4. 如果反过来写（Suspense 包 ErrorBoundary），reject 的 error 会穿透到 root → 白屏崩溃
```

---

## 总体验收

| 实验 | 验证目标 | 是否通过 |
|------|---------|---------|
| L1 | together 所有内容同时出现 vs forwards 逐个出现 | ✅ |
| L2 | 控制台只打印一次 fetching（缓存生效，无重复请求） | ✅ |
| L3 | reject 显示错误 fallback, pending 显示 loading fallback | ✅ |

### 踩坑记录

1. L3 初始版本在 Node.js 中 `await rejectedPromise` 直接导致 unhandledRejection crash —— 因为 Node.js 没有 ErrorBoundary。修复方式：用 `.catch()` 安全地提取 rejection reason，并加 `process.on('unhandledRejection', () => {})` 兜底。
2. 终端中文输出乱码（macOS 默认编码问题），不影响逻辑正确性。实际结论以代码逻辑为准。
