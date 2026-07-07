import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { useState, useDeferredValue, useTransition } = React;
const h = React.createElement;
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
console.log('React version:', React.version);

// ===== T3：useDeferredValue 在"当前渲染已是低优先级"场景下是否跳过二次延迟 =====
// 验证思路（对照 notes/day20.md §三 3.2 第③步 renderLanes & 42 === 0 的判断）：
// 场景A：在普通同步渲染里改变 value，观察 deferredValue 是否先给旧值再补新值（应触发延迟）。
// 场景B：把改变 value 的这次更新本身包进 startTransition 里（让这次渲染本身已经是低优先级），
//        观察 deferredValue 是否"直接给新值，不再二次延迟"。

let logA = [];
let logB = [];

function AppA() {
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  AppA.setText = setText;
  logA.push(`text="${text}" deferred="${deferred}"`);
  return h('div', null, `${text}|${deferred}`);
}

function AppB() {
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  const [, startTransition] = useTransition();
  AppB.setTextViaTransition = (v) => startTransition(() => setText(v));
  logB.push(`text="${text}" deferred="${deferred}"`);
  return h('div', null, `${text}|${deferred}`);
}

console.log('\n===== T3-A: 普通同步更新中的 useDeferredValue =====');
const rootA = ReactDOMClient.createRoot(document.getElementById('root'));
await act(async () => { rootA.render(h(AppA)); });
logA = [];
console.log('--- 直接 setText("hello")（同步/紧急更新） ---');
await act(async () => { AppA.setText('hello'); });
logA.forEach(l => console.log('   ', l));

console.log('\n===== T3-B: transition 更新中的 useDeferredValue =====');
document.getElementById('root').innerHTML = '';
const dom2 = new JSDOM('<!doctype html><html><body><div id="root2"></div></body></html>');
// 用同一个 document 追加一个新容器，避免复用节点状态
const container2 = document.createElement('div');
document.body.appendChild(container2);
const rootB = ReactDOMClient.createRoot(container2);
await act(async () => { rootB.render(h(AppB)); });
logB = [];
console.log('--- 通过 startTransition 触发 setText("world") ---');
await act(async () => { AppB.setTextViaTransition('world'); });
logB.forEach(l => console.log('   ', l));

console.log('\n===== T3 预期（基于源码推理，未本机预跑，见 README） =====');
console.log('预期A（普通同步更新）：应观察到至少两次渲染——先 deferred 仍是旧值(""), 后 deferred 追上新值("hello")。对应 renderLanes & 42 !== 0 触发延迟分支。');
console.log('预期B（transition 更新）：因为这次渲染本身已经是低优先级(TransitionLane)，renderLanes & 42 应为 0，deferred 理论上应该"直接"等于新值("world")，不再二次延迟——即不会出现 deferred 仍为空字符串的中间渲染。');
console.log('⚠️ 这是本次实验最需要重点验证的对比点：A组是否真的出现"旧值→新值"两阶段，B组是否真的"一步到位"。如果 B 组也出现了两阶段，说明我们对 §三 3.2 第③步的理解需要重新核对源码。');
