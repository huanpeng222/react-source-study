# Day 14 笔记：React Compiler + 性能优化深度

> 日期：2026-07-01
> 主题：React Compiler 工作原理、编译前后对比、memo/useMemo/useCallback 的正确使用时机、什么情况下仍然需要手写
> 状态：📖 教程完成，待跟练
> 源码出处：
> - `packages/react-compiler/src/ReactCompiler.js`（主入口，Babel 插件）
> - `packages/react-compiler/src/Hooks.js`（Hook 依赖分析）
> - `packages/react-reconciler/src/ReactFiberBeginWork.js`（bailout 判断逻辑）
> - `packages/react/src/ReactMemo.js`（React.memo 实现）

---

## 零、入场自测（先答，不会就写"不会"）

1. 你平时什么时候会加 `React.memo`？什么时候用 `useMemo` / `useCallback`？你的判断标准是什么？

2. `React.memo` 的比较函数（第二个参数）返回 `true` 表示什么？返回 `false` 呢？和 `Array.filter` 的语义一样吗？（很多人搞反）

3. 下面这段代码有没有性能问题？如果有，问题在哪？怎么改？

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  const handleClick = () => setCount(c => c + 1);
  const heavyData = computeExpensive(count);

  return (
    <div>
      <button onClick={handleClick}>{count}</button>
      <Child data={heavyData} onClick={handleClick} />
      <VeryHeavyComponent />
    </div>
  );
}

function Child({ data, onClick }) {
  return <div onClick={onClick}>{data.name}</div>;
}
```

4. React Compiler 是怎么知道"这个组件需要缓存"的？它是分析 JSX？分析 Hook 依赖？还是别的机制？

---

## 一、为什么需要 React Compiler？（memo 的困境）

### 1.1 你的 memo 写对了吗？

先做个小测试——下面这些代码你见过几种？

**情况 A：该 memo 没 memo**

```jsx
// Parent 每次 render 都创建新的对象/函数 → Child 无意义地 re-render
function Parent({ items }) {
  return (
    <div>
      {items.map(item => (
        <Child key={item.id} 
          item={item} 
          onClick={() => handle(item.id)}   // ← 每次新函数！
          options={{ mode: 'edit', theme: 'dark' }}  // ← 每次新对象！
        />
      ))}
    </div>
  );
}

function Child({ item, onClick, options }) {
  // 即使 item 没变，因为 onClick 和 options 每次都是新的引用
  // 这个组件每次都会 re-render
  return <div>{item.name}</div>;
}
```

**情况 B：过度 memo**

```jsx
// 很多人的"防御性编程"
const MemoChild = React.memo(function Child({ name }) {
  return <div>{name}</div>;
});

function App() {
  // 如果 MemoChild 的父组件 re-render 不频繁，
  // 或者 MemoChild 本身渲染很轻量（一个 div），
  // 这个 React.memo 的成本（比较 props）可能比直接渲染还高
  return <MemoChild name="hello" />;
}
```

**情况 C：memo 了但没用对**

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  
  // ❌ 每次 render 都是新函数引用 → React.memo 形同虚设
  const handleClick = () => console.log(count);
  
  return (
    <div>
      <button onClick={() => setCount(c + 1)}>{count}</button>
      <MemoChild onClick={handleClick} />  {/* onClick 每次都变！ */}
    </div>
  );
}

const MemoChild = React.memo(({ onClick }) => {
  return <button onClick={click}>点击</button>;
});
// React.memo 默认用 Object.is 比较 → 新函数 !== 旧函数 → 永远不命中 bailout
```

### 1.2 核心矛盾

| 问题 | 说明 |
|---|---|
| **漏加 memo** | 子组件不必要的 re-render → 卡顿 |
| **乱加 memo** | 比较本身的成本 > 节省的渲染成本 |
| **加了但无效** | 引用不稳定（新函数/新对象），memo 白写了 |
| **依赖数组写错** | useMemo 返回过期数据 / useCallback 引用过期闭包 |

**这不是你的错。** memo 的正确使用需要你：
1. 理解组件的渲染频率
2. 分析每个 prop 的稳定性
3. 记住给每个新函数/对象包 `useCallback` / `useMemo`
4. 维护正确的依赖数组

这本质上是把**编译器该干的活**推给了人。

---

## 二、React Compiler 是什么？

### 2.1 一句话定义

> **React Compiler 是一个 Babel 插件/构建时工具，自动分析你的组件代码，在需要的地方插入 memoization（等价于自动帮你写 React.memo / useMemo / useCallback）。**

它不是运行时库，不改变 React runtime。它是在**编译阶段**重写你的代码。

### 2.2 编译前后对比（最直观的理解）

**你写的代码（源码）：**

```jsx
function Hello({ name, color }) {
  const greeting = `Hello, ${name}!`;
  const style = { color };
  return <div style={style}>{greeting}</div>;
}
```

**Compiler 编译后（概念等价）：**

```jsx
// 注意：这是概念演示，不是真正的编译输出
function Hello({ name, color }) {
  // $ 编译器自动插入的变量缓存
  let $greeting, $style;
  
  // $ 只在依赖变化时重新计算（类似 useMemo）
  const $depsChanged = name !== $prevName || color !== $prevColor;
  if ($depsChanged || $firstRender) {
    $greeting = `Hello, ${name}!`;
    $style = { color };
    $prevName = name;
    $prevColor = color;
  }
  
  return <div style={$style}>{$greeting}</div>;
}
```

**关键区别**：

| | 你手写 | Compiler 自动 |
|---|---|---|
| 要不要分析哪些值需要缓存？ | 自己想 | **自动分析** |
| 依赖数组要不要手动维护？ | 要，且容易写错 | **自动推导** |
| 忘了包 useMemo 怎么办？ | 性能 bug | **不存在这个问题** |
| 包多了怎么办？ | 冗余代码，可读性差 | **精确分析，不多不少** |

### 2.3 Compiler 的工作原理（面试高频）

> 📌 **入场自测 Q4 答案**：Compiler 不是分析 JSX，也不是简单比对字符串。它的核心是**构建依赖图（dependency graph）通过控制流分析（control flow analysis）+ 作用域分析**。

具体过程：

```
第一步：AST 解析（Babel 完成）
  你的代码 → 抽象语法树

第二步：作用域 + 控制流分析（Compiler 核心）
  
  function Component({ user, items }) {
    const name = user.name;          // ← 分析出: name 依赖于 user
    const filtered = items.filter(x => x.active);  // ← filtered 依赖于 items
    return <List data={filtered} title={name} />;  // ← List 的 props 依赖于 filtered 和 name
  }
  
  ↓ Compiler 内部建立了这样的图:
  
  user ─→ user.name (= name)
  items ─→ items.filter(...) (= filtered)
  name ───┐
  filtered ─┼─→ <List props>
  
第三步：决定哪里需要缓存
  
  规则：
  1. 如果一个变量在多次 render 间可能被重算
     且计算有可见副作用或开销较大
     → 自动缓存（等价于 useMemo）
     
  2. 如果传给子组件的 prop 在当前 render 中是"稳定的"
     （即只依赖于外部 props / 缓存后的变量）
     → 子组件不需要额外 memo（Compiler 已经保证了 prop 引用稳定）
     
  3. 如果一个值在条件分支中创建
     但在多个路径中使用
     → 提升到公共作用域并缓存
```

**源码级解释**（React Compiler 核心流程简化）：

```js
// packages/react-compiler/src/ReactCompiler.js（概念性伪代码）
class ReactiveScope {
  constructor(variables) {
    this.variables = variables;        // 需要追踪的变量列表
    this.deps = new Map();             // 变量间的依赖关系
    this.memoized = new Map();         // 已缓存的值
  }

  // 判断某个变量是否需要更新
  needsUpdate(varName, newValue) {
    const oldVal = this.memoized.get(varName);
    if (Object.is(oldValue, newValue)) return false;  // 引用相等 → 复用
    
    // 递归检查依赖是否变化
    for (const dep of this.getDependencies(varName)) {
      if (this.needsUpdate(dep, this.getCurrent(dep))) return true;
    }
    return false;
  }
}
```

### 2.4 "输入等价性保证"

> 📌 **入场预读 Q3 答案**：这是 Compiler 最重要的设计约束。

**定义**：Compiler 编译后的代码行为，与源码在**相同输入下产生完全相同的输出**。

换句话说：
- 给定相同的 props / state / context → 渲染结果完全一致
- Compiler **不会改变**组件的逻辑、副作用顺序、生命周期
- Compiler **不会优化掉**你认为应该保留的计算
- Compiler **不会重排** Hooks 调用顺序

```
保证的内容:
✅ 相同输入 → 相同输出（数学上的纯函数等价）
✅ 副作用执行次数不变（useEffect 等不会被跳过）
✅ Hooks 顺序不变（不会违反 Rules of Hooks）
✅ 错误抛出的时机不变

不保证（也不需要保证）的内容:
⚠️ 渲染次数可能减少（这正是目的）
⚠️ 内存占用可能略增（缓存需要空间）
⚠️ 编译后代码不可读（这是编译产物，不是给人看的）
```

**为什么重要？** 因为这意味着你可以**安全地启用 Compiler 而不用担心引入 bug**。如果编译后有行为差异，那是 Compiler 的 bug，不是你的问题。

---

## 三、传统 Memo 体系完整回顾

### 3.1 React.memo

**API：**

```jsx
React.memo(Component, areEqual?(oldProps, newProps) => boolean)
//                                              ↑ 返回 true = 不需要 re-render（props 等价）
//                                                返回 false = 需要 re-render
```

**⚠️ 最大的坑：返回值语义和 Array.filter 相反！**

```jsx
// Array.filter: 返回 true = 保留
[1,2,3].filter(x => x > 1);  // → [2,3]  (true = keep)

// React.memo: 返回 true = 不更新！（true = skip render）
React.memo(Child, (prev, next) => {
  return prev.id === next.id && prev.name === next.name;  // true = props 没变 = 不 re-render
});
```

**默认比较函数是 Object.is**（严格相等）：

| 类型 | Object.is 行为 |
|---|---|
| number/string/boolean | 值相等 → `true` |
| object/array/function | **引用相等**才 → `true`（浅比较！） |
| null/undefined | `null === null` → `true` |
| NaN | `Object.is(NaN, NaN)` → `true`（不同于 ===） |

**实际例子：**

```jsx
const MemoChild = React.memo(function Child({ user, onClick, config }) {
  return <div onClick={onClick}>{user.name}, mode={config.mode}</div>;
});

function Parent() {
  const [count, setCount] = useState(0);
  const user = { name: '张三', id: 1 };       // ← 每次新对象！
  const handleClick = () => alert('click');     // ← 每次新函数！
  const config = { mode: 'dark', lang: 'zh' }; // ← 每次新对象！

  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
      {/* 这三个 prop 每次都是新引用 → React.memo 永远不命中 bailout */}
      <MemoChild user={user} onClick={handleClick} config={config} />
    </div>
  );
}
```

**修复方式 —— 手动稳定化：**

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  
  // 方式 A: 移到外部（组件间共享）
  // 方式 B: useState 缓存
  const [user] = useState(() => ({ name: '张三', id: 1 }));
  
  // 方式 C: useCallback
  const handleClick = useCallback(() => alert('click'), []);
  
  // 方式 D: useMemo
  const config = useMemo(() => ({ mode: 'dark', lang: 'zh' }), []);

  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
      {/* 现在 prop 引用稳定了 → React.memo 能命中 bailout ✅ */}
      <MemoChild user={user} onClick={handleClick} config={config} />
    </div>
  );
}
```

### 3.2 useMemo

**用途：** 缓存**昂贵计算**的结果。

```jsx
// ❌ 每次 render 都重算
function List({ items, filter }) {
  const filtered = items           // 假设 items 有 10 万条
    .filter(x => x.status === filter)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 20);               // O(n log n) 每次都执行
  return <ul>{filtered.map(renderItem)}</ul>;
}

// ✅ 只有 items 或 filter 变化时才重算
function List({ items, filter }) {
  const filtered = useMemo(() =>
    items
      .filter(x => x.status === filter)
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 20),
    [items, filter]  // 依赖数组
  );
  return <ul>{filtered.map(renderItem)}</ul>;
}
```

**⚠️ useMemo 的误用场景：**

```jsx
// ❌ 误用1: 缓存 trivial 计算
const sum = useMemo(() => a + b, [a, b]);  // 加法比查缓存还快

// ❌ 误用2: 依赖数组太宽 → 几乎每次都重算，白写了
const value = useMemo(() => compute(obj), [obj]);
// obj 如果是外层传入的新对象 → 每次都变化 → 没缓存住

// ❌ 误用3: 用 useMemo 保证引用稳定（应该用其他方式）
const style = useMemo(() => ({ display: 'flex' }), []);
// 这种常量对象直接提到组件外面就行
```

### 3.3 useCallback

**本质：** `useMemo(fn, deps)` 的语法糖。

```jsx
// 这两个完全等价：
const fn = useCallback(() => doSomething(a, b), [a, b]);
const fn = useMemo(() => () => doSomething(a, b), [a, b]);

// 编译后大概长这样（概念性）：
let cachedFn;
let prevA, prevB;
if (a !== prevA || b !== prevB) {
  cachedFn = () => doSomething(a, b);
  prevA = a; prevB = b;
}
return cachedFn;
```

**主要用途：** 传给子组件的 callback prop 保持引用稳定（配合 React.memo 使用）。

```jsx
function Parent({ itemId }) {
  // 没有 useCallback → 每次 render 都是新函数
  // const handleDelete = () => api.delete(itemId);
  
  // 有了 useCallback → itemId 不变时引用不变
  const handleDelete = useCallback(() => {
    api.delete(itemId);
  }, [itemId]);  // 依赖数组！

  return <MemoChild onDelete={handleDelete} />;
}
```

### 3.4 三个 memo API 对比

| | `React.memo` | `useMemo` | `useCallback` |
|---|---|---|---|
| **作用范围** | 整个组件 | 组件内某个表达式 | 组件内某个函数 |
| **缓存什么** | props 比较结果 | 任意计算值 | 函数引用 |
| **触发时机** | 父组件 re-render 时 | 依赖变化时 | 依赖变化时 |
| **解决什么** | 子组件不必要的 re-render | 重复昂贵计算 | 回调 prop 引用不稳定 |
| **前提条件** | **子组件的 props 必须引用稳定**（否则形同虚设） | 计算确实有开销 | 配合 React.memo 使用才有意义 |

**⭐ 黄金组合链：**

```
父组件 re-render
  ↓
useCallback 稳定了回调函数引用
useMemo 稳定了计算值的引用
  ↓
子组件收到的 props 引用没变
  ↓
React.memo(Object.is) 比较通过 → bailout! ✅
  ↓
子组件不 re-render → 整棵子树都省了
```

**任何一环断裂 → 全链条失效。**

---

## 四、React Compiler 时代的手写 memo 还需要吗？

### 4.1 Compiler 自动做了什么

| 你以前手写的 | Compiler 自动处理 |
|---|---|
| `React.memo()` 包裹组件 | ✅ 自动分析是否需要 |
| `useMemo(() => expr, [deps])` | ✅ 自动推导依赖 + 注入缓存 |
| `useCallback(() => fn(), [deps])` | ✅ 同上（本质是 useMemo） |
| 手动提升常量到组件外 | ✅ 自动识别纯表达式 |
| 手动拆分组件避免重渲染 | ✅ 在某些情况下自动处理 |

### 4.2 ⚠️ Compiler 不能做的（仍然需要手写的情况）

**情况 1：跨组件/跨 hook 共享的稳定值**

```jsx
// Compiler 只分析单个组件的作用域
// 下面这种跨组件的共享，Compiler 管不到
const THEME = { primary: 'blue', bg: 'white' };  // ← 手动提到外部是对的

function App() {
  return <Child theme={THEME} />;
}
```

**情况 2：ref.current 相关的非 reactive 值**

```jsx
function Table({ data }) {
  const rowRef = useRef(null);
  
  // Compiler 可能无法确定 ref.current 的变化时机
  // 如果你需要在某处缓存基于 ref.current 的计算
  const currentRow = rowRef.current;
  const detail = useMemo(() => expandRow(currentRow), [currentRow]);
  // 这个 useMemo Compiler 可能不会自动加（ref 不在依赖追踪系统里）
  
  return <div ref={rowRef}>{detail?.name}</div>;
}
```

**情况 3：自定义比较逻辑**

```jsx
// React.memo 第二个参数的自定义比较函数
// Compiler 只用 Object.is（严格相等）
// 如果你需要深层比较或特殊逻辑，还得自己写
const MemoChart = React.memo(Chart, (prev, next) => {
  // 只关心 data 数组的长度和最后一项
  return prev.data.length === next.data.length &&
         prev.data[prev.data.length - 1].value === next.data[next.data.length - 1].value;
});
```

**情况 4：库代码 / 第三方组件**

```jsx
// Compiler 通常默认忽略 node_modules 中的代码
// 如果你用的第三方组件内部没有 memo，而你需要优化
// 还是得在外层包一层 React.memo
const OptimizedThirdParty = React.memo(ThirdPartyComponent);
```

**情况 5：调试 / 显式意图声明**

```jsx
// 有时候你加 memo 不是为了性能，而是为了：
// 1. 明确告诉队友"这个组件不应该频繁 re-render"
// 2. 作为性能分析的断点（DevTools 里能看出是否 bailout）
// 这些"人类可读意图"，Compiler 替代不了
const StaticHeader = React.memo(function Header({ title }) {
  return <h1>{title}</h1>;
});
```

### 4.3 总结表

| 场景 | Compiler 能处理? | 需要手写? |
|---|---|---|
| 组件内局部变量的缓存 | ✅ 自动 | ❌ 不需要 |
| 传给子组件的 prop 稳定化 | ✅ 自动 | ❌ 不需要（大部分情况） |
| 组件外部的常量/配置 | ❌ 不管 | ✅ 手动提外部 |
| 自定义比较逻辑 | ❌ 只用 Object.is | ✅ React.memo 第 2 参数 |
| ref 相关的缓存 | ⚠️ 部分 | 建议✅ 手动 useMemo |
| 第三方组件优化 | ❌ 不管 | ✅ 外层 React.memo |
| 性能调试断点 | ❌ 不管 | ✅ 显式 React.memo |

> 📌 **微检查点 1**：回到入场自测 Q3 那段代码，有几个性能问题？分别怎么修？（提示：不止一个）

---

## 五、bailout 的底层原理（源码级）

### 5.1 什么是 bailout？

**定义**：React 判定"这次更新不需要 re-render"的过程叫 **bailout**。

发生在 `beginWork` 阶段（`ReactFiberBeginWork.js`）：

```js
// ReactFiberBeginWork.js（简化）
function beginWork(current, workInProgress, renderLanes) {
  // 1. 检查是否有 pending update
  if (current !== null) {
    const oldProps = current.memoizedProps;
    const newProps = workInProgress.pendingProps;

    // 2. bailout 判断
    if (oldProps !== newProps || hasLegacyContextChange()) {
      // props 变了 → 正常走 render
      didReceiveUpdate = true;
    } else {
      // props 没变 → 检查更细粒度的条件...
      didReceiveUpdate = false;

      // 3. 尝试 bailout
      if (!includesSomeLane(renderLanes, updateLanes)) {
        // ★★ bailout! ★★
        // 复用上次的 fiber 节点，跳过整个子树渲染
        return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
      }
    }
  }

  // ... 正常渲染流程
}
```

**bailout 发生时的效果：**

```
正常渲染:
  Parent(re-render)
    ├── A (re-render)     ← 执行组件函数
    │     ├── a1 (re-render)
    │     └── a2 (re-render)
    ├── B (re-render)     ← 执行组件函数
    │     └── b1 (re-render)

bailout 后:
  Parent(re-render)       ← 父组件还是正常 render（因为触发了更新）
    ├── A (bailout!)      ← ⚡ 跳过！复用上次 fiber
    │     ├── a1 (跳过)   ← 整个子树都跳过了！
    │     └── a2 (跳过)
    ├── B (bailout!)      ← ⚡ 跳过！
    │     └── b1 (跳过)
    
  性能收益 = A + a1 + a2 + B + b1 的渲染时间全部节省
```

### 5.2 React.memo 在 fiber 层面怎么工作？

当组件被 `React.memo` 包裹后，fiber 上会有标记：

```js
// React.memo 设置了这个标志
workInProgress.tag = IndeterminateComponent;  // 普通
// vs
workInProgress.tag = SimpleMemoComponent;     // React.memo 包裹后

// beginWork 中走不同分支：
if (workInProgress.tag === SimpleMemoComponent) {
  // 走 memo 比较逻辑
  const areEqual = type.compare ?? defaultCompare;  // 自定义比较或 Object.is
  if (areEqual(current.memoizedProps, newProps)) {
    // props 等价 → bailout
    return bailoutOnAlreadyFinishedWork(...);
  }
  // 不等价 → 正常 render
}
```

### 5.3 为什么"子组件 bailout"比"父组件减少 re-render"更重要

这是一个关键的认知纠正：

```jsx
function App() {
  const [count, setCount] = useState(0);
  // 点按钮 → App re-render → 所有子组件都面临 re-render 决策
  
  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>{count}</button>
      
      <ExpensiveTree />     {/* 如果这里 bailout 了 → 省下整棵树的渲染 */}
      
      <AnotherExpensive />   {/* 这里也 bailout → 又省一棵树 */}
    </div>
  );
}
```

**父组件 App 无法 bailout**（因为它有自己的 state 变化了，`didReceiveUpdate = true`）。但**子组件可以**——这就是 memo 的价值所在。

**类比**：父组件是"老板收到了新邮件必须看"，但老板可以把不需要知道的邮件**直接转发**（bailout）给下属，下属不用重复读邮件。

---

## 六、性能优化的正确优先级

### 6.1 不要 premature optimization!

```
优化优先级（从高到低）:

第 0 层: 先确认真的有性能问题
  ├— 用 React DevTools Profiler 测量
  ├— 用户感知到了卡顿吗？
  └— 不要猜！测量数据说话

第 1 层: 结构/算法层面
  ├— 减少不必要的 state（能推导的不存）
  ├— 降低组件树深度
  ├— 虚拟列表（react-window）替代全量渲染
  └— 数据分页/懒加载

第 2 层: 更新粒度控制
  ├— 把 state 下推到最小需要的组件
  ├— 拆分组件让变化局部化
  └— 用 content-based splitting（Suspense）

第 3 层: memo 系列（最后才考虑）
  ├— React.memo（子组件 props 稳定时）
  ├— useMemo（真·昂贵计算时）
  └— useCallback（配合 React.memo 时）

第 4 层: React Compiler（自动化第 3 层）
  └— 让编译器替你做第 3 层的事
```

**最常见的错误：** 直接从第 3 层开始优化，跳过了 0-2 层。

### 6.2 入场自测 Q3 代码点评

回到那段代码：

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  const handleClick = () => setCount(c => c + 1);           // 问题 1: 见下文
  const heavyData = computeExpensive(count);                // 问题 2: 见下文

  return (
    <div>
      <button onClick={handleClick}>{count}</button>
      <Child data={heavyData} onClick={handleClick} />      // 问题 3: 见下文
      <VeryHeavyComponent />                                // 问题 4: 见下文
    </div>
  );
}

function Child({ data, onClick }) {
  return <div onClick={onClick}>{data.name}</div>;
}
```

**问题清单：**

| # | 问题 | 严重度 | 修复 |
|---|---|---|---|
| 1 | `handleClick` 每次 render 新建函数 | 🟡 中 | `useCallback(() => ..., [])` 或 Compiler 自动处理 |
| 2 | `computeExpensive(count)` 每次 render 重算 | 🔴 高 | `useMemo(() => computeExpensive(count), [count])` |
| 3 | `Child` 收到的 `data` 和 `onClick` 引用不稳定 | 🟡 中 | 修复 1+2 后自然解决；或给 Child 加 `React.memo` |
| 4 | `<VeryHeavyComponent />` 没传 props 但仍随 Parent re-render | 🔴 高 | 给它加 `React.memo()`；或把它移到不会频繁 re-render 的位置 |

**注意问题 4**：即使 `VeryHeavyComponent` 没接收任何 props，Parent re-render 时它**依然会 re-render**（因为它是 Parent 的子节点，默认行为就是跟着父组件一起 render）。这是最容易忽略的性能杀手。

---

## 七、动手实验

详见 `demos/day14/README.md`，3 个实验：

| 实验 | 内容 | 验证什么 |
|---|---|---|
| P1 | bailout 可视化（DevTools 观察） | React.memo 命中/未命中的 re-render 差异 |
| P2 | useMemo 依赖数组的陷阱 | 依赖为对象时的"假缓存"现象 |
| P3 | React Compiler 编译前后对比 | 同一段代码编译前后的渲染次数差异 |

---

## 八、我之前以为 …，其实是 …（跟练后回填）

1. **我以为** React.memo 就是万能性能银弹——**其实** 如果传进去的 props 引用不稳定（新函数/新对象），memo 形同虚设。**黄金链的前提是 prop 引用稳定。**
2. **我以为** useMemo 应该尽量多用以防万一——**其实** 过度 memo 的成本（内存 + 依赖维护）可能超过收益。**先用 Profiler 测量，确认瓶颈再优化。**
3. **我以为** React Compiler 会完全替代手写 memo——**其实** 它只管组件内部的局部优化，跨组件共享值 / 自定义比较 / 第三方组件 / 调试意图这些场景仍然需要手写。
4. **我以为** 父组件 state 变了，所有子组件必然 re-render——**其实** 子组件可以通过 bailout（React.memo 命中）跳过渲染，**整棵子树都省掉了**。所以 memo 的价值不在父组件而在子组件。

---

## 八点五、入场自测对答 & 微检查点判定

### 入场自测回答

| 题 | 学习者回答 | 判定 |
|---|---|---|
| Q1 | memo 减少重渲染，useMemo/useCallback 减少重复计算 | ✅ 方向对 |
| Q2 | 新旧 props 引用地址都没变 | 🟡 偏（漏了原始类型比值 + 返回true=不重渲染的语义陷阱） |
| Q3 | heavyData 每次重算 + VeryHeavyComponent 缺 memo → 加 React.memo | ✅ 找到 2 个问题（漏了 handleClick 每次新建 + onClick 导致子组件 memo 失效） |
| Q4 | （未答） | — |

**判定：2 对 1 偏 1 未答**

---

## 九、验收清单

- [ ] 能说出 React.memo 的比较函数返回值的含义（true = skip）
- [ ] 能指出 React.memo 返回性能问题的 3 个常见原因
- [ ] 能写出 useMemo / useCallback 的正确使用场景（各至少 2 个）
- [ ] 能解释 Compiler 的"输入等价性保证"是什么意思
- [ ] 能列出 Compiler 不能处理的 5 个场景
- [ ] 能说出 bailout 发生在哪个阶段（beginWork）、效果是什么（跳过整棵子树）
- [ ] 能按优先级排列性能优化手段（0-4 层）
- [ ] 完成 3 个实验

---

## 十、Day 15 预告

**主题**：状态管理深挖（Redux Toolkit 源码级 / Zustand vs Redux / Context 性能陷阱 / Jotai / Signals）
**预读问题**：
1. Redux Toolkit 的 `createSlice` 内部是怎么生成 reducer 和 action creators 的？
2. Context 的性能问题到底在哪？为什么说"Context value 变了所有消费者都 re-render"？怎么避免？
3. Zustand 和 Redux 的核心架构区别是什么？为什么 Zustand 不需要 Provider？
