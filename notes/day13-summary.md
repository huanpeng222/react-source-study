# Day 13 精简笔记

> 主题：React 19 Actions 体系

## 一句话总结
**Actions = async 函数 + React 自动管理 transition/loading/error，彻底终结手写表单状态。**

---

## 核心公式

```
<form action={async (formData) => { ... }}>
  → 自动 preventDefault
  → 自动 FormData 收集
  → 自动 startTransition 包裹（低优先级）
  → 自动 error 捕获到 useActionState
```

## 三大 Hook 一览

| Hook | 返回值 | 解决什么 | 类比 |
|---|---|---|---|
| `useActionState(fn, init)` | `[state, dispatch, isPending]` | 表单提交状态管理 | 异步版 useReducer |
| `useFormStatus()` | `{ pending, data, method, action }` | 子组件感知父 form 状态 | 免 prop drilling |
| `useOptimistic(real, fn)` | `[optVal, addOpt]` | 乐观更新+自动回滚 | 声明式乐观UI |

## 关键要点

### useActionState
- **prevState 参数**：首次调用 = initialState，后续 = 上次返回值
- **Error 处理**：action throw → state 变成 Error 对象，用 `instanceof` 判断
- **Transition**：自动包在 startTransition 里，不阻塞用户输入
- **vs useReducer**：支持 async、内置 isPending、自动 transition

### useFormStatus
- **必须在 `<form>` 子组件内使用**
- 在 form 外用 → 所有值是默认值（pending=false），**不报警告！**
- vs useActionState.isPending：useFormStatus 是给**子组件**用的，不需要 prop 传

### useOptimistic
- **参数1** currentValue = 真实基准值
- **参数2** updateFn = `(current, optimistic) => nextOptimistic`
- **回滚原理**：不独立存储乐观值，每次 render 基于 currentValue 重算。请求失败 → currentValue 不变 → 重算后回归真实值
- **和 useActionState 组合**：评论/点赞的黄金搭档

### Server Components（RSC）
- **RSC ≠ SSR**：SSR 是整页 HTML，RSC 是组件级拆分
- `'use client'` = 分界线：上面服务端执行（零 JS），下面客户端 hydrate
- 服务端组件不能：useState / useEffect / onClick / 浏览器 API
- 服务端组件可以：读数据库 / 文件系统 / 渲染客户端子组件 / use()

## 选择指南

| 场景 | 用什么 |
|---|---|
| 表单提交 + loading/error | `<form action={fn}>` + useActionState |
| 深层子按钮需要 pending | useFormStatus（免 prop drilling） |
| 点赞/收藏"先显示后确认" | useOptimistic（自动回滚） |
| 不想写受控组件 | 非受控 input + name 属性 + FormData |
| 首屏零 JS 直出 | Server Components + 'use client' |

## 面试口述版（30 秒）

> "React 19 的 Actions 是一套异步状态管理体系。`<form action={fn}>` 自动 preventDefault 并传入 FormData，配合 `useActionState` 管理 state/pending/error 三态，配合 `useOptimistic` 做声明式乐观更新（失败自动回滚），配合 `useFormStatus` 让深层子组件零 prop 感知表单状态。底层 action 默认走 Transition Lane，不阻塞用户输入。"
