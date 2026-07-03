# Day 13 笔记：React 19 Actions 体系

> 日期：2026-07-01
> 主题：React 19 Actions / useActionState / useFormStatus / useOptimistic / Server Components 初探
> 状态：📖 教程完成，待跟练
> 源码出处：
> - `packages/react-reconciler/src/ReactFiberWorkLoop.js`（dispatchAction → Action 处理）
> - `packages/react/src/ReactHooks.js`（useActionState / useFormStatus / useOptimistic 实现）
> - `packages/react-server/src/ReactFizzServer.js`（Server Components 流水线）

---

## 零、入场自测（先答，不会就写"不会"）

1. 你之前写表单提交是怎么做的？`e.preventDefault()` + `fetch()` + `setState` + 错误处理？这套流程有什么痛点？

2. React 19 的 `<form action={fn}>` 里，`fn` 是一个普通函数还是有什么特殊要求？如果这个函数是 async 的，React 怎么处理？

3. `useOptimistic` 和普通的 `useState` + "先更新再请求"手写乐观更新有什么本质区别？（提示：想想错误回滚）

4. 传统 SSR（如 Next.js `getServerSideProps`）和 React Server Components（RSC）的根本区别是什么？不只是"服务端渲染"那么简单吧？

---

## 一、为什么需要 Actions？（表单的旧时代）

### 1.1 旧写法回顾

你之前写表单提交，大概率长这样：

```jsx
function OldForm() {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();                    // ① 手动阻止默认行为
    setLoading(true);                     // ② 手动管理 loading
    setError(null);
    try {
      const res = await fetch('/api/user', {
        method: 'POST',
        body: JSON.stringify({ name }),   // ③ 手动收集数据
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('创建失败');
      setSuccess(true);                   // ④ 成功状态
    } catch (err) {
      setError(err.message);              // ⑤ 错误处理
    } finally {
      setLoading(false);                   // ⑥ 关闭 loading
    }
    // ⑦ 如果是列表页还要 refetch...
  };

  return (
    <form onSubmit={handleSubmit}>
      <input value={name} onChange={e => setName(e.target.value)} />
      {loading && <Spin />}
      {error && <div className="error">{error}</div>}
      {success && <div className="success">成功！</div>}
      <button type="submit" disabled={loading}>提交</button>
    </form>
  );
}
```

**数一数你手动管了几个状态？**

| 你手写的 | 用途 |
|---|---|
| `name` | 表单字段值 |
| `loading` | 提交中 |
| `error` | 错误信息 |
| `success` | 成功标志 |
| `e.preventDefault()` | 阻止刷新 |
| 手动 `fetch()` | 发请求 |
| 手动序列化 body | 收集数据 |

**7 个手动操作**，而且每个表单都重复一遍。这就是 Actions 要解决的问题。

### 1.2 Actions 的核心理念

> **Action = 一个能处理异步操作的函数，React 自动帮你管好 transition + loading + error。**

```jsx
// React 19 写法
async function createUser(formData) {   // 不需要 e.preventDefault()！
  const name = formData.get('name');     // FormData 自动传入！
  const user = await db.users.create({ name });  // 直接 await
  return user;                           // 返回值给 useActionState 用
}

// 使用
<form action={createUser}>
  <input name="name" />
  <button type="submit">提交</button>
</form>
```

**对比一下减少了多少东西：**
- ❌ 不要 `e.preventDefault()` —— React 自动处理
- ❌ 不要手动 `useState` 管 loading/error —— `useActionState` 接管
- ❌ 不要手动收集 input value —— **FormData** 自动传进来
- ❌ 不要手动 try/catch/finally —— Action 函数抛错自动变 error state

---

## 二、Action 函数详解

### 2.1 什么是 Action？

Action 是 React 19 引入的一个**概念**（不是新类型），指满足以下条件的函数：

```
✅ 同步或异步函数都可以
✅ 可以接收参数（由调用方决定传什么）
✅ 返回值会被 useActionState 捕获
✅ 执行期间自动包在 startTransition 里（不阻塞用户输入）
```

关键源码位置——当 `<form action={fn}>` 或 `<button formAction={fn}>` 触发时：

```js
// ReactFiberWorkLoop.js（简化逻辑）
function dispatchAction(fiber, action) {
  // 1. 标记当前更新为 Transition（低优先级）
  const lane = requestTransitionLane();
  
  // 2. 把 action 包装成 update 对象
  const update = {
    action: fn,           // 你的 action 函数
    payload: args,        // 参数（FormData 等）
    lane: lane,
  };
  
  // 3. 调度到 workLoop
  scheduleUpdateOnFiber(fiber, lane);
}
```

**核心点：Action 触发的更新默认走 Transition Lane**，这意味着：

| 对比项 | 普通 setState | Action |
|---|---|---|
| 优先级 | UserBlocking（高） | Transition（低） |
| 可中断 | ❌ 不可中断 | ✅ 可被更高优先级打断 |
| 并发安全 | 可能阻塞输入 | 用户可继续打字/点击 |
| 适用场景 | 即时反馈 | 表单提交/网络请求 |

### 2.2 Action 的两种触发方式

**方式 A：`<form action={fn}>`**

```jsx
<form action={async (formData) => {
  const name = formData.get('name');
  // 这里的 this === null（严格模式或模块环境）
  await submitToServer(name);
}}>
  <input name="email" defaultValue="test@example.com" />
  <button type="submit">注册</button>
</form>
```

**方式 B：`<button formAction={fn}>`**

```jsx
<form action={saveDraft}>
  {/* 默认按钮：保存草稿 */}
  <input name="title" />

  {/* 特殊按钮：发布 */}
  <button type="submit" formAction={publishPost}>发布文章</button>
  {/* 特殊按钮：预览 */}
  <button type="submit" formAction={previewPost}>预览</button>
</form>
```

**⭐ 一个表单多个 Action 按钮 = 不同按钮做不同事**，这在以前需要用 `e.submitter.name` 判断来源，现在直接声明式搞定。

### 2.3 Action 与 FormData

这是 Action 设计最巧妙的一点：

```jsx
// HTML 表单元素自动序列化为 FormData
<form action={submitOrder}>
  <input name="product" value="iPhone" />       // → formData.get('product') = 'iPhone'
  <textarea name="note">备注内容</textarea>      // → formData.get('note') = '备注内容'
  <select name="quantity">
    <option value="1" selected />                 // → formData.get('quantity') = '1'
    <option value="2" />
  </select>
  <input type="checkbox" name="giftWrap" />      // → formData.get('giftWrap') = 'on'（有勾选时）
  <input type="radio" name="size" value="L" checked /> // → formData.get('size') = 'L'
  <button type="submit">下单</button>
</form>

// Action 函数收到的是原生 FormData 对象
async function submitOrder(formData) {
  const product = formData.get('product');
  const quantity = parseInt(formData.get('quantity'), 10);
  const giftWrap = formData.has('giftWrap');     // checkbox 用 has()
  // ...
}
```

**不需要受控组件了！** 不再用 `useState` 给每个 input 绑定 value/onChange。对于简单表单，非受控 + FormData 更省代码。

> 📌 **微检查点 1**：那如果我某些字段需要实时校验（比如输入时即时显示错误提示），还能用非受控吗？什么时候必须用受控组件？

---

## 三、useActionState：替代手写 useState + fetch

### 3.1 基本 API

```jsx
const [state, dispatchFn, isPending] = useActionState(actionFn, initialState, permalink?);
//         ↑          ↑              ↑
//    返回值(最新)  触发函数      是否正在执行
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `actionFn` | `(prevState, formData) => Promise\<any\>` 或同步函数 | Action 函数本身 |
| `initialState` | any | 初始状态（首次 render 前） |
| `permalink?` | string | SSR 时用于 hydration 的 URL（一般不用管） |

**返回值：**
| 返回 | 类型 | 说明 |
|---|---|---|
| `state` | any | actionFn 返回的最新值 |
| `dispatchFn` | Function | 传给 `<form action={...}>` 或直接调用的函数 |
| `isPending` | boolean | 当前是否有 action 在执行中 |

### 3.2 完整示例

```jsx
import { useActionState } from 'react';

async function increment(prevState, formData) {
  const step = parseInt(formData.get('step') || '1', 10);
  return prevState + step;   // 返回值成为新的 state
}

function CounterForm() {
  //                          ↑ action    ↑ 初始值
  const [count, dispatchCount, isPending] = useActionState(increment, 0);

  return (
    <form action={dispatchCount}>
      <p>当前计数: {count}</p>
      {isPending && <span style={{ color: 'orange' }}>计算中...</span>}
      <input type="hidden" name="step" value="1" />
      <button type="submit" disabled={isPending}>+1</button>
      <button type="submit" disabled={isPending} formAction={
        async (prev, fd) => prev + parseInt(fd.get('step') || '5', 10)
      }>+5</button>
    </form>
  );
}
```

### 3.3 useActionState vs useReducer：关键区别

这个问题面试高频，仔细看：

| 维度 | `useReducer` | `useActionState` |
|---|---|---|
| **触发方式** | `dispatch({ type: 'ADD' })` | `<form action={dispatch}>` 或直接调用 |
| **函数签名** | `(state, action) => newState` （纯同步） | `(prevState, formData) => Promise\<any\>` **支持 async** |
| **pending 状态** | ❌ 没有，自己加 `useState` | ✅ **内置 isPending** |
| **error 处理** | 自己 try/catch | ✅ **action 抛错自动捕获为 error state**（见下节） |
| **Transition** | ❌ 不是（UserBlocking 优先级） | ✅ **自动包在 startTransition 里** |
| **适用场景** | 复杂客户端状态机 | **表单提交 / 网络请求 / 服务端交互** |

**一句话总结：`useActionState` 是 `useReducer` 的"异步 + 表单增强版"，专为 Action 场景设计。**

### 3.4 Error 处理

Action 函数抛出的异常会自动变成 error state：

```jsx
async function loginUser(prevState, formData) {
  const email = formData.get('email');
  const password = formData.get('password');

  const res = await fetch('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const data = await res.json();
    // ❌ 这里 throw 的内容会成为 error state
    throw new Error(data.message || '登录失败');
  }

  return await res.json();  // ✅ 返回值成为新的 state
}

function LoginForm() {
  const [state, dispatch, isPending] = useActionState(loginUser, null);

  // state 有两种可能：
  // 1. action 正常返回的数据 → { user: ..., token: ... }
  // 2. action 抛出的 Error → Error 对象（通过 state instanceof Error 判断）

  if (state instanceof Error) {
    return <div className="error">{state.message}</div>;
  }

  if (state?.user) {
    return <div>欢迎回来，{state.user.name}！</div>;
  }

  return (
    <form action={dispatch}>
      <input name="email" type="email" />
      <input name="password" type="password" />
      <button type="submit" disabled={isPending}>
        {isPending ? '登录中...' : '登录'}
      </button>
    </form>
  );
}
```

**error 判断模式：**
```jsx
if (state instanceof Error) {
  // 显示错误
}
```
或者用结构化返回（更推荐）：
```jsx
async function loginUser(prev, formData) {
  try {
    const res = await fetch('/api/login', { ... });
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: err.message };  // 统一 shape，不用 instanceof
  }
}

// 使用方
const [result, dispatch, isPending] = useActionState(loginUser, null);
// result.ok ? 成功 : result.error
```

> 📌 **微检查点 2**：`useActionState` 的第一个参数 prevState 是从哪来的？第一次调用和后续调用的值分别是什么？

---

## 四、useFormStatus：感知父级表单状态

### 4.1 为什么需要它？

场景：你的提交按钮在深层子组件里，但它需要知道**父级 `<form>` 是否正在提交**。

```jsx
// 旧写法：层层传递 isPending prop
<Form isPending={isPending}>
  <FormField isPending={isPending}>
    <SubmitButton isPending={isPending} />   // 传了 3 层！
  </FormField>
</Form>
```

### 4.2 useFormStatus API

```jsx
import { useFormStatus } from 'react';

function SubmitButton({ children }) {
  // ⚠️ 这个 Hook 必须在 <form> 的子孙组件里使用
  const { pending, data, method, action } = useFormStatus();

  return (
    <button type="submit" disabled={pending}>
      {pending ? '提交中...' : children}
    </button>
  );
}

// 使用——不需要传任何 prop！
<form action={submitData}>
  <input name="email" />
  <SubmitButton>提交</SubmitButton>   {/* 自动感知 pending */}
</form>
```

**返回值一览：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `pending` | boolean | 父级 `<form>` 是否正在处理 action |
| `data` | FormData \| null | 提交时的 FormData（只读快照） |
| `method` | string | `'POST'` \| `'GET'` 等 |
| `action` | Function | 父级的 action 函数引用 |

### 4.3 ⚠️ 重要限制

`useFormStatus` **必须在 `<form>` 的后代组件内调用**——它会沿着 fiber 树向上找最近的 Suspense/FormContext 边界。

如果在 `<form>` 外面用，所有值都是默认值（`pending=false`, `data=null` 等），**不会报警告**，所以容易踩坑。

```jsx
// ❌ 错误：不在 form 内部
function OuterComponent() {
  const { pending } = useFormStatus();  // 永远是 false！
  return <div>{pending ? '...' : 'ok'}</div>;
}

// ✅ 正确：作为 form 的子孙
function MyForm() {
  return (
    <form action={someAction}>
      <OuterComponent />   {/* 如果 OuterComponent 在这里渲染就对了 */}
    </form>
  );
}
```

> 📌 **微检查点 3**：`useFormStatus` 的 pending 和 `useActionState` 返回的 isPending 有什么区别？为什么需要两个？

---

## 五、useOptimistic：乐观更新 + 自动回滚

### 5.1 什么是乐观更新？

**定义**：在服务器响应返回之前，**假设请求一定会成功**，先把 UI 改成最终状态。如果实际失败了，再回滚回去。

经典案例：
- 点赞 → 数字立刻 +1（不等后端确认）
- 评论 → 立刻显示在列表里
- 拖拽排序 → 立刻到位

### 5.2 旧写法的痛苦

```jsx
// ❌ 旧写法：手写乐观更新
function LikeButton({ initialLiked, id }) {
  const [liked, setLiked] = useState(initialLiked);
  const [serverLiked, setServerLiked] = useState(initialLiked); // 服务端真实值
  const optimisticRef = useRef(false);

  const handleLike = async () => {
    const newLiked = !liked;
    setLiked(newLiked);            // ① 先乐观更新 UI
    optimisticRef.current = true;

    try {
      await fetch(`/api/like/${id}`, { method: 'POST' });
      setServerLiked(newLiked);    // ② 服务端确认
    } catch (err) {
      setLiked(serverLiked);       // ③ 失败回滚！！！
      toast.error('点赞失败');
    } finally {
      optimisticRef.current = false;
    }
  };

  // 还要处理 race condition...
  // 还要处理连续快速点击...
  return <button onClick={handleLike}>{liked ? '❤️' : '🤍'} {count}</button>;
}
```

问题在哪：
1. **两个 state**（optimistic + server）要手动同步
2. **回滚逻辑**要自己写（try/catch 里 set 回去）
3. **并发冲突**：快速连点两次怎么办？
4. **和 Suspense/Transition 的关系**：乐观更新应该在 transition 中吗？

### 5.3 useOptimistic API

```jsx
const [optimisticValue, addOptimistic] = useOptimistic(currentValue, updateFn);
//                  ↑                ↑                      ↑
//             乐观显示值       触发乐观更新的函数        如何计算下一个乐观值
```

| 参数 | 说明 |
|---|---|
| `currentValue` | 服务端/真实的当前值（作为基准） |
| `updateFn` | `(currentValue, optimisticValue) => nextOptimisticValue` 计算函数 |

**完整点赞示例：**

```jsx
import { useOptimistic, useState, transition } from 'react';

function LikeButton({ initialLiked, initialCount, postId }) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);

  //                        ↑ 真实值    ↑ 乐观计算函数
  const [optLike, toggleOptimistic] = useOptimistic(liked, (state, newValue) => newValue);

  async function handleToggle() {
    // startTransition 包裹 → 低优先级，不阻塞
    startTransition(async () => {
      // ① 先触发乐观更新（UI 立刻变）
      toggleOptimistic(!optLike);

      try {
        // ② 发请求
        const res = await fetch(`/api/posts/${postId}/like`, { method: 'POST' });
        const data = await res.json();
        setLiked(data.liked);     // ③ 服务端确认 → 更新真实值
        setCount(data.count);
      } catch {
        // ④ 失败 → useOptimistic 自动回滚！
        // 不需要手动 setLiked(oldValue)！
        console.error('点赞失败，已自动回滚');
      }
    });
  }

  // optLike 是乐观值（可能比 liked "超前"一步）
  return (
    <button onClick={handleToggle}>
      {optLike ? '❤️' : '🤍'}
      <span>{count + (optLike !== liked ? 1 : 0)}</span>
      {/* 注意：count 的乐观展示也需要类似处理，这里简化了 */}
    </button>
  );
}
```

### 5.4 useOptimistic 的魔法在哪里？

**自动回滚机制**：

```
正常流程:
  真实值 = false
  ↓ toggleOptimistic(true)
  乐观值 = true ← UI 显示 ❤️
  ↓ 请求成功
  setLiked(true) → 真实值=true → 乐观值跟随=true ✓

失败流程:
  真实值 = false
  ↓ toggleOptimistic(true)
  乐观值 = true ← UI 显示 ❤️
  ↓ 请求失败!
  真实值仍然是 false
  ↓ 下一次 render
  乐观值重新基于 false 计算 → 回滚为 🤍 ✓（自动！）
```

**关键原理**：`useOptimistic` 内部维护了一个"乐观版本"。每次 render 时：
1. 如果没有进行中的乐观更新 → 直接返回 currentValue（真实值）
2. 如果有待处理的乐观更新 → 返回最新的乐观值
3. 当外部 `currentValue`（真实值）变化且与乐观不一致时 → 自动回滚

### 5.5 useOptimistic + useActionState 组合拳

这是 React 19 最推荐的表单模式之一：

```jsx
import { useActionState, useOptimistic } from 'react';

// ===== Action 函数 =====
async function addComment(prevComments, formData) {
  const text = formData.get('text');
  const res = await fetch('/api/comments', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error('评论失败');
  return [...prevComments, await res.json()];
}

// ===== 组件 =====
function CommentSection({ initialComments }) {
  const [comments, dispatchComment, isPending] = useActionState(
    addComment,
    initialComments
  );

  // 乐观值：假设评论一定成功
  const [optimisticComments, addOptimistic] = useOptimistic(
    comments,
    (list, newComment) => [...list, { id: 'temp-' + Date.now(), text: newComment, status: 'sending' }]
  );

  return (
    <div>
      <CommentList comments={optimisticComments} />
      <form action={(formData) => {
        const text = formData.get('text');
        // 先乐观插入
        addOptimistic(text);
        // 再真正提交
        dispatchComment(formData);
      }}>
        <textarea name="text" placeholder="写下你的评论..." />
        <button type="submit" disabled={isPending}>发送</button>
      </form>
    </div>
  );
}
```

**用户体验流程**：
1. 用户打字点发送 → 评论**立刻**出现在列表（带"发送中..."标记）
2. 后端返回成功 → temp id 替换为真实 id，status 变 normal
3. 后端返回失败 → **自动消失**（回滚），toast 提示错误

> 📌 **微检查点 4**：`useOptimistic` 的回滚是"瞬间的"还是有过渡动画？如果用户在乐观更新后、回滚前又做了其他操作怎么办？

---

## 六、Server Components（RSC）初探

### 6.1 RSC ≠ SSR（最重要的一句话）

这是最多人混淆的点：

| 维度 | 传统 SSR（Next.js getServerSideProps） | React Server Components |
|---|---|---|
| **运行位置** | 服务端一次性渲染 → 发送 HTML | **组件级别**的服务端/客户端拆分 |
| **JS 大小** | 客户端拿到完整 JS bundle | 客户端**只拿客户端组件的 JS**，服务端组件零 JS |
| **交互能力** | hydrate 后全部可交互 | 只有客户端组件有事件监听器 |
| **数据获取** | 页面顶部一次性获取 | **每个服务端组件独立获取**，可以嵌套 |
| **重新获取** | 整页刷新 | 单个 RSC 可以独立 refetch |

### 6.2 核心理解：一种组件，两处运行

```
┌───────────────────────────────────────┐
│  Server Components（服务端执行）        │
│                                       │
│  <Page>          ← 读数据库、文件系统   │
│    <Sidebar>     ← 调用内部 API        │
│      <ThemeSwitch/>  ← 'use client'   │ ← 分界线
│                                       │
├───────────────────────────────────────┤
│  Client Components（浏览器执行）        │
│                                       │
│    <ThemeSwitch>  ← 有 onClick/state  │
│    <CommentForm>  ← 有 useState/useEffect │
│                                       │
└───────────────────────────────────────┘
```

**分界线就是 `'use client'` 指令**：

```jsx
// ThemeSwitch.server.jsx  — 服务端组件（默认）
export default function ThemeSwitch({ theme }) {
  // ✅ 可以访问数据库、读取文件系统、调用密钥
  // ❌ 不能用 useState / useEffect / onClick
  return (
    <div>
      <h1>当前主题: {theme}</h1>
      <ClientToggleButton theme={theme} />
    </div>
  );
}

// ClientToggleButton.client.jsx  — 客户端组件
'use client';  // ← 这一行改变一切！

export default function ClientToggleButton({ theme }) {
  const [current, setCurrent] = useState(theme);
  // ✅ 有 useState / useEffect / 事件处理器
  return (
    <button onClick={() => setCurrent(current === 'dark' ? 'light' : 'dark')}>
      切换到 {current === 'dark' ? '亮色' : '暗色'}
    </button>
  );
}
```

### 6.3 RSC 的三大优势

**1. 零 JS 开销**

```jsx
// 这个组件永远不会出现在客户端 bundle 中
function ServerGreeting({ userId }) {
  const user = db.users.find(userId);  // 直接查库！
  return <h1>你好，{user.name}！</h1>;  // 只发 HTML 过去
}
```
→ 浏览器收到的就是一个 `<h1>你好，张三！</h1>`，**没有对应的 JS 代码**。

**2. 数据靠近代码**

传统方式：
```jsx
// 客户端组件
function Profile({ userId }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    fetch(`/api/users/${userId}`).then(setUser);  // ① mount后才请求
  }, [userId]);                                     // ② 多一整个 RTT
  return user ? <h1>{user.name}</h1> : <Spinner />;
}
```

RSC 方式：
```jsx
// 服务端组件
function Profile({ userId }) {
  const user = db.users.find(userId);  // ① 渲染时就有了
  return <h1>{user.name}</h1>;        // ② 零额外请求
}
```

**3. 渐进式 hydration**

不是整页一次性 hydrate，而是：
- 服务端组件：**永不 hydrate**（它们只是 HTML）
- 客户端组件：按需 hydrate（只有交互区域才下载 JS + 绑定事件）

### 6.4 RSC 的限制（服务端组件不能做的事）

| ❌ 不能 | 原因 |
|---|---|
| `useState` / `useReducer` | 没有实例持久化（每次请求新实例） |
| `useEffect` / `useLayoutEffect` | 没有 DOM / 生命周期 |
| `onClick` / `onChange` 等事件 | 没有事件系统 |
| 浏览器 API（localStorage / window / document） | 不在浏览器跑 |
| 自定义 Hook 依赖以上任何一项 | 传导性限制 |

**能做的：**
| ✅ 能 | 示例 |
|---|---|
| 访问数据库 / 文件系统 | `db.query('SELECT ...')` / `fs.readFileSync(...)` |
| 读取环境变量 / 密钥 | `process.env.SECRET_KEY` |
| 渲染客户端组件作为子组件 | `<ClientComp data={serverData} />` |
| 异步组件（获取数据后返回 JSX） | `async function Data Comp() { const data = await fetch(...); return ...; }` |
| `use()`（Suspense 数据获取） | `const data = use(fetchData(id))` |

### 6.5 序列化：RSC playload

服务端组件渲染后的结果不是一个完整的 HTML 字符串，而是一种**特殊的序列化格式（RSC Payload）**：

```json
{
  "type": "render",
  "id": "0",
  "children": [
    {
      "type": "element",
      "name": "h1",
      "props": { "className": "title" },
      "children": ["你好，张三"]
    },
    {
      "type": "module",          // ← 客户端组件的引用
      "name": "./ClientToggle",
      "props": { "theme": "dark" },
      "clientBoundaries": [...]  // ← 客户端从这里开始 hydrate
    }
  ]
}
```

浏览器端的 RSC runtime 解析这个 payload：
1. 遇到普通元素 → 当作虚拟 DOM 渲染
2. 遇到 `"type": "module"` → 加载对应客户端组件的 JS → hydrate
3. **服务端组件部分永远只保留虚拟 DOM，不加载实现代码**

> 📌 **微检查点 5**：如果一个组件既需要读数据库（服务端能力），又需要有 onClick（客户端能力），该怎么设计？

---

## 七、五者关系全景图

```
React 19 新特性体系:

┌─────────────────────────────────────────────────────┐
│                     Actions                         │
│  (async 函数，自动 transition + error handling)     │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │useActionState│  │useFormStatus │  │useOptimist.│ │
│  │  管理 state  │  │  感知 pending │  │ 乐观更新  │ │
│  │  + isPending │  │  (无需 prop) │  │  + 自动回滚│ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
│         │                 │                │        │
│         ▼                 ▼                ▼        │
│  ┌──────────────────────────────────────────────┐   │
│  │         <form action={fn}>                    │   │
│  │   FormData 自动传入 / 自动 preventDefault      │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         +
┌─────────────────────────────────────────────────────┐
│              Server Components (RSC)                │
│  'use client' 分界线 / 零 JS 开销 / 数据靠近代码    │
│  与 Actions 配合：服务端 Action 直接操作数据库       │
└─────────────────────────────────────────────────────┘
```

**选择指南：**

| 场景 |用什么 | 一句话 |
|---|---|---|
| 表单提交 + 需要 loading/error | `useActionState` | 替代手写 useState + fetch |
| 子按钮需要知道表单 pending | `useFormStatus` | 免 prop-drilling |
| 点赞/收藏等"先显示后确认" | `useOptimistic` | 自动回滚，不用手写 |
| 简单表单不想写受控组件 | `<form action={fn}>` + FormData | 非受控 + 自动序列化 |
| 首屏数据直出、减少 JS | Server Components | `'use client'` 画界线 |

---

## 八、动手实验

详见 `demos/day13/README.md`，3 个实验：

| 实验 | 内容 | 验证什么 |
|---|---|---|
| E1 | Action + useActionState 基本用法 | form action 替代 onSubmit，isPending 自动管理 |
| E2 | useOptimistic 点赞（含失败回滚） | 乐观更新 + 自动回滚 vs 手写版对比 |
| E3 | useFormStatus 跨层级感知 | 子组件无需 prop 即可获知父 form pending |

---

## 九、入场自测对答（跟练后回填）

| 题 | 问题 | 学习者回答 | 判定 |
|---|---|---|---|
| Q1 | 表单提交旧写法痛点 | 用 button/onSubmit 提交 | 🟡 偏——知道入口，但没说出痛点（preventDefault/loading/error 手动管理） |
| Q2 | action 函数是什么？async 怎么处理 | 不清楚 | ❌ 不懂——今天核心内容 |
| Q3 | useOptimistic vs 手写乐观更新区别 | 先更新再请求，回滚不好操作 | ✅ 方向对——直觉正确，缺自动回滚机制认知 |
| Q4 | RSC vs SSR 根本区别 | SSR 返回 HTML，RSC 还是 React 组件 | ✅ 对——抓到关键区别，深度不够 |

**总评：1 对 1 偏 2 不懂** —— 典型 Day13 起步状态。

---

## 十、微检查点判定（跟练中回填）

1. **我以为** Actions 就是把 `onSubmit` 换了个名字——**其实** Actions 是一套完整的异步状态管理体系（transition + error + pending），`<form action={fn}>` 只是入口。
2. **我以为** `useActionState` 就是 `useReducer` 的别名——**其实** 它支持 async 函数、内置 isPending、自动走 transition Lane，是全新的 Hook。
3. **我以为** 乐观更新就是 `setState` 然后 `catch` 了改回去——**其实** `useOptimistic` 内部维护了独立的乐观状态栈，回滚是基于"真实值未变则自动还原"的声明式机制。
4. **我以为** Server Components 就是 SSR 换个名字——**其实** SSR 是整页 HTML 的一次性输出，RSC 是组件级别的服务端/客户端拆分，服务端组件**零 JS 到达浏览器**。

---

## 十、验收清单

- [ ] 能说出 Actions 解决的 3 个痛点（preventDefault / loading / error）
- [ ] 能写出 `<form action={fn}>` + FormData 的基本表单
- [ ] 能解释 useActionState vs useReducer 的 4 个区别
- [ ] 能写出 useOptimistic 的点赞功能并解释自动回滚原理
- [ ] 能说出 useFormStatus 的使用限制（必须在 form 内部）
- [ ] 能解释 RSC 和传统 SSR 的根本区别（组件级 vs 页面级 / 零 JS / 数据靠近代码）
- [ ] 能列出服务端组件不能用的 3 个 Hooks
- [ ] 完成 3 个实验

---

## 十一、Day 14 预告

**主题**：React Compiler（自动 memo） + 性能优化深度（React.memo / useMemo / useMemo 的正确使用时机）
**预读问题**：
1. React Compiler 是怎么判断"这个组件需要 memo 的"？编译前后代码差别有多大？
2. `React.memo`、`useMemo`、`useCallback` 在 React Compiler 时代还需要手写吗？什么情况下仍然需要？
3. 编译器的"输入等价性保证"是什么意思？为什么说它不会改变组件的行为？
