# Day17 精简笔记 — Next.js App Router

## 核心概念

**App Router = 基于 RSC 的新一代 Next.js 路由框架**

- 默认 Server Component（不需要写指令）
- 文件系统路由（`app/page.js` → `/`）
- 数据获取在组件内 `async/await`
- 内置 Suspense（loading.tsx）+ ErrorBoundary（error.tsx）

## App vs Pages Router 对比

| 维度 | Pages Router | App Router |
|------|-------------|------------|
| 渲染模型 | 全部 Client | **Server by default** |
| 数据获取 | `getServerSideProps` | **组件内 async/await** |
| 路由文件 | `pages/*.js` | **app/*/page.js** |
| 布局 | `_app.js` | **嵌套 layout.js** |
| Loading/Error | 手动 | **loading.tsx / error.tsx 自动化** |
| API | `pages/api/*` | **app/api/*/route.js** |

## 特殊文件

| 文件 | 作用 | 本质 |
|------|------|------|
| `page.js` | 页面 UI | 当前路由的 React 组件 |
| `layout.js` | 共享布局 | 不随路由切换重挂载 |
| `loading.js` | 加载状态 | **自动 Suspense fallback** |
| `error.js` | 错误处理 | **自动 ErrorBoundary**（必须 client） |
| `not-found.js` | 404 页面 | `notFound()` 调用时显示 |
| `route.js` | API 端点 | 替代 pages/api，支持 GET/POST 等 |
| `template.js` | 临时容器 | 每次导航重新挂载 |

## Layout 嵌套

```
Root Layout (html/body/nav)     ← 永远不卸载
  └── Dashboard Layout          ← dashboard 及子路由保持
       └── Page                  ← 唯一随路由变化的部分

关键：Layout 接收 { children }，children 随路由变化
      Layout 自身状态保留（滚动位置、展开状态等）
```

## Server Actions

```js
// 定义（'use server'）
'use server';
export async function submitForm(formData) {
  await db.save(Object.fromEntries(formData));
  revalidatePath('/data');
}

// 使用（"use client" 组件中）
import { submitForm } from './actions';
<form action={submitForm}>
  <input name="title" />
  <button>提交</button>
</form>
// 不需要 preventDefault！不需要 fetch！
```

## Caching 四层

```
1. Request Memoization → 同一渲染周期内相同 fetch 去重
2. Full Route Cache    → GET 默认缓存整页 HTML
3. Data Cache          → fetch 返回值独立缓存
4. Router Cache        → 客户端路由缓存（pushState）

控制方式：
  fetch(url, { cache: 'no-store' })           // 永不缓存
  fetch(url, { next: { revalidate: 3600 }})   // 定时刷新
  export const revalidate = 3600;              // 路由级配置
  revalidatePath('/blog');                    // 写后主动失效
  export const dynamic = 'force-dynamic';      // 强制动态
```

## Route Handler

```js
// app/api/users/route.js
export async function GET() {
  const users = await db.findAll();
  return Response.json(users);  // Web 标准 Response
}
// 支持 GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS
```

## 请求生命周期

```
URL → 路由匹配 → 缓存检查
  → 命中？直接返回
  → 未命中：RSC 渲染（Layout→Loading→Page）
    → Streaming 分段响应
    → 浏览器：HTML 先展示 → JS hydrate → 可交互
```

## 关键记忆点

1. **"use client" 的传染性沿 import 链传播**，不沿 JSX 嵌套传播（children 除外）
2. **loading.tsx 是 Server Component**（立即返回骨架屏），**error.tsx 必须是 Client Component**
3. **Server Action 底层是隐藏的 POST 端点** + FormData 序列化，客户端不需要知道实现
4. 调用 `cookies()` / `headers()` 后路由自动变动态渲染
5. **Layout 保持状态，Template 每次重建**
