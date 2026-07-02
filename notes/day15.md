# Day 15 笔记：状态管理深挖

> 日期：2026-07-02
> 主题：Redux Toolkit 源码级 / Zustand vs Redux / Context 性能陷阱 / Jotai 原理 / Signals
> 状态：📖 学习中
> 源码出处：
> - `@reduxjs/toolkit` createSlice / createAsyncThunk 源码
> - `zustand` 核心 createStore 实现
> - React useSyncExternalStore 源码（`ReactFiberHooks.js`）
> - `jotai` atom / useAtom 原理

---

## 零、入场自测（先答，不会就写"不会"）

1. 你用过的状态管理方案有哪些？各自解决什么问题？
2. Redux Toolkit 的 `createSlice` 内部怎么生成 reducer 和 action creators？
3. Context 的性能问题到底在哪？为什么说"Context value 变了所有消费者都 re-render"？怎么避免？
4. Zustand 和 Redux 的核心架构区别是什么？为什么 Zustand 不需要 Provider？
5. 你听说过 Jotai 或 Signals 吗？它们和 Context/Redux 的根本区别是什么？

---

## 一、状态管理全景图

先建立全局认知，再逐个深挖：

```
┌─────────────────────────────────────────────────────┐
│                状态管理方案分类                       │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Context   │  │  Redux   │  │    原子式          │   │
│  │ (React内置)│  │  / RTK  │  │  Jotai / Signals │   │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │              │                   │            │
│  组件级共享     集中式单向数据流      细粒度响应      │
│  适合简单场景   适合大型应用        按需订阅         │
│  ⚠️ 性能陷阱    ⚠️ 样板代码多       ✅ 自动优化       │
└─────────────────────────────────────────────────────┘
```

---

## 二、Context 的性能陷阱（最重要的一节）

### 2.1 为什么 "Context value 变了 → 所有消费者 re-render"？

这是面试最高频的状态管理题。

```jsx
// ❌ 反面教材：一个 Context 管太多东西
const AppContext = createContext({
  user: null,
  theme: 'dark',
  locale: 'zh',
  notifications: [],
  cart: { items: [], total: 0 },
});

function App() {
  const [user, setUser] = useState(null);
  const [cart, setCart] = useState({ items: [], total: 0 });
  
  // ⚠️ 每次 render 都创建新对象！即使只有 cart 变了
  const value = { user, theme: 'dark', locale: 'zh', notifications: [], cart };
  
  return (
    <AppContext.Provider value={value}>
      <Header />       {/* 只用到 user + theme */}
      <CartPanel />     {/* 只用到 cart */}
      <Footer />        {/* 只用到 locale */}
    </AppContext.Provider>
  );
}
```

**当 `cart.items.push(...)` 触发更新时：**
- `value` 是全新对象 → Provider 检测到变化
- **所有消费者都 re-render**：Header、CartPanel、Footer 全部重渲染
- Header 只用了 `user` 和 `theme`，跟 cart 没关系，但**照样重渲染**

这就是 **"不相关状态变化导致无关组件重渲染"**。

### 2.2 底层原理

Context 的比较机制非常原始——**只比较 value 引用**：

```js
// ReactFiberNewContext.js（简化）
function propagateContextChange(workInProgress, context, newValue) {
  // 遍历当前 fiber 下所有 consumer
  let fiber = workInProgress.child;
  while (fiber) {
    if (isContextConsumer(fiber)) {
      // 不管这个 consumer 用了 context 的哪些字段
      // 只要 value 引用变了 → 标记需要更新
      markWorkInProgressReceivedUpdate();
    }
    fiber = fiber.sibling;
  }
}
```

**关键点：Context 不做字段级别的 diff！** 它是全有或全无的。

### 2.3 四种解决方案

#### 方案 A：拆分 Context（最常用）

```jsx
// ✅ 一个关注点一个 Context
const UserContext = createContext(null);
const ThemeContext = createContext('dark');
const CartContext = createContext({ items: [], total: 0 });

// cart 变化 → 只有 CartPanel 重渲染
// Header 不受影响
```

**优点**：简单直接，零依赖。
**缺点**：Context 多了嵌套地狱 `<A><B><C><D>...`。

#### 方案 B：selector 模式（手写优化）

```jsx
// ✅ 自定义 Hook + useMemo 做选择器
function useCartSelector(selector) {
  const ctx = useContext(CartContext);
  return useMemo(() => selector(ctx), [ctx, selector]);
}

// 使用
const total = useCartSelector(cart => cart.total);
const items = useCartSelector(cart => cart.items);
```

**问题**：selector 函数本身每次 render 也是新引用 → 还得包 `useCallback`。越来越复杂。

#### 方案 C：useSyncExternalStore + 外部 Store

React 18 新增的原生 Hook，专门为外部状态库设计：

```jsx
import { useSyncExternalStore } from 'react';

const store = {
  state: { count: 0, name: 'test' },
  listeners: new Set(),
  
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener); // 取消订阅
  },
  
  getSnapshot() {
    return this.state; // 返回当前快照
  },
  
  dispatch(action) {
    this.state = reducer(this.state, action);
    this.listeners.forEach(l => l()); // 通知所有订阅者
  }
};

function Counter() {
  // ✅ 只有 store.state 引用变了才触发 re-render
  const state = useSyncExternalStore(
    store.subscribe.bind(store),   // 订阅函数
    store.getSnapshot.bind(store), // 获取快照
  );
  return <div>{state.count}</div>;
}
```

**核心优势**：React 能精确知道"哪个组件订阅了什么"，实现**组件级精准更新**。

#### 方案 D：用 Zustand/Jotai 替代（推荐）

后面详讲。

### 2.4 Context 性能总结

| 方案 | 粒度 | 复杂度 | 推荐场景 |
|---|---|---|---|
| 单一 Context | 粗（全部消费者） | 低 | 小应用、状态少 |
| 拆分多个 Context | 中（按域隔离） | 中 | 中等应用 |
| selector 手写优化 | 细（按字段） | 高 | 大型应用但不想引入新库 |
| useSyncExternalStore | 组件级精准 | 中 | 自研 store / Zustand 内部原理 |
| Zustand / Jotai | 原子级精准 | 低（API简洁） | **生产环境推荐** |

---

## 三、Redux Toolkit 源码级讲解

### 3.1 从手写 Redux 到 Toolkit：解决了什么痛点？

**传统 Redux 的样板代码：**

```jsx
// ❌ 动作类型定义
const ADD_TODO = 'todos/addTodo';
const TOGGLE_TODO = 'todos/toggleTodo';
const DELETE_TODO = 'todos/deleteTodo';

// ❌ Action Creator（每个都要手动写）
const addTodo = text => ({ type: ADD_TODO, payload: { text, id: nanoid() } });

// ❌ Reducer（switch-case 越来越长）
function todosReducer(state = initialState, action) {
  switch (action.type) {
    case ADD_TODO:
      return [...state, { id: action.payload.id, text: action.payload.text, completed: false }];
    case TOGGLE_TODO:
      return state.map(t => t.id === action.payload ? { ...t, completed: !t.completed } : t);
    case DELETE_TODO:
      return state.filter(t => t.id !== action.payload);
    default:
      return state;
  }
}
```

**7 个手动步骤**，每个 slice 都要重复一遍。

### 3.2 createSlice 怎么自动生成的？

RTK 的 `createSlice` 是核心 API，它一次性解决上述所有痛点：

```jsx
import { createSlice } from '@reduxjs/toolkit';

const todoSlice = createSlice({
  name: 'todos',                    // ← 自动生成 action type 前缀
  initialState: [
    { id: 1, text: '学习 React 源码', completed: false }
  ],
  reducers: {
    // ← 每个 key 自动变成 action creator + case 分支
    addTodo: (state, action) => {
      // ✅ 可以直接 mutation！（内部用 Immer 处理）
      state.push({ id: Date.now(), text: action.payload, completed: false });
    },
    
    toggleTodo: (state, action) => {
      const todo = state.find(t => t.id === action.payload);
      if (todo) todo.completed = !todo.completed;
    },

    deleteTodo: (state, action) => {
      return state.filter(t => t.id !== action.payload); // 返回新引用也行
    },
    
    // prepare: 自定义 payload 构造
    addTodoWithId: {
      reducer(state, action) {
        state.push(action.payload);
      },
      prepare(text, priority) {  // ← action creator 接收自定义参数
        return { payload: { id: nanoid(), text, priority } }; // → 最终传给 reducer
      },
    },
  },
});

// ===== 自动生成的内容 =====
console.log(todoSlice.actions);
// {
//   addTodo: (text) => ({ type: 'todos/addTodo', payload: text }),
//   toggleTodo: (id) => ({ type: 'todos/toggleTodo', payload: id }),
//   deleteTodo: (id) => ({ type: 'todos/deleteTodo', payload: id }),
//   addTodoWithId: (text, priority) => ({ type: 'todos/addTodoWithId', payload: { id, text, priority } }),
// }

console.log(todoSlice.caseReducers);
// { addTodo: fn, toggleTodo: fn, deleteTodo: fn, addTodoWithId: fn }

export default todoSlice.reducer;
export const { addTodo, toggleTodo, deleteTodo, addTodoWithId } = todoSlice.actions;
```

### 3.3 createSlice 源码级原理（简化）

```js
// @reduxjs/toolkit/src/createSlice.ts（概念性伪代码）

function createSlice(options) {
  const { name, initialState, reducers } = options;

  // 1. 从 reducers 对象生成 action creators
  const actionCreators = {};
  const caseReducers = {};

  for (const [reducerName, reducerFn] of Object.entries(reducers)) {
    if (typeof reducerFn === 'object') {
      // 带 prepare 的情况
      const { reducer, prepare } = reducerFn;
      actionCreators[reducerName] = (...args) => ({
        type: `${name}/${reducerName}`,
        payload: prepare(...args).payload,
      });
      caseReducers[reducerName] = reducer;
    } else {
      // 普通 reducer
      actionCreators[reducerName] = (payload) => ({
        type: `${name}/${reducerName}`,
        payload,  // 直接作为 payload
      });
      caseReducers[reducerName] = reducerFn;
    }
  }

  // 2. 生成 reducer（用 Immer 包裹，允许 direct mutation）
  function slicedReducer(state = initialState, action) {
    // 如果匹配当前 slice 的 action type
    if (action.type.startsWith(`${name}/`)) {
      const caseName = action.type.slice(name.length + 1); // 去掉前缀 "todos/"
      if (caseReducers[caseName]) {
        // 用 immer.produce 包装 → 允许直接修改 state
        return produce(state, draft => caseReducers[caseName](draft, action));
      }
    }
    return state; // 不是我的 action → 原样返回
  }

  return {
    name,
    reducer: slicedReducer,
    actions: actionCreators,
    caseReducers,
    getInitialState: () => initialState,
  };
}
```

### 3.4 createAsyncThunk：异步标准写法

```jsx
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// ① 定义 async thunk
const fetchUserById = createAsyncThunk(
  'users/fetchById',           // type prefix
  async (userId) => {          // payload creator
    const res = await fetch(`/api/users/${userId}`);
    if (!res.ok) throw new Error('获取失败');
    return await res.json();   // 返回值成为 fulfilled action 的 payload
  }
);

// ② 在 slice 里处理生命周期
const usersSlice = createSlice({
  name: 'users',
  initialState: { byId: {}, status: 'idle' },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchUserById.pending, (state) => {
        state.status = 'loading';     // pending
      })
      .addCase(fetchUserById.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.byId[action.payload.id] = action.payload;  // fulfilled
      })
      .addCase(fetchUserById.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.error.message;  // rejected
      });
  },
});
```

**自动生成 3 个 action types：**
- `users/fetchById/pending`
- `users/fetchById/fulfilled`
- `users/fetchById/rejected`

不需要手写任何 thunk middleware 配置 —— RTK 默认自带。

---

## 四、Zustand vs Redux：架构级对比

### 4.1 核心区别一览

| 维度 | Redux | Zustand |
|---|---|---|
| **Store 结构** | 单一棵大树 + combineReducers | 扁平或嵌套随意，无强制结构 |
| **Provider** | **必须** `<Provider store={store}>` | **不需要** |
| **更新机制** | dispatch(action) → reducer 计算新状态 | `set(fn)` 直接写，内部自动 merge |
| **订阅粒度** | 需要 selector + connect/useSelector | `useStore(s => s.field)` 原生细粒度 |
| **DevTools** | Redux DevTools（成熟） | 有中间件支持但略逊 |
| **Bundle 大小** | ~7kb (redux + react-redux) | **~200b**（不含 devtools） |
| **中间件** | 强制架构（dispatch 改造） | 可选插件 |
| **异步** | thunk/saga/observable 需额外配置 | **原生支持**（set 里直接 async） |

### 4.2 为什么 Zustand 不需要 Provider？

**Redux 需要 Provider 的原因**：React 的 context 机制要求在组件树顶层注入 store，子组件通过 `useContext` 获取。

**Zustand 不需要的原理**：它**不在 React 组件树里传递数据**。

```js
// Zustand 核心源码（极度简化）
const stores = new Map(); // 模块级变量，不在组件树里！

function create(createState) {
  let state;
  const listeners = new Set();

  // setState 函数
  const set = (partial, replace) => {
    const nextState = typeof partial === 'function'
      ? partial(state)
      : partial;
    
    if (!Object.is(nextState, state)) {
      const prevState = state;
      state = replace ? nextState : { ...state, ...nextState };
      listeners.forEach(l => l(state, prevState)); // 通知所有监听者
    }
  };

  // getState（同步读取，不在 React 生命周期内）
  const getState = () => state;

  // subscribe（外部可独立订阅，不一定在组件里）
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  // 初始化
  state = createState(set, getState, {});

  return { getState, set, subscribe }; // ← 纯 JS 对象，跟 React 无关！
}
```

```jsx
// 使用：store 在模块级别创建，不在任何组件内
const useStore = create((set) => ({
  count: 0,
  inc: () => set(s => ({ count: s.count + 1 })),
}));

// 组件内使用（通过闭包访问模块级 store）
function Counter() {
  // useSyncExternalStore 原理：订阅 store 变化 → 仅当返回值变了才 re-render
  const count = useStore(s => s.count);  // ← 只订阅 count 字段！
  return <button onClick={useStore(s => s.inc)}>{count}</button>;
}
```

**核心差异**：
- Redux：store 通过 **React Context** 传递 → 需要 Provider
- Zustand：store 存在 **模块级闭包** → 组件通过 `useSyncExternalStore`（React 18）或自定义 Hook 订阅 → 不需要 Provider

### 4.3 Zustand vs Redux 代码对比

**同一个计数器功能：**

```jsx
// ========== Redux + RTK（~30 行配置）==========
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { Provider, useDispatch, useSelector } from 'react-redux';

const counterSlice = createSlice({
  name: 'counter',
  initialState: { count: 0 },
  reducers: {
    increment: s => { s.count += 1 },
  },
});

const store = configureStore({ reducer: counterSlice.reducer });

function App() {
  return (
    <Provider store={store}>
      <Counter />
    </Provider>
  );
}

function Counter() {
  const count = useSelector(s => s.count);
  const dispatch = useDispatch();
  return <button onClick={() => dispatch(counterSlice.actions.increment())}>{count}</button>;
}

// ========== Zustand（~10 行）==========
import { create } from 'zustand';

const useStore = create(set => ({
  count: 0,
  increment: () => set(s => ({ count: s.count + 1 })),
}));

function Counter() {
  const count = useStore(s => s.count);
  const increment = useStore(s => s.increment);
  return <button onClick={increment}>{count}</button>;
}

// 不需要 Provider! 不需要 dispatch! 不需要 action type!
```

### 4.4 Zustand 的最佳实践

```jsx
// ✅ 推荐：按域拆分 store
const useAuthStore = create((set) => ({
  user: null,
  token: null,
  login: async (credentials) => {
    const res = await authApi.login(credentials);
    set({ user: res.user, token: res.token });
  },
  logout: () => set({ user: null, token: null }),
}));

const useCartStore = create((set) => ({
  items: [],
  addItem: (item) => set(s => ({ items: [...s.items, item] })),
  clearCart: () => set({ items: [] }),
}));

// 组件里各取所需
function Header() {
  const user = useAuthStore(s => s.user);       // 只订阅 user
  return <div>Hello, {user?.name}</div>;       // cart 变化不影响这里
}

function Cart() {
  const items = useCartStore(s => s.items);     // 只订阅 items
  const clear = useCartStore(s => s.clearCart);
  return <div onClick={clear}>{items.length} items</div>;
}
```

**注意**：每个 store 独立订阅，**天然没有 Context 的性能陷阱**。cart 变了不会导致 Header 重渲染。

---

## 五、Jotai：原子化状态管理

### 5.1 核心思想：从"大树"到"原子"

```
Redux/Zustand:  一棵大树 → 选出部分树枝（selector）→ 可能还是太粗
Context:       一棵树 → 整棵树变 → 所有消费者受影响
Jotai:        无数个独立的"原子(atom)" → 组件只订阅它关心的原子 → 最细粒度
```

### 5.2 基本用法

```jsx
import { atom, useAtom } from 'jotai';

// ① 创建原子（独立的状态单元）
const countAtom = atom(0);
const textAtom = atom('hello');
const isEvenAtom = atom((get) => get(countAtom) % 2 === 0); // 派生原子（computed）

// ② 组件里使用
function Counter() {
  const [count, setCount] = useAtom(countAtom);  // 类似 useState
  // ↑ 只有 countAtom 变化时此组件 re-render
  
  return (
    <div>
      <p>count: {count}, even: <IsEven /></p>
      <button onClick={() => setCount(c => c + 1)}>+1</button>
    </div>
  );
}

function IsEven() {
  const [isEven] = useAtom(isEvenAtom);  // ← 派生原子，只在 count 变偶/奇时更新
  return <span>{isEven ? '偶数' : '奇数'}</span>;
}
```

### 5.3 Jotai 为什么能实现最细粒度更新？

```js
// Jotai 核心原理（简化）
class Atom {
  constructor(initialValue) {
    this.value = initialValue;
    this.listeners = new Set();  // 只关心这个原子的组件
  }
  
  subscribe(listener) {
    this.listeners.add(listener);
  }
  
  set(newValue) {
    this.value = newValue;
    this.listeners.forEach(l => l(newValue)); // 只通知订阅了这个原子的组件！
  }
}

// 派生原子（computed）
class DerivedAtom extends Atom {
  constructor(depsFn) {
    super();
    this.depsFn = depsFn;
    this.dependencies = []; // 它依赖的其他原子
  }
  
  get() {
    return this.depsFn(dep => dep.get()); // 递归取值
  }
}
```

**关键区别于 Context**：
- Context：一个 value 变 → 所有消费者检查是否需要更新
- Jotai：atom A 变 → **只通知订阅了 atom A 的组件**

### 5.4 Jotai vs Context vs Zustand 对比

| 场景 | Context | Zustand | Jotai |
|---|---|---|---|
| 简单布尔切换 | ✅ 够用 | ✅ 过重 | ✅ 够用 |
| 多组件共享复杂对象 | ⚠️ 性能陷阱 | ✅ 推荐 | ✅ 推荐 |
| 派生状态(computed) | ❌ 要手写 useMemo | ✅ selector | **✅ 天然支持** |
| 组件外读取状态 | ❌ 不能（只能在组件/Hook内） | ✅ `getState()` | ✅ `get(atom)` |
| 更新粒度 | 整棵树 | 按 selector | **按单个 atom** |
| Bundle | 0 | ~200b | ~6kb |

---

## 六、Signals：未来的方向？

### 6.1 什么是 Signal？

Signal 是一种正在被前端框架广泛采用的状态原语（Vue 3.4/Preact/Angular/Solid 都已实现）：

```jsx
// SolidJS 风格（假设语法）
const count = signal(0);

function Counter() {
  // 不需要 .value！编译器自动追踪
  return <button onClick={() => count(c => c + 1)}>{count()}</button>;
  //                                        ^^^^^^^^
  // 只有这行读到了 count → 这个 DOM 节点才会被更新
  // 其他部分完全不受影响！比 Jotai 还细（DOM 节点级）
}
```

### 6.2 Signal vs React State

| 维度 | React State | Signal |
|---|---|---|
| 更新粒度 | **组件级**（setState → 整个组件 re-render） | **节点/表达式级**（只更新读到的地方） |
| 依赖追踪 | **手动**（useMemo/useEffect/deps 数组） | **自动**（运行时自动收集谁读了谁写了） |
| 框架绑定 | React 专属 | **跨框架**（Preact/Solid/Vue/Angular 共识） |
| 成熟度 | 生产验证多年 | 快速成熟中 |

### 6.3 React 会支持 Signal 吗？

目前 React 团队对 Signal 持谨慎态度，主要顾虑：
1. 与现有 mental model 差异太大
2. Compiler（React Compiler）已经在做类似的事（自动 memoization）
3. 但社区实验版 `@preact/signals-react` 已存在

**短期建议**：继续用 Zustand/Jotai，关注 React Compiler 进展。Signal 是趋势但不是现在必须掌握的。

---

## 七、五者关系全景图与选择指南

```
┌──────────────────────────────────────────────────────┐
│                  如何选状态管理？                      │
│                                                      │
│  项目规模 / 团队大小                                  │
│       │                                              │
│       ▼                                              │
│  ┌─────────────┬──────────────┬─────────────────┐    │
│  │ 小型/个人    │ 中型团队       │ 大型企业         │    │
│  │             │               │                 │    │
│  │ Context     │ Zustand       │ Redux Toolkit   │    │
│  │ 或 Jotai     │ + Jotai 按需   │ + TS 严格模式    │    │
│  └─────────────┴──────────────┴─────────────────┘    │
│                                                      │
│  特殊需求：                                           │
│  ├─ 派生状态多 → Jotai                                │
│  ├─ 需要时间旅行调试 → Redux DevTools                  │
│  ├─ SSR/SSG 兼容 → Zustand (useSyncExternalStore)    │
│  └─ 最小 bundle → Zustand (~200b)                     │
└──────────────────────────────────────────────────────┘
```

---

## 八、动手实验

详见 `demos/day15/README.md`，3 个实验：

| 实验 | 内容 | 验证什么 |
|---|---|---|
| S1 | Context 性能陷阱演示 + 三种修复 | 拆分 / selector / zustand替代 各自效果 |
| S2 | Zustand vs Redux 同功能对比 | 代码量 / bundle / 订阅精度 |
| S3 | Jotai 原子派生 + 粒度验证 | 派生 atom 的独立更新 |

---

## 九、验收清单

- [ ] 能解释 Context 性能陷阱的根本原因（value 引用比较，无字段级 diff）
- [ ] 能写出至少 3 种 Context 性能优化方案并说明优劣
- [ ] 能说出 createSlice 自动生成了什么（actionCreators + reducer + type prefix）
- [ ] 能解释 Zustand 不需要 Provider 的原理（模块级闭包 vs React Context）
- [ ] 能写出 Zustand 的 create 函数简化实现（set/getState/subscribe）
- [ ] 能比较 Jotai atom 和 Context Consumer 的更新粒度差异
- [ ] 能根据项目规模给出状态管理方案选择理由
- [ ] 完成 3 个实验

---

## 十、Day 16 预告

**主题**：手写 mini-store（从零实现一个类 Zustand 的状态管理库）

**预告问题：**
1. `useSyncExternalStore` 的两个必需参数是什么？getSnapshot 为什么必须是同步的？
2. 怎么实现 selector 的相等性比较（避免每次返回新对象导致的无效更新）？
3. 怎么支持中间件（如 logger / persist）？
