# Day 14 实验：React Compiler + 性能优化（bailout / memo / useMemo / useCallback）

> 代码贴进 Vite + React playground（浏览器里跑），配合 React DevTools Profiler 观察渲染次数。

## 环境准备（如果还没有 playground）

```bash
cd demos/day14
npm create vite@latest playground -- --template react
cd playground
npm install
npm run dev
```

⚠️ **重要前提**：如果你的 Vite 项目是 React 19 且开了 React Compiler（`babel-plugin-react-compiler`），编译器会自动帮你做 memo/useMemo/useCallback 等价优化，下面几个实验里"未加 memo"的对照组可能也不会重渲染——这不是实验失败，是编译器自动介入了。可以先检查 `vite.config.js` / `package.json` 有没有这个插件，没有的话就是纯手写场景，实验现象最典型。

---

## 实验 P1：bailout 可视化——memo 生效的前提是"props 引用稳定"

```jsx
import { useState, useCallback, useMemo, memo, useEffect } from 'react';

let renderCountA = 0, renderCountB = 0, renderCountC = 0, heavyRenderCount = 0;

// A：没有 memo（对照组）
function ChildA({ data }) {
  renderCountA++;
  console.log(`[ChildA] 第 ${renderCountA} 次 render, data=${data?.name}`);
  return <div>ChildA: {data?.name} (renders: {renderCountA})</div>;
}

// B：有 memo 但 props 引用不稳定（形同虚设）
const ChildB = memo(function ChildB({ data }) {
  renderCountB++;
  console.log(`[ChildB] 第 ${renderCountB} 次 render (memo但props不稳定), data=${data?.name}`);
  return <div>ChildB: {data?.name} (renders: {renderCountB})</div>;
});

// C：有 memo + props 引用稳定（真正生效）
const ChildC = memo(function ChildC({ data }) {
  renderCountC++;
  console.log(`[ChildC] 第 ${renderCountC} 次 render (memo+稳定引用✅), data=${data?.name}`);
  return <div>ChildC: {data?.name} (renders: {renderCountC})</div>;
});

// Heavy：无 props 但昂贵的子组件
const HeavyComponent = memo(function Heavy() {
  heavyRenderCount++;
  console.log(`[HeavyComponent] 第 ${heavyRenderCount} 次 render! (无任何props)`);
  return <div>Heavy: 渲染了 {heavyRenderCount} 次</div>;
});

export default function App() {
  const [count, setCount] = useState(0);

  // ❌ 每次都是新函数/新对象 → memo 形同虚设
  const badData = { name: `count=${count}` };

  // ✅ 引用稳定 → memo 能命中 bailout
  const goodData = useMemo(() => ({ name: 'stable' }), []);

  return (
    <div style={{ padding: 20 }}>
      <p>Parent count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+1（触发 Parent re-render）</button>

      <h3>A: 无 memo（每次都渲染）</h3>
      <ChildA data={badData} />

      <h3>B: 有 memo + 不稳定 props（memo 失效）</h3>
      <ChildB data={badData} />

      <h3>C: 有 memo + 稳定 props（bailout 生效）</h3>
      <ChildC data={goodData} />

      <h3>Heavy: 无 props 但昂贵</h3>
      <HeavyComponent />
    </div>
  );
}
```

**操作步骤**：打开 Console，点几次"+1"按钮，观察 4 个子组件各打印了几次渲染日志。

**记录到 observations.md**：ChildA/ChildB 是否每次都跟着渲染？ChildC/HeavyComponent 是否只在首次 mount 时渲染了一次？

---

## 实验 P2：useMemo / useCallback 依赖陷阱

```jsx
import { useState, useMemo, useCallback } from 'react';

let computeCount = 0;
function computeExpensive(n) {
  computeCount++;
  let sum = 0;
  for (let i = 0; i < n * 10000; i++) sum += i;
  return { result: sum, input: n };
}

// 场景 A：依赖是对象 → 假缓存
function ScenarioA() {
  const [count, setCount] = useState(0);
  const config = { mode: 'dark' }; // ❌ 每次 render 都是新对象

  const value = useMemo(() => {
    console.log(`[ScenarioA] 重算! count=${count}`);
    return computeExpensive(count);
  }, [config]); // ← config 每次都是新引用，"假缓存"

  return (
    <div>
      <p>ScenarioA: count={count}, computeCount={computeCount}</p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
    </div>
  );
}

// 场景 B：依赖只用基本类型 → 真缓存
function ScenarioB() {
  const [count, setCount] = useState(0);
  const [other, setOther] = useState(0); // 无关状态

  const value = useMemo(() => {
    console.log(`[ScenarioB] 重算! count=${count}`);
    return computeExpensive(count);
  }, [count]); // ← 只依赖基本类型

  return (
    <div>
      <p>ScenarioB: count={count}, other={other}, computed={value.result}</p>
      <button onClick={() => setCount(c => c + 1)}>改 count（应重算）</button>
      <button onClick={() => setOther(o => o + 1)}>改 other（不应重算）</button>
    </div>
  );
}

// 场景 C：useCallback 闭包陷阱
function ScenarioC() {
  const [count, setCount] = useState(0);

  const badFn = useCallback(() => `bad: count=${count}`, []); // ❌ 依赖漏写 → stale closure
  const goodFn = useCallback(() => `good: count=${count}`, [count]); // ✅

  return (
    <div>
      <p>ScenarioC: count={count}</p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
      <p>badFn()="{badFn()}" (应该永远是初始值)</p>
      <p>goodFn()="{goodFn()}" (应该跟着 count 变)</p>
    </div>
  );
}

export default function App() {
  return (
    <div style={{ padding: 20 }}>
      <h3>场景 A：依赖是对象（假缓存）</h3>
      <ScenarioA />
      <hr />
      <h3>场景 B：依赖稳定化后（真缓存，注意 other 按钮不该触发重算）</h3>
      <ScenarioB />
      <hr />
      <h3>场景 C：useCallback 闭包陷阱</h3>
      <ScenarioC />
    </div>
  );
}
```

**操作步骤**：
1. 场景 A：点几次按钮，观察 Console 是否**每次**都打印"重算"（即使逻辑上 config 内容没变）。
2. 场景 B：点"改 count"应该重算；点"改 other"**不应该**触发"重算"日志。
3. 场景 C：点几次 +1，观察 `badFn()` 的输出是否卡在初始值不变，`goodFn()` 是否跟着变。

**记录到 observations.md**：场景 A 是否真的每次都重算？场景 B 的"改 other"按钮是否真的没触发重算日志？

---

## 实验 P3：React.memo 比较函数语义 + 边界场景

```jsx
import { useState, memo } from 'react';

// 场景 1：自定义比较函数（返回值语义和 Array.filter 相反！）
const CustomChild = memo(function CustomChild({ id, name }) {
  console.log(`[CustomChild] render! id=${id}, name=${name}`);
  return <div>id={id} name={name}</div>;
}, (prev, next) => {
  // 返回 true = props "相等" = 跳过渲染（bailout）
  console.log(`[compare] prev.id=${prev.id} vs next.id=${next.id} → ${prev.id === next.id ? 'true(跳过)' : 'false(渲染)'}`);
  return prev.id === next.id; // 只比较 id，忽略 name 变化
});

// 场景 3：无 props 子组件——memo 前后对比
let noPropsRenderCount = 0;
function NoPropsChild() {
  noPropsRenderCount++;
  console.log(`[NoPropsChild] 第 ${noPropsRenderCount} 次 render (无任何props!)`);
  return <div>NoPropsChild 渲染了 {noPropsRenderCount} 次</div>;
}
const MemoNoProps = memo(NoPropsChild);

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: 20 }}>
      <p>Parent count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>

      <h3>Demo1: 自定义比较函数（id 不变时应该跳过，即使 name 变了）</h3>
      <CustomChild id={1} name={`name-v${count}`} />

      <h3>Demo3: 无 props 子组件</h3>
      <p>未 memo：</p>
      <NoPropsChild />
      <p>已 memo（点+1不应该再渲染）：</p>
      <MemoNoProps />
    </div>
  );
}
```

**操作步骤**：点几次"+1"，观察：
1. `CustomChild` 是否即使 `name` 变了也**不**打印新的 render 日志（因为自定义比较只看 id）。
2. 未 memo 的 `NoPropsChild` 是否每次都跟着渲染；已 memo 的 `MemoNoProps` 是否**不**再渲染（虽然它没有任何 props）。

**记录到 observations.md**：CustomChild 是否真的因为 id 不变而跳过？无 props 的子组件加 memo 后是否真的不再重渲染？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| P1 | props 引用不稳定时 memo 形同虚设，稳定后才 bailout | React.memo 默认用 Object.is 浅比较 props |
| P2 | 依赖数组里的对象/新引用导致"假缓存" | useMemo/useCallback 依赖比较也是 Object.is |
| P3 | memo 比较函数返回 true=跳过（和 filter 相反）；无 props 子组件也需要 memo | 自定义比较函数语义 + 空 props 场景 |

---

## 完成后

```bash
git add demos/day14 notes/day14.md
git commit -m "W3 D14 Compiler+性能优化：完成浏览器实验(bailout可视化/useMemo依赖陷阱/memo比较函数语义)"
git push
```
