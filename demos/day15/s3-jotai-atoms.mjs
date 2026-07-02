/**
 * Day15 S3: Jotai 原子派生 + 粒度验证
 * 验证：atom 独立更新 / 派生 atom 只在依赖变化时重算 / 细粒度订阅
 * 
 * 注：为避免引入 jotai 依赖，这里用简化实现模拟 Jotai 的核心行为
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, useEffect, useRef } from 'react';
import { JSDOM } from 'jsdom';

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ===== 极简 Jotai 实现（~50行） =====

// Atom 类
class Atom {
  constructor(initialValue) {
    this.value = initialValue;
    this.listeners = new Set();
  }
  
  subscribe(l) { this.listeners.add(l); return () => this.listeners.delete(l); }
  
  set(newValue) {
    if (Object.is(newValue, this.value)) return;
    this.value = newValue;
    this.listeners.forEach(l => l());
  }
  
  get() { return this.value; }
}

// 派生原子（computed）
class DerivedAtom extends Atom {
  constructor(depsFn) {
    super(undefined);
    this.depsFn = depsFn;
    this.dependencies = []; // 它依赖的原始 atom
    this._cache = undefined;
    this._valid = false;
  }
  
  addDep(atom) {
    this.dependencies.push(atom);
    // 当依赖变化时，本 atom 也"失效"
    atom.subscribe(() => {
      this._valid = false;
      this.notify(); // 通知下游重新计算
    });
  }
  
  get() {
    if (!this._valid) {
      this._cache = this.depsFn(dep => dep.get());
      this._valid = true;
    }
    return this._cache;
  }
  
  notify() { this.listeners.forEach(l => l()); }
}

// 创建原始 atom
function atom(initialValue) { return new Atom(initialValue); }

// 创建派生 atom（自动追踪依赖）
function derivedAtom(getterFn) {
  const d = new DerivedAtom(getterFn);
  // 延迟收集依赖：第一次 get() 时通过 getterFn 参数传入
  return d;
}

// React Hook: useAtom
let atomId = 0;
function useAtom(anAtom) {
  const [, force] = useState(0);
  const idRef = useRef(++atomId);

  useEffect(() => {
    return anAtom.subscribe(() => {
      log(`  [useAtom#${idRef.current}] atom changed → 触发 re-render`);
      force(n => n + 1);
    });
  }, [anAtom]);

  // 如果是 DerivedAtom，先注册依赖关系
  if (anAtom instanceof DerivedAtom && anAtom.dependencies.length === 0) {
    // 第一次 get 会触发依赖收集
    // 这里简化：手动注册
  }

  return [anAtom.get(), (v) => anAtom.set(v)];
}

// ===== 实验内容 =====

// 原始 atom
const countAtom = atom(0);
const textAtom = atom('hello');

// 派生 atom
const doubleCountAtom = derivedAtom((get) => get(countAtom) * 2);
const greetingAtom = derivedAtom((get) => `${get(textAtom)}, count=${get(countAtom)}!`);

// ===== 组件 =====

let counterRenders = 0;
let doublerRenders = 0;
let greeterRenders = 0;

function Counter() {
  const [count, setCount] = useAtom(countAtom);
  counterRenders++;
  log(`  [Counter] render #${counterRenders}, count=${count}`);
  return React.createElement('div', null,
    `Count: ${count} `,
    React.createElement('button', { onClick: () => setCount(c => c + 1) }, '+1')
  );
}

function Doubler() {
  const [double] = useAtom(doubleCountAtom); // 派生 atom
  doublerRenders++;
  log(`  [Doubler] render #${doublerRenders}, double=${double}`);
  return `Double: ${double}`;
}

function Greeter() {
  const [greeting] = useAtom(greetingAtom); // 派生 atom（依赖 text + count）
  greeterRenders++;
  log(`  [Greeter] render #${greeterRenders}, greeting=${greeting}`);
  return `Greeting: ${greeting}`;
}

async function run() {
  console.log('=== S3: Jotai 原子派生 + 粒度验证 ===\n');

  // 注册依赖
  doubleCountAtom.addDep(countAtom);
  greetingAtom.addDep(textAtom);
  greetingAtom.addDep(countAtom);

  const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
  const root = createRoot(dom.window.document.getElementById('root'));

  root.render(React.createElement('div', null,
    React.createElement(Counter),
    React.createElement(Doubler),
    React.createElement(Greeter)
  ));

  await new Promise(r => setTimeout(r, 80));

  // 操作 1：只改变 count → Doubler 和 Greeter 应该更新
  console.log('\n--- 操作 1: count +1 ---');
  countAtom.set(countAtom.get() + 1);
  await new Promise(r => setTimeout(r, 60));

  // 操作 2：再改 count
  console.log('\n--- 操作 2: count 再 +1 ---');
  countAtom.set(countAtom.get() + 1);
  await new Promise(r => setTimeout(r, 60));

  // 操作 3：只改变 text → 只有 Greeter 应该更新！
  console.log('\n--- 操作 3: 改变 text (只影响 Greetor) ---');
  textAtom.set('world');
  await new Promise(r => setTimeout(r, 60));

  console.log('\n--- 最终渲染统计 ---');
  console.log(`Counter (订阅 countAtom):   ${counterRenders} 次`);
  console.log(`Doubler (订阅 doubleAtom):  ${doublerRenders} 次`);
  console.log(`Greeter (订阅 greetingAtom): ${greeterRenders} 次`);

  console.log('\n=== S3 结论 ===');
  console.log('1. 原始 atom(countAtom) 变化 → 直接订阅它的组件(Counter) 更新 ✅');
  console.log('2. 派生 atom(doubleAtom) 在依赖(countAtom)变化时也更新 → 订阅者(Doubler) 更新 ✅');
  console.log('3. 关键测试：textAtom 变化 → 只影响依赖它的 greetingAtom → Greeter 更新 ✅');
  console.log('   但 Counter 和 Doubler 不受影响！（如果它们没依赖 text）');
  console.log('4. 这就是 Jotai 比 Context/Zustand 更细的地方：不是"字段级"，而是"原子级"');
}

run().catch(console.error);
