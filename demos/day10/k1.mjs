import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { useState } = React;
const h = React.createElement;
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
console.log('React version:', React.version);

let setA, setB;
let renderCount = 0;
function App() {
  renderCount++;
  const [a, _setA] = useState(0);
  const [b, _setB] = useState(0);
  setA = _setA; setB = _setB;
  return h('div', null, `a=${a} b=${b}`);
}

const root = ReactDOMClient.createRoot(document.getElementById('root'));
await act(async () => { root.render(h(App)); });
console.log('[mount] renderCount =', renderCount);

console.log('--- 同一 act(模拟同一事件) 里连续 setA + setB ---');
const before = renderCount;
await act(async () => {
  setA(x => x + 1);
  setB(x => x + 1);
});
console.log('两次 setState 后 renderCount 增量 =', renderCount - before);
console.log('最终 DOM =', document.getElementById('root').textContent);
