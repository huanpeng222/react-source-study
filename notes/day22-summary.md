# Day 22 精简笔记 — 自研 mini-store

> 速查卡，面试前快速过一遍。完整教程见 `day22.md`。

## 核心结论

**外部 store（Zustand/Redux/mini-store）不是 React 内部的东西**，是站在 React 外面、用 `useSyncExternalStore` 这个官方"桥"接进来的。React 内部状态存在 fiber 上（Day6），外部状态存在模块级闭包里，两者互不知道对方，需要桥梁连接。

## mini-store 骨架（不到 40 行）

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
      queueMicrotask(() => { isNotifyScheduled = false; notify(); });
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}

function useStore(store, selector = s => s) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
```

## 三个核心认知（容易搞混的点）

| 误解 | 真相 |
|---|---|
| selector细粒度是自己写的判断逻辑 | 广播无差别，细粒度是 `useSyncExternalStore` 内置的 `Object.is` 比较，各组件自己过滤 |
| 批量去重该用定时器 | 该用 `queueMicrotask`——不用猜延迟，同步代码跑完立刻执行，不是"让出主线程" |
| 渲染撕裂修复是"丢弃旧数据" | 没丢弃任何数据，是"发现快照不一致→强制重渲染→让组件重新读最新值" |

## `useSyncExternalStore` 撕裂修复机制（源码级）

```
render阶段：getSnapshot() 同步读一次，记为 inst.value
useEffect阶段：才真正建立订阅（subscribe）
commit之后：checkIfSnapshotChanged 重新读一次快照，跟 inst.value 比较(Object.is)
  不一致 → forceStoreRerender → 用 SyncLane(最高优先级) 强制重渲染
```

外部store更新永远走SyncLane，这是Zustand/Redux比普通setState感觉更"跟手"的原因，但也意味着订阅频繁变化的不重要字段可能有性能代价。

## `subscribe` 返回取消订阅函数的原因

不是"每次通知完要重新绑定"（订阅是长期有效的登记）。真正原因：配合 `useEffect` 的 cleanup 机制——组件卸载时 React 自动调用这个返回值，把自己从 `listeners` 摘掉，防止内存泄漏 + 操作已卸载组件报错。这跟 Day7 讲的 effect cleanup 是同一个模式。

## 我的疑问追问记录

1. "subscribe为什么要返回取消订阅函数" → 配合useEffect cleanup，非重新绑定
2. ".bind()那行在useEffect里又是什么意思" → bind不是调用是打包函数，mountEffect才决定何时调用
3. "useSyncExternalStore是什么" → React内部状态vs外部状态的桥梁，三个参数(subscribe/getSnapshot/getServerSnapshot)

## 我的踩坑记录

- **验收清单自查纠错**：渲染撕裂修复不是"丢弃数据"；`queueMicrotask` 不是"让出主线程"而是"立刻执行"（认知纠正#79/#80）
- **实战bug**：`setState` 忘记调用 `notify()`——数据层正确更新了，但订阅者不知道，页面值不跟着变。数据更新和通知是两个独立步骤，缺一不可。

## 面试话术版

**Q: 讲讲你怎么理解Zustand这类状态库的底层原理？**

"核心骨架很简单——一个模块级的闭包保存state，配合subscribe/notify做订阅通知。真正的技术难点不在store本身，而在'怎么安全地接入React的渲染系统'，这靠的是React 18提供的useSyncExternalStore。它解决的核心问题是渲染撕裂：因为render阶段读快照和useEffect阶段才建立订阅之间有个窗口期，并发渲染下可能读到不一致的数据。useSyncExternalStore在每次commit完成后会重新检查快照，如果和渲染时读到的不一致，就用最高优先级的SyncLane强制重渲染纠正。selector的细粒度订阅也不是store自己实现的，是useSyncExternalStore内置的Object.is比较——广播永远是无差别的，只是没变化的组件会被React自动挡住不渲染。"
