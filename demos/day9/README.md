# Day 9 实验：useContext + Provider + dependencies

> 代码贴进 Vite + React playground
> ⚠️ 核心教训：Context "只渲染消费者" 的精准性，**必须配合 React.memo 才能观察到**。
> 没有 memo 时，"父重渲染 → 子默认全渲染" 会盖住 context 机制。

---

## 实验 J1：无 memo vs 有 memo 对照（理解 context 机制的前提）

### 第一步：无 memo 版（先看"默认全渲染"）

```jsx
import { createContext, useContext, useState } from 'react';

const Ctx = createContext('default');

function DeepChild({ tag }) {
  const val = useContext(Ctx);
  console.log(`  [无memo] DeepChild#${tag} render, 读到:`, val);
  return <li>{tag}: {val}</li>;
}

export default function App() {
  const [outer, setOuter] = useState('outer');
  const [inner, setInner] = useState('inner');
  const [toggle, setToggle] = useState(false);

  return (
    <Ctx.Provider value={outer}>
      <button onClick={() => setOuter(o => o + '!')}>改 outer</button>
      <button onClick={() => setInner(i => i + '!')}>改 inner</button>
      <button onClick={() => setToggle(t => !t)}>toggle（value 不变）</button>
      <DeepChild tag="A(外层)" />
      <Ctx.Provider value={inner}>
        <DeepChild tag="B(内层)" />
      </Ctx.Provider>
      <DeepChild tag="C(外层)" />
    </Ctx.Provider>
  );
}
```

**预期（关键！）**：点 **任何一个按钮**，console 都打印 **3 行**（A/B/C 全渲染）。

- 改 toggle：3 个都渲染，值不变（A=outer, B=inner, C=outer）
- 改 inner：3 个都渲染（A=outer, B=inner!, C=outer）
- 改 outer：3 个都渲染（A=outer!, B=inner, C=outer!）

⭐ **结论**：DeepChild 没包 memo → App 重渲染时 props 每次新引用 → bailout 失败 → 三个全渲染。**三个按钮行为一样**。这时候根本看不出 context 的"精准标记"。

---

### 第二步：加 memo 版（这才能看出 context 机制）

把 `DeepChild` 改成：

```jsx
import { memo } from 'react';

const DeepChild = memo(function DeepChild({ tag }) {
  const val = useContext(Ctx);
  console.log(`  [有memo] DeepChild#${tag} render, 读到:`, val);
  return <li>{tag}: {val}</li>;
});
```

（`tag` 是字符串字面量，props 稳定，memo 浅比较通过）

**预期（差异终于出现）**：

| 操作 | console 打印 | 原因 |
|---|---|---|
| 改 toggle（value 不变） | **0 行**（都不渲染）| props 没变 + value 没变 → bailout 成功 |
| 改 inner（内层 value 变） | **只 B(内层) 1 行** | propagateContextChanges 只标记内层 B 的 lanes，穿透其 memo；A/C 不在内层 Provider 子树，bailout 成功 |
| 改 outer（外层 value 变） | **A/B/C 3 行** | 三个都在外层 Provider 子树且都消费 Ctx → 都被标记 lanes → 都穿透 memo |

⭐ **核心结论**：
- **propagateContextChanges 精准标记消费者**的价值，只有在 memo 挡住"默认全渲染"后才显现
- **改 toggle 0 行**证明：context value 不变时，propagateContextChanges 根本不触发
- **改 inner 只 1 行**证明：只有"该 Provider 子树内 + 消费了该 context"的 fiber 被标记
- **改 outer 3 行**证明：外层 Provider 子树覆盖全部三个，DFS 穿透嵌套 Provider 也能标记到内层 B

---

## 实验 J2：Context 穿透 React.memo（单独聚焦穿透）

```jsx
import { createContext, useContext, useState, memo } from 'react';

const ThemeCtx = createContext('light');

const MemoChild = memo(function MemoChild({ label }) {
  const theme = useContext(ThemeCtx);
  console.log('  🔵 MemoChild render:', label, 'theme:', theme);
  return <li>{label} - {theme}</li>;
});

export default function App() {
  const [theme, setTheme] = useState('light');
  const [count, setCount] = useState(0);

  return (
    <ThemeCtx.Provider value={theme}>
      <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>改 theme</button>
      <button onClick={() => setCount(c => c + 1)}>改 count（无关更新）</button>
      <ul>
        <MemoChild label="A" />
        <MemoChild label="B" />
      </ul>
    </ThemeCtx.Provider>
  );
}
```

**预期**：

| 操作 | MemoChild 是否渲染 | 原因 |
|---|---|---|
| 改 count | ❌ 不渲染 | theme 没变 → value 引用不变 → 不触发 propagateContextChanges；label 稳定 → memo bailout |
| 改 theme | ✅ 渲染 | value 变 → propagateContextChanges 标记 lanes → 穿透 memo |

---

## 实验 J3：看 fiber.dependencies（DevTools / console）

在 J2 的 `MemoChild` 里用 ref 抓 fiber：

```jsx
import { useRef, useEffect } from 'react';
// MemoChild 内：
const liRef = useRef(null);
useEffect(() => {
  const key = Object.keys(liRef.current).find(k => k.startsWith('__reactFiber$'));
  const fiber = liRef.current[key];
  console.log('dependencies:', fiber?.dependencies);
  console.log('memoizedState(Hook链表头):', fiber?.memoizedState);
});
return <li ref={liRef}>{label}</li>;
```

**预期**：
- `dependencies.firstContext.context` 指向 ThemeCtx
- `memoizedState` 链表里**没有** useContext 的节点（只有 useRef / useEffect 的）—— 证明 useContext 不占 Hook 节点
