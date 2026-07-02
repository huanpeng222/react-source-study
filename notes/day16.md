# Day 16 笔记：React Server Components (RSC) 原理深度

> 日期：2026-07-02
> 主题：RSC 架构 / 客户端-服务器边界 / 序列化协议 / "use client" 指令原理 / RSC vs SSR
> 状态：📖 学习中
> 源码出处：
> - `react-server` 包（React 官方 RSC runtime）
> - Next.js App Router `react-server-dom` 编译输出
> - React RFC #189 (Server Components)

---

## 零、入场自测（先答，不会就写"不会"）

1. 你知道什么是 React Server Components 吗？和 SSR 有什么区别？
2. `"use client"` 和 `"use server"` 这两个指令分别放在哪个文件？它们的作用是什么？
3. 哪些代码只能在服务器组件里运行？哪些只能在客户端？
4. 什么是 RSC 的"序列化边界"？为什么不能把函数传给客户端？
5. RSC payload 长什么样？和 HTML 有什么不同？

---

## 一、先破除一个最大的误解

### ❌ "RSC 就是 SSR"

**完全不是一回事。** 这是 90% 的人第一反应就搞混的。

```
SSR（服务端渲染）：
  服务器执行 React 组件 → 输出 HTML 字符串 → 发给浏览器
  ↓ 浏览器收到的是纯 HTML（没有交互能力）
  ↓ 然后 hydrate → JS 加载后"激活"成可交互页面

RSC（服务器组件）：
  服务器执行部分组件 → 产出一份 RSC Payload（$/@ 编码的树形数据)
  ↓ 这份 Payload 具体怎么发给客户端，分两种场景：
  
  场景A：用户首次直接访问 URL（浏览器地址栏/爬虫抓取）
    服务器会把 Payload 再转成一份**真正的 HTML**（用于首屏展示）
    这份 HTML 直接发给浏览器/爬虫 → 爬虫读到的就是完整内容，SEO 生效
    同时把 RSC Payload 编码后内嵌进这份 HTML 的 <script> 标签里
    （给客户端 JS 之后做 hydrate/挂载 Client Component 用）
    
  场景B：用户站内点击 <Link> 做客户端导航
    这次服务器**只返回纯 RSC Payload，不再包一层 HTML**
    客户端已加载的 React 直接用它更新内存里的组件树、patch DOM
    （这才是"RSC 不需要 hydrate"、"不是HTML"这句话真正适用的场景）
```

**关键澄清（容易被误解的地方）**：不要把"RSC Payload 本身不是 HTML"和"用户访问页面时看不到 HTML"混为一谈。首次访问时，Payload 会被转成完整 HTML 发出去，爬虫和无 JS 用户看到的是货真价实的 HTML；只有站内客户端导航时，响应体才是纯 Payload、不含 HTML。这也是为什么 RSC 既不影响 SEO，又能让页面切换比传统 SPA 更快。

关键区别：

| 维度 | SSR | RSC |
|------|-----|-----|
| **产物** | HTML 字符串 | 首次访问=HTML(内嵌Payload)；客户端导航=纯Payload |
| **交互性** | 需要hydrate才能交互 | 客户端组件天然可交互 |
| **粒度** | 整个页面一起渲染 | 可以一棵树上混着服务器+客户端组件 |
| **数据获取** | 在 renderToString 时一次性完成 | 组件级按需，每个服务器组件独立获取 |
| **JS bundle** | 整个应用 JS 都要加载 | 服务器组件的代码**永远不会下载到浏览器** |

### 最核心的价值：**零 JS 开销**

```jsx
// 这个组件在服务器上运行
// 它的代码永远不会出现在浏览器的 JS bundle 里
async function NoteList({ userId }) {
  // ✅ 可以直接查数据库（Node.js 环境）
  const notes = await db.query('SELECT * FROM notes WHERE user_id = ?', [userId]);
  
  return (
    <ul>
      {notes.map(note => <li key={note.id}>{note.title}</li>)}
    </ul>
  );
}
// ↑ 这个组件编译后的产物只有渲染结果
//   浏览器拿不到 db、query、NoteList 的任何源码
//   这就是"零 JS"
```

---

## 二、架构模型：一棵树，两个世界

```
                    ┌──────────────┐
                    │    Root      │ ← 默认是 Server Component
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────┴──────┐ ┌────┴─────┐ ┌──────┴──────┐
     │  Header     │ │ NoteList │ │   Footer    │
     │  (Server)   │ │ (Server) │ │  (Client)   │
     │             │ │          │ │ "use client"│
     │ ┌────────┐  │ │ ┌──────┐ │ │             │
     │ │Logo    │  │ │ │Item×N│ │ │ ThemeToggle │
     │ │(Server)│  │ │ │(Srv) │ │ │ SearchBar   │
     │ └────────┘  │ │ └──────┘ │ │ (都是 Client)│
     │ ┌────────┐  │ └──────────┘ │ ┌───────────┐ │
     │ │Nav     │  │              │ │UserMenu   │ │
     │ │(Client)│  │              │ └───────────┘ │
     │ │"use c" │  │              └──────────────┘
     │ └────────┘  │
     └─────────────┘

规则：
  - 默认所有组件都是 Server Component
  - 只有标记了 "use client" 的才是 Client Component
  - Server 可以 import Client，但 Client 不能 import Server
  - Server → Client 是单向依赖
```

---

## 三、两条铁律

### 铁律 1：Server → Client ✅，Client → Server ❌

```jsx
// ✅ 合法：Server Component 引入 Client Component
// ServerComponent.jsx （默认就是 Server，不需要任何指令）
import { ThemeToggle } from './ThemeToggle';  // ThemeToggle 标记了 "use client"

function ServerComponent() {
  return (
    <div>
      <h1>这是服务器组件</h1>
      <ThemeToggle />  {/* 这里是客户端边界 */}
    </div>
  );
}

// ❌ 非法：Client Component 引入 Server Component
// ThemeToggle.jsx
"use client";  // 标记为客户端组件

import { NoteList } from './NoteList';  // ⚠️ 编译报错！

// 为什么不行？因为 Client 组件的代码会打包到浏览器
// 如果允许它 import Server 组件 → Server 组件的代码也会被打包进去
// 那 Server 组件里的数据库查询代码就会暴露到前端 = 安全灾难
```

### 铁律 2：跨边界的 props 必须可序列化

```jsx
// Server Component 可以传什么给 Client Component？

function NotePage() {
  const note = { id: 1, title: 'Hello', body: 'World' };  // 纯数据
  
  return (
    <NoteEditor 
      initialTitle={note.title}        // ✅ string → 可序列化
      initialBody={note.body}          // ✅ string → 可序列化
      noteId={note.id}                 // ✅ number → 可序列化
      onSave={async (data) => {        // ❌ 函数 → 不可序列化！
        await saveToDB(data);           //    但这里有个例外（后面讲）
      }}
    />
  );
}
```

**可序列化的类型**：
- `string`, `number`, `boolean`, `null`, `undefined`
- 普通 `object` / `array`（只包含上述基本类型的）
- `Date` / `RegExp` / `Map` / `Set` / `BigInt` / `Symbol`（有限支持）

**不可序列化的类型**（传过去会丢失或报错）：
- **函数** — 除非用 `"use server"` 包装（Server Actions）
- **类实例**
- **DOM 元素 / 事件对象**
- **React 元素 / JSX**（但可以传 children）

---

## 四、"use client" 指令深度解析

### 它到底是什么？

```js
"use client";
```

**这不是运行时指令，而是编译时指令。** 它告诉打包工具（Webpack/Rollup/Next.js compiler）：

> "这个文件及其所有依赖（除了再次被 'use client' 边界隔开的），都要打包进客户端 JS bundle。"

### 编译器怎么处理它？

```
原始文件结构：
  app/
    page.jsx          ← Server Component（默认）
    components/
      Header.jsx      ← Server Component
      ThemeToggle.jsx ← "use client"
      SearchBar.jsx   ← "use client"
      UserMenu.jsx    ← "use client"（被 SearchBar import）

编译后的结果：

  【客户端 Bundle】包含：
    ThemeToggle.jsx + SearchBar.jsx + UserMenu.jsx
    + 它们依赖的所有 react/react-dom 代码

  【服务端 Bundle】包含：
    page.jsx + Header.jsx + 所有 Server Component
    + 数据库查询等 Node.js 代码

  关键点：SearchBar import 了 UserMenu
  因为两者都标记了 "use client"，所以 UserMenu 也进入客户端 bundle ✅
  
  如果 UserMenu 没有 "use client" 但被 SearchBar（client）import 了呢？
  → 它会被强制提升为 Client Component！（隐式 client boundary）
  → 这是一个常见的性能陷阱
```

### 隐式 Client Boundary —— 性能陷阱

```jsx
// SearchBar.jsx  ← "use client"
"use client";
import { UserAvatar } from './UserAvatar';
// UserAvatar.jsx 没有标记 "use client"！
// 但因为它被 Client Component import 了 → 被拖入客户端 bundle

function UserAvatar() {
  // 这个组件本可以只跑在服务端（只是显示头像图片）
  // 但现在它的代码也被打包到浏览器了 😢
  return <img src={`/avatar/${userId}.jpg`} alt="avatar" />;
}
```

**教训**：如果一个组件不需要任何客户端能力（无事件、无 state、无 effect、无浏览器 API），**不要让 Client Component import 它。** 把它提到 Server 层作为 children 传入：

```jsx
// ✅ 正确写法：children 保持服务端
function SearchBar({ children }) {  // "use client"
  const [query, setQuery] = useState('');
  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      {/* children 由父级（Server）传入，保持服务端 */}
      {children}
    </div>
  );
}

// 在 Server Component 中使用：
<SearchBar>
  <UserAvatar />  {/* 始终在服务端渲染 ✅ */}
</SearchBar>
```

---

## 五、"use server" 指令与 Server Actions

这是 RSC 中最革命性的功能——**从客户端直接调用服务端函数**。

### 基本用法

```jsx
// actions.ts —— 服务端动作文件
'use server';

// 这个函数只在服务端执行
export async function submitNote(formData: FormData) {
  const title = formData.get('title') as string;
  const body = formData.get('body') as string;
  
  // ✅ 可以直接操作数据库
  const result = await db.notes.insert({ title, body });
  
  // ✅ 可以调用其他 Node.js API
  revalidatePath('/notes');  // 清除缓存
  
  return { success: true, id: result.id };
}

// ===== 客户端组件中使用 =====
// NoteForm.jsx
"use client";

import { submitNote } from '../actions';

export function NoteForm() {
  async function handleSubmit(formData) {
    // ★ 从客户端直接调用服务端函数！
    // 不需要手动 fetch、不需要定义 API route
    const result = await submitNote(formData);
    if (result.success) {
      alert('保存成功！');
    }
  }

  return (
    <form action={handleSubmit}>
      <input name="title" placeholder="标题" />
      <textarea name="body" placeholder="内容" />
      <button type="submit">保存</button>
    </form>
  );
}
```

### 底层原理：它是怎么做到的？

```
编译过程：

1. 编译器看到 'use server' 标记
2. 把这个函数提取到一个独立的服务端模块
3. 生成一个客户端存根（stub）函数：
   
   // 客户端实际拿到的 submitNote：
   async function submitNote(formData) {
     const res = await fetch('__rsc_action__', {
       method: 'POST',
       body: JSON.stringify({
         id: 'xxx-action-id',   // 编译时生成的唯一 ID
         args: serialize(formData),  // 序列化参数
       })
     });
     return res.json();  // 返回服务端执行结果
   }

4. 运行时：
   客户端调用 submitNote()
     → 实际发送 HTTP POST 到服务端
     → 服务端根据 action ID 找到真正的函数
     → 用序列化好的参数执行
     → 返回结果
```

**所以 `use server` 的本质就是一个 RPC（远程过程调用）框架**，由编译器和运行时自动帮你生成客户端存根和服务端路由。

---

## 六、RSC Payload 格式 —— 到底传输的是什么？

这是理解 RSC 最硬核的部分。当服务器组件渲染完成后，它输出的不是 HTML：

```
传统 SSR 输出：
  "<html><body><div><h1>Hello</h1></div></body></html>"
  ↑ 纯文本 HTML 字符串

RSC 输出（RSC Payload）：
  一个流式的类 JSON 树形结构，长这样：
```

```json
[
  "$", "div", null, [
    ["$", "h1", null, "Hello"],
    ["$", "NoteList", { userId: "123" }, [
      ["$", "li", null, "First note"],
      ["$", "li", null, "Second note"]
    ]],
    ["$", "@", "./ThemeToggle", { "default": { "theme": "dark" } }],
    ["$", "Footer", null]
  ]
]
```

逐段解读这个 payload：

| 片段 | 含义 |
|------|------|
| `$` | **普通元素** — 后面跟 tag名、props、children |
| `$,"div"` | `<div>` 元素 |
| `$,"NoteList"` | **服务器组件** — 已经在服务端渲染完毕，结果是子数组 |
| `@` | **客户端组件引用** — 后面跟文件路径和 props |
| `"@","./ThemeToggle"` | "去加载 ./ThemeToggle.js 这个客户端组件，用这些 props 渲染它" |

**客户端拿到这个 payload 后做什么？**

```
1. 解析 payload（是一个流，可以逐步接收）
2. 遇到 $ → 直接创建 DOM 元素（像 ReactDOM.createElement）
3. 遇到 @ → 动态 import() 加载对应的客户端组件 JS → 渲染
4. 整个过程是渐进的：不用等整棵树完成就能开始渲染
5. 不需要 hydrate（因为没有初始 HTML 要匹配）
```

这就是为什么 RSC **比 SSR 更快**：
- SSR：等整棵树 → 输出完整 HTML → 下载 JS → hydrate（对比 DOM 差异）
- RSC：流式输出 payload → 边接收边渲染 → 只下载客户端组件的 JS

---

## 七、RSC vs SSR 完整对比

| 特征 | SSR (renderToString) | RSC (Server Components) |
|------|---------------------|------------------------|
| **执行环境** | Node.js（全量） | Node.js（仅 Server Components） |
| **产物** | HTML 字符串 | RSC Payload（类 JSON 流） |
| **客户端需要** | 完整 React + 应用 JS + hydrate | 仅 Client Components JS（通常小很多） |
| **数据获取时机** | render 时同步或预取 | 组件级别异步（`await` 在组件内） |
| **互操作性** | 需要完整的 hydration 匹配 | 天然兼容（payload → 直接渲染） |
| **可缓存粒度** | 页面级别 | **组件级别**（单个 Server Component 可独立缓存） |
| **适合场景** | SEO + 首屏速度 | 复杂应用 + 大量数据获取 |
| **代表框架** | Next.js Pages Router | **Next.js App Router** |

### 一个具体例子看差异

```jsx
// 同一个页面，两种方案的数据流：

// ===== 方案 A: 传统 SSR =====
// 服务器一次性做完所有事
app.get('/page', async (req, res) => {
  const html = renderToString(<App />);  // 所有组件在这里执行
  res.send(`<!DOCTYPE html>${html}`);
});
// 问题：
// 1. 用户必须等最慢的那个组件
// 2. 整个页面的 JS 都要下载
// 3. 无法做组件级缓存

// ===== 方案 B: RSC =====
// 服务器组件各自独立执行，流式返回
async function Page() {
  // 这三个组件并行执行，最快的先返回
  return (
    <>
      <Suspense fallback={<Skeleton />}>
        <NoteList />         {/* 可能要 200ms */}
      </Suspense>
      <Sidebar />            {/* 可能只要 50ms */}
      <Recommendations />    {/* 可能要 500ms，但不阻塞其他 */}
    </>
  );
}
// 优势：
// 1. Sidebar 最快 → 先显示
// 2. NoteList 完成 → 流式追加到 payload
// 3. Recommendations 最后到 → 追加
// 4. 每个 Server Component 可以独立 CDN 缓存
```

---

## 八、什么时候该用 Server Component？什么时候用 Client Component？

### ✅ 用 Server Component 当你需要：

| 场景 | 示例 |
|------|------|
| **访问数据库 / 文件系统 / 内部 API** | `const posts = await db.posts.findMany()` |
| **读取秘密信息（密钥、token）** | `const key = process.env.API_KEY` |
| **减少客户端 JS 体积** | 大型列表/表格/详情页的内容区 |
| **SEO 需要** | 博客文章、产品详情 |
| **需要直连后端资源** | 读取文件生成 PDF、调用 AI API |

### ✅ 用 Client Component 当你需要：

| 场景 | 示例 |
|------|------|
| **事件处理** | `onClick`, `onChange`, `onSubmit` |
| **状态管理** | `useState`, `useReducer` |
| **生命周期 / 副作用** | `useEffect`, `useLayoutEffect` |
| **浏览器专属 API** | `localStorage`, `geolocation`, `window/document` |
| **自定义 Hook 依赖上述能力** | 很多第三方库 |
| **动画 / 交互** | drag & drop、表单验证实时反馈 |

### 🎯 黄金法则：**默认 Server，按需加 "use client"**

```jsx
// 开发时的思维流程：

// 1. 先不标记 → 默认 Server Component
function MyComponent({ data }) {
  return <div>{data.title}</div>;
  // ✅ 纯展示 → Server 就够了
}

// 2. 发现需要交互 → 加 "use client"
"use client";
function MyComponent({ data }) {
  const [open, setOpen] = useState(false);  // 需要状态
  return (
    <div onClick={() => setOpen(!open)}>
      {data.title}
      {open && <Details />}
    </div>
  );
}

// 3. 发现只有一小块需要交互 → 拆分！
// MyComponent.jsx（保持 Server）
function MyComponent({ data }) {
  return (
    <div>
      <span>{data.title}</span>
      <ExpandButton />  {/* 只把交互部分抽出去 */}
    </div>
  );
}

// ExpandButton.jsx（唯一加 "use client" 的）
"use client";
function ExpandButton() {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(!open)}>{open ? '收起' : '展开'}</button>;
}
```

---

## 九、RSC 的限制和注意事项

### 1. 不能在 Server Component 里用 Hooks（除了有限的几个）

```jsx
// ❌ 这些都不行（Server Component 里）
useState()        // 无状态
useEffect()       // 无副作用
useReducer()      // 无 reducer
useContext()      // 无 Context（但可以做 Provider）

// ✅ 这些可以用
use(params)       // Next.js 提供的参数 Hook
useSearchParams() // URL 参数
```

### 2. Server Component 不能是 form 的 action

```jsx
// ❌ 不行
function ServerForm() {
  async function handleSubmit() { ... }
  return <form action={handleSubmit}>;  // 报错！
}

// ✅ 要么做成 Client Component，要么用 Server Action
// ServerAction 版：
'use server';
export default async function handleSubmit(formData) { ... }
```

### 3. Error Boundary 在两边都能用，但行为不同

```
Server Component 抛错:
  → 服务端捕获 → 显示 fallback UI（在 payload 中）
  → 不影响其他 Server Components

Client Component 抛错:
  → 客户端 ErrorBoundary 捕获
  → 行为和普通 React 一样
```

---

## 十、总结：面试口述版

> **RSC 是什么？**
> 
> React Server Components 让你可以在服务端执行 React 组件。默认所有组件都是 Server Component，只有加了 `"use client"` 才变成 Client Component。Server Component 的代码不会下载到浏览器。
> 
> **核心价值三点**：
> 1. **零 JS**：Server Component 的代码永远不进客户端 bundle
> 2. **直连后端**：可以直接访问数据库、文件系统、内部 API
> 3. **流式渲染**：通过 RSC Payload（类 JSON 树形数据）逐步传输，不用等整页
> 
> **四条铁律**：
> 1. Server 可以 import Client，Client 不能 import Server
> 2. 跨边界 props 必须可序列化（函数除外，需用 `use server` 包装）
> 3. `"use client"` 是编译时指令，告诉打包工具"把这个打进客户端 bundle"
> 4. `"use server"` 创建 Server Actions——从客户端远程调用服务端函数
> 
> **vs SSR**：SSR 出 HTML（需要 hydrate），RSC 出 Payload（直接渲染，无需 hydrate）。RSC 粒度更细（组件级缓存、并行渲染）、JS 更少（只下载 Client Component 代码）。
