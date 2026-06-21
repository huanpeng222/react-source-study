# Day 6 实验：useState 源码现象验证

> 配套 `notes/day6.md`，3 个实验。每个实验**先预测、再跑、再对照**。
>
> 推荐路径：在 `demos/day6/playground/` 起一个 Vite + React 项目，把代码贴进 `src/App.jsx`。

---

## 环境准备（首次跑）

```bash
cd demos/day6
npm create vite@latest playground -- --template react
cd playground && npm install && npm run dev
```

---

## 实验 G1：闭包陷阱——值更新 vs 函数式

### 目标

亲眼看到"同一次事件里 setN(n+1) 调用 3 次，n 只 +1"，再用函数式修复成 +3。

### 代码

```jsx
import { useState, useEffect } from 'react';

export default function App() {
  const [n, setN] = useState(0);

  // ★ 每次 render 都打印（看 render 触发次数）
  console.log('🎨 render, n =', n);

  // 写法 A：值更新
  const triple_value = () => {
    setN(n + 1);
    setN(n + 1);
    setN(n + 1);
    console.log('  [value] 函数体里的 n（闭包值）:', n);
  };

  // 写法 B：函数式更新
  const triple_func = () => {
    setN(prev => prev + 1);
    setN(prev => prev + 1);
    setN(prev => prev + 1);
    console.log('  [func] 函数体里的 n（闭包值）:', n);
  };

  return (
    <>
      <h1>n = {n}</h1>
      <button onClick={triple_value}>值更新 setN(n+1) × 3</button>
      <button onClick={triple_func}>函数式 setN(prev => prev+1) × 3</button>
      <button onClick={() => setN(0)}>reset</button>
    </>
  );
}
```

### 预测（先写下你的猜测）

| 操作 | n 变成 | render 次数 |
|---|---|---|
| 点"值更新"按钮 1 次 | ? | ? |
| 点"函数式"按钮 1 次 | ? | ? |
| 连续点"值更新"3 次（中间不切按钮）| ? | ? |

### 预期现象

| 操作 | n 变成 | render 次数 |
|---|---|---|
| 点"值更新"1 次 | **1** | 1（自动批处理）|
| 点"函数式"1 次 | **3** | 1（自动批处理）|

### 关键观察

- ✅ 值更新只 +1：3 次 setN(n+1) 都是 `setN(0+1)`，相当于"用 1 覆盖 1 覆盖 1"
- ✅ 函数式 +3：第二次 setN 的 prev 是上次 reducer 计算结果（1）
- ⭐ 两种写法都只触发 **1 次 render**（React 18 自动批处理）

### 思考题

1. 如果在"值更新"的 3 次 setN 之间加 `await Promise.resolve()`，结果会怎么变？
2. 把 3 次 setN 包在 setTimeout 里呢？React 18 vs 17 区别？

### 留档

把 console 截图存到 `screenshots/G1-closure-trap.png`，把答案填到 `observations.md` 实验 G1 部分。

---

## 实验 G2：lazy init 性能差异

### 目标

故意制造"慢初始化"，对比两种写法在多次 render 时的性能差距。

### 代码

```jsx
import { useState } from 'react';

// 模拟一个 100ms 的昂贵初始化
function expensiveCompute() {
  console.log('💸 expensiveCompute 跑了！');
  const start = performance.now();
  while (performance.now() - start < 100) {
    // 阻塞 100ms
  }
  return Math.random();
}

export default function App() {
  const [count, setCount] = useState(0);

  // ❌ 写法 A：每次 render 都跑 expensiveCompute
  // const [data] = useState(expensiveCompute());

  // ✅ 写法 B：只 mount 跑一次
  const [data] = useState(() => expensiveCompute());

  return (
    <>
      <h1>count = {count}, data = {data.toFixed(4)}</h1>
      <button onClick={() => setCount(c => c + 1)}>点我（看 console）</button>
    </>
  );
}
```

### 操作步骤

1. **先用写法 B（lazy）**：点击按钮 5 次，看 console 出现几次 `💸 expensiveCompute 跑了！`
2. 注释 B、启用 A，**重新加载页面**：点击按钮 5 次，再看

### 预测

| 写法 | 5 次点击后 console 出现"💸"的次数 |
|---|---|
| A（直接传值）| ? |
| B（lazy）| ? |

### 预期现象

| 写法 | "💸"次数 | 用户体验 |
|---|---|---|
| A（直接传值）| **6 次**（mount 1 + 5 次 click 后 re-render）| 每次点击都卡 100ms 🐢 |
| B（lazy）| **1 次**（只 mount）| 点击丝滑 ⚡️ |

### 关键观察

- ⭐ 写法 A 即使 useState 内部"不用"这个值，**JS 引擎已经把 expensiveCompute() 跑完了**
- 写法 B 传的是函数对象，没立即调用 → React 决定调不调

### 进阶变体

把 expensiveCompute 改成：

```js
const expensiveCompute = () => {
  console.log('💸 read localStorage');
  return JSON.parse(localStorage.getItem('user') || '{"name":"anon"}');
};
```

跑 100 次 render 看读 localStorage 的累积代价。

### 留档

把对比 console 截图存到 `screenshots/G2-lazy-init.png`。

---

## 实验 G3：React 18 自动批处理

### 目标

验证 React 18 在 **setTimeout / Promise / 原生事件** 里的多次 setState 也会自动批处理（React 17 不会）。

### 代码

```jsx
import { useState } from 'react';

export default function App() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);

  console.log('🎨 render, a =', a, 'b =', b);

  // 场景 1：合成事件里多次 setState（React 17 也批处理）
  const inEvent = () => {
    setA(x => x + 1);
    setB(x => x + 1);
  };

  // 场景 2：setTimeout 里多次 setState（React 17 不批，18 批）
  const inTimeout = () => {
    setTimeout(() => {
      setA(x => x + 1);
      setB(x => x + 1);
    }, 100);
  };

  // 场景 3：Promise 里多次 setState（React 17 不批，18 批）
  const inPromise = () => {
    Promise.resolve().then(() => {
      setA(x => x + 1);
      setB(x => x + 1);
    });
  };

  // 场景 4：用 flushSync 强制不批处理
  const noBatch = async () => {
    // 注意需要 import { flushSync } from 'react-dom';
    // flushSync(() => setA(x => x + 1));
    // flushSync(() => setB(x => x + 1));
    // 简化版：原生事件
    document.body.addEventListener('click', () => {
      setA(x => x + 1);
      setB(x => x + 1);
    }, { once: true });
    console.log('请点击空白处一次');
  };

  return (
    <>
      <h1>a = {a}, b = {b}</h1>
      <button onClick={inEvent}>合成事件 setA + setB</button>
      <button onClick={inTimeout}>setTimeout 内 setA + setB</button>
      <button onClick={inPromise}>Promise 内 setA + setB</button>
    </>
  );
}
```

### 预测

| 场景 | render 次数（React 18）|
|---|---|
| 合成事件 | ? |
| setTimeout | ? |
| Promise | ? |

### 预期现象（React 18）

| 场景 | render 次数 |
|---|---|
| 合成事件 | **1** |
| setTimeout | **1**（React 17 是 2）|
| Promise | **1**（React 17 是 2）|

⭐ **关键观察**：React 18 把"批处理"从合成事件扩展到**所有异步上下文**，这就叫"自动批处理（automatic batching）"。

### 想要不批？用 flushSync

```jsx
import { flushSync } from 'react-dom';

const forceTwoRenders = () => {
  flushSync(() => setA(x => x + 1));   // 立即 commit
  flushSync(() => setB(x => x + 1));   // 立即 commit
  // → 2 次 render
};
```

⚠️ 用 flushSync 通常是性能反模式，**除非你需要在两次 update 之间读取 DOM**（比如测量后再决定下一步）。

### 留档

3 个按钮各点 1 次，console 截图存到 `screenshots/G3-auto-batching.png`。

---

## 完成实验后

把 3 个观察和思考题答案填到 `observations.md`，然后 commit：

```bash
git add demos/day6/
git commit -m "W2 D6 实验回填：G1 闭包陷阱 + G2 lazy init + G3 自动批处理"
git push
```
