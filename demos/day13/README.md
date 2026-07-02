# Day 13 实验指南

> 主题：React 19 Actions 体系（useActionState / useOptimistic / useFormStatus）
> 环境：react@19 + react-dom@19 + jsdom@22
> 跑法：`node k1-actionstate.mjs` 等

## 实验 E1：Action + useActionState 基本用法

**验证什么：**
- `<form action={fn}>` 替代 `onSubmit`，自动 preventDefault + FormData
- `useActionState` 返回 `[state, dispatchFn, isPending]`
- action 抛错 → state 变成 Error 对象
- isPending 在执行期间为 true

**运行：** `node k1-actionstate.mjs`

**预期输出：**
```
=== 初始状态 ===
state: null | isPending: false

=== 第 1 次提交 (name=张三) ===
isPending: true ← 提交中...
state: { name: '张三', ok: true } ← 成功！
isPending: false ← 结束

=== 第 2 次提交 (触发错误) ===
isPending: true
state 是 Error: 用户名已存在 ← action throw 被 useActionState 捕获！

=== 第 3 次提交 (正常) ===
isPending: true
state: { name: '李四', ok: true }
```

---

## 实验 E2：useOptimistic 点赞（含失败回滚）

**验证什么：**
- `useOptimistic(currentValue, updateFn)` 乐观更新 UI
- 请求成功 → 真实值更新，乐观值跟随
- **请求失败 → 自动回滚！** 不需要手动 set 回去
- 连续快速点击的处理

**运行：** `node k2-optimistic.mjs`

**预期输出：**
```
初始: liked=false, optLiked=false

第 1 次点击 (模拟成功):
  → optLiked 立刻变 true! ← 乐观更新
  → 请求成功 → liked=true
  → 最终: liked=true, optLiked=true ✓

第 2 次点击 (模拟失败):
  → optLiked 立刻变 false!
  → 请求失败!
  → ★ 自动回滚 ★ → optLiked 重新基于 liked(true) 计算 = false? 
     等等... toggleOptimistic(!optLike) 所以是 !false = true
     但真实值没变(还是 true)，所以回滚到 true ← 关键点！
```

---

## 实验 E3：useFormStatus 跨层级感知

**验证什么：**
- 子组件通过 `useFormStatus()` 获取父级 `<form>` 的 pending 状态
- **不需要 prop drilling** —— 不传 isPending
- 在 form 外部使用时 pending 永远是 false
- 多个 form 各自独立的状态

**运行：** `node k3-formstatus.mjs`

**预期输出：**
```
Form A 提交前:
  SubmitButtonA.pending = false
  SubmitButtonB.pending = false （Form B 不受影响）

Form A 提交中:
  SubmitButtonA.pending = true ← 自动感知！
  SubmitButtonB.pending = false ← 各自独立

Form B 提交中:
  SubmitButtonA.pending = false
  SubmitButtonB.pending = true
```
