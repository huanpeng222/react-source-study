# Day 9 精简笔记：useContext 源码 + Context 穿透 memo

> 复习只看这一份。源码出处：`ReactFiberNewContext.js` / `ReactFiberHooks.js` / `ReactContext.js`

## 一句话总纲

> **`useContext` 是所有 Hook 中的"异类"：不建 Hook 节点、不占 `fiber.memoizedState`、不调用 `mountWorkInProgressHook`。每次 render 直接 `readContext` 读 `context._currentValue`，依赖记录在 `fiber.dependencies`。**

## 核心概念

### 1. `createContext` 产物

```js
const context = {
  _currentValue: defaultValue,    // ★ 当前值，Provider 实时更新它
  Provider: { $$typeof, _context },
  Consumer: { $$typeof, _context },
};
```

`useContext(Context)` 本质就是读 `Context._currentValue`。

### 2. Provider 栈式值管理

```
beginWork 调 pushProvider：旧值压栈 → _currentValue = 新值
  子树中 readContext 读到新值
completeWork 调 popProvider：弹栈恢复旧值
```

类比：进门（push）改值 → 在房间里读到新值 → 出门（pop）恢复旧值。防止嵌套 Provider 的值泄漏到外面。

### 3. 消费关系追踪：`fiber.dependencies`

```
当 fiber 调了 useContext(Context)：
  → readContext 记录 { context: Context, memoizedValue: value } 到
  → fiber.dependencies.firstContext 链表
```

不同于其他 Hook 的 `fiber.memoizedState`（持久化存储），这里只是记录"谁消费了什么"。

### 4. 变化传播：`propagateContextChanges`

Provider value 变化时（render 阶段）：

```
propagateContextChanges(fiber, [MyContext], lanes)
  → DFS 遍历 Provider 所有子 fiber
  → 检查每个 fiber.dependencies.firstContext 链表
  → dep.context === MyContext 匹配上 → mergeLanes(consumer.lanes)
  → 该 fiber 下次 render 时 bailout 失败 → 强制重渲染
```

### 5. 穿透 memo 的根因

```js
// beginWork bailout 判断：
if (oldProps === newProps && !hasScheduledUpdate() && !hasScheduledContext())
// lanes 被 propagateContextChanges 改了 → hasScheduledContext()=true
// → bailout 条件失败 → 强制走完整渲染 → 穿透 memo
```

**不是 memo 在检查 lanes，是 beginWork 的 bailout 判断在检查 lanes。**

### 6. 性能陷阱

- **问题**：Provider value 是对象时每次新建引用 → `propagateContextChanges` 触发所有消费者重渲染（即使用 memo 也拦不住）
- **修复**：`useMemo` 稳定 value 引用 + **拆分 Context**（不同数据的 Context 分开）

## 我学完后的追问记录

### 追问 1：pushProvider/popProvider 为什么在 beginWork 和 completeWork 分开？

理解了。beginWork 时 DFS 下钻，进门改值；completeWork 时 DFS 回溯，出门恢复。分两个阶段是因为消费发生在遍历子 fiber 的过程中，不是当前 fiber 自己。嵌套 Provider 必须有栈机制才能正确隔离作用域。

### 追问 2：lanes 是什么？

位掩码优先级模型。`propagateContextChanges` 改消费者 `lanes` → 破坏 bailout 条件 → 穿透 memo。

## 5 句口诀

1. useContext 不建节点、不存数据、每次 render 直接读
2. pushProvider 进门改值，popProvider 出门恢复
3. dependencies 链表记"我消费了哪个 context"
4. Provider 变 → DFS 遍历 match → lanes → 穿透 memo
5. 性能解法：useMemo 稳引用 + 拆分 Context
