# Day 9 实验：useContext + Provider + dependencies

> 代码贴进 Vite + React playground
> ⚠️ 核心教训：Context "只渲染消费者" 的精准性，能否被观察到，取决于 **子组件 element 的 props 引用是否跨 render 稳定**。

---

## ⭐ 先讲清"分水岭"（源码基准，已实测验证）

bailout 判断在 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `beginWork` 开头：

```js
if (oldProps !== newProps || hasLegacyContextChanged()) {
  didReceiveUpdate = true;   // ★ props 引用变了 → 必须重渲染（bailout 失败）
} else {
  // props 引用没变 → 再看 lanes，没标记就 bailout（跳过）
}
```

所以"改 inner 时几个 DeepChild 重渲染"的**真正分水岭，是 `<DeepChild/>` 这个 element 的 props 引用稳不稳定**，不是"有没有写 memo"：

| 场景 | A/C 的 props 引用 | 改 inner 的结果 |
|---|---|---|
| **裸 JSX，无任何缓存**（纯手写 + 未开编译器）| App 每次 render 都 `createElement` → **新引用** | `oldProps !== newProps` → A/C bailout 失败 → **3 个全渲染** |
| **手写 `React.memo(DeepChild)`** | memo 浅比较 `tag` 相等 → 视为稳定 | A/C bailout 成功 → **只 B 渲染** |
| **React Compiler 自动 memo**（Vite + React 19，`.tsx` 默认常开）| 编译器把 element 缓存 → **引用稳定** | A/C bailout 成功 → **只 B 渲染** |

⭐ **实测结论**（jsdom 跑 react@19.2）：
> - 裸 JSX（element 每次新建）→ 改 inner = **3 行** `outer / inner! / outer`
> - element 引用被缓存（模拟编译器 / 等价 memo）→ 改 inner = **1 行** `inner!`，改 outer = **2 行**，toggle = **0 行**

如果你在真实 Vite + React 19 项目里"没写 memo 也只看到 1 行 `inner!`"，那是 **React Compiler 自动帮你 memo 了 element**（查 `vite.config` / `package.json` 是否有 `babel-plugin-react-compiler`）。**这不矛盾——编译器做的就是"自动稳定 props 引用"这件事**。

---

## 实验 J1：props 引用稳定性 = 能否观察 context 精准标记的前提

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

**预期（仅当 element 引用每次新建时，即纯手写 JSX 且未开 React Compiler）**：点 **任何一个按钮**，console 都打印 **3 行**（A/B/C 全渲染）。

- 改 toggle：3 个都渲染，值不变（A=outer, B=inner, C=outer）
- 改 inner：3 个都渲染（A=outer, B=inner!, C=outer）
- 改 outer：3 个都渲染（A=outer!, B=inner, C=outer!）

⭐ **结论**：element props 每次新引用 → `oldProps !== newProps` → bailout 失败 → 三个全渲染。**三个按钮行为一样**。这时候看不出 context 的"精准标记"。

⚠️ **重要前提**：上面"3 行"只在 **element 引用每次都新建** 时成立。如果你的项目开了 React Compiler（Vite + React 19 常见），编译器会自动缓存 element → A/C 的 `oldProps === newProps` → 它们 bailout 成功 → **改 inner 只打印 1 行 `inner!`**（等价于下面"加 memo 版"的效果）。所以你看到 1 行不是 bug，是编译器自动 memo 的结果。

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
