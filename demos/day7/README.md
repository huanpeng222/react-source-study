# Day 7 实验：useEffect 源码现象验证

> 配套 `notes/day7.md`，3 个实验。每个**先预测、再跑、再对照**。
> 在 `demos/day7/playground/` 起 Vite + React 项目，代码贴进 `src/App.jsx`。

---

## 环境准备

```bash
cd demos/day7
npm create vite@latest playground -- --template react
cd playground && npm install && npm run dev
```

---

## 实验 H1：deps 浅比较陷阱（Object.is 逐项 + 引用 vs 值）

### 目标

验证 `areHookInputsEqual` 用 Object.is 逐项比 deps：基本类型比值、引用类型比引用。看"deps 里放对象"如何导致 effect 每次都重跑。

### 代码

```jsx
import { useState, useEffect, useMemo } from 'react';

export default function App() {
  const [n, setN] = useState(0);

  // A. deps 是基本类型
  useEffect(() => {
    console.log('🔵 effect A（deps=[n] 基本类型）');
  }, [n]);

  // B. deps 是每次新建的对象 → 引用每次都变
  const obj = { value: 0 };   // ⚠️ 每次 render 新建
  useEffect(() => {
    console.log('🔴 effect B（deps=[obj] 每次新对象）');
  }, [obj]);

  // C. deps 是 useMemo 稳定引用的对象
  const stableObj = useMemo(() => ({ value: 0 }), []);
  useEffect(() => {
    console.log('🟢 effect C（deps=[stableObj] useMemo 稳定）');
  }, [stableObj]);

  return <button onClick={() => setN(n + 1)}>点击 {n}（不改 obj/stableObj 内容）</button>;
}
```

### 预测（先写下来）

点击按钮（n 变，但 obj 内容不变），三个 effect 哪些会重跑？

| effect | deps | 点击后重跑？ |
|---|---|---|
| A `[n]` | 基本类型 | ? |
| B `[obj]` | 每次新对象 | ? |
| C `[stableObj]` | useMemo 稳定 | ? |

### 预期现象

| effect | 点击后重跑？ | 原因 |
|---|---|---|
| A `[n]` | ✅ 重跑 | n 值变了（Object.is(0,1)=false）|
| B `[obj]` | ✅ **每次都重跑** | obj 每次 render 新建，引用变（Object.is 两个不同对象=false）|
| C `[stableObj]` | ❌ 不重跑 | useMemo 锁定引用，Object.is 同一引用=true |

⭐ **核心观察**：B 即使"内容没变"也每次重跑——因为 Object.is 比的是**引用**不是内容。这就是"deps 放对象/函数要用 useMemo/useCallback 包"的根本原因。

### 留档

console 截图 + 把三个 effect 的重跑情况记到 `observations.md`。

---

## 实验 H2：两条链表实物（同一 effect 对象）

### 目标

在 DevTools 里看到 effect 对象**同时挂在** Hook 链表（memoizedState）和 updateQueue 环形链表，验证是同一个对象。

### 代码

```jsx
import { useState, useEffect, useRef } from 'react';

export default function App() {
  const [n, setN] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    console.log('effect 1');
  }, [n]);

  useEffect(() => {
    console.log('effect 2');
  });

  useEffect(() => {
    if (!ref.current) return;
    const key = Object.keys(ref.current).find(k => k.startsWith('__reactFiber$'));
    const fiber = ref.current[key].return;  // 往上找到 App 组件的 fiber

    console.group('🧬 两条链表');
    // 链表 1：Hook 链表（memoizedState）
    let hook = fiber.memoizedState;
    let i = 0;
    while (hook) {
      console.log(`Hook[${i}] memoizedState:`, hook.memoizedState);
      hook = hook.next;
      i++;
    }
    // 链表 2：effect 环形链表（updateQueue.lastEffect）
    const q = fiber.updateQueue;
    console.log('updateQueue.lastEffect:', q && q.lastEffect);
    console.groupEnd();
  });

  return <button ref={ref} onClick={() => setN(n + 1)}>{n}</button>;
}
```

### 你要观察/回答

1. Hook 链表里有几个节点？（3 个 useEffect + 1 个 useState + 1 个 useRef = 5 个 Hook）
2. useEffect 对应的 Hook 节点，它的 `memoizedState` 是不是一个 `{tag, create, deps, inst, next}` 的 effect 对象？
3. `updateQueue.lastEffect` 是不是也指向 effect 对象？它的 `next` 串起来是不是环形（最后一个 next 指回第一个）？
4. （进阶）验证同一性：Hook 链表里第一个 useEffect 的 memoizedState，和 updateQueue 环形链表里对应的那个 effect，是不是 `===`？

### 预期

- Hook 链表 5 个节点（useState/useRef 的 memoizedState 是值或 ref 对象；useEffect 的是 effect 对象）
- updateQueue 只串 3 个 effect（useState/useRef 不进）
- 同一个 useEffect：`hook.memoizedState === updateQueue 里对应 effect`（同一对象两处引用）

### 留档

DevTools 截图存 `screenshots/H2-two-lists.png`。

---

## 实验 H3：cleanup 时机（useLayoutEffect vs useEffect）

### 目标

亲眼看到 cleanup 和 effect 的跑动顺序：layoutCleanup 在 Mutation、layoutEffect 在 Layout、useEffect 的 cleanup+effect 在 paint 后异步。验证 cleanup 闭包捕获的是**上次**的值。

### 代码

```jsx
import { useState, useEffect, useLayoutEffect } from 'react';

export default function App() {
  const [n, setN] = useState(0);

  console.log('🎨 render:', n);

  useEffect(() => {
    console.log('🔵 effect:', n);
    return () => console.log('🔴 cleanup:', n);   // ← 这个 n 是哪一版？
  }, [n]);

  useLayoutEffect(() => {
    console.log('🟡 layoutEffect:', n);
    return () => console.log('🟠 layoutCleanup:', n);
  }, [n]);

  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
```

### 预测

初次加载 + 点击 1 次，console 完整顺序？每个 cleanup 打印的 n 是几？

### 预期现象

```
初次加载：
  🎨 render: 0
  🟡 layoutEffect: 0      ← Layout 同步
  （paint）
  🔵 effect: 0            ← 异步

点击 1 次：
  🎨 render: 1
  🟠 layoutCleanup: 0     ← Mutation 同步（cleanup 拿上次的 n=0！）
  🟡 layoutEffect: 1      ← Layout 同步
  （paint）
  🔴 cleanup: 0           ← 异步（cleanup 拿上次的 n=0！）
  🔵 effect: 1            ← 异步（effect 拿这次的 n=1）
```

⭐ **核心观察**：
1. cleanup 打印的是 **0（上次的 n）**，effect 打印的是 **1（这次的 n）**——cleanup 闭包捕获上次渲染的值。
2. layoutCleanup 在 layoutEffect 之前（Mutation → Layout，中间隔着改 DOM）。
3. useEffect 的 cleanup + effect 都在 paint 后（晚于 layoutEffect:1）。

### 留档

console 截图存 `screenshots/H3-cleanup-timing.png`。

---

## 实验 H4：父子组件 effect/cleanup 执行顺序（mount / re-render / unmount）

### 目标

一次性验证所有场景下 effect 和 cleanup 的父子执行顺序：

| 场景 | effect（create） | cleanup |
|---|---|---|
| mount | 子先父后 | 不执行 |
| **re-render（deps 变，不卸载）** | 子先父后 | **子先父后** |
| **unmount（卸载）** | 不执行 | **父先子后** ❗ |

> ⚠️ re-render 和 unmount 的 cleanup 顺序**相反**，这是本实验最容易搞混的点。

### 代码

```jsx
import { useState, useEffect, useLayoutEffect } from 'react';

// ── 子组件 1 ──
function Child({ count }) {
  console.log('  📗 Child render, count =', count);

  // deps 依赖 count → count 变就 cleanup + 重新 create（不卸载）
  useEffect(() => {
    console.log('  📗 Child useEffect, count =', count);
    return () => console.log('  📕 Child useEffect cleanup, count =', count);
  }, [count]);

  useLayoutEffect(() => {
    console.log('  📗 Child useLayoutEffect, count =', count);
    return () => console.log('  📕 Child useLayoutEffect cleanup, count =', count);
  }, [count]);

  return <div>Child (count={count})</div>;
}

// ── 子组件 2（包裹层）──
function Child2({ count }) {
  console.log('  📗 Child2 render, count =', count);

  useEffect(() => {
    console.log('  📗 Child2 useEffect, count =', count);
    return () => console.log('  📕 Child2 useEffect cleanup, count =', count);
  }, [count]);

  useLayoutEffect(() => {
    console.log('  📗 Child2 useLayoutEffect, count =', count);
    return () => console.log('  📕 Child2 useLayoutEffect cleanup, count =', count);
  }, [count]);

  return <div><Child count={count} /></div>;
}

// ── 父组件 ──
export default function App() {
  const [showChild, setShowChild] = useState(true);
  const [count, setCount] = useState(0);

  console.log('📘 App render, count =', count, ', showChild =', showChild);

  // deps 依赖 count → 跟 Child 一起变化，验证父子顺序
  useEffect(() => {
    console.log('📘 App useEffect, count =', count);
    return () => console.log('📕 App useEffect cleanup, count =', count);
  }, [count]);

  useLayoutEffect(() => {
    console.log('📘 App useLayoutEffect, count =', count);
    return () => console.log('📕 App useLayoutEffect cleanup, count =', count);
  }, [count]);

  return (
    <div style={{ padding: 20 }}>
      <h1>count = {count}, showChild = {showChild ? 'true' : 'false'}</h1>

      <div style={{ marginBottom: 10 }}>
        <button onClick={() => setCount(c => c + 1)}>
          re-render（deps 变，不卸载）
        </button>
        <button onClick={() => setShowChild(false)} style={{ marginLeft: 8 }}>
          卸载 Child（unmount）
        </button>
        <button onClick={() => { setShowChild(true); setCount(0); }} style={{ marginLeft: 8 }}>
          重新挂载（reset）
        </button>
      </div>

      {showChild && <Child2 count={count} />}
    </div>
  );
}
```

### 操作步骤

**第 1 步：mount（页面首次加载）**

清空 console，刷新页面。

**第 2 步：re-render（点"re-render"按钮）**

点一次。`count` 从 0 变 1，App 和 Child 的 effect deps 都变了，但**组件不卸载**——这是真正的 re-render。

**第 3 步：unmount（点"卸载 Child"按钮）**

先点"重新挂载"把 count 重置为 0（方便观察），再点"卸载 Child"。Child 被卸载。

### 预期现象

**第 1 步：mount**
```
📘 App render, count = 0 , showChild = true
  📗 Child render, count = 0
  📗 Child useLayoutEffect, count = 0      ← layout: 子先
📘 App useLayoutEffect, count = 0           ← layout: 父后
  📗 Child useEffect, count = 0           ← passive: 子先
📘 App useEffect, count = 0                ← passive: 父后
```

**第 2 步：re-render（count 0→1，deps 变，不卸载）**
```
📘 App render, count = 1 , showChild = true
  📗 Child render, count = 1

// layout 阶段（后序遍历 → 子先父后）：
  📕 Child useLayoutEffect cleanup, count = 0     ← 子 cleanup 先（拿旧值0）
  📗 Child useLayoutEffect, count = 1              ← 子 create 后（拿新值1）
📕 App useLayoutEffect cleanup, count = 0           ← 父 cleanup
📘 App useLayoutEffect, count = 1                  ← 父 create

// passive 阶段（同样后序 → 子先父后）：
  📕 Child useEffect cleanup, count = 0
  📗 Child useEffect, count = 1
📕 App useEffect cleanup, count = 0
📘 App useEffect, count = 1
```

**第 3 步：unmount（showChild = false）**
```
📘 App render, count = 0 , showChild = false

// before mutation 阶段（从父往子递归 → 父先子后）❗反过来了：
  📕 Child useLayoutEffect cleanup, count = 0      ← 注意：这里只有 Child 的 cleanup
  📕 Child useEffect cleanup, count = 0             ← App 没卸载，App 的 effect 不跑
```

### 关键观察

1. **mount 时 create：子先父后**（从叶子往上冒泡）
2. **re-render 时 cleanup 也是子先父后**（跟 create 同向，后序遍历）
3. **unmount 时 cleanup 反过来：父先子后**❗（从根往下拆，before mutation 阶段递归方向不同）
4. **cleanup 打印旧值，create 打印新值**（闭包捕获的是上次 render 的值）
5. **layoutEffect 永远比 useEffect 先执行**（layout 同步在 commit，passive 异步在 paint 后）

### 完整对比表

| 场景 | cleanup 顺序 | create 顺序 | 组件是否卸载 |
|---|---|---|---|
| mount | 不执行 | 子先父后 | 新挂载 |
| **re-render（deps 变）** | **子先父后** | **子先父后** | 不卸载 |
| **unmount（卸载）** | **父先子后** ❗ | 不执行 | 卸载 |

### 速记口诀

> **建是"搭积木"（子先父后，从下往上）**
> **更新时 cleanup 跟 create 同向（都子先父后）**
> **拆是"拆房子"（父先子后，从外往内）❗只有卸载才反过来**

### 留档

console 截图存 `screenshots/H4-parent-child-order.png`。

---

## 完成后

填 `observations.md`，然后 commit：

```bash
git add demos/day7/
git commit -m "W2 D7 实验回填：H1 deps 浅比较 + H2 两条链表 + H3 cleanup 时机"
git push
```
