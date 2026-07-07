# Day 18 实验观察记录

> 真实 Next.js App Router 项目实验，覆盖 Parallel Routes / Intercepting Routes / Middleware / server-only。跑完后把真实结果填进下方区块。

## 浏览器版实测记录（待填）

### P1：Parallel Routes 独立渲染
- Notifications 插槽是否立即显示，不受 Analytics 延迟影响？
- Analytics 插槽的 loading.js 是否独立生效？

（待填）

### P2：Intercepting Routes 软/硬导航
- 点击链接（软导航）进入 /feed/1 是否显示模态框？
- 直接输入 URL/刷新（硬导航）是否显示完整页面？

（待填）

### P3：Middleware redirect/rewrite
- /old-page 是否跳转到 /new-page（地址栏变化）？
- /secret 是否地址栏不变但内容变成 Feed 列表？
- matcher 之外的路径是否没有被拦截？

（待填）

### P4：server-only 构建报错
- 报错信息具体内容是什么？
- 去掉 `import 'server-only'` 后是否不再报错？

（待填）
