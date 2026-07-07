# Day 12 实验输出记录

> ⚠️ **2026-07-07 更新**：README.md 已改为 Vite/浏览器版实验。之前的 jsdom 版本只能验证"组件被调用、不崩溃"，看不到 SuspenseList 真正的视觉差异——这正是浏览器版要补上的部分。下面先保留 jsdom 版历史记录（作参照），跑完浏览器版后把真实结果填进"浏览器版实测记录"区块。

## 浏览器版实测记录（待填）

### L1：4 种模式下内容出现的真实顺序/时机

（待填）

### L2：有缓存/无缓存的真实表现

（待填）

### L3：A/B/C 三个场景的页面显示

（待填）

---

## jsdom 版历史记录（2026-06-30，保留作参照）

> 环境：react@19 + react-dom@19 + jsdom@22 + Node 18.12

### L1：SuspenseList 三种模式（jsdom 输出）

```
===== L1: SuspenseList 三种模式 =====

--- 场景 A：无 SuspenseList ---
[A (无SuspenseList)] 开始渲染 (ProfileCard:200ms, UserList:400ms, StatsChart:100ms)
[A (无SuspenseList)] root.render() 完成 — 无 SuspenseList

--- 场景 B：revealOrder="together" ---
[B (together)] 开始渲染 (ProfileCard:200ms, UserList:400ms, StatsChart:100ms)
[B (together)] root.render() 完成 — SuspenseList revealOrder="together"
```

**结论**：4 种场景全部没有崩溃，`root.render()` 正常返回，throw 被 Suspense 接住。**但因为 jsdom 没有 Scheduler，看不到内容真正随时间出现的视觉差异**——这正是本次改成浏览器版实验的原因。

### L2：缓存 Map 防死循环（jsdom 输出）

- 场景 A（模拟无缓存路径）：每次 render 都走 fallback
- 场景 B（有缓存）：render 2 **read() 直接返回数据** ✅，render 3 缓存命中 ✅
- 场景 C：id 变化自动发新请求 ✅

**结论**：核心流程验证通过，逻辑层面没问题。浏览器版用真实的 setTimeout+state 驱动，可以更直观地看到"疯狂刷屏"和"命中缓存"的对比。

### L3：ErrorBoundary + Suspense 嵌套（jsdom 输出）

- 场景 A：pending promise → Suspense ✅
- 场景 B：rejected promise → ErrorBoundary ✅
- 场景 C：5 种路由判断测试全 ✅

**结论**：逻辑层面全部通过，浏览器版可以看到真实的红色错误 UI 和 loading UI。
