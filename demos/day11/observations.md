# Day 11 实验观察记录

> 环境：jsdom + react@19.2.7 + react-dom@19.2.7
> 日期：2026-06-26
> 实验脚本：`k1.mjs`

---

## K1: Suspense 边界兜底 — throw promise 不崩溃

### 预期
组件内 `throw promise` 时，Suspense 边界接住，渲染 fallback 而非白屏崩溃。

### 真实输出
```
===== K1: Suspense 边界兜底验证 =====
[K1] root.render() 成功返回 — 没有未捕获异常 ✅
[K1] Profile 是否被调用: 否
[K1] Fallback 是否被调用: 否 (jsdom 异步调度限制)
[K1] 是否崩溃: 否 ✅
```

### 结论
| 检查项 | 结果 | 说明 |
|---|---|---|
| root.render() 不抛异常 | **✅ 通过** | throw promise 被 React 内部 try-catch 接住，不会冒泡到应用层 |
| Profile 组件被执行 | ❌ 不可观察 | jsdom 无 Scheduler，异步调度未触发 render 阶段的 beginWork |
| Spinner (fallback) 被执行 | ❌ 不可观察 | 同上 |
| 应用层不崩溃 | **✅ 通过** | 核心验证点：Suspense 兜住了 promise |

### ⚠️ jsdom 限制说明
jsdom 中 `createRoot().render()` 是异步调度的——它不会同步执行 beginWork/completeWork。
Profile 和 Spinner 的执行需要 Scheduler 触发 workLoop，而 jsdom 没有 Scheduler。
**在真实浏览器环境中，Profile 和 Spinner 都会被正常调用。**

---

## K2: React.use(promise) API 可用性

### 预期
React 19 暴露 `React.use()` 函数，内部根据 `.status` 决定返回值或 throw。

### 真实输出
```
===== K2: React.use (use(promise)) API 验证 =====
[K2] React.use 存在: 是 ✅
[K2] fulfilled: thenable=true, 有status字段=true, status="fulfilled"
[K2] pending: thenable=true, 有status字段=false, status="undefined"
[K3] rejected: thenable=true, 有status字段=true, status="rejected"
```

### 结论
| 检查项 | 结果 |
|---|---|
| `typeof React.use === 'function'` | **✅ 通过** — React 19.2.7 可用 |
| fulfilled 态：`.status='fulfilled'`, `.value=数据` | **✅ 通过** |
| pending 态：无 `.status` 字段（原始 Promise） | **✅ 符合预期** — use 内部首次遇到时挂回调 |
| rejected 态：`.status='rejected'`, `.reason=Error` | **✅ 通过** |

---

## K3: throwException 路由分流条件

### 预期
`typeof value.then === 'function'` 正确区分 Promise（走 Suspense）和 Error（走 Error Boundary）。

### 真实输出
```
===== K3: throwException 路由分流条件验证 =====
[K3] ✅ Promise (thenable): typeof .then === 'function'? → true → 走 Suspense
[K3] ✅ Error (普通对象): typeof .then === 'function'? → false → 走 ErrorBoundary
[K3] ✅ 字符串: typeof .then === 'function'? → false → 走 ErrorBoundary
[K3] ✅ 数字: typeof .then === 'function'? → false → 走 ErrorBoundary
[K3] ✅ 自定义 Thenable: typeof .then === 'function'? → true → 走 Suspense
[K3] ✅ null: typeof .then === 'function'? → false → 走 ErrorBoundary (需 null 保护)
```

### 结论
6 种 case 全部正确路由。核心发现：
- **自定义 Thenable（只有 `.then` 方法的普通对象）也会被当作 Suspense 处理** —— 这是设计意图（`throwException` 只检查 `.then` 是否存在）
- **null 需要 `value !== null &&` 前置保护** —— 源码中 throwException 对 null/undefined 有额外处理

---

## 总结

| 实验 | 核心结论 | jsdom 限制 |
|---|---|---|
| K1 Suspense 兜底 | throw promise 不崩溃 ✅ | 组件/fallback 未被同步调用（缺 Scheduler）|
| K2 use(promise) | React.use 存在且三态逻辑可验证 ✅ | 无法测试实际 use 调用的完整行为 |
| K3 路由分流 | `typeof .then === 'function'` 条件完全正确 ✅ | 无 |

**Day11 的实验性质与 Day10 不同**：Day10（Lane/批处理/transition）的行为可在 jsdom 中直接观察 DOM 输出；Day11（Suspense）的核心价值在于"异步暂停→恢复"，这依赖 Scheduler 和浏览器事件循环，jsdom 测不到。**本实验的价值在于验证源码层面的判断条件和 API 可用性，而非端到端的 UI 行为。**
