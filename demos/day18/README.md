# Day 18 实验：Next.js 进阶（Parallel Routes / Intercepting Routes / Middleware / server-only）

> Parallel Routes、Intercepting Routes、Middleware、server-only 都是 Next.js 构建时/路由层的机制，必须在真实 Next.js 项目里跑才能看到效果。

## 环境准备

```bash
cd demos/day18
npx create-next-app@latest playground --app --no-typescript --no-tailwind --no-eslint --src-dir=false
cd playground
npm run dev
```

---

## 实验 P1：Parallel Routes —— 一个布局，多个独立插槽

创建目录结构：

```
app/
  layout.js
  @analytics/
    page.js
    loading.js
  @notifications/
    page.js
  page.js
```

`app/layout.js`：

```jsx
export default function RootLayout({ children, analytics, notifications }) {
  return (
    <html>
      <body>
        <div style={{ display: 'flex', gap: 20 }}>
          <div>{children}</div>
          <div style={{ border: '1px solid green' }}>
            <h4>Analytics 插槽</h4>
            {analytics}
          </div>
          <div style={{ border: '1px solid orange' }}>
            <h4>Notifications 插槽</h4>
            {notifications}
          </div>
        </div>
      </body>
    </html>
  );
}
```

`app/@analytics/page.js`（故意延迟，验证独立 Suspense）：

```jsx
async function getData() {
  await new Promise(r => setTimeout(r, 2000));
  return { views: 1234 };
}

export default async function Analytics() {
  const data = await getData();
  return <p>浏览量: {data.views}</p>;
}
```

`app/@analytics/loading.js`：

```jsx
export default function Loading() {
  return <p>Analytics 加载中...</p>;
}
```

`app/@notifications/page.js`（无延迟）：

```jsx
export default function Notifications() {
  return <p>你有 3 条新通知</p>;
}
```

**操作步骤**：刷新页面，观察 `Notifications` 插槽是否**立即**显示内容，而 `Analytics` 插槽显示"加载中..."持续 2 秒后才显示浏览量——两个插槽互不阻塞。

**记录到 observations.md**：Notifications 是否立即显示？Analytics 的 loading 状态是否独立、不影响 Notifications？

---

## 实验 P2：Intercepting Routes —— 模态框深链接

创建目录结构：

```
app/
  feed/
    page.js
    [id]/
      page.js          （直接访问 /feed/1 时的完整详情页）
    (.)[id]/
      page.js          （从 /feed 点击进入时拦截显示的模态框）
```

`app/feed/page.js`：

```jsx
import Link from 'next/link';

export default function Feed() {
  return (
    <div>
      <h1>Feed 列表</h1>
      <Link href="/feed/1">查看照片 1（应该以模态框打开）</Link>
    </div>
  );
}
```

`app/feed/(.)[id]/page.js`（拦截层，模态框）：

```jsx
export default function PhotoModal({ params }) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{ background: 'white', padding: 20 }}>
        <h2>照片 {params.id}（模态框形态）</h2>
        <a href="/feed">关闭</a>
      </div>
    </div>
  );
}
```

`app/feed/[id]/page.js`（完整详情页）：

```jsx
export default function PhotoPage({ params }) {
  return (
    <div>
      <h1>照片 {params.id}（完整页面形态）</h1>
    </div>
  );
}
```

**操作步骤**：
1. 从 `/feed` 页面点击"查看照片 1"链接（软导航），观察是否以**模态框**形式弹出（背景仍是 Feed 列表）。
2. 直接在浏览器地址栏输入 `/feed/1` 并回车（硬导航/刷新），观察是否显示**完整详情页**（没有模态框背景）。

**记录到 observations.md**：软导航（点击链接）和硬导航（直接输入 URL/刷新）看到的是不是两种不同的渲染形态？

---

## 实验 P3：Middleware —— redirect / rewrite

在项目根目录（`playground/`）创建 `middleware.js`：

```jsx
import { NextResponse } from 'next/server';

export function middleware(request) {
  const { pathname } = request.nextUrl;

  console.log('[Middleware] 拦截到请求:', pathname);

  if (pathname === '/old-page') {
    return NextResponse.redirect(new URL('/new-page', request.url));
  }

  if (pathname === '/secret') {
    return NextResponse.rewrite(new URL('/feed', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/old-page', '/secret'],
};
```

创建 `app/new-page/page.js`：

```jsx
export default function NewPage() {
  return <h1>这是新页面</h1>;
}
```

**操作步骤**：
1. 访问 `/old-page`，观察浏览器地址栏是否**跳转**到 `/new-page`（redirect：URL 会变）。
2. 访问 `/secret`，观察浏览器地址栏是否**保持** `/secret` 不变，但页面内容却是 Feed 列表（rewrite：URL 不变，内容悄悄换了）。
3. 访问一个不在 matcher 里的路径（比如 `/`），确认终端没有打印 `[Middleware] 拦截到请求`（matcher 精确控制了生效范围）。

**记录到 observations.md**：redirect 和 rewrite 在地址栏表现上的区别是否符合预期？matcher 之外的路径是否真的没有被拦截？

---

## 实验 P4：server-only 环境隔离（构建时报错）

```bash
npm install server-only
```

创建 `app/db.js`：

```jsx
import 'server-only'; // 一行代码，给这个文件打上"服务端专属"标记

export function getSecretApiKey() {
  return process.env.SECRET_API_KEY || 'super-secret-key';
}
```

创建 `app/BadClientComponent.js`：

```jsx
'use client';
import { getSecretApiKey } from './db'; // ❌ 故意在客户端组件里 import 服务端专属模块

export default function BadClientComponent() {
  return <div>{getSecretApiKey()}</div>;
}
```

在 `app/page.js` 里引用 `BadClientComponent`，然后 `npm run dev`（或 `npm run build`）。

**操作步骤**：观察终端/浏览器是否报错，报错信息里是否提到 `server-only` 或"cannot be imported from a Client Component"之类的字样。删掉 `import 'server-only'` 那一行再试一次，确认没有这行标记时不会报错（说明检查是靠这行 import 触发的，不是自动检测）。

**记录到 observations.md**：报错信息具体是什么？去掉 `import 'server-only'` 后是否就不再报错（哪怕逻辑上仍是"密钥泄露到客户端"）？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| P1 | 一个插槽慢加载不阻塞另一个插槽 | Parallel Routes 每个 `@slot` 独立渲染、独立 Suspense 边界 |
| P2 | 软导航模态框，硬导航完整页 | Intercepting Routes 拦截层只在客户端路由导航时生效 |
| P3 | redirect 变 URL，rewrite 不变 URL 但换内容 | Middleware 在请求到达路由前拦截处理 |
| P4 | 误用会在构建/开发阶段直接报错 | `server-only` 靠 package exports 条件导出触发编译期检查 |

---

## 完成后

```bash
git add demos/day18 notes/day18.md
git commit -m "W4 D18 Next.js进阶：补建真实Next.js实验(Parallel插槽独立渲染/Intercepting软硬导航/Middleware重定向重写/server-only构建报错)"
git push
```
