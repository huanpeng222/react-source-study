# Day20 — useTransition / useDeferredValue：两个"不那么急"的更新方式

> 📌 **主线位置**：衔接 Day19 Scheduler 结尾预告，对应原 `meta/roadmap.md` 的 **D14**。Day19 讲完了"任务怎么排队、怎么让出主线程"，今天讲**这套机制在 Hooks 层是怎么被 `useTransition`/`useDeferredValue` 包起来给你用的**——这两个 Hook 是 TransitionLane（Day10 讲过的概念）在用户 API 层面的两个入口。
>
> 日期：2026-07-07（2026-07-07 重写：初版堆砌大段压缩源码，学习者反馈"太晦涩，读完没有明确理解"，本版先用类比建立直觉，源码只作零星佐证）
> 状态：📖 教程完成，待跟练
> 源码依据：已下载 `react-dom@19.1.0` 的 `cjs/react-dom-client.development.js` 逐行核实（本篇引用的每一行代码都在这份文件里能对照到，行号会因版本漂移，仅供定位参考）。

---

## 零、入场自测（先答，不会就写"不会"）

1. `useTransition` 返回的 `isPending` 是靠什么机制驱动更新的——是一个特殊的内部状态，还是普通的 `useState`？

2. `startTransition(callback)` 执行的时候，`callback()` 里面那些 `setState` 是"立刻变成低优先级"，还是"通过某个全局标记间接影响"？

3. `useDeferredValue(value)` 和普通的 `useState` + `useEffect` 做防抖有什么本质区别？（提示：想想它返回的到底是"新值"还是"旧值"）

4. 如果我在一个已经处于同步渲染（比如离散事件触发的紧急更新）中调用 `useDeferredValue`，它还会"延迟"吗？

---

## 一、先讲一个类比，把整个心智模型立住

想象你在一个繁忙的柜台前工作，同时处理两类请求：

- **急件**：客户站在你面前等，你必须马上办（对应同步/紧急渲染）
- **缓办件**：不用立刻交付，可以先应付过去，晚点再补（对应 transition/deferred 渲染）

**`useTransition` 相当于你自己主动说**："这一批我接下来要办的事，不急，谁来插队都让他先。"——这是**你主动申报**的，你控制的是"接下来要做的这一段事情"。

**`useDeferredValue` 相当于**：柜台后面有个显示牌，显示"当前处理到第几号"。当有人报了新号（value 变了），显示牌**不会立刻跳数字**——如果你正在办一件急事，显示牌先维持原来的数字撑一下场面，等你把急事办完、有空的时候，才悄悄把数字更新成最新的。**这个数字（value）本身不是你申报的，是别人（父组件/外部数据源）给你的，你没法改变"谁给你这个数字"这件事，只能决定"显示它的时机能不能拖一拖"。**

> 💡 一句话记住区别：**`useTransition` 管的是"一段代码"，`useDeferredValue` 管的是"一个值"。前者你能改造触发点，后者你只能接收别人给的值。**

---

## 二、useTransition：拆开看它内部到底装了什么

### 2.1 先问一个问题：`isPending` 是什么

如果你自己要实现一个"记录是否忙碌"的状态，最朴素的做法是什么？——就是一个开关：

```
忙碌前：isBusy = true
干完活：isBusy = false
```

**这正是 `useTransition` 里 `isPending` 的真相：它就是一个普普通通的 `useState(false)`，没有任何魔法。**

`useTransition()` 表面上是一个 Hook，但它内部其实**同时用了两个 hook 位**：

```
位①：存 isPending 这个状态（本质是 useState）
位②：存一个提前"绑好参数"的函数——也就是你拿到的 startTransition
```

为什么要提前绑好参数存起来？因为这样每次组件重新渲染，你拿到的 `startTransition` 都是**同一个函数引用**，可以放心塞进 `useEffect` 依赖数组，不会因为引用变化触发多余的副作用。

**源码只留一个关键片段作证**（不用逐字读，看第一行就够）：

```js
function mountTransition() {
  var stateHook = mountStateImpl(false);   // ← 就是这一行：内部真的挂了一个 useState(false)
  // ...后面是把 startTransition 绑好参数存起来，细节不重要
}
```

> 📌 **回答入场自测 Q1**：`isPending` 的**主体机制就是普通 `useState`**。唯一的例外：如果你传给 `startTransition` 的 callback 是一个 **async 函数**（返回 Promise），`isPending` 会暂时变成一个"类 Promise 对象"，等这个 Promise resolve 了才真正变回 `false`——这是 React 19 Actions（Day13 讲过）新增的能力，是**例外分支**，不是常态。上次你答"靠抛出的 promise 状态标识"，把这个例外当成了主体，方向反了。

> 📌 **微检查点 1**：更新时会走 `updateTransition`，重渲染时（Day6-9 讲过的场景）会走 `rerenderTransition`。你还记得 Day6-9 讲 Hooks 时，什么场景下会触发"重渲染分支"（即同一次渲染里 setState 又触发了一轮）？

### 2.2 startTransition：怎么让 callback 里的更新"变得不急"

这是今天最重要的一步，我用一个类比先讲懂，再看代码。

**类比**：想象你在门上挂一个牌子，牌子写着"内部施工中，请稍候"。你挂上牌子（①），然后进去干活（②）。干活期间，任何想进门的人看到牌子，都知道"现在这里的事不紧急"。干完活，你把牌子摘掉（③）。

`startTransition` 做的正是这三步：

```
① 挂牌子：把一个全局变量（ReactSharedInternals.T）设成"非空"
② 干活：同步执行你传进来的 callback()
③ 摘牌子：把那个全局变量还原成原来的值（null 或者外层的牌子）
```

**关键在于**：`callback()` 里面的每一次 `setState`，在被处理的那一刻，都会去**看一眼这个全局牌子还挂着没**。挂着 → 就去申请一个"不急"的优先级（TransitionLane）；没挂 → 就走正常的优先级判断（Day10 讲的四分支决策树）。

```
setState 触发
   ↓
瞧一眼全局牌子（ReactSharedInternals.T）
   ↓
牌子挂着？
  是 → 申请一个 TransitionLane（专属的"不急"优先级）
  否 → 走正常优先级判断（Day10 的决策树）
```

> 📌 **回答入场自测 Q2**：不是"立刻变成低优先级"，也不是"直接设置 lanes 的值"——是**间接**的三步式："挂牌子（全局标记）→ 干活期间每次 setState 检测牌子 → 检测到才去申请具体的 lane"。上次你答"通过设置 lanes 的值来标识优先级"，方向没错，但漏了中间这层"标记 + 检测"的机制，以为是直接一步赋值。

**为什么干完活一定要把牌子摘掉？** 因为这是个**全局共享的牌子**——如果不摘，后面所有代码触发的更新都会被误判成"还在不急的状态里"，这是个很危险的副作用，所以源码里用 `try/finally` 保证一定会摘牌子。

**为什么摘牌子这个动作可靠？** 因为 `callback()` 是**同步执行**完的，不是丢进某个队列异步执行。哪怕 callback 内部是个 async 函数，"挂牌子→执行→摘牌子"这三步依然是围绕这一次同步调用栈完成的——async 函数里真正的异步部分，靠另一套机制（thenable）单独续接，不依赖牌子一直挂着。

> ⚠️ 术语对照：这个"全局牌子"在源码新版本里叫 `ReactSharedInternals.T`，老版本文档/教程常写作 `ReactCurrentBatchConfig.transition`——同一个东西，字段改了名。

### 2.3 挂牌子之后，具体换算成哪个 lane

牌子挂着只是"信号"，真正干活时还得算出一个具体的优先级数值（lane）。这一步交给 `requestUpdateLane` 函数：

```
检测到牌子挂着（transition !== null）
   ↓
去"不急优先级"的专属仓库里领一个号（claimNextTransitionLane）
   ↓
这个仓库的号是轮转发放的——发完一个号，下次自动发下一个号
```

**为什么要轮转发号，不是一直用同一个号？** 因为如果你连续开了两个不同的 transition（比如快速点了两次 Tab 切换），每个 transition 领到不同的号，之后 React 才能**精细区分**"哪个 transition 该被打断、哪个该继续保留"——如果两个 transition 混用同一个号，React 就没法区分它们了。

---

## 三、useDeferredValue：不是防抖，是"允许你先用旧值撑一下"

### 3.1 先纠正一个常见的错误理解

很多人第一次看到 `useDeferredValue` 会以为它跟"防抖/节流"是一回事——**这是错的**，先讲清楚区别：

```
防抖：故意拖延"调用的时机"——用户停止输入 300ms 后才真的去更新
useDeferredValue：调用没有被拖延，value 立刻是最新的——
                  但组件"消费"这个值的时机被拖延了
```

用类比说：防抖是"我等你说完话再反应"；`useDeferredValue` 是"你说的话我立刻听到了，但我先假装没听到、继续做手上的事，等我有空了再回应你说的内容"。

> 📌 **回答入场自测 Q3**：`useDeferredValue` 不是防抖。它返回的可能是**旧值**——意思是"这次渲染里，你先拿旧值撑住界面，React 会在后台单独调度一次低优先级渲染，等那次渲染完成，你的组件会重新拿到最新值"。防抖是**人为拖延调用**，`useDeferredValue` 是**值本身没拖延，只是消费它的渲染被 React 的调度自然错开**。

### 3.2 什么时候该用旧值，什么时候该用新值——这是本节的核心判断

这里正是你上次答反的地方，我们重新过一遍逻辑。

先问自己一个问题：**"要不要延迟"这件事，到底应该看什么来决定？**

答案是：**看"这次渲染本身有多急"，不是看"会不会被打断"**。这两个是完全不同的问题：

```
问题 A（useDeferredValue 关心的）：
  "这次渲染是紧急插进来的，还是本来就是悠闲的？"
  → 决定"这次该展示新值还是继续用旧值垫着"

问题 B（Scheduler + Lane 冒泡关心的，Day19 讲过）：
  "有没有比我更急的任务要抢我的位置？"
  → 决定"我这次渲染会不会被打断、要不要让出主线程"
```

**`useDeferredValue` 只回答问题 A，跟问题 B 完全无关。** 上次你把这两个问题当成一回事，所以答反了。

现在讲问题 A 具体怎么判断：

```
这次渲染是"紧急插进来的"（比如用户刚敲了个字，触发的是同步/紧急更新）
   → 正是这种时候，才需要"延迟"！用旧值撑住界面，别让重计算卡住这次紧急渲染
   → 新值的展示，另外单独安排一次不紧急的渲染去做

这次渲染本身"已经是悠闲的"（比如这次渲染本身就是刚才安排的那次低优先级补渲染）
   → 已经不紧急了，不需要再拖一次，直接用新值
```

> 📌 **回答入场自测 Q4（重新纠正）**：如果当前处于同步/紧急渲染中，`useDeferredValue` **会**触发延迟，返回旧值——**正是这种场景才是它存在的意义**。反过来，只有当渲染本身已经是低优先级的，它才不用再延迟。上次你答"不会延迟，因为紧急更新优先级更高不会打断"——这里犯了两个错：一是把"延迟"和"打断"当成一回事（分别对应上面的问题 A 和问题 B）；二是结论刚好答反了，同步/紧急渲染恰恰是**触发**延迟的条件，不是不延迟的条件。

**源码怎么判断"这次渲染紧急不紧急"？** 用一个位运算：看这次渲染携带的 lane 组合里，有没有命中"紧急"那几种 lane（Sync、InputContinuous、Default）。命中了 → 紧急 → 延迟返回旧值；没命中 → 悠闲 → 直接给新值。这只是一次简单的位掩码判断，不用死记数字，记住"判断这次渲染紧不紧急"这个语义就够了。

### 3.3 首次渲染的一个小彩蛋：`initialValue`

如果你给 `useDeferredValue(value, initialValue)` 传了第二个参数，**首次渲染**会先用这个占位值把界面撑起来，真实的 `value` 也推到后台单独渲染——这对首屏渲染有好处：不用让首次渲染就承担一次重计算。这是 React 18.3+/19 新增的能力，React 18 最初版本只有一个参数。

---

## 四、把两者放进一个真实场景对比着看

**场景**：搜索框输入实时过滤一个很大的列表。

### 方案 A：useDeferredValue（你只能拿到 query 这个值，改不了它怎么产生）

```jsx
function SearchPage() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <HeavyList query={deferredQuery} />
    </>
  );
}
```

**时序讲成故事**：用户敲一个字 → `query` 立刻更新，输入框跟手不卡顿 → 但这次渲染是紧急的（离散事件触发）→ `deferredQuery` 判断"这次紧急，先用旧值撑一下" → `HeavyList` 暂时还显示旧结果，不会因为重计算卡住输入 → React 后台悄悄安排一次不紧急的渲染 → 这次渲染悠闲，直接用新值 → `HeavyList` 更新成最新结果。

### 方案 B：useTransition（你能改造 onChange，自己决定哪部分该挂"不急"的牌子）

```jsx
function SearchPage() {
  const [query, setQuery] = useState('');
  const [displayQuery, setDisplayQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleChange(e) {
    setQuery(e.target.value);              // 紧急：输入框跟手
    startTransition(() => {
      setDisplayQuery(e.target.value);     // 挂"不急"的牌子：大列表用的查询词
    });
  }

  return (
    <>
      <input value={query} onChange={handleChange} />
      {isPending && <Spinner />}
      <HeavyList query={displayQuery} />
    </>
  );
}
```

**怎么选**：

| 场景 | 选择 |
|---|---|
| 你能改造触发更新的代码（自己写的 onChange） | `useTransition`（还能拿到 `isPending` 显示 loading） |
| 你只能拿到一个外部传入的 value（比如父组件传的 props），改不了它的产生逻辑 | `useDeferredValue` |
| 需要明确的 pending 状态做 UI 反馈（比如显示 loading 图标） | `useTransition` |

---

## 五、把 Day10 / Day19 / Day20 串成一条完整链路

```
用户交互触发 setState
        ↓
【今天讲的】是否挂了"不急"的牌子（在 startTransition 里）？
  是 → 检测到牌子 → 去专属仓库领一个 TransitionLane
  否 → 走正常优先级判断（Day10 的四分支决策树）
        ↓
lane 冒泡标记到 fiber 上（Day10 讲的 lanes / childLanes 字段）
        ↓
lane 换算成 Scheduler 认识的优先级 → 排进最小堆（Day19）
        ↓
【打断发生在这里，跟今天讲的"延迟"是两件事】
如果这时候又来了一个更急的任务 → 它排到堆顶 → 正在跑的低优先级渲染让出主线程
        ↓
最终这批"不急"的更新真正跑完 → isPending 变回 false / deferredValue 追上最新值
```

**记住这张图里的分界线**：牌子、领号、冒泡、排堆、让出——这一整条链路解决的是"谁先跑、跑多久"（打断问题）；而 `useDeferredValue` 内部"这次该用新值还是旧值"的判断，是另一条独立的小逻辑，只是刚好也依赖同一套 lane 信息去做判断。

---

## 六、几个容易搞混的点（面试向）

**Q1：`useTransition` 的 `isPending` 什么时候变 true，什么时候变 false？**

调用 `startTransition(callback)` 的瞬间就**同步**设成 `true`；`callback()` 执行完（同步情况）或者它返回的 Promise resolve 后（async 情况），再设回 `false`。

**Q2：`startTransition` 这次调用本身会阻塞主线程吗？**

不会阻塞，但也不是异步的——`callback()` 是被**同步直接调用**的。"不急"只体现在 callback 内部触发的那些 setState 之后走到的渲染调度上，不是说 `startTransition` 这次调用被推迟执行了。

**Q3：`useDeferredValue` 为什么不直接去看"有没有挂那个不急的牌子"，而是去看这次渲染的 lane 组合？**

因为它关心的是"**这次渲染本身的性质**"，不是"当前有没有处于 transition 的调用栈里"——一次渲染的 lane 组合是这批更新最终被批处理之后的结果，可能有多种来源，直接看 lane 组合更准确、更通用。

**Q4：`useDeferredValue` 和 `useTransition` 能不能一起用？**

能，且是常见组合：外层用 `useTransition` 包一批更新（拿到 `isPending` 做 loading），内部某个具体的 value 又单独用 `useDeferredValue` 兜底——但大多数场景选一个就够，同时用容易增加理解成本。

---

## 七、入场自测完整对答记录（历史存档）

| 题 | 学习者回答 | 判定 |
|---|---|---|
| Q1 isPending 机制 | 靠抛出的 promise 状态标识 | 🟡 偏——混淆主次机制。主体是普通 `useState(false)`；promise/thenable 只是 callback 为 async 函数时的次要分支 |
| Q2 setState 怎么变低优先级 | 通过设置 lanes 的值来标识优先级 | 🟡 偏——方向对但层次反了。是"挂牌子（全局标记）→ 检测 → 领号"三步，不是直接赋值 |
| Q3 | 不清楚 | 正常，当天核心内容 |
| Q4 同步渲染中 useDeferredValue 会不会延迟 | 答"不会延迟，紧急更新优先级更高不会打断" | ❌ 答反——把"延迟"（问题A：该用新值还是旧值）和"打断"（问题B：会不会被抢位置）两个不同问题混了。源码里正相反：**正是**处于同步/紧急渲染时才触发延迟返回旧值 |

**核心薄弱点**：Q4 暴露的是"延迟机制"和"打断机制"被当成同一件事——这也是本次重写后 §三 3.2 重点拆开讲的地方。

---

## 八、动手实验（写入 demos/day20/）

| 实验 | 验证什么 |
|---|---|
| T1 | `startTransition` 包裹的 setState 是否真的被 Scheduler 标记为低优先级（用一个耗时组件对比有无 transition 的渲染表现） |
| T2 | 高优先级更新是否能打断正在进行的 transition 渲染（配合 Day19 的 Scheduler 让出机制观察） |
| T3 | `useDeferredValue` 在"当前渲染已是低优先级"场景下是否真的跳过二次延迟 |

> ⚠️ 按 STUDY_PROTOCOL 硬规则：所有实验预期必须先本地实测再定案，不能凭源码推断直接写"预期结果"。

---

## 九、验收清单

- [ ] 能用类比讲清楚 `useTransition` 和 `useDeferredValue` 的本质区别（控制代码 vs 控制值）
- [ ] 能说出 `isPending` 的主体机制（普通 useState），以及例外分支（async callback 场景的 thenable）
- [ ] 能讲清楚 `startTransition` 的"挂牌子→检测→领号"三步式机制
- [ ] 能说出为什么 `startTransition` 结束后必须"摘牌子"
- [ ] 能清晰区分"延迟"（这次渲染用新值还是旧值）和"打断"（会不会被抢位置）是两个不同问题
- [ ] 能说出 `useDeferredValue` 和防抖的本质区别
- [ ] 能画出搜索框场景下两种方案（useTransition vs useDeferredValue）的执行时序
- [ ] 完成 3 个实验

---

## 十、Day21 预告

**主题**：高优先级打断低优先级实战（原 roadmap D15）——今天讲完两个 Hook 的机制后，下一步是**真正动手复现"打断"这个过程**（也就是本篇里反复强调的"问题 B"）：写一个耗时的低优先级渲染，中途用高优先级更新打断它，在 DevTools/console 里观察 wip 树被丢弃重做的实际证据。这是 Day10（Lane 决策树）+ Day19（Scheduler 让出机制）+ Day20（Transition 标记机制）三天内容的综合实战验证。

**预读问题**：
1. 怎么在代码里制造一个"故意很慢"的渲染，方便观察打断效果？
2. 打断发生时，React DevTools Profiler 会显示出什么迹象？
3. 如果低优先级渲染已经完成了 `beginWork` 但还没 `completeWork`，被打断后这部分工作是完全浪费，还是能有部分复用？
4. `entangleTransitions` 这个函数名多次在源码里出现，它是解决什么问题的？
