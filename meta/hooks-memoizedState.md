# Hook 节点 `memoizedState` 字段速查

> 按结构分组，源码出处：`packages/react-reconciler/src/ReactFiberHooks.js`
> 一行记忆规律：**有没有 queue = 能不能触发 render；有没有 flag = 要不要延迟到 commit**

---

## 一、完整一览

| Hook | `hook.memoizedState` 存什么 | 有 `queue` | 打 `flag` |
|---|---|---|---|
| **useState** | 当前 state 值（`5` / `"a"` / `obj`） | ✅ | ❌ |
| **useReducer** | 当前 state 值 | ✅ | ❌ |
| **useRef** | `{ current: initialValue }` 盒子对象 | ❌ | ❌ |
| **useMemo** | `[value, deps]` 二元组 | ❌ | ❌ |
| **useCallback** | `[callback, deps]` 二元组 | ❌ | ❌ |
| **useEffect** | effect 对象 `{ tag, create, inst, deps, next }` | ❌ | ✅ |
| **useLayoutEffect** | 同上 effect 对象 | ❌ | ✅ |
| **useInsertionEffect** | 同上 effect 对象 | ❌ | ✅ |
| **useImperativeHandle** | `{ current: ... }` 或 `undefined` | ❌ | ✅ |
| **useDebugValue** | 开发者自定义标签值 | ❌ | ❌ |
| **useDeferredValue** | `[value, previousValue]` 二元组 | ❌ | ❌ |
| **useTransition** | `[isPending, startTransition]` 状态 | ❌ | ❌ |
| **useOptimistic** | `[optimisticValue, ...]` | ❌ | ❌ |
| **useSyncExternalStore** | `[snapshot, ...]` | ❌ | ❌ |

---

## 二、按结构分组

### 组 A：纯值（state 类）
```js
useState / useReducer
  memoizedState: 5                // 当前 state 值
  queue: { pending, dispatch }     // ✅ 有 queue
  flag: ❌
```

### 组 B：纯值（ref / debug 类）
```js
useRef
  memoizedState: { current: null }  // 盒子对象，updateRef 一行 return，从不新建
  queue: ❌
  flag: ❌

useDebugValue
  memoizedState: 'customLabel'      // 纯值
  queue: ❌
  flag: ❌
```

### 组 C：二元组（[值, deps] 类）
```js
useMemo
  memoizedState: [42, [a, b]]          // [缓存结果, 依赖]
  queue: ❌
  flag: ❌
  // deps 命中 → 返回 [0]（复用缓存）；不命中 → 重算 create() 并更新 [0]

useCallback
  memoizedState: [fn, [a, b]]          // [函数, 依赖]
  queue: ❌
  flag: ❌
  // 同 useMemo，但存的是函数本身，不执行 create

useDeferredValue
  memoizedState: [val, prevVal]

useOptimistic
  memoizedState: [optVal, ...]

useSyncExternalStore
  memoizedState: [snapshot, ...]
```

### 组 D：effect 对象（[tag, create, inst, deps, next] 类）
```js
useEffect / useLayoutEffect / useInsertionEffect
  memoizedState: {
    tag:    9（useEffect: HookHasEffect|HookPassive）  // 或 5（useLayoutEffect: HookHasEffect|HookLayout）
             // 两个体系：fiberFlags 在 fiber.flags / hookFlags 在 effect.tag
    create: fn,                                        // 用户写的 effect 回调
    inst: { destroy: cleanupFn },                       // cleanup 存这里（不在 memoizedState 上！）
    deps: [a],                                         // 依赖
    next: → 下一个 effect（同时也在 fiber.updateQueue 环形链表里）
  }
  queue: ❌
  flag: ✅（Passive / Update / Layout）
  // ★ 同时被两处引用：Hook 链表（比 deps 用） + fiber.updateQueue 环形链表（commit 执行清单）
```

### 组 E：盒 + flag 类
```js
useImperativeHandle
  memoizedState: { current: refObj } 或 undefined
  queue: ❌
  flag: ✅
```

---

## 三、两条核心规律

### 规律 1：有没有 `queue` → 能不能触发 render

```
有 queue（useState / useReducer）→ dispatch 派发 update → scheduleUpdateOnFiber → render
没有 queue（其余所有）          → 没有 dispatch 通路 → 自己永不发起 render / 都是纯读写
```

### 规律 2：有没有 `flag` → 要不要延迟到 commit

```
有 flag（useEffect / useLayoutEffect / useInsertionEffect / useImperativeHandle）
  → render 阶段不能执行，要等 DOM 改完 → 打 flag 标记 → commit 阶段根据 flag 执行
没有 flag（其余所有）
  → render 阶段直接算出结果就返回 / 直接读 memoizedState 就返回
```

### 规律 3：memoizedState 结构复杂度

```
纯值 / 盒子 < 二元组[deps] <  effect 对象（有 inst/next/环形链表）
useState       useMemo        useEffect / useLayoutEffect
useReducer     useCallback
useRef         useDeferredValue
```
