# Day 8 实验：useRef / useMemo / useCallback

> 运行：把代码贴进 Vite + React playground（`demos/day2/playground` 那套）
> 目标：用实验验证"ref 改值不 render"、"useMemo 缓存命中/失效"、"useCallback 配 memo 才有意义"

---

## 实验 I1：ref 引用稳定 + 改 current 不 render

### 代码

```jsx
import { useRef, useState, useEffect } from 'react';

export default function App() {
  const ref = useRef(0);
  const [, forceRender] = useState(0);
  const lastRef = useRef(null);

  // 验证：每次 render 拿到的是不是同一个 ref 盒子
  console.log('ref === 上次?', lastRef.current === ref, '| current =', ref.current);
  lastRef.current = ref;

  return (
    <div>
      <button onClick={() => { ref.current += 1; console.log('改后 current =', ref.current); }}>
        改 ref.current（不会 render）
      </button>
      <button onClick={() => forceRender(n => n + 1)}>
        强制 render（这时才看到最新 current）
      </button>
      <p>页面显示的 current：{ref.current}</p>
    </div>
  );
}
```

### 操作 + 预期

1. 连点「改 ref.current」5 次
   - console：`改后 current = 1/2/3/4/5`（**值立即变**）
   - 但**没有新的 render 日志**，页面 `<p>` 还显示 0（**视图不变**）
2. 点一次「强制 render」
   - 出现 render 日志，且 `ref === 上次? true`（**同一个盒子**）
   - 页面 `<p>` 这时才跳到 5

### 结论

> ref.current 的**值立即变**，但**不触发 render → 视图不变**；ref 盒子跨 render 是**同一个引用**。

---

## 实验 I2：useMemo 缓存命中 vs 失效

### 代码

```jsx
import { useMemo, useState } from 'react';

function expensive(n) {
  console.log('  ⚙️ expensive 执行了！');
  let s = 0; for (let i = 0; i < n * 1000; i++) s += i;
  return s;
}

export default function App() {
  const [count, setCount] = useState(0);
  const [other, setOther] = useState(0);

  // A：deps 稳定（count）
  const good = useMemo(() => expensive(count), [count]);

  // B：deps 是每次新建的对象（故意制造失效）
  const cfg = { n: count };
  const bad = useMemo(() => expensive(count), [cfg]);  // ❌ cfg 每次新引用

  console.log('render: count =', count, ', other =', other);
  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>count+1</button>
      <button onClick={() => setOther(o => o + 1)}>other+1（count 不变）</button>
    </div>
  );
}
```

### 操作 + 预期

1. 点「other+1」（count 不变）
   - A（good）：deps `[count]` 没变 → **expensive 不执行**（命中缓存）
   - B（bad）：deps `[cfg]` 每次新对象 → **expensive 照样执行**（失效）
2. 点「count+1」
   - 两个都执行（count 真变了）

### 结论

> deps 稳定才命中缓存；deps 里放每次新建的对象 → 浅比较永远不等 → useMemo 失效（白写还更慢）。

---

## 实验 I3：useCallback 必须配 React.memo 才有意义

### 代码

```jsx
import { useState, useCallback, memo } from 'react';

const Child = memo(function Child({ onClick }) {
  console.log('  🔵 Child render');
  return <button onClick={onClick}>child</button>;
});

export default function App() {
  const [count, setCount] = useState(0);

  // 切换这两行对比
  const stable = useCallback(() => {}, []);     // ✓ 引用稳定
  const unstable = () => {};                     // ✗ 每次新函数

  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>父 count+1：{count}</button>
      <Child onClick={stable} />   {/* 改成 unstable 对比 */}
    </div>
  );
}
```

### 操作 + 预期

点「父 count+1」多次：
- 传 `stable`（useCallback）：`Child render` **只在首次出现**，之后父更新 Child 不重渲染 ✓
- 传 `unstable`：每次点击都打印 `Child render`（memo 被新函数引用打破）

### 结论

> useCallback 的价值是**让传给子组件的函数引用稳定**，从而让子组件的 `React.memo` 生效。单独用 useCallback 不配 memo，基本没意义。

---

## 自检问题（写到 observations.md）

1. I1 里改 ref.current 后，为什么 `<p>` 不更新但 console 的值是新的？
2. I2 里 bad 那个 useMemo 怎么改才能命中缓存？（提示：deps 换成 count）
3. I3 里如果 Child 不包 memo，useCallback 还有用吗？
