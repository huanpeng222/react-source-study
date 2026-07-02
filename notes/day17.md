# Day17 — Next.js App Router 架构深度解析

> **前置知识**：Day16 RSC 原理（"use client"、"use server"、序列化边界、Payload 格式）
>
> **本日目标**：不是背一堆 API，而是搞清楚"如果我自己要把 RSC 理论做成一个可用的框架，会遇到哪些问题，Next.js 是怎么一步步解决的"。

---

## 引子：假设你要做一个博客站

为了不让今天的内容变成一堆孤立的 API 罗列，我们用一个具体场景贯穿全篇：

> 你要做一个博客网站。首页展示文章列表，点进去是详情页，详情页下面有评论区，用户可以提交评论。数据存在数据库里。

这个场景会自然地把 App Router 的每个特性串起来——**每一个新特性，都是为了解决上一步暴露出来的问题**。

---

## 一、先看 Pages Router 时代怎么做，痛点在哪

```js
// pages/blog/[slug].js —— 详情页

export default function BlogPost({ post }) {
  // 这个组件在 **客户端** 执行
  // 即使数据是服务端拿的，组件本身还是要在浏览器里跑一遍（hydrate）
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  );
}

export async function getServerSideProps({ params }) {
  // 数据获取逻辑，跟组件是两个完全独立的函数
  const post = await db.posts.findBySlug(params.slug);
  return { props: { post } };
}
```

写起来似乎没什么问题，但仔细想会发现三个别扭的地方：

1. **组件和数据获取被拆成两个函数**，读代码要来回跳，逻辑上明明是一件事却写在两处。
2. **`BlogPost` 组件本身还是要发到浏览器执行**——即使它只是渲染静态文字，没有任何 `useState`/`onClick`，也要打进 JS bundle、被 hydrate。纯展示型组件白白消耗了客户端资源。
3. **导航栏、侧边栏这些每页都有的东西**，要么在 `_app.js` 里手写一层包裹，要么每个页面自己重复写，页面切换时这些"公共外壳"会跟着重新执行一遍（状态丢失、滚动位置归零）。

这三个别扭点，恰好对应 App Router 要解决的前三个问题。我们一个一个来。

---

## 二、第一个问题的解法：让组件本身"默认待在服务端"

Pages Router 的核心矛盾是：**组件代码默认要发到客户端**，即使它不需要交互。App Router 反过来定义默认值：

```js
// app/blog/[slug]/page.js —— App Router 的写法

export default async function BlogPost({ params }) {
  // 数据获取和组件渲染写在同一个函数里，不用跳来跳去
  const post = await db.posts.findBySlug(params.slug);
  
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  );
}
// 这个函数**默认不会发到浏览器**，它只在服务端跑一次，
// 产出的 HTML/RSC Payload 才发给客户端
```

这就是 Day16 学过的 Server Component，在这里的意义是：**默认值从"发到客户端"变成了"留在服务端"**。只有当你确实需要 `useState`/`onClick`（比如评论区的输入框），才手动标记 `"use client"`，把那一小块拉到客户端去。

对应到上面三个别扭点，第 1、2 点在这里被同时解决了：数据获取和渲染写一处，纯展示组件不再占用客户端资源。

但这就带来一个新问题——**Next.js 怎么知道 `app/blog/[slug]/page.js` 这个文件对应 `/blog/xxx` 这个 URL？** 这就是第二个问题。

---

## 三、第二个问题的解法：文件路径就是路由表

Pages Router 的路由规则是"文件在哪，路由就在哪"，App Router 延续了这个思路，但做得更细。核心规则一句话：

> **目录嵌套关系 = URL 路径层级，文件名有特殊含义。**

```
app/
├── page.js              →           /
├── blog/
│   ├── page.js          →           /blog        （列表页）
│   └── [slug]/
│       └── page.js      →           /blog/:slug  （详情页，[slug] 是动态段）
├── shop/
│   └── [category]/
│       └── [id]/
│           └── page.js  →           /shop/:category/:id
└── api/
    └── comments/
        └── route.js     →  GET/POST /api/comments  （这个先放一放，第七节讲）
```

**为什么方括号 `[slug]` 代表动态参数？** 因为普通目录名会原样出现在 URL 里（`blog` → `/blog`），但博客详情页的 slug 是运行时才知道的值，不能写死成目录名，所以用 `[slug]` 占位，Next.js 在匹配到 URL 时会把这一段解析出来塞进 `params` 对象：

```js
// URL: /blog/how-i-learned-react
// app/blog/[slug]/page.js 收到：
export default function BlogPost({ params }) {
  console.log(params.slug); // 'how-i-learned-react'
}
```

如果 URL 段数不固定（比如文档站的多级路径 `/docs/guide/setup/step1`），方括号前面加三个点变成 `[...slug]`（catch-all），此时 `params.slug` 会是一个数组 `['guide', 'setup', 'step1']`。

除了 `page.js` 这种承载 UI 的文件，目录里还可以放几种有特殊含义的文件，这些我们会在后面几节陆续用到，这里先列个索引，方便对照：

| 文件名 | 作用 | 会在哪一节展开 |
|--------|------|---------------|
| `page.js` | 定义该路径的 UI | 已讲 |
| `layout.js` | 共享布局外壳 | 第四节 |
| `loading.js` | 加载态 UI | 第五节 |
| `error.js` | 错误态 UI | 第五节 |
| `route.js` | API 端点 | 第七节 |
| `not-found.js` | 404 页面 | 第五节末尾 |
| `template.js` | 类似 layout 但每次重建 | 第四节 |

现在路由和渲染都解决了，回到第三个别扭点——导航栏这种公共外壳要怎么做到"不随页面切换而重新执行"？

---

## 四、第三个问题的解法：Layout 是一个"不会重新挂载"的包裹层

先还原一下 Pages Router 的痛点：`_app.js` 里包一层 `<Nav />`，但只要路由变化，Next.js 就会把整棵组件树重新渲染一遍，`Nav` 内部如果有状态（比如"侧边栏是否展开"），会跟着归零。

App Router 的解法是**把 UI 结构和文件结构直接对应起来**，让 Next.js 能精确知道"哪一层是共享的，哪一层才是真正变化的"：

```
app/
├── layout.js          ← Root Layout：整个站点的外壳，访问任何页面都会经过它
│     <html><body>
│       <Nav />
│       {children}   ← 当前页面的内容会被塞到这里
│     </body></html>
│
├── page.js            → /            （作为上面的 children）
│
└── blog/
    ├── layout.js      ← Blog 专属布局（可选），只包裹 /blog 及其子路由
    │     <BlogSidebar />
    │     {children}
    │
    ├── page.js        → /blog       （作为 BlogLayout 的 children）
    └── [slug]/
        └── page.js    → /blog/:slug （同样作为 BlogLayout 的 children）
```

关键在于：**从 `/` 导航到 `/blog/xxx` 时，`RootLayout` 组件实例是同一个，没有被卸载重建**——只有 `{children}` 这个插槽里的内容变了。这也是为什么 `Nav` 里维护的状态（比如登录状态、侧边栏展开状态）在页面切换时能保留下来。

```js
// app/layout.js
export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <Nav />           {/* 状态在路由切换时不丢失 */}
        <main>{children}</main>
      </body>
    </html>
  );
}
```

这里有个容易踩的坑：**如果你确实需要"每次进入这个路由段都重新执行一遍"**（比如一个进入动画，或者一个需要每次重置的计时器），用 `layout.js` 反而是错的——它不会重新执行。这时候要换成 `template.js`，写法完全一样，唯一区别是 Next.js 对它的处理方式是"每次导航都销毁重建"：

```js
// app/blog/template.js —— 每次进入 /blog/* 都会重新挂载
export default function BlogTemplate({ children }) {
  useEffect(() => {
    console.log('每次导航到这里都会打印一次');
  }, []);
  return <div className="fade-in">{children}</div>;
}
```

**记忆方式**：Layout 保状态（导航栏、侧边栏），Template 保新鲜（动画、埋点）。

到这里，Pages Router 时代的三个别扭点都有了对应方案。但博客详情页要查数据库，**如果数据库慢一点，用户点进去要面对几百毫秒的空白，怎么办？**这是下一个自然会遇到的问题。

---

## 五、新问题：数据没查完之前，页面显示什么？

回到 `app/blog/[slug]/page.js`：

```js
export default async function BlogPost({ params }) {
  const post = await db.posts.findBySlug(params.slug); // 假设这里要等 300ms
  return <article>{post.title}</article>;
}
```

这个 `await` 期间，页面应该显示什么？总不能白屏等 300ms。Next.js 的答案是：**只要你在同一目录下放一个 `loading.js`，它就自动帮你做 Suspense 包裹**：

```js
// app/blog/[slug]/loading.js
export default function BlogPostLoading() {
  return <div className="skeleton">加载中...</div>;
}
```

这行为背后完全没有魔法，等价于 Next.js 在背后自动写了这段代码：

```js
<Suspense fallback={<BlogPostLoading />}>
  <BlogPost />
</Suspense>
```

**为什么这个 loading 组件能立即显示？** 因为它自己不需要等任何数据，是个纯静态组件，Server Component 渲染它几乎零耗时，可以立刻发给客户端；而 `<BlogPost>` 因为 `await` 卡住了，Suspense 检测到"这个子树还没准备好"，就先用 `fallback` 顶着。等 `await` 完成后，Next.js 再把真实内容通过 Streaming（下一节细讲）推送过去替换掉骨架屏。

**那如果数据库直接挂了，`await` 抛出异常呢？** 骨架屏解决的是"慢"，没解决"错"。这是紧接着冒出来的下一个问题。

---

## 六、新问题：数据获取失败了怎么办？

跟 `loading.js` 一个套路，同目录放一个 `error.js`：

```js
// app/blog/[slug]/error.js
'use client';   // ⚠️ error.js 必须是 Client Component

export default function BlogPostError({ error, reset }) {
  useEffect(() => {
    console.error('博客加载失败:', error);
  }, [error]);

  return (
    <div className="error-box">
      <h2>加载失败 😢</h2>
      <p>{error.message}</p>
      <button onClick={() => reset()}>重试</button>
    </div>
  );
}
```

等价于 Next.js 自动包了一层：

```js
<ErrorBoundary fallback={<BlogPostError />}>
  <Suspense fallback={<BlogPostLoading />}>
    <BlogPost />
  </Suspense>
</ErrorBoundary>
```

**为什么 `error.js` 必须写 `"use client"`，而 `loading.js` 不需要？** 因为 `error.js` 要接收 Next.js 注入的 `reset` 函数（一个可调用的回调，函数不能跨越 Server/Client 序列化边界，回忆 Day16 的坑），而且通常要用 `useEffect` 上报错误日志——这两件事都要求它是 Client Component。`loading.js` 只是纯展示，不需要任何交互能力，留在 Server Component 反而更轻量。

`error.js` 也遵循和 `layout.js` 一样的就近原则：谁离出错的组件最近，谁先接管：

```
app/
├── error.js           ← 兜底：捕获整站任何没被下层捕获的错误
└── blog/
    └── [slug]/
        └── error.js   ← 优先级更高：/blog/xxx 出错先被这层接住
```

现在 loading 和 error 都有了，那**用户在浏览器里到底看到了什么样的加载过程？**这就是把前两节串起来的底层机制——Streaming。

---

## 七、把 loading/error 串起来：Streaming 到底传输了什么

先厘清一个直觉误区：很多人以为服务端要等所有数据都拿到才返回响应，其实 App Router 的默认行为是**分批次、边算边发**：

```
用户访问 /blog/how-i-learned-react

T=0ms    服务端立刻返回:
         <html><body><Nav/><main>
           <div class="skeleton">加载中...</div>
         (连接不断开，先把这部分发出去)

T=0~5ms  浏览器收到上面这段 → 立即渲染 → 用户看到导航栏 + 骨架屏
         （比传统 SSR "等全部数据再返回" 快得多）

T=300ms  数据库查询完成，服务端继续往同一个连接里追加:
         <!--$?--><article><h1>How I Learned React</h1>...</article><!--/$?-->
         这段内容里带着特殊标记，告诉浏览器"把骨架屏换成这个"

T=305ms  浏览器执行替换 → 骨架屏消失，真实内容出现
         </main></body></html>  （流结束）
```

这就是为什么它叫 Streaming（流式传输）——HTTP 连接始终保持打开，服务端算完一部分就发一部分，而不是攒够所有内容再一次性发送。**如果中途数据库抛异常**，服务端会往流里追加 `error.js` 渲染出的内容，替换掉骨架屏，效果就是我们上一节看到的错误提示。

这也顺带回答了一个常见疑问："`page.js` 里能不能一部分快一部分慢？"——能，只要给慢的部分单独包一层 `<Suspense>`，Next.js 就会对这个子树单独走一次 Streaming 替换，跟 `loading.js` 是同一套机制，只是手动控制粒度。

---

## 八、页面之外：评论区要提交数据，得有个"后端接口"

博客详情页下面还有个评论区。评论列表可以在 `page.js` 里直接查数据库展示，但如果这是一个前端 App 单独调用的接口（比如给移动端 App 用），就需要一个纯粹的 HTTP 端点，不返回 HTML。这对应 Pages Router 里的 `pages/api/*.js`，App Router 里叫 Route Handler：

```js
// app/api/comments/route.js
export async function GET(request) {
  const postId = new URL(request.url).searchParams.get('postId');
  const comments = await db.comments.findByPost(postId);
  return Response.json(comments);
}

export async function POST(request) {
  const body = await request.json();
  const comment = await db.comments.create(body);
  return Response.json(comment, { status: 201 });
}
```

跟旧版最大的差异是**函数签名从 Express 风格换成了 Web 标准**：不再是 `(req, res) => {}`，而是 `export async function GET(request)`，返回值也从 `res.json()` 变成了标准的 `Response.json()`。这个改动不是为了炫技，是因为 Web 标准的 `Request`/`Response` 在 Edge Runtime（不只是 Node.js）里也能跑，Route Handler 因此天然支持部署到边缘节点。

不过，**如果评论表单只是要提交数据，值得为它专门写一个 Route Handler + 客户端 fetch 吗？** 大部分场景其实不需要，这就引出 App Router 里体验提升最大的一个特性。

---

## 九、表单提交的新范式：Server Action

按 Route Handler 的思路，评论表单要这样写：

```js
// 前端 Client Component
async function handleSubmit(e) {
  e.preventDefault();
  const res = await fetch('/api/comments', {
    method: 'POST',
    body: JSON.stringify({ postId, content }),
  });
  // 还要手动处理 loading / 错误 / 成功后刷新列表...
}
```

需要单独定义一个 Route Handler，前端还要手写 fetch、处理各种状态。App Router 提供了一条更短的路径——**直接把一个标记了 `'use server'` 的函数绑定到 `<form action={...}>` 上**：

```js
// app/blog/[slug]/actions.js
'use server';

export async function addComment(formData) {
  const postId = formData.get('postId');
  const content = formData.get('content');
  
  await db.comments.create({ postId, content });
  
  // 提交完之后，让详情页的缓存失效，下次访问能看到新评论
  revalidatePath(`/blog/${postId}`);
}
```

```js
// app/blog/[slug]/CommentForm.jsx —— Client Component
'use client';
import { addComment } from './actions';

export function CommentForm({ postId }) {
  return (
    <form action={addComment}>
      <input type="hidden" name="postId" value={postId} />
      <textarea name="content" />
      <button type="submit">提交评论</button>
    </form>
  );
}
// 没有 preventDefault，没有 fetch，没有手动管理 loading 状态
```

**这背后到底发生了什么？** 用户点提交时，浏览器走的其实还是原生表单提交流程，Next.js 在编译阶段把 `<form action={addComment}>` 转换成了一个隐藏的 POST 请求，指向一个内部约定的端点，同时把 `addComment` 编码成一个 ID 塞进表单的隐藏字段里：

```
浏览器实际提交的内容大致是：
  POST /blog/how-i-learned-react  (Next.js 内部路由)
  body: postId=xxx&content=xxx&$ACTION_ID=<addComment的编码引用>

服务端收到后：
  1. 根据 $ACTION_ID 找到对应的 addComment 函数
  2. 把 body 组装成 FormData 传进去执行
  3. 函数内调用了 revalidatePath → 标记 /blog/xxx 的缓存失效
  4. 返回结果，Next.js 自动重新渲染受影响的部分
```

对写代码的人来说，`addComment` 看起来就是一个普通函数，但它实际运行在服务端——这就是 Server Action 的本质：**把"客户端调用、服务端执行"这件事，从"手写 API + fetch"降级成了"直接 import 一个函数来用"**。

注意上面出现的 `revalidatePath`——这引出了另一个必须搞清楚的问题：**评论提交之后，详情页缓存的旧数据要怎么被刷新掉？** 这就要回到"App Router 默认是缓存的"这个前提。

---

## 十、缓存：默认行为是什么，怎么打破它

前面提到过 `page.js` 里的 `fetch`/数据库查询结果默认会被缓存,这在博客场景里其实是把双刃剑：

- **好处**：同一篇文章被 1000 个人访问，数据库只需要查一次，后面全从缓存拿,首屏几毫秒返回。
- **坏处**：如果不做处理，评论区提交新评论后，别人访问这篇文章看到的还是旧缓存,新评论"消失"了。

这就是为什么第九节的 `addComment` 里一定要调用 `revalidatePath('/blog/xxx')`——**手动告诉 Next.js"这个路径的缓存现在失效了，下次访问请重新执行一遍"**。

缓存这件事在 App Router 里分了几层,不需要全部记住,但要知道分层的原因——**不同层解决的是不同粒度的重复计算问题**：

```
Request Memoization   → 同一次渲染里，同一个 fetch 调 3 次也只发 1 次请求
                          （解决: 一次页面渲染中 Header/Sidebar/Content 都要用户信息导致的重复查询）

Full Route Cache      → 同一个路由，不同用户访问共享同一份渲染结果
                          （解决: 1000 个人看同一篇文章，不用查 1000 次数据库）

Data Cache            → fetch 的返回值本身被持久缓存，独立于路由缓存
                          （解决: 数据可以比页面缓存活得更久或更短）
```

**怎么控制？** 三种常用方式，对应不同场景：

```js
// 场景 1：这篇文章内容基本不变 → 长期缓存，很少刷新
fetch(url, { next: { revalidate: 3600 } });  // 1 小时后允许重新验证

// 场景 2：这是用户的购物车，因人而异 → 完全不缓存
fetch(url, { cache: 'no-store' });

// 场景 3：读取了 cookies/headers（依赖请求上下文）→ 自动变成动态渲染
import { cookies } from 'next/headers';
const theme = cookies().get('theme');  // 调用这一行之后，整个路由自动放弃 Full Route Cache
```

**决策的判断标准其实很简单**：这个数据"是不是所有人看到的都一样"？一样 → 可以缓存；因人而异或要求实时 → 别缓存,或者缓存后记得在写操作时主动 `revalidatePath`。

---

## 十一、给博客加上 SEO：Metadata API

写完功能后，博客站还有个现实需求——**搜索引擎和社交媒体分享卡片需要读到正确的 `<title>`、`<meta description>`**。这在 Server Component 体系里有专门的导出方式：

```js
// app/blog/[slug]/page.js
export async function generateMetadata({ params }) {
  const post = await db.posts.findBySlug(params.slug);
  
  return {
    title: post.title,
    description: post.summary,
    openGraph: {
      title: post.title,
      images: [post.coverImage],
    },
  };
}

export default async function BlogPost({ params }) {
  // ...
}
```

**为什么这个函数要单独导出，而不是在组件里直接改 `document.title`？** 因为 `generateMetadata` 在**组件渲染之前**、且**在服务端**执行完毕，最终结果直接写进响应的 `<head>` 里。搜索引擎爬虫大多不执行 JS，所以只有服务端提前算好、直接躺在 HTML 里的 meta 信息才是可靠的——这跟组件必须是 Server Component 默认执行是同一个逻辑：**能在服务端确定的东西,就不要指望客户端 JS 去补**。

---

## 十二、把整个流程串一遍：一次请求的完整生命周期

现在博客站的功能已经齐了（路由、布局、加载态、错误处理、评论提交、缓存、SEO），我们把一次真实请求走一遍，看看这些机制是怎么配合工作的：

```
用户访问 https://blog.com/blog/how-i-learned-react

① Next.js 匹配路由
   → app/blog/[slug]/page.js，params = { slug: 'how-i-learned-react' }

② 检查缓存（Full Route Cache）
   → 命中且未过期？直接返回缓存的 HTML（几毫秒）
   → 未命中？继续下一步

③ 依次执行 Server Component 渲染
   3a. app/layout.js（Root Layout）
   3b. app/blog/layout.js（如果有）
   3c. app/blog/[slug]/loading.js → 立即产出骨架屏（走 Suspense fallback）
   3d. app/blog/[slug]/page.js
       - generateMetadata() 先算好 <head>
       - await db.posts.findBySlug(...) 查数据
       - 渲染出 JSX → 转换成 RSC Payload（$/@ 格式，Day16 学过）

④ Streaming 响应
   → 先把 Layout + 骨架屏发给浏览器（用户立刻看到东西）
   → 数据库查询完成后，追加真实内容替换骨架屏
   → 如果查询失败，追加 error.js 渲染的内容替换骨架屏

⑤ 浏览器接收
   → HTML/Payload 解析 → 页面可见（不需要等 JS 加载）
   → CommentForm 这类 Client Component 的 JS 加载完成 → 可交互

⑥ 用户提交评论
   → 表单提交触发 Server Action (addComment)
   → 服务端执行、写数据库、调用 revalidatePath
   → 该路由的 Full Route Cache 被标记失效
   → 下一个访问者会重新触发步骤 ③
```

这一整条链路,其实就是前面十一节内容的组合——**没有任何一个环节是孤立的特性,都是为了解决同一个目标（让用户尽快看到内容,同时保证数据最终一致）而互相配合**。

---

## 十三、几个容易被面试问到、也容易被自己绕晕的点

**Q1：`"use client"` 会不会导致它下面所有子组件都变成 Client Component？**

不是按 JSX 嵌套关系传播的，是按 **import 依赖链** 传播的：

```js
"use client";
import Comment from './Comment';  // Comment 没写 "use client"

function CommentList() {
  return <Comment />;  // Comment 仍然被拉入 client bundle，变成 Client Component
}
```

但如果 `Comment` 是通过 `{children}` 从一个 Server Component 传进来的（而不是被 Client Component 直接 import），它可以保持 Server Component 身份——这是 Composition Pattern，实践中常用它把交互壳做薄。

**Q2：为什么 App Router 比传统 SSR 首屏快？**

不是因为服务端算得更快，是因为**响应可以分批发送**（Streaming），浏览器不需要等最慢的那部分数据,先看到导航栏和骨架屏,体感响应快了一个量级。

**Q3：Layout 和 Template 该怎么选？**

问自己一句话："如果用户在 `/blog/a` 和 `/blog/b` 之间来回切换，这个组件里的状态应该保留还是重置？" 保留 → Layout，重置 → Template。

**Q4：Server Action 和 Route Handler 应该用哪个？**

给页面内表单/按钮用 Server Action（更少代码，自动处理 FormData）；给外部客户端（移动端 App、第三方）调用用 Route Handler（标准 HTTP 接口，谁都能调）。

---

## 十四、今日总结

把整篇内容串回一句话：

> **Pages Router 时代组件默认要发到客户端，App Router 把默认值反过来，逼着你去思考"这一小块到底需不需要在浏览器里跑"——文件路由、Layout、Loading/Error、Server Action、缓存，都是在这个新默认值之上，为了把开发体验和运行性能同时做好而搭建的配套设施。**

记忆口诀（对应今天讲的顺序）：

```
Server by Default   —— 默认服务端，需要交互才标记 client
File as Route       —— 目录结构就是路由表
Layout Persists     —— 布局不因路由切换而重新挂载
Stream, Don't Wait  —— 骨架屏先顶上，数据到了再替换
Action Over Fetch   —— 表单提交直接绑函数，不必手写 API
Cache Unless Told   —— 默认缓存，写操作后主动 revalidate
```
