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

// ===== T1：startTransition 包裹的 setState 是否真的走了低优先级路径 =====
// 验证思路：用一个模拟"耗时"的子组件（渲染时打印时间戳+做一次同步空转模拟计算量），
// 对比"直接 setState" vs "startTransition 包裹的 setState" 触发时，isPending 的变化序列，
// 以及 React 是否在 transition 更新期间先给出旧值（isPending=true 阶段）。

let renderLog = [];
let heavyCount = 0;

function heavyCompute(n) {
  // 模拟一次"有实际耗时"的计算（同步空转），次数打印方便观察是否真的执行了
  heavyCount++;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i;
  return sum;
}

let setNDirect, setNTransition, getIsPending;

function App() {
  const [n, setN] = useState(0);
  const [isPending, startTransition] = useTransition();

  setNDirect = (v) => setN(v);
  setNTransition = (v) => startTransition(() => setN(v));
  getIsPending = () => isPending;

  const heavy = heavyCompute(1000); // 数量不大，只是为了确认"是否被跳过/是否被执行"
  renderLog.push(`render: n=${n} isPending=${isPending} heavyCount累计=${heavyCount} heavyResult=${heavy}`);

  return h('div', null, `n=${n} isPending=${isPending}`);
}

const root = ReactDOMClient.createRoot(document.getElementById('root'));

console.log('\n===== T1: startTransition 的 isPending 变化序列 =====');

await act(async () => { root.render(h(App)); });
console.log('[mount] 渲染序列:');
renderLog.forEach(l => console.log('   ', l));

renderLog = [];
console.log('\n--- 场景A：直接 setN(1)（不走 transition） ---');
await act(async () => { setNDirect(1); });
renderLog.forEach(l => console.log('   ', l));
console.log('   DOM =', document.getElementById('root').textContent);

renderLog = [];
console.log('\n--- 场景B：setNTransition(2)（走 startTransition） ---');
await act(async () => { setNTransition(2); });
renderLog.forEach(l => console.log('   ', l));
console.log('   DOM =', document.getElementById('root').textContent);

console.log('\n===== T1 预期（基于源码推理，未本机预跑，见 README） =====');
console.log('预期A：直接 setN 只应该看到 1 次渲染，isPending 全程 false（没有 pending 阶段）');
console.log('预期B：startTransition 里的 setN 理论上会先触发一次 isPending=true 的渲染，再触发一次 isPending=false 且 n 已更新的渲染');
console.log('⚠️ jsdom 环境警示：act() 会把所有微任务/调度都同步冲刷完，可能观察不到真实浏览器里 isPending=true 阶段的"中间态"停留——这正是本实验要验证的点之一。');
