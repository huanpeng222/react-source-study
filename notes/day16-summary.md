# Day16 精简笔记：RSC 原理

## 一、RSC vs SSR（核心区别）

```
SSR:  服务器 → HTML字符串 → 浏览器 → hydrate → 可交互
RSC:  服务器 → RSC Payload(类JSON树) → 客户端React渲染 → 直接可交互
```

| 维度 | SSR | RSC |
|------|-----|-----|
| 产物 | HTML 字符串 | RSC Payload（流式类JSON） |
| 激活方式 | hydrate（对比DOM差异） | 直接渲染（无需hydrate） |
| JS bundle | 整个应用 | 仅 Client Component |
| 粒度 | 页面级 | **组件级** |
| 缓存 | 页面级 | **组件级** |

## 二、两条铁律

1. **Server → Client ✅，Client → Server ❌**
2. **跨边界 props 必须可序列化**（函数需用 `use server` 包装）

## 三、两个指令

### "use client"（编译时指令）
- 告诉打包工具：此文件及其依赖打入**客户端 bundle**
- 默认所有组件都是 Server，只有标记 `use client` 才是 Client
- **隐式 client boundary**：Client Component import 的未标记组件也被拖入客户端 bundle

### "use server"
- 创建 **Server Action**——从客户端远程调用服务端函数
- 编译时提取为服务端模块，客户端生成 fetch 存根
- 本质 = 自动生成的 RPC 框架

## 四、RSC Payload 结构

```json
["$","div",null, [
  ["$","h1",null,"Hello"],          // $ = 普通元素（已渲染完毕）
  ["@","./ThemeToggle",{...}]        // @ = 客户端引用（待加载JS）
]]
```
- `$`：普通元素/已渲染的 Server Component
- `@`：Client Component 引用（文件路径 + props）
- 流式传输，边收边渲染

## 五、选型决策树

```
需要事件/状态/effect/浏览器API？
  ├─ 是 → 加 "use client"
  └─ 否 → 保持默认（Server Component）

需要访问数据库/文件系统/env？
  ├─ 是 → 必须是 Server Component
  └─ 否 → 都可以

黄金法则：默认 Server，按需加 "use client"，保持 Client 边界最小化
```

## 六、性能陷阱：隐式 Client Boundary

```jsx
// ❌ SearchBar (client) import 了 UserAvatar (无标记) 
//    → UserAvatar 被强制打入客户端 bundle

// ✅ 用 children 模式把 UserAvatar 保持在服务端
<SearchBar>
  <UserAvatar />
</SearchBar>
```
