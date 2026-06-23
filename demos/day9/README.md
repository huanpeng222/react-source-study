# Day 9 实验：useContext + Provider + dependencies

> 代码贴进 Vite + React playground
> 目标：验证 Provider 嵌套值覆盖 / Context 穿透 memo / DevTools 看 dependencies

## 实验 J1：Provider 嵌套与值覆盖

### 代码

```jsx
import { createContext, useContext, useState } from 'react';

const Ctx = createContext('default');

function DeepChild() {
  const val = useContext(Ctx);
  console.log('  DeepChild 读到的值:', val);
  return <li>{val}</li>;
}

export default function App() {
  const [outer, setOuter] = useState('outer');
  const [inner, setInner] = useState('inner');
  const [toggle, setToggle] = useState(false);

  return (
    <Ctx.Provider value={outer}>
      <button onClick={() => setOuter(o => o + '!')}>改 outer</button>
      <DeepChild />
      <Ctx.Provider value={inner}>
        <button onClick={() => setInner(i => i + '!')}>改 inner</button>
        <DeepChild />
      </Ctx.Provider>
      <button onClick={() => setToggle(t => !t)}>toggle（无关更新）</button>
      <DeepChild />
    </Ctx.Provider>
  );
}
```

### 预期

1. 初始：`outer / inner / outer`（Provider 嵌套生效）
2. 点"改 inner"：只有内层 DeepChild 重新渲染，读到新 inner
3. 点"改 outer"：内层、外层两个 DeepChild 都重新渲染（外层读 outer，内层的 dependencies 也匹配了 Ctx）
4. 点"toggle"：所有 DeepChild 都重新渲染（因为 App 重新渲染，Provider value={`outer`/`inner`} 引用没变？注意字符串字面量 === 是稳定的，所以不会触发 propagateContextChanges——但组件函数本身会重跑）

## 实验 J2：Context 穿透 React.memo

### 代码

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

### 预期

1. 点"改 count"：App 重新渲染 → Provider 重新渲染。但因为 `value={theme}` 是字符串，`theme` 没变时引用相等 → value 没变 → `propagateContextChanges` 不触发。但注意 `MemoChild` 的 `label` prop 也是稳定的（字符串字面量），所以 memo 浅比较通过，**Child 不重渲染** ✅
2. 点"改 theme"：theme 值变了 → `pushProvider` 更新 `_currentValue` → `propagateContextChanges` 标记 lane → `MemoChild` 即使 props 没变也被强制渲染 ✅（穿透验证）

## 实验 J3：看 fiber.dependencies（DevTools）

在 J2 的 `MemoChild` 里加：

```jsx
const fiberKey = Object.keys(memoChildRef.current).find(k => k.startsWith('__reactFiber$'));
const fiber = memoChildRef.current[fiberKey];
console.log('fiber.dependencies:', fiber?.dependencies);
```

确认 `dependencies.firstContext.context` 指向 ThemeCtx。
