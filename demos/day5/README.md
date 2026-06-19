# Day 5 实验：commit 三子阶段实战

> 三个实验，每个 5-10 分钟可完成。

---

## 实验 F1：useLayoutEffect vs useEffect 时序

### 目标

亲眼看到 render / useLayoutEffect / 浏览器 paint / useEffect 的精确顺序。

### 代码

```jsx
import { useState, useEffect, useLayoutEffect } from 'react';

export default function App() {
  const [n, setN] = useState(0);
  
  console.log(`%c[render] n=${n}`, 'color:purple;font-weight:bold');
  
  useLayoutEffect(() => {
    console.log(`%c[useLayoutEffect] n=${n}`, 'color:orange;font-weight:bold');
    return () => console.log(`%c[useLayoutEffect cleanup] n=${n}`, 'color:gray');
  }, [n]);
  
  useEffect(() => {
    console.log(`%c[useEffect] n=${n}`, 'color:green;font-weight:bold');
    return () => console.log(`%c[useEffect cleanup] n=${n}`, 'color:gray');
  }, [n]);
  
  return <button onClick={() => setN(c => c + 1)}>n = {n}</button>;
}
```

### 操作步骤

1. 启动应用，**清空 console**
2. 连续点击按钮 2 次
3. 观察 console 顺序

### 真实预期现象

```
首次 mount：
[render] n=0
[useLayoutEffect] n=0       ← Phase 3 同步
（浏览器绘制）
[useEffect] n=0              ← 异步

点击 1 次：
[render] n=1
[useLayoutEffect cleanup] n=0   ← Mutation 同步（上次留下）
[useLayoutEffect] n=1            ← Phase 3 同步
（浏览器绘制）
[useEffect cleanup] n=0          ← 这里是 Mutation 跑的还是异步跑的？观察一下
[useEffect] n=1                  ← flushPassiveEffects 异步
```

⚠️ **注意**：useEffect 的 cleanup 是在 Mutation 阶段（同步）跑的——和 useLayoutEffect cleanup 同时。React 18+ 的精确实现是这样。

### 自检（写到 observations.md）

1. cleanup 和新 effect 哪个先跑？
2. 两个 cleanup 的执行顺序是什么？
3. 试着点击按钮**很快连续**3 次，cleanup 还是每次都跑吗？

---

## 实验 F2：用 useLayoutEffect 修复闪烁

### 目标

亲眼看到 useEffect 修改 DOM 会导致**画面闪一下**，而 useLayoutEffect 不会。

### 代码（反例 - useEffect，会闪）

```jsx
import { useState, useRef, useEffect } from 'react';

function FlickerBox() {
  const ref = useRef(null);
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    // 故意延迟一下，让闪烁更明显
    const start = performance.now();
    while (performance.now() - start < 50) {}  // 阻塞 50ms
    
    if (ref.current) {
      ref.current.style.fontSize = '60px';
      ref.current.style.color = 'red';
    }
  }, [count]);
  
  return (
    <>
      <button onClick={() => setCount(c => c + 1)}>refresh</button>
      <div ref={ref} style={{ fontSize: '16px', color: 'black' }}>
        Hello, I should be RED 60px
      </div>
    </>
  );
}
```

### 操作步骤

1. 点击 refresh 按钮
2. **慢动作观察**：文字会先以 16px 黑色显示 50ms，然后跳成 60px 红色

### 改成 useLayoutEffect（修复）

```jsx
import { useLayoutEffect } from 'react';

// 把 useEffect 改成 useLayoutEffect
useLayoutEffect(() => {
  const start = performance.now();
  while (performance.now() - start < 50) {}
  
  if (ref.current) {
    ref.current.style.fontSize = '60px';
    ref.current.style.color = 'red';
  }
}, [count]);
```

### 预期对比

| | useEffect | useLayoutEffect |
|---|---|---|
| 用户视觉 | 先看到 16px 黑 → 跳成 60px 红（闪） | 直接看到 60px 红（不闪） |
| 原因 | 已 paint 后才改样式 | paint 前已经改完 |

### 录屏

录两个 gif 对比：`F2-flicker-with-useEffect.gif` 和 `F2-no-flicker-useLayoutEffect.gif`。

---

## 实验 F3：用 cleanup 看清"上次 dep"vs"这次 dep"

### 目标

验证 cleanup 拿到的是**上次 render 的闭包值**，effect 拿到的是**这次的**。

### 代码

```jsx
import { useState, useEffect } from 'react';

export default function App() {
  const [n, setN] = useState(0);
  
  useEffect(() => {
    console.log(`%c[effect] n=${n}`, 'color:green');
    return () => console.log(`%c[cleanup] n=${n}`, 'color:red');
  }, [n]);
  
  return <button onClick={() => setN(c => c + 1)}>{n}</button>;
}
```

### 操作步骤

1. 点击按钮 3 次（n: 0 → 1 → 2 → 3）
2. 观察 console

### 预期输出

```
[effect] n=0          ← 首次 mount

点 1：
[cleanup] n=0         ← 上次的闭包（dep=0）
[effect] n=1          ← 这次的值（dep=1）

点 2：
[cleanup] n=1
[effect] n=2

点 3：
[cleanup] n=2
[effect] n=3
```

⭐ **核心观察**：cleanup 的 n 永远比 effect 的 n 小 1——因为 cleanup 是**上次**留下的函数（闭包捕获了上次的 n）。

### 自检

**Q**：如果在 effect 里启动一个 setTimeout，timer 到了打印 n，会打印哪个 n？

<details><summary>答案</summary>

如果 timer 在这个 dep 期间触发 → 打印这次 dep 对应的 n
如果 timer 跨越了多次 render → 打印它启动时那次的 n（闭包）

cleanup 的存在就是为了清理这种"还没触发的旧 timer"。

```jsx
useEffect(() => {
  const timer = setTimeout(() => console.log(n), 1000);
  return () => clearTimeout(timer);  // ← 干净清理
}, [n]);
```

</details>

---

## 自检题（写到 observations.md）

1. F1 中，cleanup 和新 effect 哪个先跑？为什么 React 这样安排？
2. F2 中，如果你不阻塞 50ms（去掉 while 循环），还能看到闪烁吗？为什么？
3. F3 中，如果你**故意不写 cleanup**，会有什么 bug？

---

## 完成后

```bash
cd react-source-study
git add demos/day5 notes/day5.md notes/day5-summary.md notes/day5-quiz.md
git commit -m "W1 D5 commit 三阶段：完成 3 实验"
git push
```
