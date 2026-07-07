# Day 20 实验：useTransition / useDeferredValue

> 代码贴进 Vite + React playground（浏览器里跑），配合 React DevTools Profiler 观察 isPending 变化和渲染时序。

## 环境准备

```bash
cd demos/day20
npm create vite@latest playground -- --template react
cd playground
npm install
npm run dev
```

---

## 实验 T1：startTransition 的 isPending 变化序列

```jsx
import { useState, useTransition } from 'react';

function heavyCompute(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i;
  return sum;
}

export default function App() {
  const [n, setN] = useState(0);
  const [isPending, startTransition] = useTransition();

  const heavy = heavyCompute(50000000); // 故意做得慢一点，方便观察 isPending 的"中间态"
  console.log(`[render] n=${n} isPending=${isPending}`);

  return (
    <div style={{ padding: 20 }}>
      <p>n={n}, isPending={String(isPending)}</p>
      <button onClick={() => setN(v => v + 1)}>直接 setN（不走 transition）</button>
      <button onClick={() => startTransition(() => setN(v => v + 1))}>startTransition 包裹的 setN</button>
    </div>
  );
}
```

**操作步骤**：
1. 点击"直接 setN"按钮，观察 Console 打印的渲染序列——`isPending` 是否始终是 `false`（没有 pending 阶段）。
2. 点击"startTransition 包裹的 setN"按钮，观察是否先打印一次 `isPending=true`（n 还是旧值），过一会儿再打印一次 `isPending=false`（n 已经是新值）。

**记录到 observations.md**：直接 setN 是否只有 1 次渲染、isPending 全程 false？transition 版是否出现了 isPending 从 true 变回 false 的两阶段？

---

## 实验 T2：transition 更新与紧急更新同时发起，谁最终生效

```jsx
import { useState, useTransition } from 'react';

export default function App() {
  const [n, setN] = useState(0);
  const [isPending, startTransition] = useTransition();

  console.log(`[render] n=${n} isPending=${isPending}`);

  function handleBothAtOnce() {
    startTransition(() => setN(1));   // 先发起一个"不急"的更新
    setN(2);                          // 紧接着发起一个"紧急"的更新
  }

  return (
    <div style={{ padding: 20 }}>
      <p>n={n}</p>
      <button onClick={handleBothAtOnce}>同时触发 transition(setN(1)) 和 直接setN(2)</button>
    </div>
  );
}
```

**操作步骤**：点击按钮，观察 Console 打印的渲染序列，以及最终页面显示的 `n` 是 1 还是 2。

**记录到 observations.md**：最终 n 的值是多少？是否符合"更高优先级（直接 setN）的结果最终生效"的预期？中间是否出现过 n=1 的可见渲染？

---

## 实验 T3：useDeferredValue 在紧急渲染 vs transition 渲染中的表现差异

```jsx
import { useState, useDeferredValue, useTransition } from 'react';

// 场景A：普通同步更新
function AppA() {
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  console.log(`[AppA render] text="${text}" deferred="${deferred}"`);
  return (
    <div>
      <p>A: text="{text}" | deferred="{deferred}"</p>
      <button onClick={() => setText('hello')}>直接 setText("hello")</button>
    </div>
  );
}

// 场景B：包在 startTransition 里的更新
function AppB() {
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  const [, startTransition] = useTransition();
  console.log(`[AppB render] text="${text}" deferred="${deferred}"`);
  return (
    <div>
      <p>B: text="{text}" | deferred="{deferred}"</p>
      <button onClick={() => startTransition(() => setText('world'))}>
        用 startTransition 包裹 setText("world")
      </button>
    </div>
  );
}

export default function App() {
  return (
    <div style={{ padding: 20 }}>
      <h3>场景 A：普通同步更新中的 useDeferredValue</h3>
      <AppA />
      <hr />
      <h3>场景 B：transition 更新中的 useDeferredValue</h3>
      <AppB />
    </div>
  );
}
```

**操作步骤**：
1. 点击场景 A 的按钮，观察 Console：是否出现两次渲染——先 `deferred=""`（旧值），紧接着 `deferred="hello"`（追上新值）。
2. 点击场景 B 的按钮，观察 Console：`deferred` 是否**直接**变成 `"world"`，没有出现中间的空字符串渲染（因为这次更新本身已经是低优先级，`renderLanes & 42 === 0`，不需要二次延迟）。

**记录到 observations.md**：场景 A 是否真的出现"旧值→新值"两阶段？场景 B 是否真的"一步到位"，没有中间态？这两者的差异是否验证了 `notes/day20.md` 里"当前渲染已是低优先级就不用二次延迟"的结论？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| T1 | transition 更新前后 isPending 有 true→false 变化，直接更新没有 | useTransition 内部挂了一个独立的 isPending state |
| T2 | 紧急更新的值最终生效，transition 的值被覆盖/合并 | Lane 优先级决定最终渲染结果，不是先到先得 |
| T3 | 同步渲染里 deferredValue 滞后一拍，transition 渲染里不滞后 | `renderLanes & 42` 判断当前渲染是否已是低优先级 |

---

## 完成后

```bash
git add demos/day20 notes/day20.md
git commit -m "W3 D20 useTransition/useDeferredValue：改写为浏览器实验(isPending变化序列/优先级覆盖/deferred延迟对比)"
git push
```
