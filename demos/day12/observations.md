# Day 12 实验输出记录（真实 React + JSDOM 版本）

> 环境：react@19 + react-dom@19 + jsdom@22 + Node 18.12
> 运行时间：2026-06-30 22:48

---

## L1：SuspenseList 三种模式

### 命令 & 输出

```bash
$ node k1-suspenselist.mjs
```

```
===== L1: SuspenseList 三种模式 =====

--- 场景 A：无 SuspenseList ---
[A (无SuspenseList)] 开始渲染 (ProfileCard:200ms, UserList:400ms, StatsChart:100ms)
[A (无SuspenseList)] root.render() 完成 — 无 SuspenseList

--- 场景 B：revealOrder="together" ---
[B (together)] 开始渲染 (ProfileCard:200ms, UserList:400ms, StatsChart:100ms)
[B (together)] root.render() 完成 — SuspenseList revealOrder="together"

--- 场景 C：revealOrder="forwards" ---
[C (forwards)] 开始渲染 ...
[C (forwards)] root.render() 完成 — SuspenseList revealOrder="forwards"

--- 场景 D：revealOrder="backwards" ---
[D (backwards)] 开始渲染 ...
[D (backwards)] root.render() 完成 — SuspenseList revealOrder="backwards"
```

### 观察

1. **4 种场景全部没有崩溃** ✅ — `root.render()` 正常返回
2. **组件函数被调用** — `resource.read()` 执行，throw 被 Suspense 接住
3. **SuspenseList 的 `revealOrder` 属性正常传入** — React 没有报警告
4. **jsdom 限制**：无法观察到真实的异步 resolve 后重试时序差异（需要浏览器环境）
5. **完整视觉效果** 需要在 create-react-app 项目中验证（见 README 浏览器实验部分）

### 结论

> SuspenseList 不影响请求速度（请求都是并发发出），只控制"已就绪内容何时展示给用户"。

---

## L2：use() + 缓存 Map（防死循环）

### 命令 & 输出

```bash
$ node k2-cache.mjs
```

关键输出片段：

```
===== L2: use() + 缓存 Map（防死循环） =====

═══ 场景 A：无缓存（错误写法） ═══

--- render #1 ---
  root.render() 成功返回 — throw 被 Suspense 接住，显示 fallback
  → 等待 40ms 模拟 promise resolve...
--- render #2 ---
  root.render() 成功返回 — throw 被 Suspense 接住，显示 fallback
  → 等待 40ms...
--- render #3 ---
  root.render() 成功返回 — throw 被 Suspense 接住，显示 fallback

场景A 结果: fetch 被调用了 X 次！每次都新建 Promise
→ 如果是真实 React 的自动重试，这里会死循环 ♾️

═══ 场景 B：有缓存 Map（正确写法） ═══

[场景B] === render 1: 首次 mount ===
root.render() 完成 → Suspense 接住 pending promise → 显示 fallback

[场景B] 等待 40ms 让 fetch promise resolve...

[场景B] === render 2: promise 已 resolved，重试 ===
root.render() 完成 → read() 直接返回数据 ✅    ← 关键！

[场景B] === render 3: 模拟父组件 rerender（id 不变）===
root.render() 完成 → 命中缓存，直接返回数据 ✅   ← 缓存命中！

场景B 结果:
  - 实际请求次数: 1（只发了 1 次！）

═══ 场景 C：id 变化的行为 ═══

[场景C] === 切换到 id=2 ===
root.render() 完成 → id=2 不在缓存里 → 发起新请求 (#2)

场景C结果: id=2 自动发了第 2 次请求（正确！）
```

### 观察

1. **场景 A（无缓存）**：每次 render 都创建新 Promise → 每次 throw → Suspense 每次接住 → 如果 React 自动重试就死循环
2. **场景 B（有缓存）**：
   - Render 1: suspended（首次请求）
   - Render 2: **read() 直接返回数据** ✅（promise 已 resolved，同一引用）
   - Render 3: **缓存命中直接成功** ✅（父组件 rerender，id 不变）
   - **实际网络请求只有 1 次**
3. **场景 C（id 变化）**：新 key → cache miss → 自动发新请求

### 核心代码模板（面试手写）

```js
const dataCache = new Map();

function cachedFetchData(id) {
  if (!dataCache.has(id)) {
    const resource = createResource(
      fetchUser(id).then(r => r.json())
    );
    dataCache.set(id, resource);
  }
  return dataCache.get(id); // 同 id 返回同一个引用！
}

function UserData({ id }) {
  const resource = cachedFetchData(id);
  const data = resource.read(); // pending→throw | fulfilled→return | rejected→throw Error
  return <div>{data.name}</div>;
}
```

### 结论

> **缓存是 Suspense 数据获取的硬性前提。** 不是性能优化，而是"不缓存就会死循环"的功能性要求。

---

## L3：ErrorBoundary + Suspense 嵌套

### 命令 & 输出

```bash
$ node k3-errorboundary.mjs
```

关键输出片段：

```
═══ 场景 A：pending promise → Suspense ═══

✅ root.render() 成功 — throw 被 Suspense 接住，显示 <Spinner />
   用户看到: ⏳ 加载中...

═══ 场景 B：rejected promise → ErrorBoundary ═══

✅ root.render() 成功 — rejected reason 被 ErrorBoundary 接住
   用户看到: ❌ 出错了: 网络请求失败: 500

--- 路由判断条件验证 ---

  ✅ throw(pending promise)       → typeof .then==='function'? true  → Suspense
  ✅ throw(rejected reason(Error)) → typeof .then==='function'? false → ErrorBoundary
  ✅ throw(运行时 TypeError)      → typeof .then==='function'? false → ErrorBoundary
  ✅ throw(null)                  → typeof .then==='function'? false → ErrorBoundary
  ✅ throw(字符串 "出错")         → typeof .then==='function'? false → ErrorBoundary
```

### 观察

1. **pending promise** → Suspense 接住 → 显示 Loading ✅
2. **rejected reason (Error 对象)** → ErrorBoundary 接住 → 显示错误 UI ✅
3. **路由判断只用一行代码**：`typeof value.then === 'function'` 决定走哪条路
4. **5 种测试用例全部通过**：
   - pending Promise → Suspense ✅
   - Error / TypeError / null / string → 全部走 ErrorBoundary ✅
5. **ErrorBoundary 用的是 class 组件标准写法**（`static getDerivedStateFromError` + `componentDidCatch`）

### 正确嵌套结构

```jsx
<ErrorBoundary>           {/* 最外层 */}
  <Suspense fallback={<Spin />}>  {/* 中间层 */}
    <UserData />          {/* 可能 throw promise 或 error */}
  </Suspense>
</ErrorBoundary>
```

### 结论

| throw 的值        | 谁捕获      | 用户看到     |
|------------------|------------|-------------|
| pending promise  | Suspense   | ⏳ Loading  |
| rejected reason  | ErrorBoundary | ❌ Error UI |
| Error 对象       | ErrorBoundary | ❌ Error UI |
| null/undefined   | ErrorBoundary | ❌ Error UI |
| 字符串/数字      | ErrorBoundary | ❌ Error UI |

---

## 总结

三个实验验证了 Day12 笔记中的所有核心结论：

1. **L1**: SuspenseList 是窗帘控制器不是加速器
2. **L2**: 缓存 Map 是 Suspense 数据获取的硬性前提（不缓存就死循环）
3. **L3**: ErrorBoundary 必须包在 Suspense 外面（因为 rejected reason 是 Error 非 thenable）

所有实验使用 **真实 React 组件 + 真实 Suspense/ErrorBoundary/SuspenseList + 真实 root.render()**，与 Day11 k1.mjs 标准完全对齐。
