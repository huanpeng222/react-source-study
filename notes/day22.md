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

（跟练完成后填写）

---

## 七、动手实验（demos/day22/）

在真实的 Vite + React 项目里跑：

| 实验 | 验证什么 |
|---|---|
| M1 | 手写的 mini-store 是否真的支持 selector 细粒度订阅（一个组件只订阅 `count`，另一个组件改 `name`，前者不应该重渲染） |
| M2 | 批量更新去重是否生效（同一事件里调用 3 次 `setState`，通过 `subscribe` 里打 log 验证只通知了 1 次，不是 3 次） |
| M3 | 对比原生手写"forceUpdate"版本 vs `useSyncExternalStore` 版本，在并发渲染场景下是否有撕裂差异（可选，难度较高） |

---

## 八、验收清单

- [ ] 能说出为什么普通全局变量改了不会触发 React 重渲染
- [ ] 能讲清楚 `useSyncExternalStore` 解决的"渲染撕裂"问题，以及它怎么解决（commit后重新检查快照，用SyncLane强制纠正）
- [ ] 能讲清楚"selector细粒度订阅"其实是 `useSyncExternalStore` 内置的 `Object.is` 比较，不是自己实现的
- [ ] 能讲清楚批量更新去重为什么用 `queueMicrotask`
- [ ] 完成至少 2 个实验并记录到 observations.md

---

## 九、Day23 预告

**主题**：源码模块模拟面试（复用 leetcode-algorithm 的模拟面试节奏），衔接 `meta/job-sprint-plan.md` 阶段A第三天。不学新知识，从 Day1-22 的所有 quiz 里随机抽 15 题，限时口述自检（不查任何资料），暴露出的薄弱点记录进 `notes/day23-gap-list.md`，作为 Day24 面试话术卡的重点。
