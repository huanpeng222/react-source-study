# Day 22 — 自研 mini-store（订阅 + selector + 批量更新）

> **主线位置**：`meta/job-sprint-plan.md` 阶段 A 第二天，对应原 `meta/roadmap.md` **D20**（自研 mini-store）。Day15 已经讲完了 Redux/Zustand/Jotai 的**源码对比和原理**，今天不再重复理论，直接**自己动手写一个能跑的状态管理库**——目标 100-150 行，今天写完当天就能用。

---

## 零、入场自测（先答，不会就写"不会"）

1. 一个最小可用的状态管理库，最少需要几个核心方法？
2. 如果两个组件用同一个 `selector` 订阅同一个字段，状态变化时应该分别通知还是合并成一次？
3. "批量更新"在没有 React 内部机制帮忙的情况下，你自己的 store 要怎么手动实现？

### 零点五、入场自测对答（2026-07-08 跟练记录）

| 题 | 学习者回答 | 判定 |
|---|---|---|
| Q1 | setState方法、组件订阅方法、消息发布方法、getState方法 | ✅ 对 |
| Q2 | 分别通知一次 | ❌ 反了——实际是合并成一次通知，细粒度是靠 `useSyncExternalStore` 内置的 `Object.is` 比较让没变的组件自己跳过重渲染，不是广播时区分谁该收到 |
| Q3 | 维持一个定时器，定时器内推进更新action定点执行 | 🟡 方向对（延迟到某个时机统一处理）但工具选错——定时器要猜一个固定延迟，既慢又不精确，正确工具是微任务`queueMicrotask` |

**1对1反1偏**——Q2/Q3 是今天的核心内容，下面系统讲解会重点覆盖。

---

## 一、先想清楚：你要写的东西到底是什么

### 类比：一个"广播站 + 订阅名单"

想象一个广播站：

- **广播站自己保管一份最新消息**（对应 `state`）。
- **任何人可以订阅这个广播站**（对应 `subscribe`），订阅后拿到一个"取消订阅"的开关。
- **广播站发新消息时，通知所有订阅者**（对应 `notify`），但**不会把消息内容塞给你**——你自己决定要不要重新去问一下"现在的消息是什么"（对应 `getState`）。
- 组件想用这个广播站的数据，要做的事情是：①订阅 ②收到通知后自己重新读一次 ③强制自己重新渲染。

这就是所有"外部状态管理库"（Redux/Zustand/Jotai）的**共同骨架**——它们都不是 React 内部的东西，是**站在 React 外面、用 React 提供的一个"桥"（`useSyncExternalStore`）接进来的**。

### 为什么不能只用 `useState` 自己攒一个全局对象？

如果你写：

```js
let globalState = { count: 0 };
// 直接改 globalState.count++ 
```

**React 完全不知道这个对象变了**——`useState` 只认自己内部的 `dispatch`，改一个外部普通对象的属性，不会触发任何组件重渲染。所以"外部 store"必须自己维护一份"通知机制"，再想办法"钩"进 React 的渲染系统里，这个"钩子"就是今天要用的 `useSyncExternalStore`。

---

## 二、`useSyncExternalStore`：React 官方提供的"外部状态桥"

### 2.0 先搞清楚"它是什么"——一句话定义

**`useSyncExternalStore` 是 React 官方提供的一个 Hook，专门用来"订阅一个存在于 React 之外的数据源，并让这个数据源的变化能正确地触发组件重渲染"。**

先弄清楚"外部"是相对于什么而言的——React 里的状态分两大类：

```
React 内部状态：useState / useReducer
  存在哪？存在这个组件的 fiber 上（Day6 讲过 memoizedState）
  谁能改？只能通过 React 提供的 dispatch
  React 知道吗？知道！dispatch 本身就是在通知 React"该重渲染了"

外部状态：一个普通的 JS 对象、浏览器 API、第三方库的 store
  存在哪？存在 React 完全不知道的地方（模块级变量、浏览器全局对象等）
  谁能改？谁都能改，随便一行赋值
  React 知道吗？完全不知道！改了它 React 毫无反应
```

**`useSyncExternalStore` 就是专门为第二类"外部状态"设计的桥**——它让你告诉 React："这里有一个我自己管理的数据源，请你学会关心它什么时候变了。"

**类比**：想象组件是家里的信箱，`useState` 管理的状态就像"你自己写便签纸往信箱里塞"——React 完全掌控，你什么时候塞纸条，React 立刻就知道。而"外部状态"像小区门口一个**独立运营的邮局**（比如 Zustand 的 store）——不受你信箱管辖。想让信箱在"邮局有新邮件"时也响铃，需要：①告诉邮局"有新邮件请通知我"（`subscribe`）②每次响铃后跑去邮局问一下"现在最新的邮件是什么"（`getSnapshot`）。这两份"说明书"就是传给 `useSyncExternalStore` 的两个参数。

**三个参数**：

```js
const value = useSyncExternalStore(
  subscribe,       // 参数1：怎么订阅——一个函数，接收listener，返回取消订阅函数
  getSnapshot,      // 参数2：怎么读当前值——一个函数，返回当前快照
  getServerSnapshot // 参数3（可选）：SSR场景用的快照
);
```

对照 mini-store：

```js
function useStore(store, selector = s => s) {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState())
  );
}
```

**它帮你干的三件事**：①保证首次渲染就能拿到最新值（`getSnapshot` 在 render 阶段同步调用）②在正确的时机建立订阅和清理（内部帮你把 `subscribe` 包进 `useEffect`）③防止渲染撕裂（见下方 2.1/2.2）。**它是所有第三方状态管理库（Redux/Zustand/Jotai）能安全接入 React 18+ 并发渲染的地基**。

### 2.1 为什么不能靠开发者手写"订阅+强制刷新"

在 `useSyncExternalStore` 出现之前（React 18 之前），大家会这样手写：

```js
function useStore(store) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    return store.subscribe(() => forceUpdate(n => n + 1));
  }, [store]);
  return store.getState();
}
```

这样写在**并发渲染**下有一个致命问题：`store.getState()` 在 render 阶段被调用，但**订阅**是在 `useEffect` 里才建立的（commit 之后）。中间这段"render 完但还没订阅上"的窗口期，如果 store 的值变了，组件读到的可能是**撕裂的（tearing）**数据——不同组件在同一次渲染里读到了不一致的快照。

### 2.2 已核实源码：`useSyncExternalStore` 怎么解决撕裂问题

```js
function mountSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
  var nextSnapshot = getSnapshot();          // ① render阶段直接同步读一次
  hook.memoizedState = nextSnapshot;
  mountEffect(subscribeToStore.bind(...), [subscribe]);  // ② useEffect里才真正订阅
  pushSimpleEffect(..., updateStoreInstance.bind(...));  // ③ 额外挂一个"提交后检查"的effect
  return nextSnapshot;
}
```

```js
function checkIfSnapshotChanged(inst) {
  var nextValue = inst.getSnapshot();
  return !Object.is(inst.value, nextValue);   // 用 Object.is 比较快照
}
function forceStoreRerender(fiber) {
  var root = enqueueConcurrentRenderForLane(fiber, 2);   // 2 = SyncLane
  scheduleUpdateOnFiber(root, fiber, 2);       // 强制用同步优先级重渲染！
}
```

关键设计：`useSyncExternalStore` 在**每次 commit 完成之后**，都会用 `checkIfSnapshotChanged` **重新读一次**当前的快照，跟渲染时读到的快照比较——**如果不一致，直接用 SyncLane 强制重渲染**，不管这次更新原本是什么优先级。这保证了"即使中间有并发渲染的空子可钻，commit 后也会立刻纠正过来"，代价是**外部 store 的更新总是被当作最高优先级处理**（这也是为什么 Zustand/Redux 的更新一般感觉比普通 `setState` 更"跟手"）。

> 📌 **微检查点 1**：既然外部 store 更新永远走 SyncLane（最高优先级），那用 `useSyncExternalStore` 订阅一个"频繁变化、但不重要"的字段（比如鼠标坐标），会有什么潜在的性能问题？

### 2.3 跟练追问：为什么 subscribe 要返回一个"取消订阅函数"

**误解排除**：不是"每次通知完都要重新绑定"。`subscribe` 建立的是一个长期有效的登记，listener 一旦被 `listeners.add(listener)` 加进去，会一直留在名单里接收未来所有次的通知，直到主动调用返回的取消函数。

**真正的原因**：这个返回值是给 `useEffect` 的清理机制用的。已核实源码：

```js
function subscribeToStore(fiber, inst, subscribe) {
  return subscribe(function () {
    checkIfSnapshotChanged(inst) && forceStoreRerender(fiber);
  });
}
```

`subscribeToStore` 这个函数**本身就是被塞进 `useEffect` 的那个副作用函数**（对应 §2.2 源码里 `mountEffect(subscribeToStore.bind(...), [subscribe])` 这一行）。React 的 `useEffect` 有个铁律（Day7 讲过）：**如果副作用函数返回一个函数，这个返回值会被当作清理函数（cleanup），在组件卸载、或依赖变化导致 effect 重新执行之前，React 会自动调用它**。

完整链路：组件挂载 → `useEffect` 执行 `subscribeToStore` → 它内部调用 `subscribe(callback)` → `subscribe` 把 callback 加进 `listeners`，返回"删除这个callback"的函数 → 这个删除函数被 `subscribeToStore` 原样 `return` 出去 → 成为这次 `useEffect` 的清理函数 → 组件卸载时，React 自动调用它，把这个组件从监听名单里摘掉。

**如果不返回取消订阅函数会怎样**：①内存泄漏——组件的闭包和它引用的 fiber 永远不会被垃圾回收，因为 `listeners` 这个 `Set` 一直持有引用；②更致命的是，store 之后再触发更新，还会调用"已卸载组件"的回调，`forceStoreRerender(fiber)` 会试图给一个不存在的组件强制重渲染，React 会报"Cannot update state on unmounted component"；③如果组件反复挂载/卸载（比如列表里来回切换），`listeners` 会无限增长，从不缩小。这跟 Day7 讲的"`useEffect` 返回 cleanup 撤销上一次副作用"是同一个模式，事件监听/定时器/WebSocket 的清理写法都一样。

### 2.4 跟练追问：`.bind()` 那一行到底在干什么，为什么"又"塞进了 useEffect

容易看错的地方：`.bind()` **不是在调用**，是在**打包一个函数**。回看 §2.2 那行：

```js
mountEffect(subscribeToStore.bind(null, fiber, getServerSnapshot, subscribe), [subscribe]);
```

`fn.bind(null, a, b, c)` 返回一个**新函数**，将来被调用时等价于执行 `fn(a, b, c)`（提前焊死参数，等以后有人"扣扳机"）。所以这行代码此刻**没有执行** `subscribeToStore`，只是生成了一个"还没执行的函数"。去掉 bind 语法糖，等价于：

```js
const effectFn = function () {
  return subscribeToStore(fiber, getServerSnapshot, subscribe);  // 此刻还没执行
};
mountEffect(effectFn, [subscribe]);
```

`mountEffect` 就是 `useEffect` 挂载阶段的真实内部实现（跟 `mountState` 是 `useState` 内部实现同理）——它把 `effectFn` 记到 fiber 的 effect 链表上，**不会立刻执行**，等这次渲染 commit 完成之后，React 才在合适的时机调用它。

换成你自己写代码的等价写法就不陌生了：

```js
// 你平时写的（箭头函数版）：
useEffect(() => subscribe(callback), [subscribe]);

// React源码写的（bind版，效果完全等价）：
mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe]);
```

**为什么源码用 bind 不用箭头函数**：纯粹是内部代码风格/性能考量（`bind` 生成的函数在某些场景下开销更小），跟业务逻辑无关，React 源码里大量这种写法。

**"又"塞进 useEffect 的疑惑**：`subscribeToStore` 本身就是被设计成"useEffect 的回调函数体"，不是一个独立被随意调用的工具函数——它的存在意义就是"调用 subscribe 建立订阅，并把 subscribe 返回的取消订阅函数原样返回出去"，这个返回值最终变成这次 `useEffect` 的 cleanup（正好接上 2.3 讲的机制）。

---

## 三、动手写 mini-store：从最简版本开始，逐步补齐能力

### 3.1 第一版：只有 `getState` / `setState` / `subscribe`

```js
function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(partial) {
    const nextState = typeof partial === 'function' ? partial(state) : partial;
    if (Object.is(nextState, state)) return;   // 值没变，不通知
    state = { ...state, ...nextState };
    listeners.forEach(listener => listener());  // 通知所有订阅者，不带任何数据
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);    // 返回取消订阅的函数
  }

  return { getState, setState, subscribe };
}
```

**这已经是一个可用的 store 了**，但组件想用它，还要自己拼一个 Hook：

```js
import { useSyncExternalStore } from 'react';

function useStore(store, selector = s => s) {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState())
  );
}
```

用一下：

```jsx
const counterStore = createStore({ count: 0, name: 'guest' });

function Counter() {
  const count = useStore(counterStore, s => s.count);  // 只订阅 count
  return (
    <button onClick={() => counterStore.setState(s => ({ count: s.count + 1 }))}>
      {count}
    </button>
  );
}
```

### 3.2 第二版：加上 selector 的"细粒度订阅"能力

**问题**：上面 `useStore(store, s => s.count)` 表面上"只订阅 count"，但实际上任何字段变化都会让 `useSyncExternalStore` 重新执行 `selector`，只是**如果 selector 算出来的结果没变（`Object.is` 判断），React 才会跳过重渲染**。这个能力**不是你自己实现的，是 `useSyncExternalStore` 内置的**——它天然会拿新旧快照做 `Object.is` 比较。

所以真正决定"细粒度"的，其实是 **selector 函数返回值的稳定性**：

```js
// ❌ 每次都返回新对象，即使内容一样也会被判定"变了"
const bad = useStore(store, s => ({ count: s.count }));

// ✅ 直接返回基本类型/已有引用，才能真正命中"没变就不渲染"
const good = useStore(store, s => s.count);
```

> 💡 这和 Day9 讲的 Context 陷阱、Day14 讲的 `useMemo` 依赖陷阱是**同一个原理**：**`Object.is` 比较对象引用，不比较内容**。

### 3.3 第三版：批量更新去重——避免同一个 tick 里多次 setState 各自触发一次通知

**问题**：如果在一个事件处理函数里连续调用了 3 次 `setState`：

```js
function handleClick() {
  store.setState(s => ({ a: s.a + 1 }));
  store.setState(s => ({ b: s.b + 1 }));
  store.setState(s => ({ c: s.c + 1 }));
}
```

上面第一版的实现会**通知 3 次**，即使 React 的自动批处理（Day10 讲过）能把这 3 次渲染合并成一次 commit，但 `listeners.forEach` 本身触发了 3 次调用，如果监听者里有昂贵的计算（比如触发了别的副作用），会被白白执行 3 次。

**解决思路**：借用微任务（`queueMicrotask`）做一次"去重合并"——在同一个 tick 内，无论 `setState` 调用几次，只在这个 tick 结束时**统一通知一次**。

```js
function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  let isNotifyScheduled = false;   // 本轮是否已经排了一次通知

  function getState() {
    return state;
  }

  function notify() {
    listeners.forEach(listener => listener());
  }

  function setState(partial) {
    const nextState = typeof partial === 'function' ? partial(state) : partial;
    if (Object.is(nextState, state)) return;
    state = { ...state, ...nextState };

    if (!isNotifyScheduled) {
      isNotifyScheduled = true;
      queueMicrotask(() => {
        isNotifyScheduled = false;
        notify();   // 这个 tick 里不管调用了几次 setState，只通知一次
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

> 📌 **微检查点 2**：为什么用 `queueMicrotask` 而不是 `setTimeout(fn, 0)`？（提示：回想 Day19 讲过的宏任务/微任务时序差异，微任务保证在**这一轮事件循环结束、下一次渲染或绘制之前**执行）

### 3.4 完整版：加上 `destroy`（清理所有订阅，方便测试）

```js
function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  let isNotifyScheduled = false;

  function getState() { return state; }

  function notify() { listeners.forEach(l => l()); }

  function setState(partial) {
    const nextState = typeof partial === 'function' ? partial(state) : partial;
    if (Object.is(nextState, state)) return;
    state = { ...state, ...nextState };
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

  function destroy() { listeners.clear(); }   // 主要用于测试隔离

  return { getState, setState, subscribe, destroy };
}

function useStore(store, selector = (s) => s) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
```

**这就是完整的 mini-store，核心逻辑不到 40 行**——比想象中简单，因为真正难的"渲染层撕裂问题"已经被 `useSyncExternalStore` 处理掉了，你只需要负责"状态存储 + 通知去重"这两件事。

---

## 四、和 Zustand 真实源码的差异对比

| 维度 | 你的 mini-store | Zustand 真实源码 |
|---|---|---|
| 核心骨架 | `getState`/`setState`/`subscribe` | 完全一致（Zustand `vanilla.ts` 就是这个骨架） |
| 批量更新 | `queueMicrotask` 去重 | Zustand **不做批量去重**，每次 `set` 都同步通知——依赖 React 的自动批处理来合并渲染 |
| selector细粒度 | 依赖 `useSyncExternalStore` 内置的 `Object.is` | 同样依赖 `useSyncExternalStore`（Zustand v4+），但额外支持自定义 `equalityFn`（如 `shallow` 浅比较对象） |
| merge策略 | 固定 `{...state, ...partial}` 浅合并 | 同样默认浅合并，但 `set(fn, replace)` 支持完全替换 |
| 中间件 | 无 | 有完整的中间件系统（persist/devtools/immer等），用高阶函数包一层 `set`/`get` |
| TypeScript | 无类型 | 完整泛型支持 |

**一句话总结**：Zustand 的核心不比你的 mini-store 复杂多少——它的价值主要在**中间件生态**和**类型系统**，核心的状态存储+订阅机制跟你写的几乎是同一套思路。

---

## 五、几个容易搞混/被面试问到的点

**Q：为什么 selector 细粒度订阅是 `useSyncExternalStore` 自带的，不是你自己实现的？**

`useSyncExternalStore(subscribe, getSnapshot)` 的第二个参数 `getSnapshot` 每次都会被调用，React 内部拿新快照跟上次的快照做 `Object.is` 比较，只有不一致才触发重渲染。你把 `() => selector(store.getState())` 传进去，`selector` 的返回值就是这个"快照"，比较逻辑完全是 React 内置的，你只需要保证 selector 返回的值"该稳定的时候是稳定的"。

**Q：mini-store 和 useReducer 有什么本质区别？**

`useReducer` 的状态**存在组件的 fiber 上**，跟组件生命周期绑定，组件卸载状态就没了；mini-store 的状态**存在模块级闭包里**，跟任何组件的生命周期无关，可以被多个不相关的组件树共享（甚至可以在 React 外部读写，比如给非 React 代码用）。

**Q：为什么不用 Context 实现一个类似的东西？**

Context 的更新会导致所有消费该 Context 的组件重新渲染（除非手动拆分或配合 memo，Day9 讲过的坑），而 `useSyncExternalStore` + selector 天然支持字段级精度，不需要手动拆分多个 Context。

---

## 六、我之前以为…，其实是…（跟练后回填）

1. **我以为** 一个最小可用的状态管理库，selector 细粒度订阅需要自己手写"只通知关心这个字段的人"这种判断逻辑。**其实**广播是无差别的（`listeners.forEach` 无条件通知所有订阅者），真正的细粒度判断完全外包给了 `useSyncExternalStore` 内置的 `Object.is` 比较——每个组件自己重新算一次 selector，值没变就被 React 自动挡住，不用手写。

2. **我以为** 批量更新去重应该靠"维持一个定时器，定点执行更新"。**其实**该用 `queueMicrotask`——它不需要猜一个固定延迟时间，语义是"这一轮同步代码全部跑完之后立刻执行"，比 `setTimeout` 更精确也更快。（入场自测Q3纠错）

3. **我以为** `subscribe` 返回取消订阅函数是为了"下一次通知需要重新绑定"。**其实**订阅是长期有效的登记，返回取消函数是为了配合 `useEffect` 的清理机制——组件卸载时 React 自动调用这个返回值，把自己从监听名单里摘掉，防止内存泄漏和"操作已卸载组件"的报错。

4. **我以为** `useSyncExternalStore` 内部那行 `subscribeToStore.bind(null, fiber, inst, subscribe)` 是在"调用"函数。**其实** `.bind()` 只是打包一个"稍后才会被调用"的函数，跟箭头函数 `() => subscribe(callback)` 是完全等价的写法，`mountEffect` 才是真正决定"什么时候调用"的地方（渲染commit之后）。

5. **我以为** `useSyncExternalStore` 修复渲染撕裂是"发现快照不一致就丢弃旧数据，强制重渲染"。**其实**没有任何数据被丢弃——`checkIfSnapshotChanged` 只是比较"渲染时读到的快照"和"commit后重新读到的快照"，不一致时用 `forceStoreRerender` 触发一次新渲染，让组件重新去读最新值，真实 state 一直在 store 里好好保管着。（验收清单自查纠错，认知纠正#79）

6. **实战踩坑**：`setState` 实现里改完 `state` 后忘了调用 `notify()`，导致 store 内部数据确实正确更新了，但订阅者永远不知道数据变了，页面上的值不会跟着变化——数据层正确、通知层缺失是两件独立的事，任何一个环节漏了都会导致"看起来没生效"。

---

## 七、动手实验（demos/day22/）

已按真实 Vite + React 项目格式补建，详见 `demos/day22/README.md`：

| 实验 | 验证什么 |
|---|---|
| M1 | 手写的 mini-store 是否真的支持 selector 细粒度订阅（一个组件只订阅 `count`，另一个组件改 `name`，前者不应该重渲染） |
| M2 | 批量更新去重是否生效（同一事件里调用 3 次 `setState`，通过 `subscribe` 里打 log 验证只通知了 1 次，不是 3 次） |

---

## 八、验收清单

- [x] 能说出为什么普通全局变量改了不会触发 React 重渲染
- [x] 能讲清楚 `useSyncExternalStore` 解决的"渲染撕裂"问题，以及它怎么解决（commit后重新检查快照，触发新渲染让组件重新读最新值，不是丢弃数据）
- [x] 能讲清楚"selector细粒度订阅"其实是 `useSyncExternalStore` 内置的 `Object.is` 比较，不是自己实现的
- [x] 能讲清楚批量更新去重为什么用 `queueMicrotask`（不是让出主线程，是立刻执行不用猜延迟）
- [x] 完成实验并记录到 observations.md

### 八点五、验收清单自查记录（2026-07-09）

| 条目 | 学习者回答 | 判定 |
|---|---|---|
| 普通全局变量为什么不触发重渲染 | 正确，`useSyncExternalStore`是桥梁 | ✅ 对 |
| 渲染撕裂怎么解决 | "如果不一致，则丢弃，直接强制重渲染" | 🟡 偏——"丢弃"说法不准确 |
| 为什么用queueMicrotask | "可以让出主线程，比setTimeout没有损耗" | ❌ 反了——queueMicrotask恰恰不是"让出"，是"不让出、立刻执行" |

**纠正1：渲染撕裂修复不是"丢弃数据"，是"发现快照不一致→强制重渲染让组件重新读最新值"**

`checkIfSnapshotChanged` 做的是**比较**：对比"上次render时读到的快照"(`inst.value`)和"现在重新调`getSnapshot()`读到的快照"，用`Object.is`判断是否一致。如果不一致，**没有任何数据被丢弃**——真实state一直在store里好好保管着，只是"渲染时读到的值"过期了，`forceStoreRerender`触发一次新渲染让组件重新走一遍流程去读最新值。

**纠正2：`queueMicrotask` 不是为了"让出主线程"，而是"不让出、立刻执行"**

"让出主线程"这个说法用在Scheduler身上是对的（Day19的`shouldYield`，宏任务级别的让步，把控制权交还浏览器去做绘制/处理输入）。但`queueMicrotask`恰恰相反——微任务的执行时机是"当前这轮同步代码跑完，绘制/宏任务开始之前，立刻执行"，比`setTimeout`（宏任务）更快、更早，根本不涉及"让出"这个动作。

用它的真正原因是：**保证这个tick里所有同步的setState调用完之后，立刻、准确地统一通知一次**——不需要猜一个固定延迟（setTimeout的问题），也不会被拖到"下一轮事件循环"才执行。

> 一句话记忆：渲染撕裂修复 = 不丢弃数据，强制重渲染重新读；`queueMicrotask` = 不让出主线程，比setTimeout更快更精确。

---

## 九、Day23 预告

**主题**：源码模块模拟面试（复用 leetcode-algorithm 的模拟面试节奏），衔接 `meta/job-sprint-plan.md` 阶段A第三天。不学新知识，从 Day1-22 的所有 quiz 里随机抽 15 题，限时口述自检（不查任何资料），暴露出的薄弱点记录进 `notes/day23-gap-list.md`，作为 Day24 面试话术卡的重点。
