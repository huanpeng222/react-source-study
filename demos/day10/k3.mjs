import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { useState, useDeferredValue } = React;
const h = React.createElement;
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
console.log('React version:', React.version);

let setText;
let log = [];
function App() {
  const [text, _setText] = useState('');
  const deferred = useDeferredValue(text);
  setText = _setText;
  log.push(`text="${text}" deferred="${deferred}"`);
  return h('div', null, `text=${text} deferred=${deferred}`);
}

const root = ReactDOMClient.createRoot(document.getElementById('root'));
await act(async () => { root.render(h(App)); });
console.log('[mount] 渲染序列:'); log.forEach(l => console.log('   ', l));

log = [];
console.log('--- setText("a") ---');
await act(async () => { setText('a'); });
console.log('setText("a") 后渲染序列:'); log.forEach(l => console.log('   ', l));
console.log('最终 DOM =', document.getElementById('root').textContent);
