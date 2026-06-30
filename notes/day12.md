# Day 12 笔记：SuspenseList + 自定义 Suspense 实战

> 日期：2026-06-28
> 主题：SuspenseList 的多边界协调、自定义 Suspense 数据获取模式、React.lazy + use() 完整案例
> 状态：✅ 已完成（含 L1/L2/L3 三组实验）
> 源码出处：
> - `packages/react-reconciler/src/ReactFiberBeginWork.js`（updateSuspenseListComponent）
> - `packages/react-reconciler/src/ReactFiberCommitWork.js`（commitSuspenseList）
> - `packages/react-reconciler/src/ReactFiberHooks.js`（mountUse）
> - `packages/react-reconciler/src/ReactFiberThrow.js`（throwException — 复用 Day11）

---

## 零、入场自测（先答，不会就写"不会"）

1. 如果页面上有 3 个并排的 `<Suspense>` 区域，各自加载一个数据组件。默认情况下它们各自显示 fallback——先加载完的先展示。如果想让**3 个区域全部加载完才统一展示**（避免页面东一块西一块的填充效果），该怎么做？

2. `<SuspenseList>` 有几种 `revealOrder` 模式？`tail` 属性是做什么的？

3. 在 Day11 你学了 `use(promise)` 底层还是 throw promise。那如果我想在 `<Suspense>` 里直接用 `use()` 获取数据，数据缓存怎么做？每次 render 都 `use(fetchUser(id))` 会不会无限循环？

4. 一个页面同时有 `React.lazy()` 懒加载组件 + `use(fetchData())` 数据请求，它们在 Suspense 边界下怎么共存？

---

## 一、SuspenseList：协调多个 Suspense 边界

### 1.1 问题场景

你的页面有 3 个数据组件，各自被 `<Suspense>` 包裹：

```jsx
<>
  <Suspense fallback={<CardSkeleton />}>
    <ProfileCard />
  </Suspense>
  <Suspense fallback={<ListSkeleton />}>
    <UserList />
  </Suspense>
  <Suspense fallback={<ChartSkeleton />}>
    <StatsChart />
  </Suspense>
</>
```

默认行为：每个 Suspense 边界独立工作——谁先加载完谁先展示。结果可能是：

```
[14:00:01] StatsChart 加载完成 → 展示
[14:00:02] ProfileCard 加载完成 → 展示
[14:00:05] UserList 加载完成 → 展示
```

用户体验：**内容碎片式填充**。用户看到页面东一块西一块地跳出来，视觉流很差。

### 1.2 SuspenseList 的解法

```jsx
import { SuspenseList } from 'react';   // React 18+ (experimental → stable)

<SuspenseList revealOrder="together">
  <Suspense fallback={<CardSkeleton />}><ProfileCard /></Suspense>
  <Suspense fallback={<ListSkeleton />}><UserList /></Suspense>
  <Suspense fallback={<ChartSkeleton />}><StatsChart /></Suspense>
</SuspenseList>
```

效果：**3 个都加载完 → 一起展示**。用户只看到一个"整体内容突然完整呈现"。

### 1.3 revealOrder 的三种模式

| 模式 | 行为 | 类比 | 适用场景 |
|---|---|---|---|
| `"together"` | 所有子 Suspense 都就绪后，**一起展示** | 拉上窗帘→全部摆好→一次性拉开 | 页面多个模块一起呈现，不零碎 |
| `"forwards"` | 按子 **顺序**依次展示（先就绪的先展示，但以模板为准） | 逐个上菜 | 侧边栏先加载，再加载主要区域 |
| `"backwards"` | 按子 **倒序**依次展示（最后就位的最先展示） | 倒油条 | 大卡片后面就绪的小图标先显示 |

补充：`tail` 属性

```jsx
<SuspenseList revealOrder="forwards" tail="collapsed">
```

- `tail="collapsed"`：已经就绪的不显示 fallback（显示内容），**还未就绪的显示一个合并的 fallback**（不各自显示很多个 skeleton）
- `tail="hidden"`：同上，但还未就绪的一概不显示（连 fallback 都隐藏）

### 1.4 SuspenseList 的 Fiber 实现

**SuspenseList 不是 Suspense 的容器**——它本身不是一个单独的 Suspense 边界。它是一个**协调器**：

```
<SuspenseList> fiber
  │
  ├─ <Suspense> fiber (ProfileCard)    ← 每个子 Suspense 保持独立
  ├─ <Suspense> fiber (UserList)          ← 各自的 fallback/primary 切换
  └─ <Suspense> fiber (StatsChart)        ← 正常的 Promise → fallback → resolve 行为
```

源码中（`ReactFiberBeginWork.js` `updateSuspenseListComponent`）：
- SuspenseList 内部维护一个**就绪队列**（`SuspenseList` 类型的 fiber 在 `memoizedState` 里存当前已就绪的子 Suspense 列表）
- 当子 Suspense 发出"我好了"信号（ping），SuspenseList 检查它的 `revealOrder` 策略：
  - `"together"`：等所有子 Suspense 都就绪了，才把它们一起"reveal"
  - `"forwards"`：从第一个子开始，按顺序逐个 reveal（前面的没做就不能 reveal 后面的）
  - `"backwards"`：从最后一个子开始，倒序 reveal

⭐ **核心**：SuspenseList **不改变**子 Suspense 的 resolve 速度（数据该什么时候好还什么时候好），它**只控制展示时机**——准备好的内容在内存中排队等着，直到满足 reveal 条件才展示给用户。

### 1.5 SuspenseList 何时生效、何时无效

| 场景 | 是否生效 | 原因 |
|---|---|---|
| 直接子节点是 `<Suspense>` | ✅ 生效 | SuspenseList 只监控直接子 Suspense 边界 |
| 子节点里有 `<Suspense>` 但被 `<div>` 包着 | ❌ 不生效 | SuspenseList 只影响直接子节点 |
| 子节点不是 Suspense 但会 throw promise | ❌ 不生效 | 非直接子 Suspense 不纳入协调 |

---

## 二、自定义 Suspense 数据获取模式

### 2.1 问题回顾：为什么普通 fetch 不能直接和 Suspense 配合？

```jsx
function ProfileCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetchUser(id).then(setData);
  }, []);
  if (!data) throw fetchUser(id);   // ❌ 每次 render 都发起新请求
  return <div>{data.name}</div>;
}
```

**死循环**：render → throw promise → Suspense 捕获 → fallback → promise resolve → 重渲染 → render 又调 `fetchUser(id)` 返回 **新 promise** → 再 throw → 无限循环。

**关键**：必须保证两次 render 拿到的是**同一个 promise 实例**（Day11 纠正 #70 说的）。

### 2.2 模式 A：使用外部缓存（最推荐，SWR/RTK Query）

```jsx
import useSWR from 'swr';

function ProfileCard() {
  const { data } = useSWR('/api/user', fetcher);
  if (!data) throw useSWR('/api/user', fetcher).data; // swr 会在 cache miss 时抛异常？
  return <div>{data.name}</div>;
}
```

但这种写法还是略显 hack。更好的方式是让 **Suspense + use() + 缓存** 三层组合：

```jsx
// 缓存层
const cache = new Map();
function fetchWithSuspense(key, fetcher) {
  const cached = cache.get(key);
  if (cached) return cached;           // 有缓存 → 返回缓存 promise
  const fresh = fetcher();
  cache.set(key, fresh);               // 缓存 promise（不是 data！）
  throw fresh;                         // 或 return fresh 让 use() 消费
}
```

### 2.3 模式 B：React 19 use(promise) + 缓存 Map

这是 Day12 今天要掌握的完整案例：

```jsx
// ============ 数据缓存层（必需） ============
const dataCache = new Map();

function fetchData(key, fetcher) {
  if (!dataCache.has(key)) {
    dataCache.set(key, fetcher());   // 存的是 promise，不是 data
  }
  return dataCache.get(key);         // 保证同一 key 返回同一 promise 引用
}

// ============ 业务组件 ============
function User({ id }) {
  const userPromise = fetchData(`user:${id}`, () =>
    fetch(`/api/user/${id}`).then(r => r.json())
  );
  const user = use(userPromise);      // React 19 的 use()
  return <div>{user.name}</div>;
}

function App() {
  return (
    <Suspense fallback={<Spin />}>
      <User id={1} />
    </Suspense>
  );
}
```

**流程分析**：
1. 第一次 render `User(1)`：
   - `dataCache` 没缓存 → `fetchData` 发起请求，存 promise 进 Map，**返回 pending promise**
   - `use(promise)` → promise 无 `status` → 挂回调 → `throw promise`
   - Suspense 捕获 → 显示 `<Spin />`
2. promise resolve：
   - `use()` 内部回调给 promise 挂上 `status='fulfilled'` + `value=data`
   - `ping` 触发重渲染
3. 第二次 render `User(1)`：
   - `fetchData` 从 Map 拿到**同一个 promise 引用**
   - `use(promise)` → `promise.status === 'fulfilled'` → 直接返回 `promise.value`
   - 正常渲染 `<div>张三</div>`

### 2.4 模式 C：React.lazy + 数据请求的组合

实际业务中一个懒加载组件通常需要同时做这两件事：
1. 异步加载 JS 模块（`React.lazy`）
2. 异步获取数据（`use(fetch())`）

两者可以共存于同一个 `<Suspense>` 边界下：

```jsx
// ============ 懒加载组件（JS + 数据都异步） ============
// LazyUserProfile.jsx
function LazyUserProfile({ id }) {
  const user = use(fetchWithCache(`user:${id}`, fetchUser));
  const posts = use(fetchWithCache(`posts:${id}`, fetchPosts));
  return (
    <div>
      <h1>{user.name}</h1>
      <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>
    </div>
  );
}

// ============ 父组件 ============
const LazyUser = lazy(() => import('./LazyUserProfile'));

function App() {
  return (
    <Suspense fallback={<BigSkeleton />}>
      {/* JS 模块加载 AND 数据加载，都在同一个 Suspense 边界下处理 */}
      <LazyUser id={123} />
    </Suspense>
  );
}
```

| 阶段 | 发生了什么 | 用户看到 |
|---|---|---|
| 初始 | React.lazy 未加载，throw promise（chunk 加载） | BigSkeleton |
| Chunk 加载完 | lazy 组件加载，开始 render | 仍 BigSkeleton（数据还在请求） |
| `use(fetchUser)` | promise pending → throw → Suspense 捕获 | 仍 BigSkeleton |
| 数据 resolve | 重渲染 → use 返回数据 | 真实 UI 展示 |

⭐ **同一个 Suspense 边界，管两件事：JS 模块加载 + 数据加载。用户只经历一次 fallback。**

---

## 三、Suspense + 错误处理最佳实践

Suspense 本身不处理错误。当：

```jsx
function User({ id }) {
  const user = use(fetchUser(id));  // 假设 fetch 失败 → promise rejected
  // 触发 ping → 重试 → use() 发现 status='rejected' → throw promise.reason
  // → Error（非 thenable）→ throwException 走 ErrorBoundary 路线
}
```

所以生产代码应该同时用 Error Boundary + Suspense：

```jsx
<ErrorBoundary fallback={<ErrorFallback />}>
  <Suspense fallback={<Spin />}>
    <User id={123} />
  </Suspense>
</ErrorBoundary>
```

| 情况 | 谁接住 | 什么表现 |
|---|---|---|
| `use(promise)` → promise pending | Suspense | 显示 `<Spin />` |
| `use(promise)` → promise reject | ErrorBoundary | 显示 `<ErrorFallback />` |
| `React.lazy()` → chunk 加载失败 | ErrorBoundary | 显示 `<ErrorFallback />` |
| `use(promise)` → promise resolve | 都没触发 | 正常渲染 |

---

## 四、动手实验

详见 `demos/day12/README.md`，3 个实验：

| 实验 | 内容 | 验证什么 |
|---|---|---|
| L1 | SuspenseList together 模式 | 多个 Suspense 边界统一展示 |
| L2 | use(promise) + 缓存 Map | 自定义 Suspense 数据获取（防无限循环） |
| L3 | ErrorBoundary + Suspense 嵌套 | 错误 → ErrorBoundary / 挂起 → Suspense |

---

## 五、我之前以为 …，其实是 …（跟练后回填）

1. **我以为** SuspenseList 会让子 Suspense 的请求也串行——**其实** 所有请求同时发起（并发），SuspenseList 只控制**展示时机**不控制加载时间。
2. **我以为** `revealOrder="forwards"` 是"谁先加载完谁先展示"——**其实** 那是默认行为（无 SuspenseList）。forwards 是"按 DOM 顺序，前面的没就绪后面的不能 reveal"。
3. **我以为** 在 Suspense 里用 `use(fetch())` 需要额外包装——**其实** 只需一个**缓存 Map**保证 promise 引用不变即可，`use()` 内部自动处理三态。

---

## 六、验收清单

- [ ] 能说出 SuspenseList 的 3 种 revealOrder 模式及其用途
- [ ] 能解释 SuspenseList 只控制展示时机、不影响加载时机
- [ ] 能写出 use(promise) + 缓存 Map 的自定义数据获取模式
- [ ] 能说出 Suspense + ErrorBoundary 的正确嵌套组合
- [ ] 能解释同一个 Suspense 边界同时管理 lazy + data fetching 的流程
- [ ] 完成 3 个实验

---

## 七、Day 13 预告

**主题**：React 19 全新特性（Actions / useActionState / useFormStatus / useOptimistic / Server Components）
**预读问题**：
1. React 19 的 `<form>` action 和 `<button formAction>` 是什么？
2. `useActionState` 和 `useReducer` 有什么区别？
3. Server Components 和传统 SSR 的根本区别是什么？
