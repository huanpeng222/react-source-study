# Day 13 自测（答案折叠，先自己答）

> 主题：Actions / useActionState / useOptimistic / useFormStatus / RSC

## Q1
`<form action={async (formData) => { ... }}>` 相比 `<form onSubmit={handleSubmit}>` 自动解决了哪些问题？至少说出 3 个。

<details><summary>答案</summary>
1. **自动 preventDefault** — 不需要 `e.preventDefault()`
2. **自动 FormData 收集** — 不需要手动 `useState` 给每个 input 绑定 value/onChange
3. **自动 loading 管理** — useActionState 的 isPending
4. **自动 error 捕获** — action throw → state 变 Error 对象
5. **自动 transition 包裹** — 低优先级，不阻塞输入
（答出任意 3 个即可）
</details>

## Q2
`useActionState(actionFn, initialState)` 返回的三个值分别是什么？prevState 参数第一次和后续分别是什么？

<details><summary>答案</summary>
返回：`[state, dispatchFn, isPending]`
- **state**：actionFn 最新返回值（或抛出的 Error）
- **dispatchFn**：传给 `<form action={...}>` 的函数
- **isPending**：是否有 action 正在执行

**prevState**：
- 第一次 = initialState（你传的第二个参数）
- 后续 = actionFn 上一次的返回值
</details>

## Q3
useOptimistic 的自动回滚原理是什么？为什么不需要手动 `setLiked(oldValue)` 回滚？

<details><summary>答案</summary>
**核心原理**：useOptimistic **不独立存储乐观值**。它每次 render 都基于 currentValue（真实基准值）重新计算显示值。

流程：
1. `toggleOptimistic(true)` → 显示 true
2. 请求失败 → 真实值 currentValue **不变**
3. 下次 render → 基于 unchanged currentValue 重算 → **自动回到真实值**

手写版的问题是要维护两个 state（real + optimistic），还要在 catch 里手动 set回去。useOptimistic 把这个模式声明式化了。
</details>

## Q4
以下代码有什么问题？

```jsx
function MyButton({ children }) {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{children}</button>;
}

// 使用
<div>
  <MyButton>提交</MyButton>
  <form action={someAction}>
    <input name="email" />
  </form>
</div>
```

<details><summary>答案</summary>
**MyButton 在 form 外面！** 它在 `<form>` 标签之前渲染，不在 form 的子树内。
→ `useFormStatus()` 返回的 `pending` **永远是 false**。
→ 按钮永远不会 disabled。

修复：把 MyButton 移到 `<form>` 内部。
</details>

## Q5
React Server Components 和传统 SSR（如 Next.js getServerSideProps）的根本区别是什么？（至少 2 点）

<details><summary>答案</summary>
1. **粒度不同**：SSR 是整页一次性 HTML 输出；RSC 是**组件级**的服务端/客户端拆分
2. **JS 开销不同**：SSR hydrate 后整页 JS 可交互；RSC 服务端组件**零 JS 到达浏览器**（只有客户端组件才下载 JS）
3. **数据获取时机不同**：SSR 通常页面顶部统一请求；RSC 每个 Server Component **独立获取数据**，可以嵌套
4. **更新方式不同**：SSR 需要整页刷新；RSC 可以单个组件独立 refetch

一句话："SSR 是页面级的全量 HTML；RSC 是组件级的按需序列化。"
</details>

## Q6（综合题）
用 Actions + useOptimistic 实现一个评论功能：用户点发送后评论**立即**出现在列表（带"发送中"标记），成功后标记消失，失败后自动消失。

<details><summary>参考实现</summary>
```jsx
const [comments, dispatchComment, isPending] = useActionState(
  async (prev, formData) => {
    const text = formData.get('text');
    const res = await fetch('/api/comments', {
      method: 'POST', body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('评论失败');
    return [...prev, await res.json()];
  },
  initialComments
);

const [optComments, addOpt] = useOptimistic(comments, (list, text) => [
  ...list,
  { id: 'temp-' + Date.now(), text, status: 'sending' }
]);

<form action={(fd) => { add(fd.get('text')); dispatchComment(fd); }}>
  <textarea name="text" />
  <button disabled={isPending}>发送</button>
</form>
<CommentList comments={optComments} />
```
关键：先 `addOptimistic`（立即显示）再 `dispatchComment`（真正提交）。
</details>
