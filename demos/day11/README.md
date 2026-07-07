# Day 11 实验：Suspense 原理（throw promise + use + fallback）

> 代码贴进 Vite + React playground（浏览器里跑）。
> 之前用 jsdom 脚本跑过，但 jsdom **没有 Scheduler，看不到 fallback 真正切换的过程**——这是 Day11 最该在真实浏览器里验证的一天。

## 环境准备（如果还没有 playground）

```bash
cd demos/day11
npm create vite@latest playground -- --template react
cd playground
npm install
npm run dev
```

---

## 实验 K1：throw promise → Suspense 兜底 → fallback 切换回真实内容

这是 jsdom 版本最大的遗憾——之前只能验证"不崩溃"，验证不了"fallback 真的显示了、又真的消失了"。现在在浏览器里补上完整链路。

```jsx
import { Suspense, useState } from 'react';

// ===== 模拟一个异步资源（三态：pending/fulfilled/rejected） =====
function createResource(promise) {
  let status = 'pending';
  let result, error;
  promise.then(
    v => { status = 'fulfilled'; result = v; },
    e => { status = 'rejected'; error = e; }
  );
  return {
    read() {
      console.log('  [resource.read] 当前状态:', status);
      if (status === 'pending') throw promise;   // ★ 关键：直接 throw promise
      if (status === 'rejected') throw error;
      return result;
    },
  };
}

function fetchUser(delay) {
  console.log(`[fetchUser] 发起请求，${delay}ms 后返回`);
  return new Promise(resolve => {
    setTimeout(() => resolve({ name: '张三', id: 1 }), delay);
  });
}

function Profile({ resource }) {
  console.log('[Profile] 组件函数开始执行');
  const data = resource.read();   // 如果还没 resolve，这一行会 throw
  console.log('[Profile] 拿到数据，正常渲染');
  return <div>✅ 用户: {data.name}</div>;
}

function Spinner() {
  console.log('[Spinner/fallback] 被渲染');
  return <div>⏳ 加载中...</div>;
}

export default function App() {
  const [resource, setResource] = useState(null);

  function handleLoad() {
    setResource(createResource(fetchUser(1500)));
  }

  return (
    <div>
      <button onClick={handleLoad}>加载用户（1.5秒延迟）</button>
      {resource && (
        <Suspense fallback={<Spinner />}>
          <Profile resource={resource} />
        </Suspense>
      )}
    </div>
  );
}
```

**操作步骤**：

1. 打开 Console，点击"加载用户"按钮。
2. **盯着页面看**：应该先出现"⏳ 加载中..."，1.5秒后自动变成"✅ 用户: 张三"。
3. 同时看 console 打印顺序。

**源码依据**：`Profile` 执行到 `resource.read()` 时 `throw promise`，被 `performUnitOfWork` 的 try-catch 接住，`throwException` 沿 fiber 树向上找到最近的 Suspense 边界，渲染 fallback；`attachPingListener` 给这个 promise 挂了 `then(ping, ping)`，promise resolve 后触发 ping，React 重新渲染 `Profile`，这次 `resource.read()` 直接返回数据，不再 throw，fallback 被替换成真实内容。

**这是 jsdom 版本完全看不到的部分**——之前的 `observations.md` 明确记录了"Fallback 是否被调用：否 (jsdom 异步调度限制)"。现在你应该能亲眼看到 fallback 出现又消失。

**记录到 observations.md**：

- console 打印的完整顺序是什么？（`[Profile] 组件函数开始执行` 出现了几次？）
- 页面上"⏳ 加载中..."显示了多久？和你设置的 delay 是否一致？
- `[Spinner/fallback] 被渲染` 打印了几次？

---

## 实验 K2：`use(promise)` API——条件语句里也能用

上一版 jsdom 实验只验证了 `React.use` 函数存在，没有真正用它渲染过东西。这次真正用起来：

```jsx
import { use, Suspense, useState } from 'react';

const cache = new Map();

function fetchData(id) {
  if (!cache.has(id)) {
    console.log(`[fetchData] id=${id} 首次请求，创建新 Promise`);
    cache.set(id, new Promise(resolve => {
      setTimeout(() => resolve({ id, text: `数据-${id}` }), 1000);
    }));
  } else {
    console.log(`[fetchData] id=${id} 命中缓存`);
  }
  return cache.get(id);
}

function DataView({ id, showExtra }) {
  // ★ 关键对比点：手动 throw 不能写在 if 里，但 use() 可以
  if (showExtra) {
    const data = use(fetchData(id));
    return <div>额外数据: {data.text}</div>;
  }
  const data = use(fetchData(id));
  return <div>基础数据: {data.text}</div>;
}

export default function App() {
  const [id, setId] = useState(1);
  const [showExtra, setShowExtra] = useState(false);

  return (
    <div>
      <button onClick={() => setId(v => v + 1)}>切换 id (当前 {id})</button>
      <button onClick={() => setShowExtra(v => !v)}>切换分支 (showExtra={String(showExtra)})</button>
      <Suspense fallback={<div>⏳ loading...</div>}>
        <DataView id={id} showExtra={showExtra} />
      </Suspense>
    </div>
  );
}
```

**操作步骤**：

1. 点击"切换 id"，观察 fallback 是否每次都出现（因为新 id 没缓存）。
2. 快速点击两次同一个操作（不切换 id），第二次是否直接显示（命中缓存，不再走 fallback）。
3. 点击"切换分支"，验证 `use()` 确实能写在 `if` 语句里正常工作（手动 `throw` 是做不到这一点的，会直接跳出函数体）。

**记录到 observations.md**：`use()` 写在 `if` 分支里，实际运行是否报错？切换 id 时命中缓存 vs 未命中缓存，fallback 出现的表现有什么不同？

---

## 实验 K3：Error 而非 Promise 时，走的是另一条路

```jsx
import { Component, Suspense } from 'react';

class ErrorBoundary extends Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return <div>❌ 出错了: {this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

function BadComponent({ throwPromise }) {
  console.log('[BadComponent] 执行, throwPromise =', throwPromise);
  if (throwPromise) {
    throw new Promise(() => {});   // 走 Suspense
  } else {
    throw new Error('这是一个真正的错误');   // 走 ErrorBoundary
  }
}

export default function App() {
  return (
    <div>
      <h3>场景A: throw Promise → 应该被 Suspense 接住</h3>
      <ErrorBoundary>
        <Suspense fallback={<div>⏳ Suspense fallback</div>}>
          <BadComponent throwPromise={true} />
        </Suspense>
      </ErrorBoundary>

      <h3>场景B: throw Error → 应该被 ErrorBoundary 接住</h3>
      <ErrorBoundary>
        <Suspense fallback={<div>⏳ Suspense fallback</div>}>
          <BadComponent throwPromise={false} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
```

**操作步骤**：打开页面，观察两个场景各自显示的内容。

**源码依据**：`throwException` 里判断 `typeof value.then === 'function'`——是 thenable 就走 Suspense 路径，否则走 Error Boundary 路径。

**记录到 observations.md**：场景A显示的是"⏳ Suspense fallback"还是"❌ 出错了"？场景B呢？是否符合预期？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| K1 | fallback 真实出现又消失（浏览器独有，jsdom 看不到） | throw promise → Suspense 接住 → ping 触发重渲染 |
| K2 | use() 可以写在 if 分支里；缓存命中时不再走 fallback | use 内部 status 判断 + 用户自己维护的缓存 |
| K3 | Promise 走 Suspense，Error 走 ErrorBoundary | throwException 的 `typeof .then` 判断 |

---

## 完成后

```bash
git add demos/day11 notes/day11.md
git commit -m "W3 D11 Suspense原理：完成浏览器实验(fallback真实切换/use条件分支/Error路由分流)"
git push
```
