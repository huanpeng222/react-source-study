# Day 21 实验：高优先级打断低优先级实战

> 代码贴进 Vite + React playground（浏览器里跑），配合 React DevTools Profiler 观察打断的真实证据。

## 环境准备

```bash
cd demos/day21
npm create vite@latest playground -- --template react
cd playground
npm install
npm install --save-dev @types/react  # 可选
npm run dev
```

浏览器装好 [React Developer Tools](https://react.dev/link/react-devtools) 插件，打开 DevTools 的 **Profiler** 面板（不是默认的 Components 面板）。

---

## 实验 I1：制造一个耗时的低优先级渲染，观察它被"从头重做"

```jsx
import { useState, useTransition } from 'react';

// 故意做一个"很慢"的列表：每一项都做一次同步空转计算
function SlowItem({ id, tag }) {
  let sum = 0;
  for (let i = 0; i < 200000; i++) sum += i; // 模拟每一项的渲染开销
  console.log(`[SlowItem #${id}] 渲染了一次 (tag=${tag})`); // 每次渲染都会打印
  return <li>Item {id}: {sum % 100} (tag={tag})</li>;
}

export default function App() {
  const [tag, setTag] = useState(0);       // 触发"低优先级"渲染的 tag
  const [urgent, setUrgent] = useState(0);  // 触发"高优先级"渲染的计数
  const [isPending, startTransition] = useTransition();

  function handleSlowUpdate() {
    console.log('===== 触发低优先级更新 (startTransition) =====');
    startTransition(() => setTag(t => t + 1));
  }

  function handleUrgentUpdate() {
    console.log('===== 触发高优先级更新 (直接 setState) =====');
    setUrgent(u => u + 1);
  }

  const items = Array.from({ length: 300 }, (_, i) => i);

  return (
    <div style={{ padding: 20 }}>
      <p>urgent={urgent}（高优先级），isPending={String(isPending)}</p>
      <button onClick={handleSlowUpdate}>①触发低优先级更新（大列表 tag={tag}）</button>
      <button onClick={handleUrgentUpdate}>②在①渲染过程中快速点我（高优先级）</button>
      <ul>
        {items.map(id => <SlowItem key={id} id={id} tag={tag} />)}
      </ul>
    </div>
  );
}
```

**操作步骤**：
1. 打开 Console，先点一下"①触发低优先级更新"按钮。因为 300 个 `SlowItem` 每个都有同步计算开销，这次渲染会持续一段时间（肉眼可感知的卡顿或至少能看到 Console 逐步打印）。
2. **在按钮①的渲染还没完全打印完 300 条日志之前**，立刻连续点几次按钮②（高优先级更新）。
3. 观察 Console 输出：
   - 高优先级更新（`urgent` 计数）是否很快就有响应，不用等 300 条 `SlowItem` 日志打完？
   - 300 条 `[SlowItem]` 的日志是否出现了**不止一轮**——也就是说，同一批 `id` 被打印了两次以上（说明低优先级渲染被丢弃重做了一次）？

**记录到 observations.md**：urgent 计数是否立刻响应？SlowItem 的渲染日志是否出现了重复打印（同一个 tag 值下同一个 id 被渲染了 2 次以上）？

---

## 实验 I2：用 React DevTools Profiler 录制，观察 commit 时间轴

复用实验 I1 的代码。

**操作步骤**：
1. 打开 DevTools 的 **Profiler** 面板，点击左上角的圆形"录制"按钮开始录制。
2. 点击"①触发低优先级更新"，紧接着（渲染进行中）点击几次"②高优先级更新"。
3. 点击"停止录制"。
4. 观察 Profiler 面板下方的火焰图时间轴：
   - 是否出现了**多个 commit**（面板顶部会有一排竖条，每一条代表一次 commit）？
   - 点击每个 commit 竖条，看看它对应的耗时和触发原因（Profiler 会标注是哪个组件触发的更新）。
   - 高优先级的 commit（урgent 计数）是否出现在低优先级 commit **之前**，即使你先点的是低优先级按钮？

**记录到 observations.md**：Profiler 面板里一共出现了几次 commit？高优先级的 commit 是否排在了低优先级 commit 前面？

---

## 实验 I3：`entangleTransitions` 效果——同一 transition 里多个 setState 是否绑定提交

```jsx
import { useState, useTransition } from 'react';

export default function App() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(() => {
      setA(v => v + 1);
      setB(v => v + 1);
    });
    console.log(`[点击后立即读取] a=${a} b=${b}（这里读到的还是旧值，正常，因为 setState 是异步生效的）`);
  }

  console.log(`[render] a=${a} b=${b} isPending=${isPending}`);

  return (
    <div style={{ padding: 20 }}>
      <p>a={a}, b={b}, isPending={String(isPending)}</p>
      <button onClick={handleClick}>同时更新 a 和 b（都在一个 transition 里）</button>
    </div>
  );
}
```

**操作步骤**：多次点击按钮，观察 Console 里 `[render]` 打印的 `a` 和 `b` 是否**永远相等**（因为它们在同一个 transition 里一起递增）。如果代码有 bug 让它们不同步提交，你会在某次 render 里看到 `a` 和 `b` 不相等的中间态——这正是 `entangleTransitions` 要防止出现的情况。

**记录到 observations.md**：`a` 和 `b` 是否在所有渲染中始终保持相等？有没有出现过 `a !== b` 的中间态？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| I1 | 高优先级更新立即响应，低优先级渲染日志重复打印（被丢弃重做过） | `getNextLanes` 重新决策 + `prepareFreshStack` 丢弃 wip 树 |
| I2 | Profiler 时间轴上高优先级 commit 排在低优先级 commit 之前 | 打断只发生在 render 阶段，commit 顺序反映最终的优先级排序结果 |
| I3 | 同一 transition 里的多个 setState 始终一起提交，不出现中间态 | `entangleTransitions` 把这些 lane 捆绑成一批处理 |

---

## 完成后

```bash
git add demos/day21 notes/day21.md
git commit -m "阶段A D21 高优先级打断实战：完成浏览器实验(丢弃重做证据/Profiler commit顺序/entangleTransitions一致性)"
git push
```
