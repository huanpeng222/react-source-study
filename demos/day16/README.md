# Day 16 实验：React Server Components 原理

> RSC 需要真实的服务端渲染环境才能观察"服务端组件零 JS、Server→Client 边界"等效果。用 Next.js App Router 是目前最简单能跑起来的方式（Next.js 是 RSC 的官方参考实现之一）。

## 环境准备

```bash
cd demos/day16
npx create-next-app@latest playground --app --no-typescript --no-tailwind --no-eslint --src-dir=false
cd playground
npm run dev
```

---

## 实验 R1：Server Component 里真的没有 JS 发到浏览器

在 `app/page.js` 里写：

```jsx
// app/page.js —— 默认就是 Server Component，不用写任何指令
async function getUser() {
  // 模拟服务端直接"查库"（这段代码永远不会出现在浏览器 bundle 里）
  await new Promise(r => setTimeout(r, 100));
  return { name: '用户A', role: 'admin' };
}

export default async function Page() {
  const user = await getUser(); // 直接 await，Server Component 支持 async
  console.log('[Server] Page 渲染，这行日志只会出现在终端(npm run dev 的控制台)，不会出现在浏览器Console！');

  return (
    <div style={{ padding: 20 }}>
      <h1>你好, {user.name}</h1>
      <p>角色: {user.role}</p>
      <ClientCounter />
    </div>
  );
}
```

在 `app/ClientCounter.js` 里写：

```jsx
'use client'; // ← 分界线

import { useState } from 'react';

export default function ClientCounter() {
  const [count, setCount] = useState(0);
  console.log('[Client] ClientCounter 渲染，这行日志会出现在浏览器Console');
  return <button onClick={() => setCount(c => c + 1)}>点击次数: {count}</button>;
}
```

记得在 `app/page.js` 顶部 `import ClientCounter from './ClientCounter'`。

**操作步骤**：
1. 打开浏览器 DevTools → **Network** 面板，刷新页面，搜索响应内容里有没有出现 `getUser`、`await new Promise` 这些源码字符串。
2. 对比浏览器 Console 和终端（跑 `npm run dev` 的那个终端窗口）—— `[Server]` 日志出现在哪里，`[Client]` 日志出现在哪里。
3. 点击按钮，观察计数器是否正常工作（客户端组件的交互能力）。

**记录到 observations.md**：`getUser` 函数体是否出现在浏览器收到的任何 JS 文件里？两条 console.log 分别出现在哪个环境？

---

## 实验 R2：Server → Client 传 props 必须可序列化

修改 `ClientCounter.js`，接收 props：

```jsx
'use client';
import { useState } from 'react';

export default function ClientCounter({ initialUser, onIncrement }) {
  const [count, setCount] = useState(0);
  console.log('[Client] 收到的 props:', { initialUser, onIncrement });
  return (
    <div>
      <p>初始用户: {JSON.stringify(initialUser)}</p>
      <p>onIncrement 类型: {typeof onIncrement}</p>
      <button onClick={() => setCount(c => c + 1)}>{count}</button>
    </div>
  );
}
```

在 `page.js` 里故意传一个函数（大概率会报错或被特殊处理）：

```jsx
<ClientCounter
  initialUser={{ name: '用户A' }}    // ✅ 可序列化（普通对象）
  onIncrement={() => console.log('incremented')}  // ❌ 函数，不可序列化
/>
```

**操作步骤**：观察浏览器 Console 和终端是否报错，报错信息里有没有提到"functions cannot be passed directly"之类的字样。把 `onIncrement` 去掉后再试一次，确认 `initialUser` 这种普通对象可以正常传递。

**记录到 observations.md**：传函数会报什么错误？把函数换成普通对象/字符串/数字后是否就正常了？

---

## 实验 R3：RSC vs 传统 SSR 的 Network 面板对比

1. 保留上面的 `page.js`，刷新页面时观察 Network 面板里的文档请求（Response 里应该能看到接近 HTML 的内容，但如果导航到另一个页面再返回，可以看到 RSC 特有的 `Content-Type: text/x-component` 格式的请求，通常文件名类似 `?_rsc=xxx`）。
2. 在浏览器地址栏直接改 query 或点击一个 `<Link>` 导航，观察 Network 里是否出现一个只返回**部分数据**（不是整页 HTML）的请求。

**记录到 observations.md**：导航时观察到的请求 Content-Type 是什么？返回内容是完整 HTML 还是类似 JSON/流式的 payload 结构？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| R1 | 服务端逻辑代码不出现在浏览器 bundle 里 | Server Component 只在服务端执行，产出序列化结果 |
| R2 | 传函数报错，传普通对象/基本类型正常 | Server→Client 边界的 props 必须可序列化 |
| R3 | 导航时是特殊 payload 请求，不是整页 HTML | RSC 的部分更新机制，区别于传统 SSR 整页刷新 |

---

## 完成后

```bash
git add demos/day16 notes/day16.md
git commit -m "W4 D16 RSC原理：完成真实Next.js实验(Server/Client边界/序列化限制/RSC payload观察)"
git push
```
