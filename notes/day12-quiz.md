# Day 12 自测题：SuspenseList + 自定义 Suspense

## Q1
SuspenseList 的 `revealOrder="together"` 模式下，3 个子 Suspense 各自的请求是同时发起的还是一个一个来的？为什么？

<details><summary>答案</summary>
同时发起。SuspenseList **不改变加载时机**，只控制展示时机——所有请求在 render 时立刻并发，只是展示被统一延迟到全部就绪。
</details>

## Q2
`use(promise)` 配合 Suspense 使用时，为什么需要缓存 promise 引用？如果不缓存会怎样？

<details><summary>答案</summary>
use() 凭 promise 对象自身的 `.status` 判断态。如果每次 render 都传新 Promise，第一次 `throw`、第二次又发现 `status=undefined` → 再次 `throw` → 无限循环。

缓存保证**同一 key 返回同一 promise 引用**，use() 第二次能读到 `.status='fulfilled'`，直接返回 `.value`。
</details>

## Q3
一个页面有 `<Suspense>` 包裹的懒加载组件，组件内部用 `use(fetchData())`。这个组件从加载到展示经历了几个阶段？

<details><summary>答案</summary>
3 个阶段（但用户只看到 1 次 fallback）：
1. React.lazy chunk 未加载 → throw promise → fallback
2. Chunk 加载完开始 render → use 发现数据未就绪 → throw promise → 仍在 fallback
3. 数据 resolve → 重渲染 → use 返回数据 → 展示真实 UI
</details>

## Q4
`<SuspenseList revealOrder="forwards" tail="collapsed">` 中的 `tail="collapsed"` 具体做了什么？

<details><summary>答案</summary>
已经就绪的子 Suspense：展示内容（不再显示 fallback）。
尚未就绪的子 Suspense：不各自显示独立的 fallback（skeleton），而是合并显示为一个"整体加载中"指示器。视觉上更干净。
</details>

## Q5
为什么 ErrorBoundary 应该包在 Suspense **外部** 而不是内部？

<details><summary>答案</summary>
如果 ErrorBoundary 在 Suspense 内部：
1. Suspense catch promise → 显示 fallback
2. promise reject → ping 重试 → use() 发现 rejected → throw Error
3. ErrorBoundary 捕获 → 显示 ErrorUI
   → 但 Suspense 还在，下次可能又 try 又 fallback 又 error，来回切换

如果 ErrorBoundary 在 Suspense **外部**：
1. Error 冒泡到外部 ErrorBoundary → 展示稳定的 ErrorUI
2. Suspense 内部完全由它处理"挂起"，两类问题边界清晰
</details>
