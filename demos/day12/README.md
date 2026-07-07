# Day 12 实验：SuspenseList + 自定义 Suspense 实战

> 代码贴进 Vite + React playground（浏览器里跑）。

## 环境准备（如果还没有 playground）

```bash
cd demos/day12
npm create vite@latest playground -- --template react
cd playground
npm install
npm run dev
```

---

## 实验 L1：SuspenseList 三种 revealOrder 模式

**目标**：观察 3 个 Suspense 区域在 together / forwards / backwards 下的展示差异——之前 jsdom 版本只能验证"不崩溃"，看不到真正的视觉差异，这次在浏览器里补上。

```jsx
import React, { Suspense, useState, useEffect } from 'react';

// ============ 数据组件工厂 ============
function createDataComp(name, delay) {
  return function DataComp() {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      const t = setTimeout(() => {
        console.log(`[${name}] 数据就绪 (${delay}ms)`);
        setReady(true);
      }, delay);
      return () => clearTimeout(t);
    }, []);
    if (!ready) {
      throw new Promise(r => setTimeout(r, delay)); // Suspense trigger
    }
    return <div style={{ padding: '4px 0' }}>✅ {name} 内容</div>;
  };
}

const Spinner = () => <div style={{ color: '#999' }}>⏳ 加载中...</div>;

// ============ App ============
export default function App() {
  const [mode, setMode] = useState('none');

  // 每次切换模式重新创建组件（重置状态）
  const ProfileCard = createDataComp('ProfileCard', 200);  // 中速
  const UserList = createDataComp('UserList', 400);        // 最慢
  const StatsChart = createDataComp('StatsChart', 100);     // 最快

  return (
    <div style={{ padding: 20 }}>
      <h2>SuspenseList revealOrder 对比</h2>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <button onClick={() => setMode('none')}>无 SuspenseList</button>
        <button onClick={() => setMode('together')}>together</button>
        <button onClick={() => setMode('forwards')}>forwards</button>
        <button onClick={() => setMode('backwards')}>backwards</button>
      </div>

      <p>当前模式: <strong>{mode}</strong></p>
      <hr />

      {mode === 'none' ? (
        <Suspense fallback={<Spinner />}>
          <ProfileCard />
          <UserList />
          <StatsChart />
        </Suspense>
      ) : (
        <React.SuspenseList revealOrder={mode}>
          <Suspense fallback={<Spinner />}><ProfileCard /></Suspense>
          <Suspense fallback={<Spinner />}><UserList /></Suspense>
          <Suspense fallback={<Spinner />}><StatsChart /></Suspense>
        </React.SuspenseList>
      )}
    </div>
  );
}
```

**操作步骤**：

1. 打开 DevTools Console（看 `[name] 数据就绪` 日志）。
2. **依次点 4 个按钮**，每次点后盯着页面看内容出现的**顺序和时机**。
3. 重点对比 **none vs together** 的视觉差异最明显。

**要观察的差异**：

| 模式 | 预期表现 |
|---|---|
| none | StatsChart(100ms) 最先出现 → 然后 ProfileCard(200ms) → 最后 UserList(400ms)，碎片式填充 |
| together | 等最慢的 UserList(400ms) 就绪后，3 个**同时闪现** |
| forwards | 按 DOM 顺序，StatsChart 先就绪但得等 ProfileCard 展示完才能轮到它 |
| backwards | 倒序，UserList 最先有机会露面 |

**记录到 observations.md**：4 种模式下，内容出现的真实顺序和时机分别是什么？跟预期一致吗？

---

## 实验 L2：缓存 Map 防死循环

**目标**：验证无缓存会死循环 / 有缓存只请求一次 / id 变化发新请求。

```jsx
import React, { Suspense, useState } from 'react';

// ============ 缓存层（核心！）============
const dataCache = new Map();

function cachedFetch(id) {
  if (!dataCache.has(id)) {
    console.log(`[缓存] fetchUser(${id}) — 首次请求！创建新 Promise`);
    const p = new Promise(resolve => {
      setTimeout(() => resolve({ id, name: `用户${id}` }), 500);
    });
    dataCache.set(id, p);
  } else {
    console.log(`[缓存] fetchUser(${id}) — 命中缓存！返回同一引用 ✅`);
  }
  return dataCache.get(id);
}

// ❌ 无缓存写法（演示死循环根因）
let naiveCount = 0;
function naiveFetch(id) {
  naiveCount++;
  console.log(`[无缓存] fetchUser(${id}) — 第 ${naiveCount} 次！每次新建 Promise`);
  return new Promise(resolve => {
    setTimeout(() => resolve({ id, name: `用户${id}` }), 300);
  });
}

// ============ 组件 ============
function NaiveUser({ id }) {
  console.log(`  [NaiveUser] render(id=${id})`);
  const p = naiveFetch(id);           // ← 每次 render 新建！
  throw p;   // 简化：直接 throw，永远不会真正 resolve 出结果
}

function CachedUser({ id }) {
  console.log(`  [CachedUser] render(id=${id})`);
  const p = cachedFetch(id);          // ← 同 id 同引用
  if (p.status !== 'fulfilled') {
    if (!p.status) {
      p.status = 'pending';
      p.then(v => { p.status = 'fulfilled'; p.value = v; });
    }
    throw p;
  }
  return <div style={{ color: 'green' }}>✅ {p.value.name}</div>;
}

const Spinner = () => <div>⏳ 加载中...</div>;

// ============ App ============
export default function App() {
  const [scenario, setScenario] = useState('cached');
  const [id, setId] = useState(1);
  const key = `${scenario}-${id}`; // 强制 remount

  return (
    <div style={{ padding: 20 }}>
      <h2>缓存 Map 防死循环</h2>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <b>场景:</b>
        <button onClick={() => { setScenario('cached'); setId(1); }}>
          ✅ 有缓存 (id=1)
        </button>
        <button onClick={() => { setScenario('cached'); setId(2); }}>
          🔄 切换 id=2
        </button>
        <button onClick={() => { setScenario('naive'); setId(1); }}>
          ❌ 无缓存（看控制台疯狂刷）
        </button>
      </div>

      <p>当前: scenario=<strong>{scenario}</strong>, id=<strong>{id}</strong></p>

      <Suspense fallback={<Spinner />} key={key}>
        {scenario === 'cached'
          ? <CachedUser id={id} />
          : <NaiveUser id={id} />
        }
      </Suspense>
    </div>
  );
}
```

**操作步骤**：

1. 打开 DevTools Console。
2. 默认进入"✅ 有缓存"模式 → 观察是否只有 **1 次** `fetchUser(1) — 首次请求`。
3. 点"🔄 切换 id=2" → 观察是否打印了 `fetchUser(2) — 首次请求`（新 id 正确发新请求）。
4. （可选，小心）点"❌ 无缓存" → 观察 Console 是否疯狂刷屏（死循环现场）。⚠️ 如果页面卡住，赶紧切回"✅ 有缓存"。

**记录到 observations.md**：有缓存模式下，`fetchUser(1)` 真的只打印了一次吗？无缓存模式下控制台刷了多少次（或者浏览器直接卡死）？

---

## 实验 L3：ErrorBoundary + Suspense 嵌套

**目标**：验证 pending→Suspense 接住 / reject→ErrorBoundary 接住。

```jsx
import React, { Component, Suspense, useState } from 'react';

// ============ ErrorBoundary ============
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] 捕获到错误:', error.message);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: 12, border: '1px solid red' }}>
          ❌ 出错了: {this.state.error.message}
          <button onClick={() => this.setState({ hasError: false, error: null })}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============ 数据组件 ============
function PendingUser() {
  console.log('[PendingUser] render → throw pending promise');
  throw new Promise(() => {}); // 永远不 resolve
}

function RejectUser() {
  console.log('[RejectUser] render → throw rejected promise');
  throw Promise.reject(new Error('网络请求失败: 500'));
}

function SuccessUser() {
  console.log('[SuccessUser] render → 正常返回');
  return <div style={{ color: 'green' }}>✅ 用户数据加载成功</div>;
}

const Spinner = () => <div style={{ color: '#999' }}>⏳ Loading...</div>;

// ============ App ============
export default function App() {
  const [scene, setScene] = useState('pending');

  return (
    <div style={{ padding: 20 }}>
      <h2>ErrorBoundary + Suspense 嵌套</h2>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <button onClick={() => setScene('pending')}>场景 A: pending → Suspense</button>
        <button onClick={() => setScene('reject')}>场景 B: reject → ErrorBoundary</button>
        <button onClick={() => setScene('success')}>场景 C: 正常渲染</button>
      </div>

      <p>当前: <strong>{scene}</strong></p>
      <hr />

      <ErrorBoundary key={`${scene}-eb`}>
        <Suspense fallback={<Spinner />} key={`${scene}-sp`}>
          {scene === 'pending' && <PendingUser />}
          {scene === 'reject' && <RejectUser />}
          {scene === 'success' && <SuccessUser />}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
```

**操作步骤**：依次点 3 个按钮，观察页面展示内容和 Console 日志。重点看 B 场景：reject 时应该看到**红色错误 UI**，而不是白屏崩溃。

**记录到 observations.md**：

| 按钮 | 页面显示 | 是否符合预期 |
|---|---|---|
| A: pending | ？ | ？ |
| B: reject | ？ | ？ |
| C: success | ？ | ？ |

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| L1 | 4 种模式下内容出现的顺序/时机各不相同 | SuspenseList 是"窗帘控制器"不是"加速器"——请求并发发出，只控制何时拉开窗帘 |
| L2 | 有缓存只请求 1 次，无缓存疯狂刷屏 | 缓存保证同一 id 返回同一个 promise 引用，否则每次 render 都是新 pending 态 |
| L3 | Promise 走 Suspense，Error(reject) 走 ErrorBoundary | 两者可以嵌套配合，各管各的错误类型 |

---

## 完成后

```bash
git add demos/day12 notes/day12.md
git commit -m "W3 D12 SuspenseList实战：完成浏览器实验(revealOrder真实视觉差异/缓存防死循环/ErrorBoundary嵌套)"
git push
```
