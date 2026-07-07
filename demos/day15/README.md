# Day 15 实验：状态管理库源码对比（Context 陷阱 / Zustand / Jotai）

> 代码贴进 Vite + React playground（浏览器里跑），配合 Console 观察渲染次数。

## 环境准备

```bash
cd demos/day15
npm create vite@latest playground -- --template react
cd playground
npm install
npm install zustand jotai
npm run dev
```

---

## 实验 S1：Context 性能陷阱 + 两种修复对比

```jsx
import { useState, useContext, useMemo, createContext, useEffect } from 'react';

// ===== 反模式：一个大 Context 管所有状态 =====
const BigCtx = createContext(null);
let headerRenders = 0, listRenders = 0;

function BadHeader() {
  const ctx = useContext(BigCtx);
  headerRenders++;
  console.log(`[BadHeader] 第 ${headerRenders} 次渲染 (只用 user/theme，但 items 变也被拖累!)`);
  return <div>Header: {ctx.user.name} ({ctx.theme})</div>;
}

function BadList() {
  const ctx = useContext(BigCtx);
  listRenders++;
  console.log(`[BadList] 第 ${listRenders} 次渲染`);
  return <div>List: {ctx.items.length} items</div>;
}

function BadApp() {
  const [user] = useState({ name: '用户A' });
  const [theme] = useState('dark');
  const [items, setItems] = useState([1, 2]);
  const value = useMemo(() => ({ user, theme, items }), [user, theme, items]);

  return (
    <BigCtx.Provider value={value}>
      <button onClick={() => setItems(p => [...p, p.length + 1])}>改 items（和 Header 无关）</button>
      <BadHeader />
      <BadList />
    </BigCtx.Provider>
  );
}

// ===== 修复方案：拆分 Context =====
const UserCtx = createContext(null);
const ItemsCtx = createContext(null);
let splitHeaderRenders = 0, splitListRenders = 0;

function SplitHeader() {
  const { user, theme } = useContext(UserCtx);
  splitHeaderRenders++;
  console.log(`[SplitHeader] 第 ${splitHeaderRenders} 次渲染 (只订阅 UserCtx)`);
  return <div>Header: {user.name} ({theme})</div>;
}

function SplitList() {
  const items = useContext(ItemsCtx);
  splitListRenders++;
  console.log(`[SplitList] 第 ${splitListRenders} 次渲染 (只订阅 ItemsCtx)`);
  return <div>List: {items.length} items</div>;
}

function SplitApp() {
  const [user] = useState({ name: '用户A' });
  const [theme] = useState('dark');
  const [items, setItems] = useState([1, 2]);

  return (
    <UserCtx.Provider value={{ user, theme }}>
      <ItemsCtx.Provider value={items}>
        <button onClick={() => setItems(p => [...p, p.length + 1])}>改 items</button>
        <SplitHeader />
        <SplitList />
      </ItemsCtx.Provider>
    </UserCtx.Provider>
  );
}

export default function App() {
  const [tab, setTab] = useState('bad');
  return (
    <div style={{ padding: 20 }}>
      <button onClick={() => setTab('bad')}>反模式（大 Context）</button>
      <button onClick={() => setTab('split')}>修复（拆分 Context）</button>
      <hr />
      {tab === 'bad' ? <BadApp /> : <SplitApp />}
    </div>
  );
}
```

**操作步骤**：
1. 切到"反模式"标签，多次点击"改 items"按钮，观察 Console：`BadHeader` 是否也跟着重渲染（尽管它只用 user/theme）。
2. 切到"修复"标签，多次点击"改 items"，观察 `SplitHeader` 是否**不再**跟着渲染，只有 `SplitList` 渲染。

**记录到 observations.md**：反模式下 Header 是否被无关的 items 更新拖累？拆分后是否真的隔离了？

---

## 实验 S2：Zustand vs 手写 Redux 同功能对比

```jsx
import { useState, useSyncExternalStore, useContext, createContext } from 'react';
import { create } from 'zustand';

// ===== 手写简化版 Redux（体会样板代码量）=====
const INC = 'counter/inc';
const SET_NAME = 'user/setName';
const inc = () => ({ type: INC });
const setNameAction = (name) => ({ type: SET_NAME, payload: name });

function reducer(state = { count: 0, name: 'guest' }, action) {
  switch (action.type) {
    case INC: return { ...state, count: state.count + 1 };
    case SET_NAME: return { ...state, name: action.payload };
    default: return state;
  }
}

function createStore(rdc) {
  let state = rdc(undefined, {});
  const listeners = new Set();
  return {
    getState: () => state,
    dispatch(action) { state = rdc(state, action); listeners.forEach(l => l()); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

const reduxStore = createStore(reducer);
const ReduxCtx = createContext(reduxStore);

function ReduxCounter() {
  const store = useContext(ReduxCtx);
  const count = useSyncExternalStore(store.subscribe.bind(store), () => store.getState().count);
  console.log('[ReduxCounter] render, count=', count);
  return (
    <div>
      Redux Count: {count}
      <button onClick={() => store.dispatch(inc())}>+1</button>
    </div>
  );
}

// ===== 真实 Zustand（~10 行定义 store）=====
const useZustandStore = create((set) => ({
  count: 0,
  name: 'guest',
  inc: () => set(s => ({ count: s.count + 1 })),
}));

function ZustandCounter() {
  const count = useZustandStore(s => s.count); // selector：只订阅 count
  const inc = useZustandStore(s => s.inc);
  console.log('[ZustandCounter] render, count=', count);
  return (
    <div>
      Zustand Count: {count}
      <button onClick={inc}>+1</button>
    </div>
  );
}

export default function App() {
  return (
    <div style={{ padding: 20 }}>
      <h3>Redux 风格（需要 action type + reducer + Provider + useSyncExternalStore）</h3>
      <ReduxCounter />
      <h3>Zustand（不需要 Provider，不需要 dispatch，不需要 action type）</h3>
      <ZustandCounter />
    </div>
  );
}
```

**操作步骤**：分别点两个"+1"按钮，对比两种方案实现同一个计数器所需的代码量和心智负担。

**记录到 observations.md**：两者功能是否完全等价？Zustand 版本是否真的不需要 Provider 包裹？

---

## 实验 S3：Jotai 原子派生 + 细粒度订阅

```jsx
import { atom, useAtom } from 'jotai';

const countAtom = atom(0);
const textAtom = atom('hello');
const doubleCountAtom = atom((get) => get(countAtom) * 2); // 派生 atom
const greetingAtom = atom((get) => `${get(textAtom)}, count=${get(countAtom)}!`); // 依赖两个 atom

function Counter() {
  const [count, setCount] = useAtom(countAtom);
  console.log('[Counter] render, count=', count);
  return <div>Count: {count} <button onClick={() => setCount(c => c + 1)}>+1</button></div>;
}

function Doubler() {
  const [double] = useAtom(doubleCountAtom);
  console.log('[Doubler] render, double=', double); // 应该跟着 count 变
  return <div>Double: {double}</div>;
}

function Greeter() {
  const [greeting] = useAtom(greetingAtom);
  console.log('[Greeter] render, greeting=', greeting);
  return <div>Greeting: {greeting}</div>;
}

function TextInput() {
  const [text, setText] = useAtom(textAtom);
  console.log('[TextInput] render'); // 只应该在 text 变时渲染，不受 count 影响
  return <input value={text} onChange={e => setText(e.target.value)} />;
}

export default function App() {
  return (
    <div style={{ padding: 20 }}>
      <Counter />
      <Doubler />
      <Greeter />
      <TextInput />
    </div>
  );
}
```

**操作步骤**：
1. 点几次 Counter 的"+1"，观察 `TextInput` 的 Console 日志是否**没有**跟着打印（它只订阅 textAtom，不受 countAtom 影响）。
2. 在输入框里打字，观察 `Counter`/`Doubler` 是否**没有**跟着渲染，只有 `Greeter`（依赖 textAtom）跟着渲染。

**记录到 observations.md**：`TextInput` 是否真的不受 count 变化影响？`Counter`/`Doubler` 是否真的不受 text 变化影响？只有 `Greeter` 两边都订阅了吗？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| S1 | 大 Context 拖累无关消费者，拆分后隔离 | Context value 变化触发所有消费者重渲染，无字段级精度 |
| S2 | Zustand 用 selector 实现字段级订阅，无 Provider/dispatch | 基于 useSyncExternalStore 的外部 store |
| S3 | Jotai 原子级订阅，互不干扰，派生 atom 自动追踪依赖 | 每个 atom 独立通知，不经过 Context 树 |

---

## 完成后

```bash
git add demos/day15 notes/day15.md
git commit -m "W4 D15 状态管理对比：完成浏览器实验(Context陷阱拆分/真实Zustand/真实Jotai原子粒度)"
git push
```
