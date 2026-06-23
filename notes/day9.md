# Day 9 笔记：useContext 源码 + Context 更新穿透 React.memo

> 主题：`useContext` 是唯一"不占 Hook 链表节点"的 Hook；Context 更新如何用 `fiber.dependencies` + `lanes` 穿透 memo
> 源码出处：
>   - `packages/react/src/ReactContext.js`（createContext）
>   - `packages/react-reconciler/src/ReactFiberNewContext.js`（pushProvider / popProvider / propagateContextChanges）
>   - `packages/react-reconciler/src/ReactFiberHooks.js`（readContext 入口）
> 状态：📖 学习中

---

## 零、入场自测（先自己答，"不会"明确说"不会"）

1. `useContext` 占用 Hook 链表节点吗？它怎么"不按 Hook 规则"读值？
2. Provider 的 value 变化，怎么找到所有消费它的组件？
3. 为什么 Context 更新能"穿透" React.memo / shouldComponentUpdate？
4. Context 的性能问题（value 是对象时全员重渲染）根源在哪？

> 答完往下看。本篇会按新流程逐节系统讲全，每节末尾有微检查点。

---

## 一、先建立认知：`useContext` 是所有 Hook 中的"异类"

### 1.1 总结前 8 天的 "Hook 共性"

Day 6-8 学的所有 Hook 都有这个规律：

> 每个 Hook 调用 = `mountWorkInProgressHook()` 建一个 Hook 节点 → 串进 `fiber.memoizedState` 链表 → update 时 `updateWorkInProgressHook()` 克隆对应节点

**`useContext` 打破了这条规律。**

### 1.2 `useContext` 不占 Hook 链表节点

`useContext` 没有 `mountContext` 函数（源码里不存在！），它直接调用 `readContext`：

```js
// ReactFiberHooks.js 中 useContext 的实现
export function useContext(Context) {
  return readContext(Context);   // ← 就一行，不调用 mountWorkInProgressHook
}
```

`readContext` 做的事：
1. 读取 `context._currentValue`（当前 fiber 层级上 Provider 设的最新值）
2. 把 `{ context, memoizedValue }` 记录到 **`fiber.dependencies`** 链表（不是 fiber.memoizedState！）
3. 返回 `context._currentValue`

⭐ **所以 Q1 答案**：

| | useState / useEffect | useContext |
|---|---|---|
| 是否建 Hook 节点 | ✅ 是 | ❌ 否 |
| 存在哪个字段 | `fiber.memoizedState`（链表） | `fiber.dependencies`（依赖链表） |
| 存储什么 | 持久化状态 + queue + effect | 消费的 context 引用 |
| 为什么不需要 | 需要跨 render 存 state | value 每次 render 重新读就行 |

**本质差异**：
- `useState`：需要**持久化**状态（Hook 节点必须跨 render 存活）
- `useMemo`：需要**缓存**计算结果（必须存到上一个 render 拿来比 deps）
- `useContext`：**不存任何状态**——`context._currentValue` 就是权威来源，每次 render 直接读一下就行

这也是为什么 `useContext` 的顺序不要求稳定——它不比 deps、不存持久数据，错了位置也没影响。

> 🔍 微检查点 1：`useContext` 不占 Hook 节点，那 `hooks` 数组里会为它留一个空位吗？（试答）

---

## 二、`createContext` 和 Provider 的结构

### 2.1 createContext

```js
function createContext(defaultValue) {
  const context = {
    _currentValue: defaultValue,          // 当前值，Provider 会改它
    _currentValue2: defaultValue,         // 辅助渲染器（同构用）
    _threadCount: 0,
    Provider: null,                        // 运行时挂上
    Consumer: null,                        // 运行时挂上
  };
  context.Provider = {                    // <MyContext.Provider>
    $$typeof: REACT_PROVIDER_TYPE,
    _context: context,
  };
  context.Consumer = {                    // <MyContext.Consumer>（传统 render props）
    $$typeof: REACT_CONTEXT_TYPE,
    _context: context,
  };
  return context;
}
```

⭐ `_currentValue` 就是 `readContext` 读的那个值。mount 时是 `defaultValue`，Provider 覆盖后就是最新值。

### 2.2 Provider 的机制：pushProvider / popProvider

```
<MyContext.Provider value={x}>
  <Child />
</MyContext.Provider>
```

beginWork 遇到 Provider fiber 时调 `pushProvider`：

```js
function pushProvider(providerFiber, context, nextValue) {
  push(valueCursor, context._currentValue, providerFiber);  // ★ 存旧值到栈
  context._currentValue = nextValue;                        // ★ 设为新值
}
```

completeWork 回溯时调 `popProvider`：

```js
function popProvider(context, providerFiber) {
  context._currentValue = valueCursor.current;  // ★ 恢复旧值
  pop(valueCursor, providerFiber);
}
```

**关键**：`context._currentValue` 在遍历 fiber 树的过程中**随 Provider 的进出不断变化**——有点像"作用域链"。Provider 内部的所有子 fiber 在 beginWork 时读到的是新值，离开 Provider 后 readContext 读到的是旧值。

> 🔍 微检查点 2：两个嵌套的 Provider，内层 value="inner"，外层 value="outer"。在内层 Provider 内部 `useContext(MyCtx)` 读到什么？

---

## 三、Provider value 变化时，React 怎么找到所有消费者（Q2）

这是 Context 的核心机制。分两步：

### 第 1 步：消费记录 —— `fiber.dependencies`

当一个 fiber 的 beginWork 执行 `readContext` 时，会把"我消费了哪个 context"记下来：

```js
function readContext(context) {
  const value = context._currentValue;

  // 把消费记录记到 workInProgress.dependencies 链表中
  if (lastContextDependency === null) {
    lastContextDependency = {
      context,             // 引用了哪个 context 对象
      memoizedValue: value, // 当时的值
      next: null,
    };
    currentlyRenderingFiber.dependencies = {
      lanes: NoLanes,
      firstContext: lastContextDependency,   // ★ 链表头
    };
  } else {
    // 追加到链表尾
    lastContextDependency.next = { context, memoizedValue: value, next: null };
    lastContextDependency = lastContextDependency.next;
  }

  return value;
}
```

所以每个 fiber 的 `dependencies.firstContext` 是一个链表——**记录了这个 fiber 消费了哪些 context**。

### 第 2 步：变化传播 —— `propagateContextChanges`

Provider 的 value 变化时，beginWork 里调 `propagateContextChanges`。它深度遍历 Provider 所有子 fiber：

```js
function propagateContextChanges(workInProgress, contexts, renderLanes) {
  let fiber = workInProgress.child;
  while (fiber !== null) {
    const list = fiber.dependencies;

    if (list !== null) {
      // ★ 这个 fiber 读过 context！遍历它的 dependencies 链表
      let dep = list.firstContext;
      while (dep !== null) {
        if (dep.context === changedContext) {   // 引用比较
          // ★ 匹配！标记这个 fiber 需要强制更新
          fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
          fiber.alternate.lanes = mergeLanes(fiber.alternate.lanes, renderLanes);
          // 还要向上标记祖先，确保路径不被 bailout 跳过
          scheduleContextWorkOnParentPath(fiber.return, renderLanes, workInProgress);
          break;
        }
        dep = dep.next;
      }
    }

    // 深度优先 DFS 遍历所有子孙
    fiber = nextFiber(fiber);
  }
}
```

> 翻译人话：**Provider value 变了 → 遍历所有子 fiber → 看每个 fiber 的 dependencies 链表里有没有记录"我消费了这个 context" → 有的话，直接改它的 lanes → 强制它重新渲染。**

**所以 Q2 答案**：靠每个 fiber 上的 `dependencies.firstContext` 链表记录消费关系。Provider 变化时遍历子树，通过引用匹配 `dep.context === changedContext` 找到消费者。

> 🔍 微检查点 3：如果一个 fiber 在 Provider 内部但**没有调 `useContext`**，Provider value 变化时它会重新渲染吗？

---

## 四、为什么 Context 更新能穿透 React.memo（Q3）

这是 Day 6 学过的"bailout 条件"的延伸：

```js
// beginWork 里能否 bailout 的判断
if (
  current !== null &&
  oldProps === newProps &&      // React.memo 保证了这条
  !hasScheduledUpdateOrContext() &&
  //                       ↑ ★ 检查有没有 pending lanes！
  !hasLegacyContextChanged()
) {
  return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
}
```

`propagateContextChanges` 直接改了 `fiber.lanes` → `hasScheduledUpdateOrContext()` 返回 true → **bailout 条件不满足** → 即使 props 没变，也要进去渲染。

```
memo 包裹的子组件（props 没变）
  └─ 正常情况下 → bailout → 跳过渲染 ✅
  └─ 但消费了 context 且 Provider value 变了
       → fiber.lanes 被 propagateContextChanges 打上标记
       → hasScheduledUpdateOrContext() = true
       → bailout 失败 → 强制走完整 beginWork → 重新渲染 ← 这就是"穿透"
```

⭐ **Q3 答案**：`propagateContextChanges` 通过修改消费者 fiber 的 `lanes`（`mergeLanes`），使得 `beginWork` 里的 `hasScheduledUpdateOrContext()` 返回 true，**bailout 条件失效**，即使 memo 的 props 浅比较通过也要进去渲染。

> 🔍 微检查点 4：`React.memo(Child)` 的父亲传了稳定 props，但 Child 内部 `useContext(MyCtx)` 消费了变化过的 context——Child 会渲染吗？

---

## 五、Context 的性能陷阱（Q4）

```jsx
function App() {
  const [count, setCount] = useState(0);
  return (
    <MyContext.Provider value={{ count }}>
      {/* 每次 count 变，这里全是新对象 */}
      <ExpensiveTree />
    </MyContext.Provider>
  );
}
```

### 5.1 问题 1：value 是对象时，所有消费者强制渲染

`propagateContextChanges` 标记了所有消费了 `MyContext` 的 fiber → **无论它们有没有用 `count`**。

```jsx
function ConsumerA() {
  const { count } = useContext(MyContext);  // 用了 count
  return <div>{count}</div>;
}

function ConsumerB() {
  const { theme } = useContext(MyContext);  // 只用了 theme
  // ★ count 变了，B 也被强制渲染，虽然它没用 count
}
```

### 5.2 问题 2：Provider 每次 render 新建 value 对象 → 所有消费者渲染

```jsx
<MyContext.Provider value={{ count }}>
```

每次 App 重渲染，`value` 都是新对象 → `pushProvider` 把新值写进 `context._currentValue` → `readContext` 发现值变了 → `propagateContextChanges` 遍历子树 → **所有消费了 MyContext 的组件都重新渲染**。

哪怕 Consumer 用 `React.memo` 包了、props 没变，也拦不住——因为 `lanes` 已经被改了。

### 5.3 修复方案

| 问题 | 修复 |
|---|---|
| value 对象每次新建 | `useMemo` 稳定 value 引用 |
| 只消费部分字段 | **拆分 Context**（ThemeContext / CountContext 分开）|

```jsx
const value = useMemo(() => ({ count }), [count]);
<MyContext.Provider value={value}>   // 引用稳定
```

**但注意**：这只解决了"不必要的子组件渲染"，**不能解决"所有消费者强制渲染"**——那是 Context 的设计，不是 bug。

### 5.4 ⚠️ 重要前提：propagateContextChanges 的"精准"必须配合 memo 才能观察到

这是一个极易踩的认知坑（本项目作者实测踩过）：

> **如果消费组件没有包 `React.memo`，你根本看不出 context 的"只渲染消费者"精准性——因为"父重渲染 → 子默认全渲染"这个更粗的行为已经让所有子组件都渲染了。**

```jsx
// DeepChild 没包 memo
function DeepChild() {
  const val = useContext(Ctx);
  return <li>{val}</li>;
}
// App 里点任何按钮（哪怕和 context 无关的 setToggle）：
//   App 重渲染 → <DeepChild /> 每次新 props 引用 → bailout 失败 → 全部 DeepChild 渲染
//   → context 的精准标记被"默认全渲染"完全盖住，三个按钮行为看起来一样
```

加上 memo 后才能看出三种行为的区别：

| 操作 | 无 memo | 有 memo |
|---|---|---|
| 改无关 state（value 不变） | 全渲染 | **全不渲染**（propagateContextChanges 根本不触发）|
| 改某层 Provider 的 value | 全渲染 | **只该 Provider 子树内的消费者渲染**（精准标记 + 穿透 memo）|

⭐ **结论**：
1. `propagateContextChanges` 的"精准只标记消费者"**确实存在**，但它的价值是"配合 memo 时能精准 bailout 掉非消费者"。
2. 没有 memo 时，React 的默认行为是"父变子全变"，轮不到 context 机制发挥精准性。
3. 所以"Context 性能优化"几乎总是和 `React.memo` 一起谈——单独的 Context 机制无法阻止默认的全渲染。

详见 `demos/day9/README.md` 的 J1（无 memo vs 有 memo 对照实验）。

> 🔍 微检查点 5：`useContext` 比 `useState` 轻在哪？比 `useEffect` 又轻在哪？（提示：没有 queue、没有 flag、不占 Hook 节点、不参与 commit）

---

## 六、Context 整个流程串起来

```
createContext(defaultValue)
  ↓
<MyContext.Provider value={x}>
  beginWork 调 pushProvider：
    push(oldValue 到栈) → context._currentValue = x
    ↓
  MyContext 的子 fiber：
    useContext(MyContext) → readContext(context)
      → 读取 context._currentValue ← 当前是 x
      → 记录依赖到 fiber.dependencies.firstContext
      → 返回 x
    ↓
  completeWork 调 popProvider：
    context._currentValue = 栈顶旧值 → 恢复
    ↓
Provider value 变化（父组件 setState）：
  propagateContextChanges(workInProgress, [MyContext], renderLanes)
    → DFS 遍历 Provider 子树
    → 每个 fiber 的 dependencies.firstContext 链表
    → 匹配到 context 引用 === MyContext 的 fiber
    → lane = mergeLanes(lane, renderLanes)
    → ★ bailout 条件被破坏 → 强制渲染
```

---

## 七、动手实验

详见 `demos/day9/README.md`，3 个实验：

| 实验 | 目标 | 验证什么 |
|---|---|---|
| J1 | Provider value 变 → useContext 组件强制渲染 | 穿透 memo / 不消费也渲染 |
| J2 | 稳定 value 引用 + 拆分 Context | 减少不必要渲染 |
| J3 | DevTools 看 `fiber.dependencies` | Consumer dependencies 链表实物 |

---

## 八、我之前以为 …，其实是 …（5 条认知纠正）

1. **我以为** `useContext` 跟其他 Hook 一样，在 `memoizedState` 链表上有节点。
   **其实** 它根本没有 `mountContext` 函数，不占 Hook 节点。每次直接 `readContext` 读 `context._currentValue`，依赖通过 `fiber.dependencies` 记录。

2. **我以为** Context value 变化时，React 通过"绑定/订阅"找到消费者。
   **其实** 是 `propagateContextChanges` **DFS 遍历 Provider 子树**，挨个检查 `dependencies.firstContext` 链表匹配 context 引用，匹配上就改 `lanes`。

3. **我以为** Context 穿透 memo 是某种"特殊通道"。
   **其实** 就是改 `fiber.lanes` → 破坏 bailout 条件（`hasScheduledUpdateOrContext()`）→ 逼 beginWork 走完整渲染路径。没有黑魔法。

4. **我以为** `React.memo(Consumer)` 能阻止 Context 引起的重复渲染。
   **其实** 拦不住——lanes 已经被改了，bailout 条件直接失效。Context 设计上就是"所有消费者必须更新"。

5. **我以为** `useMemo` 包裹 value 对象能完全解决 Context 性能问题。
   **其实** 只能解决"value 引用不稳定导致 Consumer 多渲染一次"的问题，但**不能解决"所有消费了同一个 context 的组件都强制渲染"**——那是 Context 机制本身的代价。真正解法是拆分 Context。

---

## 九、验收清单

- [x] 能说出 useContext 不占 Hook 链表节点的原因
- [x] 能讲清 Provider 的 pushProvider/popProvider 机制
- [x] 能解释 propagateContextChanges 如何找到消费者（dependencies 链表 + DFS）
- [x] 能说清 Context 穿透 memo 的根因（改 lanes → 破坏 bailout）
- [x] 能分析 Context 性能问题 + 给出修复方案
- [x] 完成 3 个动手实验
- [x] 写下 5 条认知纠正

---

## 十、Day 10 预告

**主题**：React 18 并发渲染 + Lane 优先级模型（W3 预热，贯穿 W2 的内容）

**预读问题**：

1. Lane 是什么？和数字比大小有什么区别？
2. `useTransition` 的 startTransition 是怎么让 setState 变成"低优先级"的？
3. Concurrent Mode 下 render 可中断，那如果中断后高优先级更新插队，低优先级 wIP 树怎么处理？
4. `useDeferredValue` 和 `useTransition` 的区别是什么？

明天见 👋
