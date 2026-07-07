# Day 11 实验观察记录

> ⚠️ **2026-07-07 更新**：README.md 已改为 Vite/浏览器版实验。之前 jsdom 版本的最大遗憾是"没有 Scheduler，看不到 fallback 真正切换"——这正是浏览器版要补上的部分。下面先保留 jsdom 版历史记录（结论没变），跑完浏览器版后把真实结果填进"浏览器版实测记录"区块。

## 浏览器版实测记录（待填）

### K1：console 打印顺序 + fallback 显示时长

（待填——重点记录 `[Profile]` 打印了几次、fallback 显示的实际时长是否接近 1.5 秒）

### K2：use() 在 if 分支里是否正常工作 + 缓存命中表现

（待填）

### K3：场景A/B 各自显示什么

（待填）

---

## jsdom 版历史记录（2026-06-26，保留作参照）

> 环境：jsdom + react@19.2.7 + react-dom@19.2.7
> 实验脚本：`k1.mjs`（已删除，逻辑已转换成浏览器版 README.md 里的三个实验）

### K1: Suspense 边界兜底 — throw promise 不崩溃

**真实输出**：
```
===== K1: Suspense 边界兜底验证 =====
[K1] root.render() 成功返回 — 没有未捕获异常 ✅
[K1] Profile 是否被调用: 否
[K1] Fallback 是否被调用: 否 (jsdom 异步调度限制)
[K1] 是否崩溃: 否 ✅
```

**结论**：throw promise 被接住、不崩溃这一点验证了，但 **jsdom 看不到 Profile/Fallback 被真正调用**——这正是本次改成浏览器版的原因。

### K2: React.use(promise) API 可用性

**真实输出**：
```
[K2] React.use 存在: 是 ✅
[K2] fulfilled: thenable=true, 有status字段=true, status="fulfilled"
[K2] pending: thenable=true, 有status字段=false, status="undefined"
[K2] rejected: thenable=true, 有status字段=true, status="rejected"
```

**结论**：只验证了 API 存在和三态字段，**没有真正用 use() 渲染过任何组件**——浏览器版已改成真实渲染场景。

### K3: throwException 路由分流条件

**真实输出**：
```
[K3] ✅ Promise (thenable): typeof .then === 'function'? → true → 走 Suspense
[K3] ✅ Error (普通对象): typeof .then === 'function'? → false → 走 ErrorBoundary
[K3] ✅ 字符串/数字/null: 同上 → 走 ErrorBoundary
[K3] ✅ 自定义 Thenable: typeof .then === 'function'? → true → 走 Suspense
```

**结论**：这个判断条件是纯逻辑验证，jsdom 和浏览器结果应该一致，浏览器版 K3 用真实 ErrorBoundary + Suspense 组件复现了同样的判断。
