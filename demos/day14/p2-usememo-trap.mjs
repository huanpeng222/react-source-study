/**
 * Day14 P2: useMemo 依赖陷阱
 * 验证：依赖数组里的对象引用 → "假缓存"；修复方法
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, useMemo, useCallback } from 'react';
import { JSDOM } from 'jsdom';

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

let computeCount = 0;

// 模拟昂贵计算
function computeExpensive(n) {
  computeCount++;
  // O(n) 模拟
  let sum = 0;
  for (let i = 0; i < n * 10000; i++) sum += i;
  return { result: sum, input: n };
}

// ===== 场景 A：依赖是对象 → 假缓存 =====
function ScenarioA({ config }) {
  const [count, setCount] = useState(0);
  
  // ❌ config 是对象，每次 Parent re-render 都是新引用
  //     即使 config 内容没变，useMemo 也认为"依赖变了"→重算
  const value = useMemo(() => {
    log(`  [ScenarioA] 重算 computeExpensive! count=${count}`);
    return computeExpensive(count);
  }, [config]);  // ← config 每次都是新对象！

  if (count < 2) {
    React.useEffect(() => setTimeout(() => setCount(c => c + 1), 30));
  }

  return React.createElement('div', null,
    `ScenarioA: count=${count}, computed=${value?.result ?? 'null'}, computeCount=${computeCount}`
  );
}

// ===== 场景 B：用 useState 缓存 / 提外部常量 → 真缓存 =====
function ScenarioB() {
  const [count, setCount] = useState(0);
  
  // ✅ 用 useState 缓存配置对象（只在初始化时创建一次）
  const [stableConfig] = useState(() => ({ mode: 'dark', lang: 'zh' }));
  
  // 或者直接从 props 解析出基本类型作为依赖
  const value = useMemo(() => {
    log(`  [ScenarioB] 重算 computeExpensive! count=${count}`);
    return computeExpensive(count);
  }, [count]); // ← 只依赖基本类型！

  if (count < 2) {
    React.useEffect(() => setTimeout(() => setCount(c => c + 1), 30));
  }

  return React.createElement('div', null,
    `ScenarioB: count=${count}, computed=${value?.result}, computeCount=${computeCount}`
  );
}

// ===== 场景 C：useCallback 的闭包陷阱 =====
function ScenarioC() {
  const [count, setCount] = useState(0);

  // ❌ 依赖为空但用了 count 的旧值（stale closure）
  const badFn = useCallback(() => {
    return `bad: count=${count}`; // count 永远是初始值！
  }, []);

  // ✅ 正确：把 count 加入依赖
  const goodFn = useCallback(() => {
    return `good: count=${count}`;
  }, [count]);

  if (count < 2) {
    React.useEffect(() => setTimeout(() => setCount(c => c + 1), 30));
  }

  return React.createElement('div', null,
    `ScenarioC: count=${count}`,
    React.createElement('br'),
    `badFn()="${badFn()}" (stale!)`,
    React.createElement('br'),
    `goodFn()="${goodFn()}" (correct)`
  );
}

// ===== 测试运行器 =====
const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
global.document = dom.window.document;
global.window = dom.window;
const root = createRoot(dom.window.document.getElementById('root'));

async function run() {
  console.log('=== P2: useMemo/useCallback 依赖陷阱 ===\n');

  root.render(React.createElement('div', null,
    React.createElement('h3', null, '场景 A: 依赖是对象(假缓存)'),
    React.createElement(ScenarioA, { config: { mode: 'dark' } }),
    React.createElement('hr'),
    React.createElement('h3', null, '场景 B: 依赖稳定化后(真缓存)'),
    React.createElement(ScenarioB),
    React.createElement('hr'),
    React.createElement('h3', null, '场景 C: useCallback 闭包陷阱'),
    React.createElement(ScenarioC)
  ));

  await new Promise(r => setTimeout(r, 200));

  console.log('\n=== P2 结论 ===');
  console.log('1. useMemo 依赖如果是对象/数组/函数 → 每次新引用 → "假缓存"，每次都重算');
  console.log('2. 修复方式：(a)只依赖基本类型 string/number/boolean (b)useState 缓存 (c)提组件外部');
  console.log('3. useCallback 依赖漏写 → stale closure（闭包捕获旧值）');
  console.log('4. useMemo 的比较规则是 Object.is，和 === 类似但 NaN===NaN 为 false 而 Object.is(NaN,NaN)为 true');
  console.log('\n口诀："依赖写基本类型，对象提外或缓存，漏写依赖闭包老。"');
}

run().catch(console.error);
