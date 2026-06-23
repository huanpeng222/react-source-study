import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { useState, useTransition, startTransition } = React;
const h = React.createElement;
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
console.log('React version:', React.version);

let setN;
let pendingLog = [];
function App() {
  const [n, _setN] = useState(0);
  const [isPending, startT] = useTransition();
  setN = (v, useTransitionFlag) => {
    if (useTransitionFlag) startT(() => _setN(v));
    else _setN(v);
  };
  pendingLog.push(isPending);
  return h('div', null, `n=${n} pending=${isPending}`);
}

const root = ReactDOMClient.createRoot(document.getElementById('root'));
await act(async () => { root.render(h(App)); });
console.log('[mount] isPending 序列 =', JSON.stringify(pendingLog));

pendingLog = [];
console.log('--- 直接 setN(1) ---');
await act(async () => { setN(1, false); });
console.log('直接更新后 isPending 序列 =', JSON.stringify(pendingLog), '| DOM=', document.getElementById('root').textContent);

pendingLog = [];
console.log('--- startTransition 里 setN(2) ---');
await act(async () => { setN(2, true); });
console.log('transition 更新后 isPending 序列 =', JSON.stringify(pendingLog), '| DOM=', document.getElementById('root').textContent);
