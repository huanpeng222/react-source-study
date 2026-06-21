# W1-W2 模拟面试复盘（Day 1~6 知识融合）

> 日期：2026-06-21 ~ 2026-06-22 凌晨
> 面试官姿态：腾讯 T11~T12 / 大厂资深前端
> 候选人：彭环（5 年品牌广告前端，刚跟完 React 源码 Day 1~6）
> 全程时长：约 40 分钟，6 道题
>
> ⚠️ **本文件所有源码引用都标注了 facebook/react 仓库的精确文件路径**。
> 用户 2026-06-22 00:21 主动建立硬规则：源码事实必须来自官方源码，AI 答细节必须标出处。

---

## 📊 总评

```
Q1 暖场（React vs 原生）            5/10
Q2 虚拟 DOM 是否真快                7/10  ⭐
Q3 flushSync 真实场景               6/10  → 接住提示
Q4 console 输出顺序                 9/10  ⭐⭐⭐
Q5 cleanup 时机原理                 5.5/10 → 发现 AI 自相矛盾 +1
Q6 diff 倒序推演                    7.5/10 ⭐

平均：~7/10
面试官最终判定：T10 实力，努力一下能摸到 T11
```

**亮点（罕见品质）**：
- 听清面试官话、**敢质疑 AI 内部矛盾**（layoutCleanup 一会儿放 Mutation 一会儿放 Layout 的前后不一致）
- 结论命中率高
- 工程哲学到位（"性价比 > 极致优化"）

**短板**：
- 推演细节模糊（"LPI 0→3" 但不知具体每一步）
- 不会主动标源码出处
- 开放题（如 flushSync 场景）具体化能力不够

---

## Q1 · 暖场题

> "React 跟你之前用过的 Vue / 原生 JS 比，最让你'觉得设计精妙'或'踩过最深的坑'的一个点是什么？"

### 我的答（5/10）

> "React 跟原生 JS 比，不用手动去操作 DOM，只要进行值跟元素的绑定，值更新时，组件页面会自动更新。还有一个就是虚拟 DOM 的设计，大大减少了页面的重绘与重排。"

### 面试官点评

- ✅ 两个方向都对（声明式 + 虚拟 DOM）
- ❌ 表述像"刚学 React 半年的人"，没体现"读过源码"
- ❌ "虚拟 DOM 减少重绘重排"技术上不严谨

### 高分答模板

> "我从两个角度回答。**工程角度**：React 把'操作 DOM 的心智成本'抽象掉了——开发者写'状态 → UI 映射'，不需要想 querySelector / appendChild / setAttribute 这种增量同步。
>
> **源码角度**：真正精妙的是 **双缓存 Fiber + 可中断 reconcile**。current 树用户看，wIP 树后台算，commit 时切指针完成对换。这套设计让 React 能在保证视觉一致性的前提下实现可中断渲染。
>
> 踩过最深的坑是 **key=index 在列表头部插入时的'身份认错'**——非受控 input 的 value 会跟错行，这不是性能问题，是正确性问题。"

---

## Q2 · 虚拟 DOM 是否一定比原生快

> "虚拟 DOM 一定比原生快吗？给个具体例子。"

### 我的答（7/10 ⭐）

> "虚拟 DOM 不一定比原生 JS 操作 DOM 快，在页面元素较简单时，原生操作 DOM 反而更快；只是在页面组件更复杂时，虚拟 DOM 的优点会体现出来，比如 React 会对 setState 进行批处理，这个时候会合成一次 commit，虚拟 dom 进行一次 render。"

### 面试官点评

- ✅ **"虚拟 DOM 不一定快"是加分项**（破除迷信）
- ✅ "批处理 → 一次 commit"抓到核心
- 🟡 "虚拟 DOM 进行一次 render" 措辞有歧义

### 高分答模板

> "**核心结论：虚拟 DOM 不是性能银弹，是心智成本和性能的取舍。**
>
> 极致优化的手写原生 JS 一定比 React 快——但要付出'每次都得手动想 DOM 操作如何最小化'的心智成本。
>
> React 的真正优势是：**多个 setState 自动合并成一次 commit，浏览器只 reflow + repaint 一次**。
>
> 比如循环 100 次 setN(n => n + 1)，React 18 默认批处理 → 一次 commit；如果用原生 JS 100 次 innerHTML，会触发 100 次 reflow，浏览器卡死。"

---

## Q3 · flushSync 真实场景

> "既然 React 默认批处理，那为什么还要 flushSync？给一个真实业务场景。"

### 我的答（6/10）

> "默认行为会进行批处理，所以通过 flushSync 来进行跳出，比如在第一次更新 state 时，要根据这个状态下页面上的一些 dom 布局来决定下一步需要怎么实现时。"

### 面试官点评

- ✅ 抓到核心机制（默认批处理 → flushSync 跳出）
- ❌ 场景太抽象，没具体到"测什么布局、改什么 DOM"
- ❌ 没给反例

### 三个真实场景（背一个就够用）

#### 场景 1：FLIP 动画

> "做卡片重排动画。点击按钮把列表从 ABCD 改成 DCBA：
> 1. 变更前 getBoundingClientRect 记录每张卡片当前位置
> 2. **flushSync(() => setState(新列表))** → 强制立即 commit
> 3. 再次 getBoundingClientRect 得到新位置
> 4. 用 transform: translate(旧 - 新) 把卡片瞬移回旧位置
> 5. 下一帧 transform: translate(0) → 浏览器画出平滑过渡
>
> **关键是第 2 步必须 flushSync**——不然 React 还没 commit，DOM 还是旧的，拿不到新位置。"

#### 场景 2：路由切换后 scrollTo

> "页面切换时 setState 改路由内容 + window.scrollTo(0, 0)。不 flushSync 时 scrollTo 跑在旧页面（短）上，新页面（长）渲染后滚到中间。"

#### 场景 3：第三方库初始化

> "老图表库要求 'DOM 必须先存在'才能 new ChartJS(dom)，setState 让 div 渲染后立刻 new 会找不到节点。flushSync 强制 commit 后再 new。"

### 反例（什么时候不该用）

> "**只有 setState 后需要立即读 DOM 真实状态才用 flushSync**。表单字段联动这种'只要最终一致'的场景不用。flushSync 会破坏自动批处理，性能反模式。"

---

## Q4 · console 输出顺序（核心题）

```jsx
function App() {
  const [n, setN] = useState(0);
  console.log('🎨 render:', n);
  useEffect(() => {
    console.log('🔵 effect:', n);
    return () => console.log('🔴 cleanup:', n);
  }, [n]);
  useLayoutEffect(() => {
    console.log('🟡 layoutEffect:', n);
    return () => console.log('🟠 layoutCleanup:', n);
  }, [n]);
  return <button onClick={() => setN(1)}>{n}</button>;
}
```

### 我的答（9/10 ⭐⭐⭐）

```
初次加载：render: 0、layoutEffect: 0、effect: 0
点击后：  render: 1、layoutCleanup: 0、cleanup: 0、layoutEffect: 1、effect: 1
```

### 面试官点评

- ✅ 主体顺序完全对
- ✅ cleanup 在前、effect 在后
- 🟡 唯一小瑕疵：把 cleanup 放在 layoutEffect 前是错的

### 精确版

```
初次加载：
  🎨 render: 0
  🟡 layoutEffect: 0      ← Phase 3 Layout 同步
  （浏览器 paint）
  🔵 effect: 0            ← 异步 flushPassiveEffects
  
点击后：
  🎨 render: 1
  🟠 layoutCleanup: 0     ← Phase 2 Mutation 同步
  🟡 layoutEffect: 1      ← Phase 3 Layout 同步
  （浏览器 paint）
  🔴 cleanup: 0           ← passive 阶段同步第 1 步
  🔵 effect: 1            ← passive 阶段同步第 2 步
```

### 源码出处

`packages/react-reconciler/src/ReactFiberCommitWork.js`：
- `commitMutationEffects` 内部按 flags 分发，layoutCleanup（HookLayout flag）跑在 Mutation
- `commitLayoutEffects` 跑 useLayoutEffect 的回调
- `flushPassiveEffects` 异步跑 useEffect 的 cleanup + effect

### 核心口诀

> **layoutCleanup（Mutation） → 改 DOM → layoutEffect（Layout） → paint → cleanup + effect（异步）**
>
> useLayoutEffect 的 cleanup 和 effect **不在同一阶段**（中间夹了 DOM 改变）；
> useEffect 的 cleanup 和 effect **在同一异步阶段**（先 cleanup 后 effect）。

---

## Q5 · cleanup 时机原理（深挖）

> "layoutCleanup 跑在哪个子阶段？为什么必须放在那里？useEffect cleanup 为什么不像 layoutCleanup 那样同步跑？同步设计会出什么问题？"

### 我的答（5.5/10）

> "layoutCleanup 跑在 commit 的 Mutation 阶段，这个时候 dom 还未变更，需要卸载一些旧的 dom 事件。cleanup（useEffect 的）跑在下一次 commit 中的 layout 阶段，是异步跑的。useEffect 的 cleanup 也设计成同步跑时，页面会有卡顿的感觉。"

### 面试官点评

- ✅ Q1 layoutCleanup 阶段对
- ❌ Q2 cleanup 位置错（不是"下次 commit"，是"当前 commit 后异步"）
- 🟡 Q3 防卡顿对但浅

### ⭐ 关键时刻：我（面试官）说错了

我之前一段说"Phase 3 Layout → 跑 layoutCleanup 旧 → layoutEffect 新"——
学习者立刻反问"前后矛盾"。

**真相精确版**：

```
Phase 2 Mutation（同步）:
  step 2a: 跑 useLayoutEffect 的旧 cleanup
  step 2b: 改 DOM
  step 2c: root.current = wIP（身份对换）
  
Phase 3 Layout（同步）:
  step 3a: 跑 useLayoutEffect 的新 effect
  step 3b: 调 componentDidMount/cDU
  step 3c: 绑新 ref

浏览器 paint

异步 flushPassiveEffects:
  step 4a: 跑 useEffect 的旧 cleanup
  step 4b: 跑 useEffect 的新 effect
```

**设计精髓**：**cleanup 看旧 → 改 DOM → effect 看新**，layoutCleanup 和 layoutEffect "夹住" DOM 改变。

### 同步设计的代价（高分答的杀手锏）

> "useEffect cleanup 跑得晚 → 存在'残留监听'窗口期。
>
> 比如组件 A unmount → 它的 useEffect cleanup 还没跑 → 这一瞬间订阅还活着 → 如果数据源 push 事件，A 已经销毁了却收到 → 可能 setState 报警告。
>
> React 用 try/catch 兜底这个窗口。这就是为什么 React 19 引入 `use` 和更激进的 Suspense 数据加载方案——尝试减少这种异步副作用的窗口期。"

### 源码出处

`packages/react-reconciler/src/ReactFiberCommitWork.js`：
- `commitHookEffectListUnmount(HookLayout, ...)` 在 commitMutationEffects 中调用
- `commitHookEffectListMount(HookLayout, ...)` 在 commitLayoutEffects 中调用
- `commitHookEffectListUnmount(HookPassive, ...)` + `commitHookEffectListMount(HookPassive, ...)` 都在 `flushPassiveEffects` 中调用（异步）

---

## Q6 · diff 倒序推演（分水岭题）

> `[A, B, C, D] → [D, C, B, A]` 完全倒序，回答 4 件事：
> 1. 第一轮在哪 break
> 2. 第二轮逐步推演（含 LPI 变化）
> 3. Placement 总数
> 4. React 贪心 vs Vue 3 LIS 取舍

### 我的答（7.5/10 ⭐）

> "1. A 与 D 的 key 值不一样，直接 break，进入第二轮。
> 2. 第二轮用 map 结构，lastPlacedIndex 0→3，C、B、A 都标记移动。
> 3. (3 个)
> 4. Vue 3 的 LIS 移动得更少，React 认为大部分情况下贪心算法是足够的，算法简单，性价比高。"

### 面试官点评

- ✅ 结论命中（第一轮 break / Map / Placement 3 个 / 取舍哲学）
- 🟡 第二轮推演没给细节（"0→3"但不知具体每一步）
- ❌ 没意识到完全倒序时 LIS 和贪心**移动次数相同**

### 精确推演（源码逐步）

第二轮 Map：`{A→idx=0, B→idx=1, C→idx=2, D→idx=3}`，LPI=0

| 步 | 新 | oldIndex | 判定 `oldIndex < LPI` | placeChild 分支 | 动作 | 新 LPI |
|---|---|---|---|---|---|---|
| 0 | D | 3 | 3 < 0? ❌ | `else { return oldIndex }` | 保持原位 | **3** |
| 1 | C | 2 | 2 < 3? ✅ | `if { flags |= Placement; return LPI }` | ⭐ Placement | 3 |
| 2 | B | 1 | 1 < 3? ✅ | 同上 | ⭐ Placement | 3 |
| 3 | A | 0 | 0 < 3? ✅ | 同上 | ⭐ Placement | 3 |

⭐ **关键洞察**：LPI 只在第 0 步从 0 跳到 3，**之后一直停在 3**——后续节点都被判 Placement，placeChild 返回 lastPlacedIndex 本身。

### 源码出处

`packages/react-reconciler/src/ReactChildFiber.js` 的 `placeChild`：

```js
function placeChild(newFiber, lastPlacedIndex, newIndex) {
  newFiber.index = newIndex;
  ...
  const current = newFiber.alternate;
  if (current !== null) {
    const oldIndex = current.index;
    if (oldIndex < lastPlacedIndex) {
      // This is a move.
      newFiber.flags |= Placement | PlacementDEV;
      return lastPlacedIndex;
    } else {
      // This item can stay in place.
      return oldIndex;
    }
  } else {
    // This is an insertion.
    newFiber.flags |= Placement | PlacementDEV;
    return lastPlacedIndex;
  }
}
```

### React 贪心 vs Vue 3 LIS 精确版

完全倒序场景下：

**Vue 3 LIS**：
- source 数组：`[3, 2, 1, 0]`
- 最长递增子序列 = 长度 1（任何单元素，比如 `[3]`）
- 保持 1 个不动 → 移动 3 个

**React 贪心**：
- 也保持 1 个不动（D 当锚点）→ 移动 3 个

⭐ **彩蛋**：**完全倒序时 React 和 Vue 3 移动次数相同**！LIS 优势只在**部分乱序**时体现（比如 `[A,B,C,D,E] → [C,A,B,E,D]`，React 多移动 1 次）。

---

## 🎤 5 句"面试时直接背"的口诀

1. **flushSync 用法**："只在 setState 之后需要立即读 DOM 真实状态才用，比如 FLIP 动画的位置测量"

2. **effect 时序**："layoutCleanup 在 Mutation，layoutEffect 在 Layout，useEffect 的 cleanup + effect 都在 paint 后异步同跑"

3. **cleanup 设计哲学**："cleanup 看旧 → 改 DOM → effect 看新，夹住 DOM 改变"

4. **diff 贪心精髓**："lastPlacedIndex 是已放置最右端柱子，旧位置在柱子左边就要 Placement，右边就保持原位、推柱子"

5. **React vs Vue 3 取舍**："Vue 3 LIS 是理论最优，React 贪心通常多 0-2 次移动——React 选简单源码换可维护性，'性价比 > 极致优化'是 React 工程哲学"

---

## 🐛 5 个真实踩坑（今晚暴露的）

1. **flushSync 场景具体化能力差**：知道概念但举不出 3 个真实业务场景
2. **layoutCleanup vs cleanup 阶段混淆**：以为 cleanup 跑在"下次 commit 的 layout"
3. **不知道 useEffect 异步设计的代价**："残留监听窗口"概念缺失
4. **diff 推演细节模糊**：能说 LPI 变化但说不清"何时停何时推"
5. **不知道完全倒序时 React 和 Vue 3 等价**：以为 LIS 一定更优

---

## 📚 下次面试前必背的源码地图

| 主题 | 文件 | 关键函数 |
|---|---|---|
| diff 算法 | `packages/react-reconciler/src/ReactChildFiber.js` | `reconcileChildrenArray` / `placeChild` / `updateSlot` |
| commit 三阶段 | `packages/react-reconciler/src/ReactFiberCommitWork.js` | `commitMutationEffects` / `commitLayoutEffects` |
| Hook 实现 | `packages/react-reconciler/src/ReactFiberHooks.js` | `mountState` / `updateReducer` / `dispatchSetState` |
| 工作循环 | `packages/react-reconciler/src/ReactFiberWorkLoop.js` | `workLoop` / `performUnitOfWork` |
| beginWork | `packages/react-reconciler/src/ReactFiberBeginWork.js` | `beginWork` / `updateFunctionComponent` |
| completeWork | `packages/react-reconciler/src/ReactFiberCompleteWork.js` | `completeWork` / `bubbleProperties` |

---

## 🎯 给"明天面试的我"的最后建议

1. **先抛框架再填细节**："我从两个角度回答"开场
2. **结论用数字、场景用代码**：不要说"差不多"，要说"3 次移动"、"用 FLIP 动画的 getBoundingClientRect"
3. **承认不知道时反而加分**：直接说"这个细节我不确定，需要确认源码"
4. **敢质疑面试官**：今晚发现 AI 矛盾这件事，正式面试遇到同样情况要主动指出
5. **永远标源码出处**：让面试官知道你真的读过

---

_本文件源码引用全部来自 facebook/react main 分支，2026-06-22 通过 WebFetch 实时拉取验证。_
