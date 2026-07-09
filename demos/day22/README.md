# Day 22 实验：自研 mini-store

> 代码贴进 Vite + React playground（浏览器里跑），验证手写的 mini-store 是否真的具备 selector 细粒度订阅和批量更新去重的能力。

## 环境准备

```bash
cd demos/day22
npm create vite@latest playground -- --template react
cd playground
npm install
npm run dev
```

创建 `src/store.js`（完整版 mini-store，注意 `setState` 末尾必须调用 `notify()`，这是跟练时踩过的坑）：

```js
export function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  let isNotifyScheduled = false;

  function getState() { return state; }

  function notify() { listeners.forEach(listener => listener()); }

  function setState(partial) {
    const nextState = typeof partial === 'function' ? partial(state) : partial;
    if (Object.is(nextState, state)) return;
    state = { ...state, ...nextState };

    // ⚠️ 关键：改完 state 之后必须调用 notify()，否则订阅者永远不知道数据变了
    if (!isNotifyScheduled) {
      isNotifyScheduled = true;
      queueMicrotask(() => {
        isNotifyScheduled = false;
        notify();
      });
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}
```

创建 `src/useStore.js`：

```js
import { useSyncExternalStore } from 'react';

export function useStore(store, selector = (s) => s) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
```

---

## 实验 M1：selector 细粒度订阅是否真的生效

```jsx
import { createStore } from './store.js';
import { useStore } from './useStore.js';

const store = createStore({ count: 0, name: 'guest' });

let countRenders = 0;
function CountDisplay() {
  countRenders++;
  const count = useStore(store, s => s.count);
  console.log(`[CountDisplay] 第 ${countRenders} 次渲染, count=${count}`);
  return <p>Count: {count} (renders: {countRenders})</p>;
}

let nameRenders = 0;
function NameDisplay() {
  nameRenders++;
  const name = useStore(store, s => s.name);
  console.log(`[NameDisplay] 第 ${nameRenders} 次渲染, name=${name}`);
  return <p>Name: {name} (renders: {nameRenders})</p>;
}

export default function App() {
  return (
    <div style={{ padding: 20 }}>
      <CountDisplay />
      <NameDisplay />
      <button onClick={() => store.setState(s => ({ count: s.count + 1 }))}>改 count</button>
      <button onClick={() => store.setState(s => ({ name: s.name + '!' }))}>改 name</button>
    </div>
  );
}
```

**操作步骤**：点击"改 count"几次，观察 Console：`CountDisplay` 是否跟着渲染，`NameDisplay` 是否**没有**跟着渲染（虽然它也订阅了同一个 store，但 selector 算出来的 `name` 没变）。再点"改 name"，反过来验证一次。

**记录到 observations.md**：改 count 时 NameDisplay 是否真的没有重渲染？改 name 时 CountDisplay 是否也没重渲染？

---

## 实验 M2：批量更新去重是否生效

```jsx
import { createStore } from './store.js';
import { useStore } from './useStore.js';

const store = createStore({ a: 0, b: 0, c: 0 });

let notifyCount = 0;
store.subscribe(() => {
  notifyCount++;
  console.log(`[通知] 第 ${notifyCount} 次收到通知`);
});

function App() {
  const { a, b, c } = useStore(store);

  function handleClick() {
    console.log('===== 点击：同步连续调用3次setState =====');
    notifyCount = 0;
    store.setState(s => ({ a: s.a + 1 }));
    store.setState(s => ({ b: s.b + 1 }));
    store.setState(s => ({ c: s.c + 1 }));
    console.log('===== 3次setState调用完毕（此刻notify还没执行，是微任务）=====');
  }

  return (
    <div style={{ padding: 20 }}>
      <p>a={a}, b={b}, c={c}</p>
      <button onClick={handleClick}>同步连续 setState 3 次</button>
    </div>
  );
}

export default App;
```

**操作步骤**：点击按钮，观察 Console 输出的顺序和"收到通知"的总次数。

**记录到 observations.md**：3 次 `setState` 是否只触发了 1 次"收到通知"日志？"3次setState调用完毕"这行日志和"收到通知"日志的先后顺序是什么（能否验证 notify 是在同步代码跑完之后才执行的）？

---

## 一句话收束

| 实验 | 要观察的现象 | 对应机制 |
|---|---|---|
| M1 | 改 count 时 NameDisplay 不重渲染，反之亦然 | `useSyncExternalStore` 内置的 `Object.is` 比较新旧快照 |
| M2 | 3次同步 setState 只触发 1 次 notify，且在同步代码跑完之后才执行 | `queueMicrotask` 做批量去重 |

---

## 完成后

```bash
git add demos/day22 notes/day22.md
git commit -m "阶段A D22 自研mini-store：完成浏览器实验(selector细粒度订阅验证/批量更新去重验证)"
git push
```
