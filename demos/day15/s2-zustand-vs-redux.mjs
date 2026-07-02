/**
 * Day15 S2: Zustand vs Redux 同功能对比
 * 验证：同一功能两种方案代码量 / Provider / dispatch 差异
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, useSyncExternalStore, useContext, createContext } from 'react';
import { JSDOM } from 'jsdom';

const log = (...args) => console.log(`[${new Date().toISOString().slice(11,19)}]`, ...args);

// ===== 方案 A：手写简化版 Redux =====
// Action Types (手动定义 ❌)
const INC = 'counter/inc';
const SET_NAME = 'user/setName';

// Action Creators (手动定义 ❌)
const inc = () => ({ type: INC });
const setName = (name) => ({ type: SET_NAME, payload: name });

// Reducer (手动 switch-case ❌)
const initialState = { count: 0, name: 'guest' };
function reducer(state = initialState, action) {
  switch (action.type) {
    case INC: return { ...state, count: state.count + 1 };
    case SET_NAME: return { ...state, name: action.payload };
    default: return state;
  }
}

// Store 实现（简化版 Redux）
function createStore(rducr) {
  let state = rducr(undefined, '@@INIT');
  const listeners = new Set();
  return {
    getState: () => state,
    dispatch(action) {
      state = rducr(state, action);
      listeners.forEach(l => l());
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// Provider 组件 (必须! ❌)
const Ctx = createContext(null);
function Provider({ store, children }) {
  return React.createElement(Ctx.Provider, { value: store }, children);
}

// ===== 方案 B：Zustand 风格 (~30行搞定一切) =====
function createZustand(initFn) {
  let state;
  const listeners = new Set();
  const set = (fnOrVal) => {
    const next = typeof fnOrVal === 'function' ? fnOrVal(state) : fnOrVal;
    if (!Object.is(next, state)) { state = next; listeners.forEach(l => l()); }
  };
  const get = () => state;
  const sub = (l) => { listeners.add(l); return () => listeners.delete(l); };
  state = initFn(set, get);
  
  // Hook：selector 模式
  function useStore(selector = s => s) {
    const [, force] = useState(0);
    React.useEffect(() => { return sub(() => force(n => n + 1)); }, []);
    return selector(get());
  }
  return { get, set, sub, useStore };
}

// 创建两个 store
const reduxStore = createStore(reducer);

const zustandStore = createZustand((set) => ({
  count: 0,
  name: 'guest',
  inc: () => set(s => ({ ...s, count: s.count + 1 })),
  setName: (name) => set(s => ({ ...s, name })),
}));

// ===== 渲染统计 =====
let reduxCountRenders = 0, reduxNameRenders = 0;
let zustandCountRenders = 0, zustandNameRenders = 0;

// ===== Redux 版组件 =====
function ReduxCounter() {
  const store = useContext(Ctx);
  const count = useSyncExternalStore(
    store.subscribe.bind(store),
    () => store.getState().count
  );
  reduxCountRenders++;
  log(`  [ReduxCounter] render #${reduxCountRenders}`);
  return `Redux Count: ${count}`;
}

function ReduxGreeting() {
  const store = useContext(Ctx);
  const name = useSyncExternalStore(
    store.subscribe.bind(store),
    () => store.getState().name
  );
  reduxNameRenders++;
  log(`  [ReduxGreeting] render #${reduxNameRenders}`);
  return `Hello, ${name}!`;
}

// ===== Zustand 版组件 =====
function ZustandCounter() {
  const count = zustandStore.useStore(s => s.count);
  zustandCountRenders++;
  log(`  [ZustandCounter] render #${zustandCountRenders}`);
  return `Zustand Count: ${count}`;
}

function ZustandGreeting() {
  const name = zustandStore.useStore(s => s.name);
  zustandNameRenders++;
  log(`  [ZustandGreeting] render #${zustandNameRenders}`);
  return `Hello, ${name}!`;
}

// ===== 运行对比 =====
async function run() {
  console.log('=== S2: Zustand vs Redux 同功能对比 ===\n');

  const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
  const root = createRoot(dom.window.document.getElementById('root'));

  // Redux 版
  console.log('--- Redux 版 ---');
  root.render(React.createElement(Provider, { store: reduxStore },
    React.createElement(ReduxCounter),
    React.createElement('br'),
    React.createElement(ReduxGreeting)
  ));

  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 30));
    reduxStore.dispatch(inc());
  }
  await new Promise(r => setTimeout(r, 30));
  reduxStore.dispatch(setName('彭环'));
  await new Promise(r => setTimeout(r, 30));

  console.log(`\n[Redux 统计]: Counter=${reduxCountRenders}, Greeting=${reduxNameRenders}`);

  // Zustand 版
  console.log('\n--- Zustand 版 ---');
  root.render(React.createElement('div', null,
    React.createElement(ZustandCounter),
    React.createElement('br'),
    React.createElement(ZustandGreeting)
  ));

  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 30));
    zustandStore.set(s => ({ ...s, count: s.count + 1 }));
  }
  await new Promise(r => setTimeout(r, 30));
  zustandStore.setName('彭环');
  await new Promise(r => setTimeout(r, 30));

  console.log(`\n[Zustand 统计]: Counter=${zustandCountRenders}, Greeting=${zustandNameRenders}`);

  console.log('\n=== S2 结论 ===');
  console.log('[代码量对比]');
  console.log('  Redux 需要:');
  console.log('    - Action Type 常量 (INC, SET_NAME)');
  console.log('    - Action Creator 函数 (inc, setName)');
  console.log('    - Reducer switch-case');
  console.log('    - Provider 组件包裹');
  console.log('    - useContext 获取 store');
  console.log('    → ~40 行代码');
  console.log('');
  console.log('  Zustand 需要:');
  console.log('    - create((set) => ({...})) 一行定义状态+方法');
  console.log('    - useStore(selector) 直接用');
  console.log('    - 不需要 Provider!');
  console.log('    - 不需要 dispatch!');
  console.log('    - 不需要 action type!');
  console.log('    → ~15 行代码');
  console.log('');
  console.log('[功能完全等价，但 Zustand 的心智负担显著更低]');
}

run().catch(console.error);
