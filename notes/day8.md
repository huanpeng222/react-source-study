# Day 8 笔记：useRef / useMemo / useCallback 源码

> 主题：三个"非状态" Hook 的实现，以及"为什么改 ref 不触发 render"
> 状态：📖 学习中
> 源码出处：`packages/react-reconciler/src/ReactFiberHooks.js`
>   （mountRef / updateRef / mountMemo / updateMemo / mountCallback / updateCallback / areHookInputsEqual）
> 衔接：Day 6（useState 的 queue / dispatch）+ Day 7（effect 链表 / 三层复用 / deps 浅比较）

---

## 零、入场自测（先自己答，"不会"明确说"不会"）

1. useRef 的 `{ current: x }` 对象为什么跨 render 稳定？源码怎么存的？
2. useMemo 和 useCallback 本质是同一个东西吗？源码差异在哪？
3. 为什么改 `ref.current` 不会触发 render，但改 state 会？
4. useMemo 的缓存值存在 Hook 的哪个字段？

> 答完往下看。本篇 Step 3 会**主动把每节讲全**，不靠你追问；每节末尾有一个微检查点。

---

## 一、先建立全局认知：这三个 Hook 的共性

Day 6/7 讲的 useState / useEffect 都很"重"——有 queue、有 dispatch、有副作用调度。
今天这三个 Hook 是**最轻量**的一类，共性是：

> **它们都只用 `hook.memoizedState` 一个字段做存储，没有 queue、不打 fiber.flags、不参与 commit。**

| Hook | memoizedState 存什么 | 有 queue | 打 flag | 参与 commit |
|---|---|---|---|---|
| useRef | `{ current: x }` | ❌ | ❌ | ❌ |
| useMemo | `[value, deps]` | ❌ | ❌ | ❌ |
| useCallback | `[callback, deps]` | ❌ | ❌ | ❌ |

⭐ 对比记忆（接 Day 7）：
- useState/useReducer → 有 queue（要接收 dispatch 的 update）
- useEffect/useLayoutEffect → 打 flag + 进 effect 链表（要延迟到 commit 执行）
- **useRef/useMemo/useCallback → 啥都不要，render 阶段直接算/直接取**

这就是为什么它们"不触发 render"——它们**只是 render 过程中的纯读写**，自己不会发起更新。

> 🔍 微检查点 1：这三个 Hook 和 useState 最大的结构差异是什么？（答案：没有 queue，不接收 dispatch）

---

## 二、useRef：一个永不更换的盒子

### 2.1 mount：创建 `{ current }` 盒子

```js
function mountRef(initialValue) {
  const hook = mountWorkInProgressHook();
  const ref = { current: initialValue };   // ★ 创建盒子
  hook.memoizedState = ref;                // 存进 hook
  return ref;
}
```

### 2.2 update：直接返回旧盒子（一行）

```js
function updateRef(initialValue) {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;               // ★ 原样返回，initialValue 被忽略
}
```

⭐ **就一行**。update 阶段：
- **不新建** `{ current }`
- **不读** `initialValue` 参数（和 useState 的初始值一样，mount 后就是死的）
- 直接把 mount 时那个盒子返回

### 2.3 为什么跨 render 稳定（Q1）

```
mount：  hook.memoizedState = { current: 0 }   ← 盒子对象 A，地址固定
update： return hook.memoizedState              ← 还是返回 A
```

每次 render 拿到的是**同一个对象 A**（`Object.is(ref1, ref2) === true`）。

衔接 Day 7 的三层复用：

> 每次 render Hook 外壳是新建的（`updateWorkInProgressHook` new 一个新 hook 节点），但 `memoizedState: currentHook.memoizedState` 是**浅拷贝**——新 hook 的 memoizedState 仍指向**同一个 ref 盒子**。外壳换了，盒子没换。

这跟 Day 6 "queue 跨 render 共享" 是同一个机制：**需要跨 render 存活的东西，通过浅拷贝引用延续**。

### 2.4 为什么改 ref.current 不触发 render（Q3，核心）

对比 state：

```js
// state：改值要走 dispatch → 入队 → 调度 render
setN(1);              // dispatchSetState → scheduleUpdateOnFiber

// ref：直接改对象属性，React 完全不知道
ref.current = 1;      // 就是普通 JS 赋值，没有任何 React 介入
```

⭐ **根本原因**：
- `setN` 是 React 给你的 dispatch 函数，内部会**调度更新**
- `ref.current = x` 只是改一个**普通对象的属性**，React 没有任何监听/拦截

ref 这个盒子是个"React 不管的逃生舱"——你往里塞什么、改什么，React 一概不知，自然不会 render。

> 🔍 微检查点 2：`ref.current = 5` 之后组件不会重渲染，那页面上依赖 ref.current 的地方会更新吗？
> （答案：不会自动更新；要等下次因为别的原因 render 时，才会读到新的 ref.current。这就是 ref "不适合存渲染相关数据"的原因）

### 2.5 useRef 的两个典型用途

| 用途 | 例子 | 为什么用 ref 不用 state |
|---|---|---|
| **存 DOM 引用** | `<div ref={myRef}>` | DOM 引用变化不该触发 render |
| **存"跨 render 的可变值"** | 定时器 id、上一次的值、是否首次渲染 | 改它不需要重渲染 |

```js
// 经典：存定时器 id
const timerRef = useRef(null);
timerRef.current = setInterval(...);   // 改它不 render ✓

// 经典：记录上一次的值
const prevRef = useRef();
useEffect(() => { prevRef.current = value; });
```

---

## 三、useMemo：缓存"计算结果"

### 3.1 mount：执行函数，缓存 [结果, deps]

```js
function mountMemo(nextCreate, deps) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const nextValue = nextCreate();              // ★ 立即执行，拿到结果
  hook.memoizedState = [nextValue, nextDeps];  // ★ 存 [结果, 依赖]
  return nextValue;
}
```

### 3.2 update：deps 没变就返回缓存，变了才重算

```js
function updateMemo(nextCreate, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;        // [上次结果, 上次 deps]

  if (nextDeps !== null) {
    const prevDeps = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0];                     // ★ deps 没变 → 直接返回缓存的结果，不重算
    }
  }

  const nextValue = nextCreate();              // deps 变了 → 重新执行
  hook.memoizedState = [nextValue, nextDeps];  // 更新缓存
  return nextValue;
}
```

⭐ **三步逻辑**：
1. 取出上次缓存的 `[value, deps]`
2. 用 `areHookInputsEqual` 比新旧 deps
3. 相等 → 返回旧 `value`（**跳过 nextCreate 执行**）；不等 → 重算 + 更新缓存

### 3.3 缓存值存哪（Q4）

```
hook.memoizedState = [nextValue, nextDeps]
                       ↑           ↑
                   缓存的结果    上次的依赖数组
```

⭐ **Q4 答案**：存在 `hook.memoizedState`，是个**二元数组** `[value, deps]`——第 0 项是缓存值，第 1 项是依赖数组（用来下次比较）。

> 🔍 微检查点 3：useMemo 的 deps 不传（`useMemo(fn)`，没有第二个参数）会怎样？
> （答案：nextDeps = null，每次 update 都跳过相等判断直接重算——等于没缓存。所以 useMemo 必须传 deps 才有意义）

---

## 四、useCallback：缓存"函数本身"

### 4.1 mount / update 源码（和 useMemo 几乎一样）

```js
function mountCallback(callback, deps) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  hook.memoizedState = [callback, nextDeps];   // ★ 直接存函数，不执行
  return callback;
}

function updateCallback(callback, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;

  if (nextDeps !== null) {
    const prevDeps = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0];                     // deps 没变 → 返回旧函数
    }
  }

  hook.memoizedState = [callback, nextDeps];   // deps 变了 → 存新函数
  return callback;
}
```

### 4.2 和 useMemo 的唯一区别（Q2）

把两个 mount 并排看：

```js
mountMemo:     const nextValue = nextCreate();  hook.memoizedState = [nextValue, deps];  // 存"执行结果"
mountCallback: /* 不执行 */                      hook.memoizedState = [callback, deps];   // 存"函数本身"
```

⭐ **Q2 答案**：本质是同一套机制（deps 浅比较 + 缓存），**唯一区别**：
- useMemo 存的是 `nextCreate()` 的**返回值**（会执行函数）
- useCallback 存的是 `callback` **函数本身**（不执行）

所以有那个经典等式：

```js
useCallback(fn, deps)  ≡  useMemo(() => fn, deps)
```

useCallback 就是"专门用来 memo 一个函数"的 useMemo 语法糖。

> 🔍 微检查点 4：`useMemo(() => () => doSomething(), [])` 和 `useCallback(() => doSomething(), [])` 等价吗？
> （答案：等价。useMemo 的 create 返回一个函数，缓存的就是那个函数 = useCallback 的效果）

---

## 五、areHookInputsEqual：deps 怎么比（贯穿三者）

useMemo / useCallback 的缓存命中都靠它（useEffect 的 deps 也是它，Day 7 学过）：

```js
function areHookInputsEqual(nextDeps, prevDeps) {
  if (prevDeps === null) return false;          // 上次没 deps → 不等
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (is(nextDeps[i], prevDeps[i])) continue;  // is = Object.is
    return false;                                // 有一项不等 → false
  }
  return true;                                   // 全部相等 → true
}
```

⭐ **三个关键**：
1. `is` 就是 `Object.is`（`shared/objectIs`）——**逐项**比，不是比整个数组的引用
2. 基本类型比值（`[count]` → 比 count 的值）；**引用类型比引用**（`[obj]` → 比 obj 地址）
3. 任意一项不等就返回 false → 重算

### 5.1 为什么"传新对象会让缓存失效"（实战坑，接 Day 6 memo）

```js
const config = { a: 1 };                        // 每次 render 新建对象
const value = useMemo(() => compute(config), [config]);
//                                              ↑ config 每次引用都不同
//                                              → areHookInputsEqual 永远 false
//                                              → useMemo 永远重算 = 白写
```

⭐ 这和 Day 6 学的 "React.memo + 不稳定 props = 没用" 是**同一个根**：deps/props 里放每次新建的对象/函数，浅比较永远不等。

> 🔍 微检查点 5：`useCallback(fn, [obj])`，obj 每次 render 都是新对象字面量，这个 useCallback 有用吗？
> （答案：没用。deps 永远不等 → 每次都返回新的 fn，等于没 memo）

---

## 六、把三者串到主管道上

```
render 阶段（beginWork → renderWithHooks → 执行你的函数组件）
  │
  ├─ useState   → 有 queue，消费 update 算新 state，可能触发后续 render
  ├─ useRef     → 直接返回那个 { current } 盒子（不算、不比、不触发）
  ├─ useMemo    → 比 deps：没变返回缓存值 / 变了执行 create 重算
  ├─ useCallback→ 比 deps：没变返回旧函数 / 变了存新函数
  └─ useEffect  → 打 flag + 进 effect 链表，延迟到 commit 执行
  │
  └─ 这些 Hook 全部按调用顺序串在 fiber.memoizedState 链表上（Day 7）
```

⭐ **一句话总纲**：
> useRef/useMemo/useCallback 都是 **render 阶段的纯函数式读写**——useRef 给个稳定盒子，useMemo/useCallback 用 deps 决定"复用旧的还是产出新的"。**它们自己永远不会发起 render**，所以叫"非状态 Hook"。

---

## 七、动手实验

详见 `demos/day8/README.md`，3 个实验：

| 实验 | 目标 | 验证什么 |
|---|---|---|
| I1 | ref 引用稳定 + 改 current 不 render | `Object.is(ref上次, ref这次)` 恒为 true；改 current 无 render 日志 |
| I2 | useMemo 缓存命中 vs 失效 | deps 稳定 → 不重算；deps 传新对象 → 每次重算 |
| I3 | useCallback ≡ useMemo(()=>fn) | 两种写法引用稳定性一致 |

---

## 八、我之前以为 …，其实是 …（5 条认知纠正）

1. **我以为** useRef 每次 render 会新建 `{ current }`。
   **其实** mount 建一次，update 直接 `return hook.memoizedState`（一行），永远是同一个盒子。

2. **我以为** 改 `ref.current` React 会"悄悄记录"等下次 render 用。
   **其实** 那就是**普通对象赋值**，React 完全不介入、不监听、不调度。它不像 state 有 dispatch 通路。

3. **我以为** useMemo 和 useCallback 是两套不同实现。
   **其实** 同一套（deps 浅比较 + memoizedState 二元组），唯一区别：useMemo 存 `create()` 的**结果**，useCallback 存 `callback` **本身**。`useCallback(fn,d) ≡ useMemo(()=>fn,d)`。

4. **我以为** deps 比较是比"整个数组对象"。
   **其实** 是 `areHookInputsEqual` 用 `Object.is` **逐项**比；引用类型比引用——所以 deps 里放新建对象会让缓存永久失效。

5. **我以为** useMemo 一定能提升性能。
   **其实** 如果 deps 不稳定（每次新对象/新函数），useMemo 永远重算 + 还多存一份缓存，**比不用还慢**。memo 类 API 的前提是"依赖引用稳定"。

---

## 九、Day 8 验收清单

- [x] 能说出 useRef mount/update 源码（update 就一行 return）
- [x] 能解释 ref 跨 render 稳定的原因（浅拷贝引用同一个盒子）
- [x] 能解释改 ref.current 为何不 render（普通赋值，无 dispatch 通路）
- [x] 能说出 useMemo / useCallback 的唯一区别（存结果 vs 存函数）
- [x] 能默写 areHookInputsEqual（Object.is 逐项比 deps）
- [x] 能解释"deps 放新对象导致 memo 失效"的根因
- [x] 完成 3 个动手实验
- [x] 写下 5 条认知纠正

---

## 十、Day 9 预告

**主题**：useContext 源码 + Context 更新如何穿透 React.memo

**预读问题**：

1. useContext 占用 Hook 链表节点吗？它怎么"不按 Hook 规则"读值？
2. Provider 的 value 变化，怎么找到所有消费它的组件？
3. 为什么 Context 更新能"穿透" React.memo / shouldComponentUpdate？
4. Context 的性能问题（value 是对象时全员重渲染）根源在哪？

明天见 👋
