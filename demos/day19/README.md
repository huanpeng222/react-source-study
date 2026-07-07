# Day 19 实验：Scheduler（最小堆任务队列 + MessageChannel 时间片）

> Scheduler 是纯 JS 调度逻辑，不依赖 React 组件本身，可以直接在浏览器里用真实的 `scheduler` 包（React 内部用的就是这个包）跑，不需要 Vite/Next.js 项目。

## 环境准备

新建一个空目录，直接用 CDN 引入即可，不需要构建工具：

```bash
mkdir -p demos/day19/playground
cd demos/day19/playground
```

创建 `index.html`：

```html
<!DOCTYPE html>
<html>
<head><title>Scheduler 实验</title></head>
<body>
  <h1>打开 Console 查看输出</h1>
  <script src="https://unpkg.com/scheduler@0.25.0/umd/scheduler.development.js"></script>
  <script src="experiment.js"></script>
</body>
</html>
```

用浏览器直接打开这个 `index.html`（或用 `npx serve .` 起个静态服务器再访问），打开 DevTools Console。

---

## 实验 E1：最小堆按 expirationTime 排序，不是先来后到

创建 `experiment-e1.js`（把 `index.html` 里的 script 换成引用这个文件）：

```js
const { unstable_scheduleCallback, unstable_UserBlockingPriority, unstable_NormalPriority, unstable_IdlePriority } = window.Scheduler;

console.log('=== E1: 优先级决定执行顺序，不是先来后到 ===');

// 故意按"低优先级先、高优先级后"的顺序调度
unstable_scheduleCallback(unstable_IdlePriority, () => {
  console.log('3. Idle 任务执行了（最后调度，但优先级最低）');
});

unstable_scheduleCallback(unstable_NormalPriority, () => {
  console.log('2. Normal 任务执行了');
});

unstable_scheduleCallback(unstable_UserBlockingPriority, () => {
  console.log('1. UserBlocking 任务执行了（最后调度，但优先级最高，应该最先跑）');
});

console.log('三个任务已经全部调度完毕，注意上面打印的执行顺序 ↑');
```

**操作步骤**：刷新页面看 Console 输出的三行日志顺序。

**记录到 observations.md**：三个任务的实际打印顺序是 1→2→3（按优先级），还是 3→2→1（按调度顺序）？

---

## 实验 E2：验证 MessageChannel 不受 4ms 节流，setTimeout 会

创建 `experiment-e2.js`：

```js
console.log('=== E2: MessageChannel vs setTimeout(0) 连续触发间隔 ===');

// --- 测试 setTimeout(fn, 0) 连续嵌套 ---
let stTimes = [];
function testSetTimeout(n) {
  if (n <= 0) {
    console.log('setTimeout 连续5次间隔(ms):', stTimes.map((t, i) => i === 0 ? '-' : (t - stTimes[i-1]).toFixed(2)));
    testMessageChannel(5);
    return;
  }
  stTimes.push(performance.now());
  setTimeout(() => testSetTimeout(n - 1), 0);
}

// --- 测试 MessageChannel 连续触发 ---
let mcTimes = [];
function testMessageChannel(n) {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    mcTimes.push(performance.now());
    if (n - 1 <= 0) {
      console.log('MessageChannel 连续5次间隔(ms):', mcTimes.map((t, i) => i === 0 ? '-' : (t - mcTimes[i-1]).toFixed(2)));
      console.log('对比结论：setTimeout 是否稳定 >=4ms？MessageChannel 是否能 <1ms？');
    } else {
      testMessageChannel(n - 1);
    }
  };
  channel.port2.postMessage(null);
}

testSetTimeout(5);
```

**操作步骤**：刷新页面，观察 Console 打印的两组时间间隔数组。

**记录到 observations.md**：`setTimeout` 连续调用的间隔是否稳定在 4ms 左右（浏览器节流）？`MessageChannel` 的间隔是否明显更短？

---

## 实验 E3：时间片未用完但任务返回"续体函数"时，是否立即让出

```js
console.log('=== E3: 返回续体函数(continuation) 的任务是否被切成多段 ===');

let callCount = 0;
unstable_scheduleCallback(unstable_NormalPriority, function bigTask(didTimeout) {
  callCount++;
  console.log(`第 ${callCount} 次被调用, didTimeout=${didTimeout}, 时间=${performance.now().toFixed(2)}`);

  if (callCount < 5) {
    // 返回自身 = "续体函数"，告诉 Scheduler "我还没干完，下个时间片接着调我"
    return bigTask;
  }
  console.log('任务真正完成，不再返回续体函数');
});
```

**操作步骤**：刷新页面，观察 `bigTask` 被调用了几次，每次调用之间的时间间隔（用 performance.now() 的值算差）。

**记录到 observations.md**：`bigTask` 是被一次性跑完 5 次，还是被拆成多次独立的宏任务调用（每次调用之间有明显的时间间隔，说明是真的让出过主线程）？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| E1 | 高优先级任务后调度但先执行 | 最小堆按 expirationTime 排序，不是 FIFO 队列 |
| E2 | setTimeout 有 ~4ms 节流，MessageChannel 没有 | React 弃用 setTimeout 做时间片调度的原因 |
| E3 | 返回续体函数的任务被拆成多段调用，每段之间真的让出了主线程 | 可中断渲染的底层机制：workLoop 通过续体函数分片执行 |

---

## 完成后

```bash
git add demos/day19 notes/day19.md
git commit -m "W3 D19 Scheduler：补建真实浏览器实验(最小堆优先级顺序/MessageChannel无4ms节流/续体函数分片执行)"
git push
```
