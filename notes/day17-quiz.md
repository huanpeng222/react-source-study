# Day17 自测题 — Next.js App Router

## 题目

**1.** App Router 和 Pages Router 最本质的区别是什么？为什么 App Router 性能更好？

**2.** 以下目录结构，访问 `/shop/electronics/42` 会匹配哪个文件？params 是什么？
```
app/
├── shop/
│   ├── page.js
│   └── [category]/
│       ├── page.js
│       └── [id]/
│           └── page.js
```

**3.** Layout 和 Template 的核心区别是什么？分别适用什么场景？

**4.** loading.tsx 和 error.tsx 底层分别对应 React 的什么机制？error.tsx 为什么必须写 "use client"？

**5.** 什么是 Server Action？它和传统的 API Route + fetch 方案相比有什么优势？

**6.** App Router 中有哪四层缓存？如何让一个页面强制动态渲染（不走缓存）？

**7.** Route Handler（app/api/*/route.js）和旧的 pages/api/*.js 有哪些区别？

**8.** "use client" 的传染规则是什么？以下代码中 B.tsx 是 Server 还是 Client Component？
```js
// A.tsx
"use client";
import B from './B';

function A() {
  return <B />;
}
```

**9.** `generateMetadata` 函数的作用是什么？它在渲染流程中的执行时机是什么？

**10.** Next.js App Router 的 Streaming 工作原理是什么？用户访问页面时看到的内容变化顺序是怎样的？

---

## 参考答案（作答后核对）

<details>
<summary>点击查看答案</summary>

**1.** 最本质的区别是 **App Router 默认使用 Server Component，Pages Router 全部是 Client Component**。性能更好因为：(1) Server Component 在服务端渲染后输出轻量 Payload，不增加客户端 JS bundle；(2) Streaming 支持流式传输，先返回骨架屏再替换真实内容，首屏更快；(3) 默认缓存策略减少重复计算。

**2.** 匹配 `app/shop/[category]/[id]/page.js`，params = `{ category: 'electronics', id: '42' }`。

**3.** **Layout 路由切换时不卸载重建**（状态保留），适用于导航栏、侧边栏等需要保持状态的容器；**Template 每次导航都销毁重建**（重新执行 useEffect），适用于动画、视频播放器等需要每次重新初始化的场景。

**4.** loading.tsx = `<Suspense fallback={<Loading />}>`；error.tsx = `<ErrorBoundary fallback={<Error />}>`。error.tsx 必须写 "use client" 因为它需要用 `useEffect` 记录错误、需要接收 `reset` 函数作为 prop——这些都是 Client Component 能力。

**5.** Server Action 是标记了 `'use server'` 的函数，可以在客户端直接调用但在服务端执行。优势：(1) 不需要手写 API Route + fetch；(2) 表单原生提交行为，不需要 preventDefault；(3) 支持 revalidatePath/redirect 等服务端专属 API；(4) 类型安全（传参和返回值都有类型）。

**6.** 四层缓存：Request Memoization → Full Route Cache → Data Cache → Router Cache。强制动态渲染的三种方式：
- `export const dynamic = 'force-dynamic';`
- 调用 `cookies()` 或 `headers()`；
- fetch 时指定 `{ cache: 'no-store' }`。

**7.** 区别：函数签名从 Express 风格 `(req, res)` 变为 Web 标准 `export async function GET(request)`；返回值从 `res.json()` 变为 `Response.json()`；请求信息通过 `request.nextUrl.searchParams` / `request.json()` 获取；GET 请求默认缓存。

**8.** **Client Component**。"use client" 沿 import 链传播，A 是 client 且 import 了 B → B 被 client bundle 包含 → B 变成 Client Component（即使自己没写 "use client"）。

**9.** `generateMetadata` 用于生成页面的 `<head>` 信息（title、description、OpenGraph 等）。它在 **page 组件 render 之前** 执行，且在服务端完成，所以 SEO 爬虫能拿到正确的 meta 信息而不依赖客户端 JS。

**10.** Streaming 原理：Server 先立即返回 Root Layout + Loading UI（骨架屏），然后 page 组件的异步数据获取完成后，将真实内容以流式方式推送到浏览器替换 Loading。用户看到的顺序：(1) 导航栏+骨架屏瞬间出现 → (2) 真实内容渐显替换骨架屏 → (3) Client Component JS 加载完成 → 页面可交互。整个过程无白屏。

</details>
