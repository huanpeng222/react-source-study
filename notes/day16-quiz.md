# Day16 自测题

## 基础（必须全对）

**Q1：RSC 和 SSR 的核心区别是什么？产物分别是什么？**

**Q2："use client" 是运行时指令还是编译时指令？它的作用是什么？**

**Q3：Server Component 可以 import Client Component 吗？反过来呢？**

## 进阶（理解原理）

**Q4：什么是"隐式 client boundary"？它为什么会成为性能陷阱？怎么避免？**

**Q5：RSC Payload 中的 `$` 和 `@` 分别代表什么？客户端拿到 payload 后怎么做？**

**Q6：`use server` 创建的 Server Action，底层通信原理是什么？（提示：RPC）**

**Q7：以下组件应该标记 "use client" 还是保持默认？为什么？**
- a) 一个纯展示的 `<Avatar src={url} />`
- b) 一个有 onClick 的 `<LikeButton />`
- c) 一个用 `useState` 管理折叠状态的 `<Accordion />`
- d) 一个调用 `fetch('/api/data')` 的 `<DataLoader />`

## 挑战（串联知识）

**Q8：为什么说 RSC 不需要 hydrate？这和 SSR 的 hydrate 阶段有什么本质不同？**

**Q9：如果我想让 Client Component 调用数据库查询，有哪两种方式？各自的适用场景是什么？**

**Q10：结合你学过的 Context 性能陷阱知识，思考：在 RSC 架构中，Context 应该放在 Server Component 还是 Client Component 中使用？为什么？**
