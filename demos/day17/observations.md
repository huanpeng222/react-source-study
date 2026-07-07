# Day 17 实验观察记录

> README.md 已改为真实 Next.js App Router 项目实验（之前是纯 JS 模拟路由算法，看不到真实的 mount/unmount 生命周期）。跑完后把真实结果填进下方区块。

## 浏览器版实测记录（待填）

### N1：Layout 不重新挂载
- 切换 /blog/post-1 → /blog/post-2 时，BlogLayout 的 mountCount 是否保持不变？
- BlogPost 是否正确显示了新的 slug？

（待填）

### N2：loading.js 自动 Suspense
- 切换页面时是否立即显示"⏳ 文章加载中..."？
- 导航栏（BlogLayout 部分）在等待期间是否依然可点击？

（待填）

### N3：error.js 自动 ErrorBoundary
- /blog/post-1 是否显示了 error.js 的红色错误 UI？
- 点击"重试"后发生了什么？

（待填）
