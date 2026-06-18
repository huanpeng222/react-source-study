# Day 4 实验：beginWork / completeWork / bailout

> 三个实验，每个 5-10 分钟可完成。
> 基于 Day 2 已搭好的 `playground/`（Vite + React）。

---

## 实验 E1：用 console.log 看 beginWork 时序

### 目标

亲眼看到 beginWork 阶段的"深度优先下钻"顺序。

### 代码

把 `playground/src/App.jsx` 改成：

```jsx
import { useEffect } from 'react';

let depth = 0;
function trace(name) {
  console.log('  '.repeat(depth) + '↓ ' + name);
}

function Counter() {
  trace('beginWork: Counter');
  
  useEffect(() => {
    console.log('↑ commit: Counter (useEffect)');
  });
  
  return <button>0</button>;
}

function Header() {
  trace('beginWork: Header');
  
  useEffect(() => {
    console.log('↑ commit: Header (useEffect)');
  });
  
  return <h1>Title</h1>;
}

export default function App() {
  trace('beginWork: App');
  
  useEffect(() => {
    console.log('↑ commit: App (useEffect)');
  });
  
  return (
    <div>
      <Header />
      <Counter />
    </div>
  );
}
```

### 预期输出

```
↓ beginWork: App
↓ beginWork: Header
↓ beginWork: Counter
↑ commit: Header (useEffect)
↑ commit: Counter (useEffect)
↑ commit: App (useEffect)
```

⭐ **观察规律**：
- beginWork 是**先序深度优先**（App → Header → Counter）
- useEffect 触发是**后序回溯**（Header → Counter → App）

### 自检

**Q**：为什么 beginWork 顺序是 App → Header → Counter，但 useEffect 是 Header → Counter → App？

<details><summary>答案</summary>

beginWork：先 render 父，再 render 子（深度优先下钻）

useEffect 在 commit 阶段后触发，**子先 commit、父后 commit**：
- Header 是 App 的第一个子，先 commit → 先 effect
- Counter 是 App 的第二个子，第二 commit → 第二 effect
- App 最后 commit → 最后 effect

这就是为什么 useEffect 里 ref.current 拿到的是真实 DOM——子 commit 时 DOM 已经挂上去了。

</details>

---

## 实验 E2：React.memo 验证 bailout

### 目标

亲眼看到父组件 render 但子组件被 bailout 跳过。

### 代码

```jsx
import { useState, memo, useEffect } from 'react';

const Counter = memo(function Counter({ initial }) {
  console.log('🔄 Counter render');
  return <span>Counter initial: {initial}</span>;
});

const Banner = memo(function Banner({ obj }) {
  console.log('🔄 Banner render (obj=', obj, ')');
  return <span>Banner obj.value: {obj.value}</span>;
});

export default function App() {
  const [count, setCount] = useState(0);
  console.log('🔄 App render');

  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>
        Parent count: {count}
      </button>
      
      <hr />
      
      {/* ✅ initial 是字面量 0，引用稳定 → 子 bailout */}
      <Counter initial={0} />
      
      <hr />
      
      {/* ❌ 每次都生成新对象 → 即使包了 memo，子也不 bailout */}
      <Banner obj={{ value: 'hello' }} />
    </div>
  );
}
```

### 操作步骤

1. 启动应用，**清空 console**
2. 连续点击 button 3 次
3. 观察 console 输出

### 预期输出

```
首次 render：
🔄 App render
🔄 Counter render
🔄 Banner render (obj=...)

第 1 次点击：
🔄 App render
🔄 Banner render (obj=...)         ← obj 引用变了，没 bailout
（Counter 没打印！bailout 命中）

第 2 次点击：
🔄 App render
🔄 Banner render (obj=...)
（Counter 仍然没打印）
```

⭐ **观察现象**：
- Counter 只在首次 render 打印一次，之后被 bailout
- Banner 每次都 render（因为 obj 引用每次都新生成）

### 自检

**Q**：怎么修复 Banner 让它也能 bailout？

<details><summary>答案</summary>

用 `useMemo` 让 obj 引用稳定：

```jsx
const stableObj = useMemo(() => ({ value: 'hello' }), []);
return <Banner obj={stableObj} />;
```

或者把 obj 提到组件外（只创建一次）：

```jsx
const FIXED_OBJ = { value: 'hello' };

function App() {
  return <Banner obj={FIXED_OBJ} />;
}
```

</details>

---

## 实验 E3：把 useState 放 if 里看错乱

### 目标

亲眼看到 React 的"按调用顺序对应 Hook 链表"机制——以及违反它的报错。

### 代码

```jsx
import { useState } from 'react';

export default function Buggy() {
  const [flag, setFlag] = useState(true);
  
  // ⚠️ 危险写法：条件 Hook
  let extra;
  if (flag) {
    [extra] = useState('extra value');
  }
  
  const [name, setName] = useState('hello');
  
  return (
    <div>
      <button onClick={() => setFlag(f => !f)}>toggle flag (current: {String(flag)})</button>
      <p>extra: {extra}</p>
      <p>name: {name}</p>
    </div>
  );
}
```

### 操作步骤

1. 启动应用，看初始渲染（flag=true）
2. 点击 toggle 按钮（flag → false）
3. 观察控制台

### 预期错误

控制台报错（React 19 严格版本）：

```
Warning: React has detected a change in the order of Hooks called by Buggy.
This will lead to bugs and errors if not fixed.

Previous render            Next render
------------------------------------------------------
1. useState                useState
2. useState                useState     ← name 拿到了上次 extra 的位置
3. undefined               undefined
```

或者错乱表现：`name` 显示的是上次 `extra` 的值。

### 自检

**Q**：为什么 React 不能"智能识别"哪些 Hook 是条件的？

<details><summary>答案</summary>

React 的 Hook 实现是**纯靠调用顺序**对应 fiber.memoizedState 链表节点的。

如果让 React 智能识别，就需要：
- 给每个 Hook 起一个全局唯一 id（用户要写 `useState('count')`）
- 或者解析函数体的 AST 找出所有 useState 调用位置

第一种 = 用户要多写一倍代码
第二种 = 编译器复杂度爆炸

React 团队的取舍：**简单约定（顶层调用）+ ESLint 规则（react-hooks/rules-of-hooks）防止违反**。

这就是 React"够用就好"哲学的又一个体现。

</details>

---

## 自检题（写到 observations.md）

跑完三个实验后回答：

1. E1 中，Header 和 Counter 哪个先 useEffect？为什么？
2. E2 中，如果把 Counter 的 prop 改成 `<Counter initial={count}/>`（每次都变），还会 bailout 吗？
3. E3 中，如果把 if 改成 `flag && useState('extra')`，会一样错乱吗？为什么？

---

## 完成后

```bash
cd react-source-study
git add demos/day4 notes/day4.md notes/day4-summary.md notes/day4-quiz.md
git commit -m "W1 D4 reconcile 工作循环：完成 3 实验"
git push
```
