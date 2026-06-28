# Day 12 精简笔记：SuspenseList + 自定义 Suspense 实战

> 复习只看这一份。

## 一句话总纲

> **SuspenseList 协调多个 Suspense 边界展示时机（together/forwards/backwards），不改变加载时机。自定义 Suspense 数据获取的核心是"缓存 promise 引用防无限循环"，use() + 缓存 Map 是最佳实践。**

## 一、SuspenseList 三种模式

| 模式 | 行为 | 场景 |
|---|---|---|
| `"together"` | 全部就绪→一起展示 | 页面主体内容，不碎片填充 |
| `"forwards"` | 按 DOM 顺序逐个 reveal | 侧边栏优先，主要区其次 |
| `"backwards"` | 倒序逐个 reveal | 大的后面的先不管，小的先出 |

- `tail="collapsed"`：未就绪的显示一个合并 fallback
- `tail="hidden"`：未就绪的连 fallback 都隐藏

## 二、自定义 Suspense 数据获取（必背模板）

```jsx
const cache = new Map();
function fetchWithCache(key, fetcher) {
  if (!cache.has(key)) cache.set(key, fetcher());  // 存 promise
  return cache.get(key);                            // 用同一个引用
}

function User({ id }) {
  const promise = fetchWithCache(`user:${id}`, () => fetch(`...`).then(r => r.json()));
  const user = use(promise);                        // use() 自动处理三态
  return <div>{user.name}</div>;
}
```

## 三、React.lazy + use() 在同一 Suspense 边界

```
React.lazy (chunk 加载) → throw promise → fallback
                                  ↓ chunk 加载完成
use(fetchUser) → throw promise（仍在 fallback）
                                  ↓ 数据 resolve
正常渲染 → 展示 UI
```

## 四、错误处理

```
Suspense + ErrorBoundary 嵌套：
  <ErrorBoundary>       ← promise reject → ErrorUI
    <Suspense>          ← promise pending → fallback
      <User />
    </Suspense>
  </ErrorBoundary>
```
