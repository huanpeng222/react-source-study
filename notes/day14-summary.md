# Day 14 精简笔记

> 主题：React Compiler + 性能优化深度

## 一句话总结
**memo 的价值不在父组件而在子组件——子组件通过 bailout 跳过整棵子树渲染，前提是 props 引用稳定。**

---

## 黄金组合链

```
useCallback 稳定函数引用
useMemo 稳定计算值引用
    ↓
子组件 props 引用没变
    ↓
React.memo(Object.is) 比较通过 → bailout! ✅
    ↓
整棵子树都省了
```

**任何一环断裂 → 全链条失效。**

## 三大 API 一览

| API | 缓存什么 | 触发条件 | 前提 |
|---|---|---|---|
| `React.memo(Comp, areEqual?)` | 整个组件是否重渲染 | 父 re-render 时 | **props 引用稳定**（否则形同虚设） |
| `useMemo(() => val, [deps])` | 任意表达式的值 | deps 变化时 | 计算确实有开销 |
| `useCallback(fn, [deps])` | 函数引用 | deps 变化时 | 配合 React.memo 使用 |

## ⚠️ 最大坑

**React.memo 比较函数返回值语义和 Array.filter 相反：**
- `Array.filter(fn)`：fn 返回 true = **保留**
- `React.memo(Comp, fn)`：fn 返回 true = **跳过渲染 (bailout)**

## bailout 底层原理

发生在 `beginWork` 阶段（`ReactFiberBeginWork.js`）：
```
1. oldProps vs newProps: Object.is 比较
2. 如果相等 + 无待处理 update → bailout!
3. 复用上次 fiber 节点 → 跳过整个子树
```
效果：**父组件无法 bailout（它自己触发了更新），但子组件可以。**

## React Compiler

| 你以前手写的 | Compiler 自动处理 |
|---|---|
| React.memo() | ✅ 自动分析是否需要 |
| useMemo / useCallback | ✅ 自动推导依赖 |
| 手动提升常量 | ✅ 自动识别纯表达式 |

### Compiler 不能做的（仍需手写）
1. **跨组件共享值** → 提到组件外部
2. **自定义比较逻辑** → React.memo 第二参数
3. **ref 相关缓存** → 手动 useMemo
4. **第三方组件优化** → 外层包 React.memo
5. **调试意图声明** → 显式 memo 做断点

### 输入等价性保证
相同输入 → 相同输出。Compiler 不改变逻辑/副作用/Hooks顺序。

## 性能优化优先级

```
第0层: 先测量（Profiler），确认真有问题
第1层: 结构/算法（减少 state、虚拟列表、分页）
第2层: 更新粒度（state 下推、组件拆分、Suspense）
第3层: memo 系列（最后才考虑）
第4层: React Compiler（自动化第3层）

❌ 最常见错误：直接从第3层开始优化
```

## 面试口述版（30 秒）

> "性能优化的核心是让子组件能 bailout——跳过不必要的重渲染。这需要一条完整的链路：useCallback 稳定回调、useMemo 稳定计算值，配合 React.memo 的 Object.is 比较命中 bailout。注意比较函数返回 true 表示'不需要更新'，和 filter 语义相反。React Compiler 能自动处理组件内部的 memoization，但跨组件共享、自定义比较、第三方组件这些场景仍需手写。"
