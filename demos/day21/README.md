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
import { useState, useTransition, memo } from 'react';

// 故意做一个"很慢"的列表：每一项都做一次同步空转计算
// ⚠️ 必须用 memo 包裹！否则父组件 App 任何一次重渲染都会无条件重新调用它，
//    即使这次渲染跟 tag 完全无关（比如只是更新 urgent），也会白白重跑一遍耗时计算——
//    这会让"高优先级更新"看起来也很卡，但那不是打断机制的问题，是缺 memo 导致的连带重算。
const SlowItem = memo(function SlowItem({ id, tag }) {
  let sum = 0;
  for (let i = 0; i < 200000; i++) sum += i; // 模拟每一项的渲染开销
  console.log(`[SlowItem #${id}] 渲染了一次 (tag=${tag})`); // 每次真正渲染都会打印
  return <li>Item {id}: {sum % 100} (tag={tag})</li>;
});

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
   - 高优先级更新（`urgent` 计数）是否很快就有响应，不用等 300 条 `SlowItem` 日志打完？（如果 `SlowItem` 加了 memo、且这次渲染 `tag` 没变，`urgent` 触发的这次渲染应该**完全不会重新调用 SlowItem**，因为 props 引用/值没变，直接 bailout）
   - `SlowItem` 打印的 `tag` 值：点②之后，`urgent` 界面上先更新，但 `tag` 显示的可能还是旧值——这是**正常现象**，不是 bug。原因见下方"追问"小节。
   - 300 条 `[SlowItem]` 的日志是否出现了**不止一轮**——也就是说，同一批 `id` 被打印了两次以上（说明低优先级渲染被丢弃重做了一次）？

**记录到 observations.md**：urgent 计数是否立刻响应？SlowItem 的渲染日志是否出现了重复打印（同一个 tag 值下同一个 id 被渲染了 2 次以上）？

---

### ⚠️ 跟练追问记录（2026-07-08）：urgent 也有延迟 + SlowItem 打印旧 tag，为什么？

这是实验的原始版本（`SlowItem` 没加 `memo`）暴露出的两个现象，已经修正进上面的代码，这里解释根因：

**现象 1：urgent 计数也没有立刻响应，有延迟**

根因：原始版本 `SlowItem` 没有 `memo`。React 的"高优先级"解决的是**排队顺序**问题（这次更新能不能插队到前面处理），不解决"这次渲染本身要花多久"的问题。没有 memo 时，只要 `App` 重渲染（哪怕只是为了更新跟 `SlowItem` 无关的 `urgent`），300 个 `SlowItem` 的函数体依然会被无条件全部重新调用一次——因为 React 没有"跳过调用这个组件函数"的依据（bailout 的前提是有 memo 且 props 没变，见 Day8/Day9）。而 `renderRootSync`（这次高优先级触发的同步渲染）用的 `workLoopSync` 循环里**根本没有 `shouldYield` 检查**，一旦开始就会强制跑完整棵子树的计算，中途不会再让出主线程。所以即使 `urgent` 是高优先级，只要它牵连的渲染范围包含了 300 次耗时计算，这次渲染依然会卡顿。**加上 `memo` 之后，urgent 触发的渲染会在 SlowItem 这层直接 bailout（因为 `tag`/`id` props 没变），完全不会重新跑 20 万次循环，才能看到真正"立刻响应"的效果**。

**现象 2：点击高优先级按钮后，SlowItem 还是打印旧的 tag 值**

根因：`useState` 内部维护的更新队列，每条 update 都挂着自己的 lane。已核实源码（`updateReducerImpl`）：

```js
var updateLane = update.lane & -536870913;
if ((renderLanes & updateLane) === updateLane) {
  // 这条 update 的 lane 属于本次渲染要处理的批次 → 应用它
} else {
  // 不属于 → 跳过，state 继续用旧值，这条 update 留着等下一次对应批次的渲染
}
```

`setTag` 是在 `startTransition` 里调的，它的 update 挂的是 **TransitionLane**；而点击"高优先级"按钮触发的是一次**新的、单独的同步渲染**，这次的 `renderLanes` 只有 **SyncLane**（Day10 讲过 `getNextLanes` 挑批次的规则：命中紧急 lane 就只返回这一批，不会捎带 TransitionLane）。所以这次渲染跑到 `tag` 这个 state 时，发现自己待处理的 update 是 TransitionLane，不在这次 `renderLanes` 里 → **跳过，继续用上一次已提交的旧值**。这不是 bug，是 lane 过滤机制在正常工作——`tag` 的更新被暂存着，要等下一次专门处理 TransitionLane 的渲染才会真正应用。

> 💡 一句话总结：**"高优先级"帮你抢到了"先处理"的资格，但换不来"瞬间处理完"，也不会替你把别的低优先级更新一起搭便车处理掉——每个 state 的每条更新，只认自己那条 lane 是否在这次 `renderLanes` 里。**

---## 实验 I2：用 React DevTools Profiler 录制，观察 commit 时间轴

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

## 实验 I3：`entangleTransitions` 效果——同一个 state 被两次独立 transition 触发，会不会乱序

> ⚠️ **2026-07-08 修正**：原实验（同一 startTransition 里 setA+setB）测的其实是"lane 缓存复用"这个更基础的机制（同一事件里多次 setState 天然拿到同一个 lane），跟 `entangleTransitions` 无关。`entangleTransitions` 真正的作用场景是"**同一个 state，被两次独立的事件先后触发 transition 更新**"，已重新设计实验如下。

```jsx
import { useState, useTransition } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  const [, startTransition] = useTransition();

  function handleClick() {
    // 每次点击都是"独立事件"——两次点击之间隔着一次事件循环，
    // currentEventTransitionLane 会被重置，第二次点击会领到不同的 lane
    startTransition(() => setCount(c => c + 1));
  }

  console.log('[render] count=', count);

  return (
    <div style={{ padding: 20 }}>
      <p>count={count}</p>
      <button onClick={handleClick}>点我（每次点击都是独立的 transition）</button>
    </div>
  );
}
```

**操作步骤**：快速连续点击按钮 5 次（间隔尽量短，但仍是 5 次独立的 click 事件，不是在同一个函数里连续调用 5 次 setState）。观察 Console：`count` 打印的渲染序列是否**依次**从 1 递增到 5，没有跳号也没有乱序（比如没有出现"先渲染出 count=3，之后才渲染出 count=2"这种反直觉顺序）。

**记录到 observations.md**：5 次点击后，`count` 的渲染序列是否严格递增、没有乱序？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| I1 | 高优先级更新立即响应，低优先级渲染日志重复打印（被丢弃重做过） | `getNextLanes` 重新决策 + `prepareFreshStack` 丢弃 wip 树 |
| I2 | Profiler 时间轴上高优先级 commit 排在低优先级 commit 之前 | 打断只发生在 render 阶段，commit 顺序反映最终的优先级排序结果 |
| I3 | 同一个 state 被多次独立 transition 触发，渲染序列严格递增不乱序 | `entangleTransitionUpdate` 把同一 queue 上先后挂着的多个 transition lane 捆绑成一批处理 |

---

## 完成后

```bash
git add demos/day21 notes/day21.md
git commit -m "阶段A D21 高优先级打断实战：完成浏览器实验(丢弃重做证据/Profiler commit顺序/entangleTransitions一致性)"
git push
```
