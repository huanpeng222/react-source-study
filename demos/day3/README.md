# Day 3 实验：diff 算法实战验证

> 三个实验全部基于 Day 2 已搭好的 `playground/`（Vite + React）。
> 每个实验独立运行，互不依赖。

---

## 实验 D1：复现 key=index 的"身份认错"

### 目标

亲眼看到非受控 input 内容跟错行，从而记住"key=index 是正确性 bug"。

### 代码

把 `playground/src/App.jsx` 改成：

```jsx
import { useState } from 'react';

export default function App() {
  const [todos, setTodos] = useState([
    { id: 1, text: 'A' },
    { id: 2, text: 'B' },
    { id: 3, text: 'C' },
  ]);

  const prepend = () => {
    setTodos([{ id: Date.now(), text: 'NEW' }, ...todos]);
  };

  return (
    <>
      <button onClick={prepend}>prepend NEW</button>
      <h2>❌ key=index（错误写法）</h2>
      <ul>
        {todos.map((todo, i) => (
          <li key={i}>   {/* ★ 故意用 index */}
            <input defaultValue={todo.text} placeholder="编辑我" />
            <span> ← span shows: {todo.text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
```

### 操作步骤

1. `npm run dev` 启动
2. 在**第二行 input** 里输入 "BBB"（清空原内容再输入）
3. 点击 `prepend NEW` 按钮
4. **观察**：input 内容和 span 内容是否对应？

### 预期现象

| 行 | input 内容 | span 显示 | 是否对应？ |
|---|---|---|---|
| 1 | A | NEW | ❌ 错位 |
| 2 | BBB | A | ❌ 错位 |
| 3 | C | B | ❌ 错位 |
| 4 | (空) | C | ❌ 错位 |

### 修复

把 `key={i}` 改成 `key={todo.id}`，再次操作，**input 跟随各自的语义行**。

### 截图

把"错位状态"的浏览器截图保存到 `screenshots/D1-input-mismatch.png`。

---

## 实验 D2：用 mount/unmount 日志追踪多节点 diff

### 目标

亲眼看到 React 在不同 key 策略下到底**销毁/复用/移动了哪些节点**。
**⚠️ 重要观察**：DOM 移动会触发 useEffect cleanup + rerun（即使 Fiber 是复用的）。

### 代码

```jsx
import { useState, useEffect, useRef } from 'react';

function Item({ id, name }) {
  // ★ 用 useRef 记录这个 Fiber 第一次创建时的"个人编号"
  // 如果 personalId 变了 → 说明 Fiber 真的重建了
  // 如果 personalId 没变但 MOUNT/UNMOUNT 触发了 → 说明只是 DOM 移动
  const personalId = useRef(Math.random().toString(36).slice(2, 6));

  useEffect(() => {
    console.log(`%c[${id}-${name}] MOUNT (Fiber编号=${personalId.current})`, 'color:green;font-weight:bold');
    return () => console.log(`%c[${id}-${name}] UNMOUNT (Fiber编号=${personalId.current})`, 'color:red;font-weight:bold');
  }, []);

  useEffect(() => {
    console.log(`[${id}-${name}] UPDATE (Fiber编号=${personalId.current})`);
  });

  return <li>{id} - {name} (Fiber: {personalId.current})</li>;
}

export default function App() {
  const [items, setItems] = useState([
    { id: 'A', name: 'apple' },
    { id: 'B', name: 'banana' },
    { id: 'C', name: 'cherry' },
    { id: 'D', name: 'durian' },
  ]);

  const shuffle = () => {
    setItems([
      { id: 'B', name: 'banana' },
      { id: 'A', name: 'apple' },
      { id: 'D', name: 'durian' },
      { id: 'C', name: 'cherry' },
    ]);
  };

  return (
    <>
      <button onClick={shuffle}>shuffle to [B,A,D,C]</button>

      <h2>使用 key=id（正确）</h2>
      <ul>
        {items.map(item => <Item key={item.id} id={item.id} name={item.name} />)}
      </ul>

      <h2>使用 key=index（错误）</h2>
      <ul>
        {items.map((item, i) => <Item key={i} id={item.id} name={item.name} />)}
      </ul>
    </>
  );
}
```

### 操作步骤

1. 启动应用，**记下两个列表里每个 Item 的 Fiber 编号**（页面上显示）
2. **清空 console**
3. 点击 `shuffle` 按钮
4. 观察 console + 页面上的 Fiber 编号

### 真实预期现象（修正版）

**上面那个 ul（key=id）**：

```
[B-banana] UPDATE
[A-apple] UPDATE
[D-durian] UPDATE
[C-cherry] UPDATE
[A-apple] UNMOUNT   ← ⚠️ DOM 移动触发
[A-apple] MOUNT     ← ⚠️ DOM 移动触发（但 personalId 不变，说明 Fiber 没重建）
[A-apple] UPDATE
[C-cherry] UNMOUNT  ← ⚠️ 同上
[C-cherry] MOUNT
[C-cherry] UPDATE
```

→ A 和 C 的 Fiber 编号在 shuffle 前后**不变**（验证 Fiber 复用），但 useEffect 触发了 cleanup + rerun。
→ B 和 D 没标 Placement（不需要移动），只 UPDATE。

**下面那个 ul（key=index）**：

```
[B-banana] UPDATE
[A-apple] UPDATE
[D-durian] UPDATE
[C-cherry] UPDATE
```

→ 4 行 UPDATE，**没有 mount/unmount**。
→ Fiber 编号也"看起来没变"（实际上是位置 0 的 Fiber 一直被复用，只是 id/name props 换了人）。

### ⚠️ 关键思考题（必答）

**Q**：key=index 的 console 没 mount/unmount，看起来"很安静"，那它的 bug 究竟在哪？

<details><summary>答案</summary>

console.log 打印的是从 **props 读取**的 id/name，每次 render 都用最新 props，所以"看起来对得上"。

**Bug 在 Fiber 内部不可见的部分**：
- useState 内部 state
- useRef 持有的引用（如这个例子里的 personalId）
- 非受控 DOM 内部 value（input.value、scroll position、focus、动画）

要让 bug 可见，需要给 Item 加 useState 或非受控 input，比如 D1 实验那种 `defaultValue` 写法。

**口诀**：抽屉跟着身份走 vs 钉死在位置。console.log 看的是抽屉外的标签 → 对得上；state/ref/DOM 内部状态在抽屉里 → 跟着抽屉走 → 错位。

</details>

### 进阶：刻意制造 type 不同

把第三个 Item 改成 `<p>`，看会不会真正销毁重建：

```jsx
{items.map(item => 
  item.id === 'C' 
    ? <p key={item.id}>cherry-p</p>
    : <Item key={item.id} id={item.id} name={item.name} />
)}
```

shuffle 后预期：C 的 type 改变（li → p）触发**真正的 Fiber 销毁重建**（personalId 会变）。

### 留档

把 console 输出复制到 `D2-console.txt`。

---

## 实验 D3：type 变化导致 state 重置

### 目标

亲眼验证假设 1：type 变了，组件 state 重置。

### 代码

```jsx
import { useState } from 'react';

function Counter() {
  const [n, setN] = useState(0);
  console.log('Counter render, n =', n);
  return (
    <button onClick={() => setN(c => c + 1)}>
      Counter clicked: {n}
    </button>
  );
}

export default function App() {
  const [wrapper, setWrapper] = useState('div');

  return (
    <>
      <button onClick={() => setWrapper(w => w === 'div' ? 'span' : 'div')}>
        toggle wrapper (current: {wrapper})
      </button>

      <hr />

      {wrapper === 'div' 
        ? <div style={{ background: '#fee' }}><Counter /></div>
        : <span style={{ background: '#eef' }}><Counter /></span>
      }
    </>
  );
}
```

### 操作步骤

1. 点击 Counter 按钮 5 次（n 变成 5）
2. 点击 `toggle wrapper`
3. 观察 Counter 显示的数字

### 预期现象

- Counter 数字**变回 0**
- console 出现 `Counter render, n = 0`（说明 mount 阶段）

### 对比实验

把 toggle 改成 `<div>` ↔ `<div className="x">`（type 不变，只是 className 变）：

```jsx
{wrapper === 'div' 
  ? <div><Counter /></div>
  : <div className="other"><Counter /></div>
}
```

→ Counter 数字**不会变回 0**（type 没变，Counter 复用）。

### 留档

录一个 gif 保存到 `screenshots/D3-state-reset.gif`（或者拍两张截图）。

---

## 自检问题（写到 observations.md）

跑完三个实验后回答：

1. D1 实验中，你点 `prepend NEW` 后，**哪一行的 input 跟错了人**？为什么是这一行？
2. D2 实验中，如果把 4 个 Item 全删掉、新插 4 个不同 id 的 Item，console 会打印什么？（不用真跑，先预测）
3. D3 实验中，如果把 `<Counter />` 换成 `<input defaultValue="hello" />`，切换 wrapper 时 input 内容会重置吗？为什么？
4. **挑战**：写一个最小例子，让"列表只更新（不增不删不重排）"的场景下，key=index 也出 bug。能想到吗？为什么想不到？

---

## 完成后

```bash
cd react-source-study
git add demos/day3 notes/day3.md notes/day3-summary.md notes/day3-quiz.md
git commit -m "W1 D3 diff 算法：完成 3 实验 + 回填观察"
git push
```
