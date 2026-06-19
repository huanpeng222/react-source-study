# Day 5 自测题（答案折叠，先自己答）

## Q1
commit 阶段的三个子阶段是哪三个？各自做什么？

<details><summary>👉 答案</summary>

| 子阶段 | 做什么 |
|---|---|
| Phase 1: Before Mutation | 调 getSnapshotBeforeUpdate（类组件）+ 异步调度 useEffect |
| Phase 2: Mutation | 按 flags 改 DOM + 卸载旧 ref + 跑上次 useEffect cleanup + 切 root.current |
| Phase 3: Layout | 同步跑 useLayoutEffect + cDM/cDU + 绑定新 ref |

paint 之后异步 flushPassiveEffects 跑本次的 useEffect 回调。

</details>

## Q2
useLayoutEffect 和 useEffect 触发时机的精确差异？

<details><summary>👉 答案</summary>

**两者都在 DOM 已就位之后跑**，区别在 paint 前后：

| | useLayoutEffect | useEffect |
|---|---|---|
| DOM 就位 | ✅ | ✅ |
| 浏览器绘制 | ❌ 还没 | ✅ 已绘制 |
| 阻塞 paint | ✅ | ❌ |

口诀：**Layout 看不到（绘制前），Effect 看到了（绘制后）。**

</details>

## Q3
下面代码点击按钮，console 输出顺序？

```jsx
function App() {
  const [n, setN] = useState(0);
  console.log('render:', n);
  useLayoutEffect(() => console.log('useLayoutEffect:', n), [n]);
  useEffect(() => console.log('useEffect:', n), [n]);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
```

<details><summary>👉 答案</summary>

```
render: 1
useLayoutEffect: 1     ← Phase 3 同步
（浏览器绘制）
useEffect: 1           ← 异步触发
```

</details>

## Q4
root.current 在 commit 哪个时刻切换？为什么不放 Phase 1 开始？

<details><summary>👉 答案</summary>

**Mutation 末尾、Layout 开始前**切换。

如果放 Phase 1 开始：
- DOM 还没改，但 root.current 已经指向 wIP
- Phase 2 Mutation 操作 DOM 时如果出错回滚不了
- 中间状态不一致

放 Mutation 末尾：
- DOM 已经全部改完（一致状态）
- Layout 阶段的 cDM / useLayoutEffect / this / ref 都基于新树是对的

</details>

## Q5
getSnapshotBeforeUpdate 解决什么问题？聊天框场景里"新消息追加（底部）"和"加载历史消息（顶部）"哪个需要它？

<details><summary>👉 答案</summary>

**解决问题**：DOM 变更前后保持滚动位置 / 焦点 / 选区。

只有**顶部插入**场景需要：
- 底部追加新消息：浏览器自动保持 scrollTop 不变 = 视觉不变（不需要）
- **顶部插入历史消息**：原内容向下挤 N px，必须 scrollTop += N 抵消（需要）

公式：`scrollTop_new = scrollHeight_new - snapshot`（snapshot = scrollHeight_old - scrollTop_old）。

</details>

## Q6
为什么 React 用宏任务（MessageChannel）调度 useEffect，而不用微任务（queueMicrotask）？

<details><summary>👉 答案</summary>

```
微任务调度：commit → 清空微任务（跑 effect）→ paint   → 阻塞 paint ❌
宏任务调度：commit → paint → 下个宏任务（跑 effect）  → 用户先看到 ✅
```

事件循环规则：**宏任务必须等微任务全部清空才能跑**。

如果 effect 是微任务 → 阻塞 paint（用户看不到画面，直到 effect 跑完）。
用宏任务 → paint 优先，用户先看到画面。

</details>

## Q7
下面代码点击 2 次按钮，console 输出？

```jsx
function Demo() {
  const [dep, setDep] = useState(0);
  useEffect(() => {
    console.log('effect:', dep);
    return () => console.log('cleanup:', dep);
  }, [dep]);
  return <button onClick={() => setDep(d => d + 1)}>{dep}</button>;
}
```

<details><summary>👉 答案</summary>

```
首次渲染：
  effect: 0

点击 1 次：
  cleanup: 0      ← Mutation 同步跑（上次留下，dep 是闭包旧值）
  effect: 1       ← flushPassiveEffects 异步跑（本次新值）

点击 2 次：
  cleanup: 1
  effect: 2
```

关键观察：cleanup 跑的是**上次 render** 留下的；effect 跑的是**这次 render** 新建的。

</details>

## Q8
useTransition 让 commit 可中断了吗？和 Suspense 是什么关系？

<details><summary>👉 答案</summary>

**没有**。useTransition 只让 **reconcile 可丢弃重做**：
- setState 标记 Transition Lane（低优先级）
- reconcile 中高优先级 setState 进来 → 丢弃当前 wIP 重新跑
- 一旦进 commit → 同步跑完不可中断

**useTransition ≠ Suspense**（两个独立机制）：
- useTransition：标记低优先级 Lane
- Suspense：捕获 throw promise 显示 fallback

经常配合（搜索场景），但本质独立。

</details>

## Q9
JS 单线程下，下面代码输出顺序？

```js
console.log('1');
setTimeout(() => console.log('2'), 0);
Promise.resolve()
  .then(() => { console.log('3'); return Promise.resolve(); })
  .then(() => console.log('4'));
queueMicrotask(() => console.log('5'));
console.log('6');
```

<details><summary>👉 答案</summary>

`1 → 6 → 3 → 5 → 4 → 2`

观察：
- 同步代码先跑（1, 6）= 当前宏任务
- 微任务队列清空：按入队顺序 3 → 5，第二个 `.then` 需要等第一个 then 返回的 Promise resolve（一个微任务延迟），所以 4 在 5 之后
- 下一个宏任务（2）

</details>

---

## 完成后

把答错的题对应的章节，在 `notes/day5.md` 里重读一遍。

下一站：**Day 6 · W2 Hooks 实现原理（useState 源码 + dispatch + 批处理）**。
