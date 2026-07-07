# Day 10 实验：Lane 优先级 / 自动批处理 / Transition / DeferredValue

> 代码贴进 Vite + React playground（浏览器里跑，配合 React DevTools / console 观察）。
> 之前版本用 jsdom + node 脚本跑过一遍这三个实验的核心逻辑（结论未变，已在下方各实验标注"jsdom 预跑过的真实结论"作为参照），现在改成可以直接在你自己的 Vite 项目里操作、用浏览器 console 观察的版本。

## 环境准备（如果还没有 playground）

```bash
cd demos/day10
npm create vite@latest playground -- --template react
cd playground
npm install
npm run dev
```

---

## 实验 K1：自动批处理——同一事件里多次 setState 只渲染一次

把 `playground/src/App.jsx` 改成：

```jsx
import { useState } from 'react';

let renderCount = 0;

export default function App() {
  renderCount++;
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);

  console.log(`render #${renderCount}: a=${a} b=${b}`);

  function handleClick() {
    const before = renderCount;
    setA(x => x + 1);
    setB(x => x + 1);
    // 注意：这里读到的 renderCount 还是"点击前"的，因为 setA/setB 只是排队，
    // 真正的渲染发生在这次事件处理函数结束后，所以下面这行打印的是旧值，正常
    console.log('本次事件处理函数内, renderCount 暂未变化 =', renderCount, '(vs 点击前)', before);
  }

  return (
    <div>
      <p>a={a} b={b}</p>
      <button onClick={handleClick}>同时 setA + setB</button>
    </div>
  );
}
```

**操作步骤**：

1. 打开页面，打开 DevTools Console。
2. 记下当前 `render #N`。
3. 点击按钮一次，观察 console 里新增了几条 `render #` 日志。

**源码依据**：两次 `setState` 各自入队，`requestUpdateLane` 在同一个事件回调里拿到同一条 lane（同一事件 → 同一批优先级），React 把它们合并成一次 render（自动批处理，Day6 讲过的机制）。

**jsdom 预跑过的真实结论**（react@19.2.7，作为你在浏览器验证时的参照）：
```
两次 setState 后只多渲染 1 次（不是 2 次）
```

**记录到 observations.md**：点击一次按钮，新增了几条 `render #` 日志？是 1 条还是 2 条？

---

## 实验 K2：useTransition——直接更新 vs transition 更新的 isPending

```jsx
import { useState, useTransition } from 'react';

export default function App() {
  const [n, setN] = useState(0);
  const [isPending, startTransition] = useTransition();

  console.log(`render: n=${n} isPending=${isPending}`);

  function handleDirect() {
    setN(v => v + 1);
  }

  function handleTransition() {
    startTransition(() => {
      setN(v => v + 1);
    });
  }

  return (
    <div>
      <p>n={n} isPending={String(isPending)}</p>
      <button onClick={handleDirect}>直接更新</button>
      <button onClick={handleTransition}>transition 更新</button>
    </div>
  );
}
```

**操作步骤**：

1. 打开 Console，点"直接更新"，观察打印的 `isPending` 序列。
2. 再点"transition 更新"，观察打印的 `isPending` 序列——重点看是否出现了 `isPending=true` 的中间渲染。

**源码依据**：`startTransition` 设全局 transition 标记，回调里的 `setN` 走 `requestUpdateLane` 时检测到标记 → 领一个 TransitionLane（低优先级）；`isPending` 由一次同步的占位更新驱动：进入 transition 时先设 true，回调跑完再设回 false（Day20 已详细讲过这条链路）。

**jsdom 预跑过的真实结论**：
```
直接更新：isPending 全程 false（没有 pending 阶段）
transition 更新：isPending 先变 true，再变回 false（可观察到过渡态）
```

> ⚠️ **浏览器和 jsdom 的关键差异**：在真实浏览器里，因为有完整的 Scheduler 时间片调度，你可能能观察到 `isPending=true` 停留一段时间（如果更新本身比较耗时）；而 jsdom 里 `act()` 会把调度过程同步压平，`isPending=true` 阶段几乎是瞬间闪过。**这正是本次改成浏览器版实验的意义**——去观察 jsdom 里看不到的真实调度时序。

**记录到 observations.md**：直接更新时 isPending 变化了几次？transition 更新时呢？如果你故意让 `setN` 后面跟一个耗时的子组件（比如渲染一个很大的列表），能否更清楚地看到 pending 阶段的停留？

---

## 实验 K3：useDeferredValue——deferred 值滞后于源值

```jsx
import { useState, useDeferredValue } from 'react';

export default function App() {
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);

  console.log(`render: text="${text}" deferred="${deferred}"`);

  return (
    <div>
      <input value={text} onChange={e => setText(e.target.value)} />
      <p>text={text} | deferred={deferred}</p>
    </div>
  );
}
```

**操作步骤**：

1. 打开 Console，在输入框里敲一个字符。
2. 观察打印出的渲染序列——`text` 和 `deferred` 是不是在同一次渲染里就一起变成新值，还是分成了两次渲染？

**源码依据**（`updateDeferredValueImpl`，Day20 已逐行核实）：紧急更新（比如敲键盘触发的更新）先返回**旧的 deferred 值**，同时调度一个低优先级更新去追新值；低优先级更新轮到时才返回新值。所以一次 `setText` 理论上会触发两次渲染。

**jsdom 预跑过的真实结论**：
```
setText("a") 后：
  第1次渲染：text="a" deferred=""     ← text 已更新，deferred 仍是旧值
  第2次渲染：text="a" deferred="a"    ← 低优先级追上，deferred 变新值
```

**记录到 observations.md**：敲一个字符后，console 打印了几次？deferred 是立刻跟上还是慢一拍？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| K1 | 两次 setState 只渲染 1 次 | 同事件同 lane → 批量调度一次 |
| K2 | transition 出现 `isPending: true→false` | 低优先级更新被单独调度 |
| K3 | deferred 比 text 慢一拍 | 紧急渲染返回旧值 + 调度低优先级追新 |

---

## 完成后

```bash
git add demos/day10 notes/day10.md
git commit -m "W3 D10 Lane模型：完成浏览器实验(自动批处理/isPending/deferred滞后)"
git push
```
