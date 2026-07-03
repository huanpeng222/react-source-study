# Day18 — Next.js 进阶：Parallel Routes / Intercepting Routes / Middleware / 环境隔离

> 日期：2026-07-03
> 主题：并行路由（Slots）、拦截路由（模态框深链接）、Middleware（Edge 层拦截）、server-only/client-only 的"毒药包"机制
> 状态：📖 教程完成，待跟练
> 源码/依据说明：
> - Next.js 是构建在 React 之上的框架，本篇涉及的是 **Next.js 自身的路由/中间件机制**，不是 React 核心源码。
> - 依据来源：Next.js 官方文档（nextjs.org/docs，2026 年 7 月抓取版本），已核对 Parallel Routes / Intercepting Routes / Middleware / server-only 四个官方文档页面原文。
> - `server-only` 包的"毒药"实现细节（`react-server` 条件导出）来自其 npm 包源码结构，不是 Next.js 仓库本身，已在正文标注。
> - **不确定/未直接核实的部分会明确标注"官方文档描述，未逐行核实框架内部实现"**，不编造 Next.js 仓库的文件路径和行号。

---

## 零、入场自测（先答，不会就写"不会"）

1. Dashboard 页面要同时展示 `团队信息` 和 `数据分析` 两块内容，各自能独立加载/独立出错，你会怎么设计路由结构？（提示：不是简单的一个 `page.tsx` 里堆两个组件）

2. 从信息流点击一张照片，你想让它以模态框形式弹出、URL 变成 `/photo/123`、**刷新页面后又变成完整大图页**——这种"同一个 URL 两种渲染形态"是怎么做到的？

3. Middleware 能不能读数据库、能不能用 Node.js 的 `fs` 模块？为什么？

4. 如果一个模块里写了数据库连接代码，被不小心 `import` 到了一个客户端组件里，理论上会发生什么？Next.js 有没有办法在**构建时**就报错拦下来，而不是等运行时才炸？

---

## 一、引子：Dashboard 的两个真实痛点

延续 Day17 的博客站场景，现在要做一个后台 Dashboard：

**痛点 1**：页面里有 `团队动态` 和 `数据看板` 两块，`团队动态` 查询很快（50ms），`数据看板` 涉及复杂聚合查询要 800ms。如果整页只有一个 `page.tsx`，`await` 两个数据源，用户要等最慢的那个才能看到任何内容。

**痛点 2**：产品经理想要"点击列表里的一行 → 弹出详情模态框，不离开列表页；但如果用户直接把详情链接分享给别人，对方打开应该看到完整详情页而不是一个孤零零的模态框"。

这两个痛点，分别对应今天的 **Parallel Routes** 和 **Intercepting Routes**。

---

## 二、Parallel Routes（并行路由）：一个布局，多个独立渲染的"插槽"

### 2.1 核心约定：`@folder`

```
app/
└── dashboard/
    ├── layout.tsx        ← 负责把插槽组装起来
    ├── page.tsx           ← 隐式插槽：children
    ├── @team/
    │   └── page.tsx        ← 团队动态
    └── @analytics/
        └── page.tsx        ← 数据看板
```

`@team`、`@analytics` 就是**具名插槽**（named slot）。它们不是普通的路由段，**不影响 URL**——`@analytics/page.tsx` 渲染出来对应的 URL 还是 `/dashboard`，不是 `/dashboard/analytics`。

### 2.2 插槽怎么被组装？—— 作为 props 传给 layout

```tsx
// app/dashboard/layout.tsx
export default function Layout({
  children,     // ← page.tsx 内容（隐式插槽）
  team,         // ← @team/page.tsx 内容
  analytics,    // ← @analytics/page.tsx 内容
}: {
  children: React.ReactNode
  team: React.ReactNode
  analytics: React.ReactNode
}) {
  return (
    <>
      {children}
      <div className="grid grid-cols-2">
        {team}
        {analytics}
      </div>
    </>
  )
}
```

**关键理解**：`@team` 文件夹名去掉 `@` 就是传给 `layout` 的 prop 名。Next.js 在服务端把这三路内容并行渲染，再作为三个独立的 React 元素传进 `layout`。

> 💡 **和"一个 page.tsx 里两个组件"的本质区别**：
> - 如果是一个 `page.tsx` 里 `<TeamWidget /><AnalyticsWidget />`，两个组件共享同一个 Suspense 边界/同一次请求生命周期。
> - Parallel Routes 是**路由级别**的并行——每个插槽可以有自己的 `loading.tsx`、`error.tsx`，独立地方 Suspense/ErrorBoundary 包裹，`@analytics` 卡住不影响 `@team` 先显示。

### 2.3 `default.js`：处理"访问不到"的插槽

场景：`@team` 有个子路由 `/dashboard/settings`，但 `@analytics` 没有对应的 `/settings` 页面。当浏览器**直接刷新** `/dashboard/settings` 时，Next.js 不知道 `@analytics` 该显示什么内容（它记不住"之前的活跃状态"，因为这是硬导航/全新请求）——这时就会找 `@analytics/default.tsx` 作为兜底：

```tsx
// app/dashboard/@analytics/default.tsx
export default function Default() {
  return null   // 或者返回一个占位提示
}
```

**如果没有 `default.tsx`，Next.js 会渲染 404。**

> ⚠️ **软导航 vs 硬导航的关键差异**（官方文档明确区分）：
> - **软导航**（客户端点击 `<Link>` 跳转）：Next.js 做部分渲染，只更新当前插槽的子页面，**其他插槽维持原来的活跃状态**，即使 URL 已经不匹配它们了。
> - **硬导航**（浏览器整页刷新/直接输入 URL）：Next.js 无法恢复"哪个插槽之前显示什么"，未匹配的插槽渲染 `default.tsx`，没有就 404。

### 2.4 典型用途：条件路由

```tsx
// app/dashboard/layout.tsx
import { checkUserRole } from '@/lib/auth'

export default function Layout({
  user,
  admin,
}: {
  user: React.ReactNode
  admin: React.ReactNode
}) {
  const role = checkUserRole()
  return role === 'admin' ? admin : user   // ← 同一路由，按角色渲染不同插槽内容
}
```

这比"在组件内部写 `if (role === 'admin') return <AdminDashboard/>`"更彻底——**两个分支在路由层面就是完全独立的文件**，各自可以有独立的 loading/error 状态，代码也不会打包混在一起（配合动态 import 时）。

---

## 三、Intercepting Routes（拦截路由）：同一个 URL，两种渲染形态

### 3.1 核心约定：`(.)`、`(..)`、`(..)(..)`、`(...)`

这组符号类似相对路径 `../`，但作用对象是**路由段**而不是文件系统目录：

| 约定 | 含义 |
|---|---|
| `(.)folder` | 拦截**同级**的路由段 |
| `(..)folder` | 拦截**上一级**的路由段 |
| `(..)(..)folder` | 拦截**上两级** |
| `(...)folder` | 从**根 app 目录**开始拦截 |

> ⚠️ **官方文档特别强调的坑**：`(..)` 是基于**路由段**计算的，**不考虑 Parallel Routes 的 `@slot` 文件夹**。所以下面这个结构里，虽然文件系统上 `photo` 比 `feed` 深两级（`feed/@modal/(..)photo`），但因为 `@modal` 是插槽不是路由段，`photo` 相对于 `feed` 实际只高一级，所以用 `(..)` 而不是 `(..)(..)`。这是初学者最容易数错层级的地方。

### 3.2 完整的"模态框深链接"模式（Parallel + Intercepting 组合拳）

这正是痛点 2 的解法：

```
app/
├── feed/
│   ├── page.tsx              ← 信息流列表
│   ├── layout.tsx             ← 组装 @modal 插槽
│   └── @modal/
│       ├── default.tsx        ← 返回 null（没激活时不渲染任何模态框）
│       └── (.)photo/
│           └── [id]/
│               └── page.tsx    ← 拦截版：以模态框形式渲染
└── photo/
    └── [id]/
        └── page.tsx            ← 完整版：独立大图页面
```

**运作逻辑**：

```
场景 A：用户在 /feed 页面里点击一张图片（客户端导航 <Link href="/photo/123">）
  → Next.js 发现有 (.)photo 拦截规则匹配
  → 渲染 @modal 插槽里的拦截版 page.tsx（模态框）
  → URL 变成 /photo/123，但视觉上是 /feed 页面 + 一个浮层
  → feed 页面本体没有卸载！（这就是"保留上下文"）

场景 B：用户直接在地址栏输入 /photo/123，或分享链接给别人打开
  → 这是一次全新的服务端请求，没有"当前在 /feed"这个上下文
  → Next.js 直接渲染 photo/[id]/page.tsx（完整独立页面）
  → 不会经过拦截逻辑，因为拦截只对客户端软导航生效
```

**为什么这解决了产品经理的三个诉求**：

| 诉求 | 怎么实现的 |
|---|---|
| 模态框内容可通过 URL 分享 | URL 真的变成了 `/photo/123`，不是靠 `?modal=true` 这种查询参数模拟 |
| 刷新页面保留上下文而不关闭模态框 | 反过来说：刷新后其实进入了"完整页面"模式，这是设计上的取舍，不是 bug |
| 后退关闭模态框而不是跳到上一路由 | 因为浏览历史里 `/feed` 还在栈里，`/photo/123`（模态框态）是叠加的一条历史记录，后退直接弹出 |

> 📌 **微检查点 1**：如果没有 `@modal/default.tsx` 返回 `null`，直接访问 `/feed`（没有点开任何照片）会发生什么？

---

## 四、Middleware：请求到达任何路由之前的"关卡"

### 4.1 基本形态

```ts
// middleware.ts（必须放在项目根目录，或 src/ 目录下）
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    const token = request.cookies.get('token')
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }
  return NextResponse.next()   // 放行，继续走正常路由渲染
}

// matcher 决定 middleware 对哪些路径生效——避免每个请求都跑一遍
export const config = {
  matcher: ['/dashboard/:path*', '/about/:path*'],
}
```

### 4.2 `NextRequest` / `NextResponse` 能做什么

| API | 作用 |
|---|---|
| `NextResponse.next()` | 放行，继续正常渲染流程 |
| `NextResponse.redirect(url)` | 重定向（浏览器 URL 会变） |
| `NextResponse.rewrite(url)` | **改写**目标（浏览器 URL 不变，但实际渲染的是另一个路由）——常用于 A/B 测试、多租户按 subdomain 分流 |
| `request.cookies` / `response.cookies` | 读写 Cookie |
| `request.nextUrl.pathname` | 读路径，做路由判断 |

`rewrite` 和 `redirect` 的区别是面试常问点：**redirect 用户能感知到（地址栏变了，浏览器发第二次请求）；rewrite 用户完全无感知（地址栏不变，内部悄悄换了目标）**。

### 4.3 为什么 Middleware 不能用 `fs`、不能直接连数据库？—— Edge Runtime 的限制

> ⚠️ **这部分是官方文档明确写出的约束，我没有逐行核实 Next.js 内部 Edge Runtime 的实现细节，只转述文档结论。**

Middleware 默认运行在 **Edge Runtime**（一个比 Node.js 更轻量、更接近浏览器 API 的受限环境），特点：

- **没有** Node.js 的 `fs`、`net`、大部分原生模块。
- **有** `fetch`、Web 标准 API（`Request`/`Response`/`URL` 等）。
- 目标是让 Middleware 能被部署到边缘节点（离用户物理更近的服务器），做到极低延迟的请求拦截。

所以：**能做**——读 Cookie、读 Header、做重定向/改写、做简单的鉴权判断（比如验证一个 JWT 的签名，因为验证签名只需要纯计算）。**不能做（或很难做）**——直接 `new PrismaClient()` 连数据库（大部分数据库驱动依赖 Node.js 原生模块）。真正需要查库的鉴权逻辑，通常是 Middleware 里只做"有没有 token"的粗筛，细粒度校验放到实际的 Server Component / Route Handler 里（那里是完整 Node.js 环境）。

> 📌 **微检查点 2（回答入场自测 Q3）**：Middleware 不能直接用 `fs` 和大部分数据库驱动，因为它默认运行在 Edge Runtime，这是一个类浏览器的受限 JS 环境，没有 Node.js 原生模块支持，是为了能部署到全球边缘节点、离用户更近，换来的是能力上的裁剪。

---

## 五、server-only / client-only：构建时的"环境毒药"机制

### 5.1 要解决的问题：环境污染（Environment Poisoning）

回忆 Day16 讲过的四条铁律之一：**"Server 可以 import Client，Client 不能 import Server"**。但这只是规则，如果学习者手滑呢？

```ts
// lib/data.ts —— 意图：只在服务端调用
export async function getData() {
  const res = await fetch('https://api.example.com/data', {
    headers: { authorization: process.env.API_KEY },   // 敏感密钥！
  })
  return res.json()
}
```

如果这个模块被不小心 `import` 进一个 `'use client'` 组件——**不会立刻报错**，因为 JS 层面这只是一次普通的模块导入。运行时会发生：`process.env.API_KEY` 在客户端 bundle 里因为没有 `NEXT_PUBLIC_` 前缀，会被替换成空字符串。函数依然"能跑"，但拿到的是一个**没有鉴权头的失败请求**——这是一种**运行时才暴露、还容易被误判成别的 bug** 的隐患。

### 5.2 `server-only` 包怎么在构建时就拦下来

```ts
// lib/data.ts
import 'server-only'   // ← 加这一行
export async function getData() { ... }
```

现在如果任何客户端组件尝试 `import { getData } from './lib/data'`，**构建直接报错**："This module cannot be imported from a Client Component module."

### 5.3 它是怎么做到的？——不是运行时判断，是"条件导出"的技巧

> 📖 **以下内容来自 `server-only` npm 包本身的源码结构（不是 Next.js 仓库），我核实过它的 `package.json` 和入口文件写法。**

```json
// server-only 包的 package.json（简化）
{
  "exports": {
    ".": {
      "react-server": "./empty.js",
      "default": "./index.js"
    }
  }
}
```

```js
// index.js —— default 入口
throw new Error(
  "This module cannot be imported from a Client Component module. " +
  "It should only be used from a Server Component."
)

// empty.js —— react-server 入口
// 什么都没有，是个空文件
```

**关键在 `react-server` 这个条件导出键**——这不是 Node.js 的标准条件，而是 **React 团队为 RSC（Server Components）运行时定义的一个自定义 condition**。支持 RSC 的框架（Next.js 等）在打包时会跑两条流水线：

```
Server Bundle 流水线：
  优先找 exports 里的 "react-server" 条件
  → 命中 empty.js（空文件，什么都不做）
  → import 'server-only' 在服务端等于什么都没发生，正常放行

Client Bundle 流水线：
  没有 "react-server" 这个条件
  → 走 "default" → index.js
  → 立刻 throw Error
  → 打包器在编译期发现这个 throw，报错中断构建
```

**所以这是一种"环境敏感的空包/毒药包"设计**：同一行 `import 'server-only'`，在两条不同的构建流水线里，物理上加载的是两个不同的文件，效果完全相反。`client-only` 包原理相同，只是把两个文件的行为对调（客户端环境是空文件，服务端环境是 throw）。

> ⚠️ Next.js 内部对 `server-only`/`client-only` 有专门处理，官方文档写明"安装是可选的"（不装也能靠 Next.js 内置检测报错），装它们主要是给 lint 工具/类型系统提供更明确的信号，并且能获得更清晰的报错文案。这部分"Next.js 内部专门处理逻辑"具体怎么实现，我没有找到可信的公开源码可以核实，**这里就不编具体实现，只转述文档结论**。

> 📌 **微检查点 3（回答入场自测 Q4）**：不小心把含数据库连接的模块 import 进客户端组件——如果模块里加了 `import 'server-only'`，构建阶段就会因为客户端打包流水线走到 `throw new Error(...)` 的那个文件而直接报错，不用等到运行时才发现密钥泄露或请求失败。这是一种"构建时环境检测"，利用的是 React 生态里 `react-server` 这个自定义 package export condition，让同一次 import 在两条打包流水线里加载不同文件。

---

## 六、把四个概念串起来：一个真实场景

设想一个电商网站的商品列表页：

```
需求：
① 列表页有"筛选面板"和"商品网格"两块，各自独立请求、独立 loading  → Parallel Routes（@filter + @grid 两个插槽）
② 点击某个商品卡片 → 模态框预览详情，分享链接能打开完整详情页    → Intercepting Routes（(.)product/[id]）
③ 只有登录用户才能访问 /checkout，未登录重定向到登录页          → Middleware（粗筛鉴权）
④ 商品详情页要查数据库拿库存和价格，代码绝不能进客户端 bundle    → server-only 标记数据获取模块
```

```
app/
├── middleware.ts                      ← ③ 拦 /checkout
├── products/
│   ├── layout.tsx                     ← 组装 @filter + @grid + @modal
│   ├── page.tsx
│   ├── @filter/page.tsx               ← ① 独立插槽
│   ├── @grid/page.tsx                 ← ① 独立插槽
│   └── @modal/
│       ├── default.tsx                ← 返回 null
│       └── (.)product/[id]/page.tsx    ← ② 拦截版：模态预览
├── product/
│   └── [id]/page.tsx                   ← ② 完整版：独立详情页
└── lib/
    └── db.ts                           ← ④ import 'server-only'
```

四个特性在真实项目里**不是孤立的知识点，是配合着一起用的**。

---

## 七、几个容易搞混/被面试问到的点

**Q1：Parallel Routes 的插槽会影响 URL 吗？**

不会。`@team`、`@analytics` 只是传给 layout 的 prop 名，`/dashboard` 这个 URL 不会变成 `/dashboard/team`。

**Q2：Intercepting Routes 的 `(..)` 到底怎么数层级？**

按**路由段**数，不按文件系统目录数，`@slot` 文件夹不算一层。数错层级是最常见的坑，建议先画出"去掉 `@xxx` 之后的路由段结构图"再数。

**Q3：Middleware 里能不能做完整的用户鉴权（查数据库验证 session）？**

粗筛可以（比如验证 JWT 签名的纯计算逻辑），完整查库鉴权不建议放 Middleware（Edge Runtime 限制 + 每个请求都跑一遍 Middleware 会有性能代价），细粒度鉴权放到具体路由的 Server Component / Route Handler 里。

**Q4：装了 `server-only` 就绝对安全了吗？**

它防的是"整个模块被误 import 到客户端"，防不了"服务端代码里手写把敏感数据当作 props 传给了客户端组件"——比如 `<ClientComp apiKey={secretKey} />` 这种，`server-only` 完全拦不住，因为这时候密钥已经变成了要序列化传给客户端的 props 数据，不是 import 关系的问题。

---

## 八、今日总结

一句话串联：

> **Parallel Routes 解决"同一个页面里多块内容各自独立生命周期"的问题；Intercepting Routes 解决"同一个 URL 在不同导航方式下渲染成不同形态"的问题；Middleware 解决"请求到达路由渲染之前先拦一道"的问题；server-only/client-only 解决"代码不小心跑到错误环境"的构建时安全网问题。四者都是 App Router 在"文件路径 = 路由"这套约定之上，为了应对更复杂的真实 UI/安全需求而长出来的配套设施。**

记忆口诀：

```
Slot Not Segment     —— @folder 是插槽不是路由段，不影响 URL
Soft Keeps, Hard Resets —— 软导航保留插槽活跃态，硬导航靠 default.js 兜底
Intercept by Route, Not by File —— 拦截层级按路由段数，不按文件系统数
Edge Is Limited      —— Middleware 跑在受限的 Edge Runtime，别指望它连数据库
Poison at Build Time —— server-only 靠 react-server 条件导出在构建时炸，不是运行时判断
```

---

## 九、验收清单

- [ ] 能说出 Parallel Routes 的插槽命名约定（`@folder`）以及它不影响 URL 的原因
- [ ] 能解释软导航 vs 硬导航下插槽的不同表现，以及 `default.js` 的作用
- [ ] 能正确数出 Intercepting Routes 的 `(..)` 层级（知道 `@slot` 不算一层）
- [ ] 能画出"模态框深链接"模式的完整文件结构
- [ ] 能说出 Middleware 的 `NextResponse.redirect` 和 `rewrite` 的区别
- [ ] 能解释为什么 Middleware 不能直接用 `fs`/大部分数据库驱动
- [ ] 能说出 `server-only` 靠什么机制在构建时拦截（`react-server` 条件导出）
- [ ] 完成动手实验

---

## 十、动手实验（写入 demos/day18/）

> 同样面临 Day17 的限制：完整体验需要真实 Next.js 项目 + 构建工具链。今天的实验分两类：**能在 jsdom+react 环境模拟验证的部分** 和 **必须在你自己的 Next.js 项目里跑的部分**。

| 实验 | 环境 | 验证什么 |
|---|---|---|
| P1 | jsdom 模拟 | Parallel Routes 的插槽独立渲染/独立 Suspense 边界模型 |
| P2 | jsdom 模拟 | Intercepting Routes 的"软导航 vs 硬导航"渲染分支逻辑 |
| P3 | 真实 Next.js 项目 | Middleware matcher 是否生效 + redirect/rewrite 实际效果 |
| P4 | 真实 Next.js 项目 | 故意把 `server-only` 模块 import 进 `'use client'` 组件，验证构建报错 |

（跟练时我会分别给出可跑代码 / 项目内操作步骤）

---

## 十一、Day19 预告

**候选主题**：Next.js 性能与部署深度（ISR / PPR 部分预渲染 / Turbopack 构建优化 / 生产环境缓存策略），作为 App Router 系列的收尾。

**预读问题**：
1. ISR（增量静态再生）和之前讲的 `revalidatePath` 是同一套机制吗？
2. PPR（Partial Prerendering）是怎么把"静态部分立即返回 + 动态部分流式补充"结合在同一个响应里的？
3. Turbopack 相比 Webpack 的核心加速点是什么？
4. 生产环境里，`fetch` 的缓存和浏览器 HTTP 缓存是不是一回事？
