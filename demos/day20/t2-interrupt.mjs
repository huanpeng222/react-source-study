import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { useState, useTransition } = React;
const h = React.createElement;
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
console.log('React version:', React.version);

// ===== T2：高优先级更新是否能打断正在进行的 transition 渲染 =====
// 验证思路：先触发一个 startTransition 包裹的更新（低优先级），
// 在它还没提交完成之前，立刻触发一个直接 setState（高优先级），
// 观察最终 DOM 结果、渲染调用顺序，判断"打断"是否发生、旧的 transition 渲染是否被丢弃重做。
//
// ⚠️ 已知限制（参考 Day11/Day12 的 observations.md 先例）：
// jsdom 没有真实的浏览器事件循环和 Scheduler 的 MessageChannel 时间片机制，
// act() 会把调度过程同步"压平"执行，很难在单进程同步脚本里制造出
// "低优先级渲染进行到一半、被高优先级打断"的真实中断窗口。
// 本实验能验证的是：**最终结果的正确性**（高优先级更新最终生效，没有被 transition 覆盖掉），
// 不能验证：**渲染过程中真实的 yield/打断时序**（那需要真实浏览器 + Profiler，见 README 里的浏览器版操作指引）。

let renderLog = [];

function App() {
  const [n, setN] = useState(0);
  const [isPending, startTransition] = useTransition();

  App.setNDirect = (v) => setN(v);
  App.setNTransition = (v) => startTransition(() => setN(v));

  renderLog.push(`render: n=${n} isPending=${isPending}`);
  return h('div', null, `n=${n}`);
}

const root = ReactDOMClient.createRoot(document.getElementById('root'));

console.log('\n===== T2: transition 更新与紧急更新的先后关系 =====');

await act(async () => { root.render(h(App)); });
renderLog = [];

console.log('\n--- 先发起 transition 更新 setNTransition(1)，同一个 act 内紧接着发起紧急更新 setNDirect(2) ---');
await act(async () => {
  App.setNTransition(1);
  App.setNDirect(2);
});
renderLog.forEach(l => console.log('   ', l));
console.log('   最终 DOM =', document.getElementById('root').textContent);

console.log('\n===== T2 预期（基于源码推理，未本机预跑，见 README） =====');
console.log('预期：最终 DOM 应该显示 n=2（紧急更新的值），因为 SyncLane/紧急更新的 expirationTime 更小，会排在 TransitionLane 前面处理（Day19 最小堆机制）。');
console.log('预期：transition 那次更新（n=1）大概率不会作为一次独立可见的渲染出现，因为两次更新会被同一批处理，最终以更高优先级的结果为准。');
console.log('⚠️ 如果实际结果不是这样，不要猜答案——去 demos/day20/observations.md 记录真实输出，本地复现分析原因，必要时回 notes/day20.md 修正结论（按 STUDY_PROTOCOL 冲突处理流程）。');
