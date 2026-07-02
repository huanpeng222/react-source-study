/**
 * Day14 P1: bailout 可视化
 * 验证：React.memo 命中 → 子组件函数体不执行；props 引用不稳定 → memo 失效
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, useCallback, useMemo, memo as reactMemo } from 'react';
import { JSDOM } from 'jsdom';

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

let renderCountA = 0;
let renderCountB = 0;
let renderCountC = 0;

// ===== 子组件 A：没有 memo（对照组）=====
function ChildA({ data, onClick }) {
  renderCountA++;
  log(`  [ChildA] 第 ${renderCountA} 次 render, data.name=${data?.name || data}`);
  return React.createElement('div', null, `ChildA: ${data?.name || data} (renders: ${renderCountA})`);
}

// ===== 子组件 B：有 memo 但 props 引用不稳定（形同虚设）=====
const ChildB = reactMemo(function ChildB({ data, onClick }) {
  renderCountB++;
  log(`  [ChildB] 第 ${renderCountB} 次 render (memo但props引用不稳定), data.name=${data?.name || data}`);
  return React.createElement('div', null, `ChildB: ${data?.name || data} (renders: ${renderCountB})`;
});

// ===== 子组件 C：有 memo + props 引用稳定（真正生效）=====
const ChildC = reactMemo(function ChildC({ data, onClick }) {
  renderCountC++;
  log(`  [ChildC] 第 ${renderCountC} 次 render (memo+稳定引用✅), data.name=${data?.name || data}`);
  return React.createElement('div', null, `ChildC: ${data?.name || data} (renders: ${renderCountC})`);
});

// ===== 无 props 但昂贵的子组件 =====
let heavyRenderCount = 0;
const HeavyComponent = reactMemo(function Heavy() {
  heavyRenderCount++;
  log(`  [HeavyComponent] 第 ${heavyRenderCount} 次 render! (无任何props)`);
  return React.createElement('div', null, `Heavy: 渲染了 ${heavyRenderCount} 次`);
});

// ===== 父组件 =====
function Parent() {
  const [count, setCount] = useState(0);
  
  // ❌ 每次新函数/新对象 → React.memo 形同虚设
  const badClick = () => console.log('click', count);
  const badData = { name: `count=${count}`, ts: Date.now() };
  
  // ✅ 引用稳定 → React.memo 能命中 bailout
  const goodClick = useCallback(() => console.log('click', count), []);
  const goodData = useMemo(() => ({ name: 'stable', fixed: true }), []);

  log(`\n=== Parent render #${count + 1} ===`);

  // 模拟点击后 re-render
  if (count < 3) {
    React.useEffect(() => {
      setTimeout(() => setCount(c => c + 1), 30);
    });
  }

  return React.createElement('div', null,
    React.createElement('p', null, `Parent count: ${count}`),
    React.createElement('h3', null, 'A: 无 memo (每次都渲染)'),
    React.createElement(ChildA, { data: badData, onClick: badClick }),
    
    React.createElement('h3', null, 'B: 有 memo + 不稳定 props (memo失效)'),
    React.createElement(ChildB, { data: badData, onClick: badClick }),
    
    React.createElement('h3', null, 'C: 有 memo + 稳定 props (bailout生效)'),
    React.createElement(ChildC, { data: goodData, onClick: goodClick }),

    React.createElement('h3', null, 'Heavy: 无 props 但昂贵'),
    React.createElement(HeavyComponent)
  );
}

// ===== 测试运行器 =====
const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
global.document = dom.window.document;
global.window = dom.window;
const root = createRoot(dom.window.document.getElementById('root'));

async function run() {
  console.log('=== P1: bailout 可视化 ===\n');
  console.log('观察：Parent 每次 re-render 时，4 个子组件各 render 了几次\n');

  root.render(React.createElement(Parent));
  
  await new Promise(r => setTimeout(r, 150)); // 等 4 次 re-render 完成

  console.log('\n--- 最终统计 ---');
  console.log(`ChildA (无 memo):        ${renderCountA} 次渲染`);
  console.log(`ChildB (memo+不稳定):   ${renderCountB} 次渲染 (预期 ≈ A，因为 props 引用总变)`);
  console.log(`ChildC (memo+稳定):     ${renderCountC} 次渲染 (预期 ≤ 2，首次 mount + 可能 1-2 次)`);
  console.log(`HeavyComponent (无prop): ${heavyRenderCount} 次渲染 (memo 后应该只 1 次)`);

  console.log('\n=== P1 结论 ===');
  console.log('1. Parent state 变 → Parent 必然 re-render (它自己触发的更新)');
  console.log('2. ChildA 无 memo → 每次 Parent re-render 都跟着跑');
  console.log('3. ChildB 有 memo 但 props 每次都是新对象/函数 → Object.is 不通过 → 和没 memo 一样');
  console.log('4. ChildC 有 memo + useCallback/useMemo 稳定引用 → bailout! 跳过重渲染');
  console.log('5. HeavyComponent 无 props 也受影响 → 加 React.memo 保护');
  console.log('\n核心教训：React.memo 生效的前提是 **props 引用稳定**。黄金链断裂任一环 → 全链条失效。');
}

run().catch(console.error);
