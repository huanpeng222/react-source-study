/**
 * Day14 P3: React.memo 比较函数语义 + 边界场景
 * 验证：返回值语义(和filter相反) / Object.is默认比较 / 自定义比较 / 无props子组件
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, memo as reactMemo } from 'react';
import { JSDOM } from 'jsdom';

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ===== 场景 1：比较函数的返回值语义（最大坑！）=====

// Array.filter: true = 保留
// React.memo: true = 跳过渲染（skip）！相反！

function Demo1() {
  const [count, setCount] = useState(0);
  
  // 自定义比较：只关心 id，忽略 name 变化
  const CustomChild = reactMemo(function({ id, name, ts }) {
    log(`  [CustomChild] render! id=${id}, name=${name}`);
    return `id=${id} name=${name}`;
  }, (prev, next) => {
    // 返回 true = props 等价 → 不 re-render（bailout）
    // 返回 false = props 不同 → re-render
    log(`  [compare] prev.id=${prev.id} vs next.id=${next.id} → ${prev.id === next.id ? 'true(跳过)' : 'false(渲染)'}`);
    return prev.id === next.id; // 只比较 id
  });

  // 模拟 re-render（name 和 ts 都变，但 id 不变）
  if (count < 3) {
    React.useEffect(() => setTimeout(() => setCount(c => c + 1), 30));
  }

  return React.createElement('div', null,
    React.createElement('p', null, `Demo1: count=${count}`),
    React.createElement(CustomChild, {
      id: 1,
      name: `name-v${count}`,
      ts: Date.now(),
    })
  );
}

// ===== 场景 2：Object.is 默认行为的细节 =====

function Demo2() {
  const [count, setCount] = useState(0);

  const BasicChild = reactMemo(function({ value }) {
    log(`  [BasicChild] render! value=${value}`);
    return `value=${value}`;
  }); // 默认用 Object.is 比较

  if (count < 3) {
    React.useEffect(() => setTimeout(() => setCount(c => c + 1), 30));
  }

  // 数字/字符串值相同时 Object.is 返回 true → bailout!
  return React.createElement('div', null,
    React.createElement('p', null, `Demo2: count=${count}`),
    React.createElement(BasicChild, { value: 42 })  // 值始终不变
  );
}

// ===== 场景 3：无 props 子组件也会跟着 re-render =====

let noPropsRenderCount = 0;
function NoPropsChild() {
  noPropsRenderCount++;
  log(`  [NoPropsChild] 第 ${noPropsRenderCount} 次 render (无任何props!)`);
  return `NoPropsChild 渲染了 ${noPropsRenderCount} 次`;
}

const MemoNoProps = reactMemo(NoPropsChild);

function Demo3() {
  const [count, setCount] = useState(0);

  if (count < 3) {
    React.useEffect(() => setTimeout(() => setCount(c => c + 1), 30));
  }

  return React.createElement('div', null,
    React.createElement('p', null, `Demo3: Parent count=${count}`),
    React.createElement('h4', null, '未 memo 的 NoPropsChild:'),
    React.createElement(NoPropsChild),
    React.createElement('h4', null, '已 memo 的 MemoNoProps:'),
    React.createElement(MemoNoProps)
  );
}

// ===== 测试运行器 =====
const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
global.document = dom.window.document;
global.window = dom.window;
const root = createRoot(dom.window.document.getElementById('root'));

async function run() {
  console.log('=== P3: React.memo 比较函数 + 边界场景 ===\n');

  root.render(React.createElement('div', null,

    React.createElement('h2', null, 'Demo1: 自定义比较函数（只比 id，忽略 name/ts 变化）'),
    React.createElement(Demo1),
    
    React.createElement('hr'),

    React.createElement('h2', null, 'Demo2: Object.is 对基本类型的缓存（值不变→bailout）'),
    React.createElement(Demo2),

    React.createElement('hr'),

    React.createElement('h2', null, 'Demo3: 无 props 子组件（memo前后对比）'),
    React.createElement(Demo3)

  ));

  await new Promise(r => setTimeout(r, 200));

  console.log('\n=== P3 结论 ===');
  console.log('[Demo1] 自定义比较函数:');
  console.log('  - React.memo 第二个参数返回 true = "props 相等" = 跳过渲染（bailout）');
  console.log('  - 这和 Array.filter(true=保留) 语义**相反**，最容易搞反！');
  console.log('  - 可以只比较关心的字段，实现"部分相等即 bailout"');
  
  console.log('\n[Demo2] Object.is 默认行为:');
  console.log('  - 基本类型(number/string/boolean): 值相等 → true → bailout ✅');
  console.log('  - 对象/数组/函数: 引用相等才 true → 新引用就 false ❌');
  console.log('  - 特例: Object.is(NaN, NaN)=true, 但 NaN===NaN=false');
  
  console.log('\n[Demo3] 无 props 子组件:');
  console.log('  - 未 memo: 每次 Parent re-render 都跟着跑（即使没传任何 prop）');
  console.log('  - 已 memo: React.memo 无参数时 → props 始终为 {} === {} → bailout!');
  console.log('  - 这是容易被忽略的性能杀手：昂贵子组件不传 props ≠ 不会重渲染');

  console.log('\n口诀："memo比较true跳过，引用稳定是前提，空prop也要memo。"');
}

run().catch(console.error);
