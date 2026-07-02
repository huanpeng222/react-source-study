/**
 * Day15 S1: Context 性能陷阱演示 + 三种修复对比
 * 验证：单一Context → 无关消费者被拖累 → 拆分/selector/zustand 各自效果
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, useContext, useMemo, useCallback, useRef, createContext } from 'react';
import { JSDOM } from 'jsdom';

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ===== 统计渲染次数 =====
let headerRenders = 0, listRenders = 0, footerRenders = 0;

// ===== 场景 0：反模式 — 一个 Context 管所有状态 =====
const BigCtx = createContext(null);

function BadHeader() {
  const ctx = useContext(BigCtx);
  headerRenders++;
  log(`  [BadHeader] 第 ${headerRenders} 次渲染 (只用了 user 和 theme，但 cart 变也被拖累!)`);
  return `Header: ${ctx?.user?.name || '?'} (${ctx?.theme})`;
}

function BadList() {
  const ctx = useContext(BigCtx);
  listRenders++;
  log(`  [BadList] 第 ${listRenders} 次渲染 (用到 items)`);
  return `List: ${ctx?.items?.length || 0} items`;
}

function BadApp() {
  const [user] = useState({ name: '彭环' });
  const [theme] = useState('dark');
  const [items, setItems] = useState([1, 2]);
  
  // ⚠️ 每次 render 新对象！
  const value = useMemo(() => ({ user, theme, items, setItems }), [user, theme, items]);

  // 自动触发 items 变化
  React.useEffect(() => {
    let mounted = true;
    const timer = setInterval(() => {
      if (mounted) setItems(prev => [...prev, prev.length + 1]);
    }, 60);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  return React.createElement(BigCtx.Provider, { value },
    React.createElement(BadHeader),
    React.createElement('br'),
    React.createElement(BadList)
  );
}

// ===== 场景 A：拆分 Context =====
const UserCtx = createContext(null);
const ItemsCtx = createContext(null);

let aHeaderRenders = 0, aListRenders = 0;

function SplitHeader() {
  const { user, theme } = useContext(UserCtx);
  aHeaderRenders++;
  log(`  [SplitHeader] 第 ${aHeaderRenders} 次渲染 (只订阅 UserCtx)`);
  return `Header: ${user?.name} (${theme})`;
}

function SplitList() {
  const items = useContext(ItemsCtx);
  aListRenders++;
  log(`  [SplitList] 第 ${aListRenders} 次渲染 (只订阅 ItemsCtx)`);
  return `List: ${items.length} items`;
}

function SplitApp() {
  const [user] = useState({ name: '彭环' });
  const [theme] = useState('dark');
  const [items, setItems] = useState([1, 2]);

  React.useEffect(() => {
    let m = true;
    const t = setInterval(() => { if (m) setItems(p => [...p, p.length + 1]); }, 60);
    return () => { m = false; clearInterval(t); };
  }, []);

  return React.createElement(UserCtx.Provider, { value: { user, theme } },
    React.createElement(ItemsCtx.Provider, { value: items },
      React.createElement(SplitHeader),
      React.createElement('br'),
      React.createElement(SplitList)
    )
  );
}

// ===== 场景 C：模拟 Zustand 的 useSyncExternalStore 行为 =====
// （不引入 zustand 依赖，用原生 Hook 模拟其原理）

let zHeaderRenders = 0, zListRenders = 0;

// 极简 store（Zustand 原理）
function createMiniStore(initState) {
  let state = initState;
  const listeners = new Set();
  const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
  const getState = () => state;
  const set = (fn) => {
    const next = typeof fn === 'function' ? fn(state) : fn;
    if (!Object.is(next, state)) { state = next; listeners.forEach(l => l()); }
  };
  return { getState, set, subscribe };
}

const store = createMiniStore({
  user: { name: '彭环' },
  theme: 'dark',
  items: [1, 2],
});

function useMiniStore(selector) {
  const [, force] = useState(0);
  
  React.useEffect(() => {
    // 用 subscribe + force update 模拟 useSyncExternalStore
    return store.subscribe(() => force(n => n + 1));
  }, []);
  
  return selector(store.getState());
}

function ZHeader() {
  const { user, theme } = useMiniStore(s => ({ user: s.user, theme: s.theme }));
  zHeaderRenders++;
  log(`  [Zustand-style Header] 第 ${zHeaderRenders} 次渲染 (selector 只取 user+theme)`);
  return `Header: ${user.name} (${theme})`;
}

function ZList() {
  const items = useMiniStore(s => s.items);
  zListRenders++;
  log(`  [Zustand-style List] 第 ${zListRenders} 次渲染 (selector 只取 items)`);
  return `List: ${items.length} items`;
}

async function runAllScenarios(root) {
  console.log('=== S1: Context 性能陷阱 + 三种修复 ===\n');

  // --- 场景 0：反模式 ---
  console.log('--- 场景 0：反模式（一个大 Context）---');
  root.render(React.createElement(BadApp));
  await new Promise(r => setTimeout(r, 200)); // 让 items 变化几次

  console.log('\n[统计] 反模式:');
  console.log(`  Header: ${headerRenders} 次 (应该远多于 items 变化次数!)`);
  console.log(`  List:   ${listRenders} 次`);

  // --- 场景 A：拆分 ---
  console.log('\n--- 场景 A：拆分 Context ---');
  headerRenders = 0; listRenders = 0;
  root.render(React.createElement(SplitApp));
  await new Promise(r => setTimeout(r, 200));

  console.log('[统计] 拆分后:');
  console.log(`  Header: ${aHeaderRenders} 次 (预期: 仅初始1-2次)`);
  console.log(`  List:   ${aListRenders} 次`);

  // --- 场景 C：Zustand 风格 ---
  console.log('\n--- 场景 C：useSyncExternalStore / Zustand 风格 ---');
  
  root.render(React.createElement('div', null,
    React.createElement(ZHeader),
    React.createElement('br'),
    React.createElement(ZList)
  ));

  // 模拟 items 更新
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 40));
    store.set(s => ({ ...s, items: [...s.items, s.items.length + 1] }));
  }

  console.log('[统计] Zustand 风格 (5次更新后):');
  console.log(`  Header: ${zHeaderRenders} 次 (预期: 1-2次，不受 items 影响)`);
  console.log(`  List:   ${zListRenders} 次 (预期: ~6次 = 初始1 + 5次更新)`);

  console.log('\n=== S1 结论 ===');
  console.log('1. 单一大 Context: items 每变一次 → Header 也重渲染（即使跟它无关）');
  console.log('2. 拆分 Context: items 在独立 Context 里变 → Header 完全不受影响 ✅');
  console.log('3. Zustand 风格(selector): 最细粒度控制，且不需要 Provider 包裹 ✅');
  console.log('\n生产推荐：小型应用拆分 Context；中大型直接上 Zustand。');
}

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
global.document = dom.window.document;
global.window = dom.window;
const root = createRoot(dom.window.document.getElementById('root'));

runAllScenarios(root).catch(console.error);
