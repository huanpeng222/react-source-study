# Day 15 自测（答案折叠，先自己答）

> 主题：状态管理深挖

## Q1
Context 的性能问题根本原因是什么？为什么说"Context value 变了所有消费者都 re-render"？

<details><summary>答案</summary>
**根因**：Context 的更新机制只比较 `value` 引用（`Object.is(prevValue, newValue)`），不做字段级别的 diff。

流程：
1. Provider 收到新 value（引用变了）
2. React 从当前 fiber 向下遍历，找到所有 consumer
3. **不管每个 consumer 实际用了 value 的哪些字段**，只要引用变了 → 全部标记需要更新
4. 所有消费者组件 re-render

所以如果一个大 Context 里包含了 user / theme / cart / locale，cart 变了 → 用到 user 和 theme 的消费者也被迫重渲染。
</details>

## Q2
Zustand 为什么不需要 `<Provider>`？它的 store 存在哪里？

<details><summary>答案</summary>
**Redux**：store 通过 React Context 传递 → 需要 Provider 包裹组件树

**Zustand**：
1. `create(fn)` 在模块级别调用，返回的 `{ getState, set, subscribe }` 存在**模块级闭包变量**里
2. 不经过 React Context，跟组件树无关
3. 组件内部通过 `useSyncExternalStore(store.subscribe, store.getSnapshot)` 订阅
4. 这是 React 18 的新 Hook，专门为外部状态库设计
5. 所以 Zustand 组件可以在任何位置使用，不需要被 Provider 包裹
</details>

## Q3
`createSlice({ name: 'todos', reducers: { addTodo(state, action) {...} } })` 自动生成了什么？

<details><summary>答案</summary>
生成三样东西：

1. **action creators**：`addTodo(payload)` → `{ type: 'todos/addTodo', payload }`
2. **reducer 函数**：用 Immer 包装，允许直接 mutation（`state.push(...)`）
3. **action types**：自动加前缀 `'todos/addTodo'`, `'todos/toggleTodo'` 等

额外还有：`caseReducers` 对象（原始 reducer 映射）、`getInitialState()`、`name`。

对比手写 Redux：不需要手动定义 action type 常量、不需要手写 action creator 函数、不需要 switch-case。
</details>

## Q4
Jotai 的 atom 和 React useState 有什么区别？和 Context 消费者呢？

<details><summary>答案</summary>
| | useState | Context | Jotai atom |
|---|---|---|---|
| 作用域 | 当前组件 | 子树所有 consumer | **全局任意组件** |
| 更新触发 | setState → 组件 re-render | value 变 → **所有 consumer** re-render | atom.set → **只通知该 atom 的订阅者** |
| 粒度 | 组件级 | 整棵子树级 | **单个 atom 级** |
| 派生状态 | useMemo 手写 | 需要额外机制 | **atom(get => ...)** 天然支持 |

关键优势：atom A 变化不会导致只订阅了 atom B 的组件更新。这是 Context 做不到的。
</details>

## Q5
以下代码怎么优化？

```jsx
const AppCtx = createContext();
function App() {
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [items, setItems] = useState([]);
  
  return (
    <AppCtx.Provider value={{ user, theme, items, setUser, setTheme, setItems }}>
      <Header />    {/* 只用到 user + theme */}
      <ItemList />  {/* 只用到 items */}
    </AppCtx.Provider>
  );
}
```

<details><summary>答案</summary>
**问题**：一个 Context 管了太多东西，items 变化导致 Header 无意义重渲染。

**方案 A — 拆分（最简单）**：
```jsx
const UserCtx = createContext(); // { user }
const ThemeCtx = createContext(); // { theme }
const ItemsCtx = createContext(); // { items }
// 各自 Provider，各自消费
```

**方案 B — Zustand 替代（生产推荐）**：
```jsx
const useStore = create(set => ({
  user: null, theme: 'dark', items: [],
  setUser: (u) => set(s => ({...s, user: u})),
}));
// Header: const user = useStore(s => s.user); ← 只订阅 user
// ItemList: const items = useStore(s => s.items); ← 只订阅 items
```

**方案 C — useMemo 稳定 value（治标）**：
```jsx
const value = useMemo(() => ({ user, theme, items }), [user, theme, items]);
// 但这只解决了"引用稳定性"问题，字段级粒度问题仍在
```
</details>

## Q6（综合题）
从零实现一个简化版 Zustand create 函数（核心功能即可：set/getState/subscribe/useStore Hook）。

<details><summary>参考实现</summary>
```js
// 简化版 Zustand (~30 行)
function create(createState) {
  let state;
  const listeners = new Set();

  const setState = (partial, replace) => {
    const nextState = typeof partial === 'function' ? partial(state) : partial;
    if (!Object.is(nextState, state)) {
      const prev = state;
      state = replace ? nextState : Object.assign({}, state, nextState);
      listeners.forEach(l => l(state, prev));
    }
  };

  const getState = () => state;
  const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
  state = createState(setState, getState);

  // React Hook
  const useStore = (selector = s => s) => {
    return useSyncExternalStore(subscribe, () => selector(state));
  };

  return { getState, setState, subscribe, useStore };
}

// 使用
const useCountStore = create((set) => ({
  count: 0,
  inc: () => set(s => ({ count: s.count + 1 })),
}));

function Counter() {
  const count = useCountStore(s => s.count);
  const inc = useCountStore(s => s.inc);
  return <button onClick={inc}>{count}</button>;
}
```

核心就三个函数：`setState`（更新+通知）、`getState`（同步读）、`subscribe`（订阅变化）。Hook 层只需包一层 `useSyncExternalStore`。
</details>
