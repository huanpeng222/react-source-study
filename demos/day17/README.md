# Day 17 实验：Next.js App Router 架构

> App Router 的核心机制（文件路由、Layout 不重挂载、Streaming）必须在真实 Next.js 项目里才能观察到，纯 JS 模拟看不到"路由切换时组件是否重新 mount"这类真实生命周期行为。

## 环境准备

```bash
cd demos/day17
npx create-next-app@latest playground --app --no-typescript --no-tailwind --no-eslint --src-dir=false
cd playground
npm run dev
```

---

## 实验 N1：文件系统路由 + 动态路由 + Layout 不重新挂载

创建以下目录结构：

```
app/
  layout.js          （根 layout）
  page.js             → /
  blog/
    layout.js         （blog 专属 layout，带一个 useState 计数器）
    page.js            → /blog
    [slug]/
      page.js          → /blog/:slug
```

`app/blog/layout.js`：

```jsx
'use client';
import { useState, useEffect } from 'react';

export default function BlogLayout({ children }) {
  const [mountCount, setMountCount] = useState(0);
  useEffect(() => {
    setMountCount(c => c + 1);
    console.log('[BlogLayout] 挂载了！mountCount =', mountCount + 1);
  }, []);

  return (
    <div style={{ border: '2px solid blue', padding: 10 }}>
      <p>BlogLayout mountCount(应该只在首次进入/blog时变化): {mountCount}</p>
      <nav>
        <a href="/blog/post-1">文章1</a> | <a href="/blog/post-2">文章2</a>
      </nav>
      {children}
    </div>
  );
}
```

`app/blog/[slug]/page.js`：

```jsx
export default function BlogPost({ params }) {
  console.log('[BlogPost] 渲染, slug =', params.slug);
  return <h2>文章: {params.slug}</h2>;
}
```

**操作步骤**：
1. 访问 `/blog/post-1`，记住 Console 里 `BlogLayout` 打印的 mountCount。
2. 点击"文章2"链接切到 `/blog/post-2`（不要刷新页面，用 `<a>` 或换成 Next.js 的 `<Link>`）。
3. 观察 `BlogLayout` 的 `mountCount` 是否**保持不变**（说明 layout 没有重新挂载），同时 `BlogPost` 是否重新渲染打印了新的 slug。

**记录到 observations.md**：切换 slug 时 BlogLayout 的 mountCount 有没有变化？BlogPost 是否正确显示新 slug？

---

## 实验 N2：loading.js 自动包成 Suspense fallback

在 `app/blog/[slug]/` 目录下加一个 `loading.js`：

```jsx
export default function Loading() {
  return <p>⏳ 文章加载中...</p>;
}
```

把 `page.js` 改成异步、故意延迟：

```jsx
async function getPost(slug) {
  await new Promise(r => setTimeout(r, 1500)); // 模拟慢请求
  return { title: `文章标题: ${slug}`, content: '正文内容...' };
}

export default async function BlogPost({ params }) {
  const post = await getPost(params.slug);
  return <h2>{post.title}</h2>;
}
```

**操作步骤**：点击文章链接切换页面，观察是否**立即**显示"⏳ 文章加载中..."，1.5 秒后才切换成真实标题。同时导航栏（BlogLayout 部分）是否保持可见、可点击，不是整页白屏等待。

**记录到 observations.md**：loading.js 的内容是否立即显示？导航栏是否在等待期间依然可交互？

---

## 实验 N3：error.js 捕获渲染错误

在同一目录加 `error.js`：

```jsx
'use client'; // error.js 必须是 Client Component

export default function Error({ error, reset }) {
  return (
    <div style={{ color: 'red' }}>
      <p>出错了: {error.message}</p>
      <button onClick={() => reset()}>重试</button>
    </div>
  );
}
```

把 `page.js` 改成故意抛错：

```jsx
export default async function BlogPost({ params }) {
  if (params.slug === 'post-1') {
    throw new Error('文章不存在！');
  }
  return <h2>文章: {params.slug}</h2>;
}
```

**操作步骤**：访问 `/blog/post-1`，观察是否显示 error.js 里的红色错误 UI（而不是白屏或 Next.js 默认错误页）；点击"重试"按钮观察是否重新尝试渲染。访问 `/blog/post-2` 确认正常页面不受影响。

**记录到 observations.md**：error.js 是否成功捕获了这个错误？点"重试"后行为如何？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| N1 | 切换子路由时 Layout 状态保留、不重新挂载 | Layout 在路由树中是稳定节点，只有 page 部分替换 |
| N2 | loading.js 立即显示，导航栏保持可交互 | Next.js 自动用 Suspense 包裹 page，实现流式加载 |
| N3 | error.js 捕获渲染错误，不影响兄弟路由 | Next.js 自动用 ErrorBoundary 包裹该路由段 |

---

## 完成后

```bash
git add demos/day17 notes/day17.md
git commit -m "W4 D17 App Router架构：完成真实Next.js实验(Layout不重挂载/loading自动Suspense/error自动ErrorBoundary)"
git push
```
