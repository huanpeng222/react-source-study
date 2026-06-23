# 认知纠正归档（cognitive-corrections.md）

> 每天结束时把 `notes/dayN.md` 里的"我之前以为…，其实是…"追加到这里。
> 这是最值得回顾的一份文件——错过的认知，比学过的知识更值钱。

---

## Day 1 · JSX → React Element

1. **我以为** `ReactDOM.createRoot` 和 `React.createElement` 是一回事。
   **其实** 前者是应用启动入口（整个应用调一次），后者是 JSX 编译目标（每个标签调一次），两者职责完全不同。

2. **我以为** React Element 是 DOM 节点。
   **其实** 它只是个普通 JS 对象，是渲染的"描述快照"，没有任何 DOM 属性。DOM 是 React 后续在 commit 阶段根据它生成的。

3. **我以为** 修改 `element.props.children = 'xxx'` 能改变渲染。
   **其实** 开发模式 element 被 `Object.freeze` 冻结，赋值会报错；生产模式赋值成功但 React 不会重渲染。Element 是一次性快照。

4. **我以为** `<Foo>` 和 `<foo>` 都能用。
   **其实** babel 按首字母大小写决定 type 是 `"foo"` 字符串还是 `Foo` 变量。小写视为 DOM 标签，组件名必须大写。

5. **我以为** key 是 props 的一部分，组件里能读 `props.key`。
   **其实** 17+ 新 Transform 把 key 单独作为 `jsx()` 第三参数，从编译期就剥离 props，组件内 `props.key === undefined`。

---

## Day 2 · Element → Fiber + 双缓存

1. **我以为** React Element → 虚拟 DOM → 真实 DOM 是三层。
   **其实** React Element 本身就是虚拟 DOM，中间隔的是 Fiber 树，不是另一个"虚拟 DOM 层"。

2. **我以为** Fiber 只是个"调度优化"的小改动。
   **其实** Fiber 同时是**数据结构**（链表式树）+ **工作单元**（可暂停的渲染粒度）+ **调度对象**（带 lanes 优先级）。它是 React 16 之后整个新架构的根基。

3. **我以为** Stack Reconciler 卡是因为"代码写得慢"。
   **其实** 是因为**递归调用栈无法中断**——快慢不是问题，**没法让出主线程**才是问题。

4. **我以为** 双缓存就是 React 内部偷偷 clone 了一份对象。
   **其实** 是两棵 Fiber 树通过 `alternate` 互相指，**节点能复用就复用**，并不是真的全量复制。这就是为什么 Fiber 内存可控。

5. **我以为** alternate 是某种"备份"。
   **其实** 它是"另一棵树上的同一个我"。current 和 wIP 互为 alternate，commit 时指针一换，**没有 src/dst 之分**。

6. **我以为** Fiber 之前 React Element 直接渲染到真实 DOM。
   **其实** 从 React 0.x 开始就一直有"协调器（Reconciler）"中间层。React 15 的中间层叫 ReactInstance 树（也就是当时的"虚拟 DOM"），由 Stack Reconciler 同步递归处理。Fiber 不是"凭空多出来一层"，而是把这层中间结构**从同步递归改成可中断的链表遍历**。

7. **我以为** "Fiber 可中断"是浏览器或者 React 偷偷在背后帮我们暂停了 JS 线程。
   **其实** JS 单线程根本无法被强制中断。Fiber 的"中断"本质是**主动 `return` 退出 while 循环**：把进度写到全局变量 `workInProgress`，让出主线程，下次再通过 `scheduleCallback(workLoop)` 回来续接。**整个机制 4 个字：主动让出。**

8. **我以为** reconcile 就是 diff 算法。
   **其实** diff 只是 reconcile 的一部分。reconcile = **拿新 Element 对比旧 Fiber，生成 wIP 树，并在每个节点上打 effect 标记**——它是"装修总监量房 + 写施工清单"的过程，**完全不操作 DOM**。真正改 DOM 的是后续的 commit 阶段。

9. **我以为** alternate 是单向的"备份指针"。
   **其实** 它是**双向**的（A.alternate=B 且 B.alternate=A）。双向的根本目的是：commit 后身份对换时直接交换 root.current 指针；第二次更新时 React 直接复用旧 alternate 对象（不 new），这就是 Fiber 内存可控的根本。

10. **我以为** Fiber 节点上有字段标记自己"是 current 还是 wIP"。
    **其实** 没有这种字段——身份是**全局概念**。判别的权威源头是 `FiberRoot.current`：爬到 HostRoot，看 root.current 指针指向的是不是自己。**实战经验**：组件函数体内抓到的是 wIP，useEffect / DevTools 里抓到的是 current。

11. **我以为** flags 是字符串数组或者 enum。
    **其实** 是**位运算掩码**（`Placement | Ref | Passive` 用按位或拼起来）。用位运算是因为 commit 阶段每个 Fiber 都要判一遍 flags，O(1) 的位与运算比 `Array.includes` 快几个数量级。

12. **我以为** commit 阶段会遍历整棵 wIP 树。
    **其实** commit 用 `subtreeFlags` 剪枝——`subtreeFlags === 0` 的整棵子树直接跳过。这就是 React 17+ 千万级节点也能快速 commit 的秘诀。

13. **我以为** commit 之后旧 current 会被销毁、新 wIP 是在旧 current 上"重建"出来的。
    **其实** 同一个组件位置永远只有 **2 个 Fiber 对象在轮流坐庄**。commit 只是切换 `root.current` 指针，旧 current 原地不动；下次 setState 时 React 通过 `current.alternate` 拿到旧 current 直接**复用为新 wIP**（改写 pendingProps / 清零 flags），不 new 新对象。**对象不死，身份对换**。Fiber 真销毁只发生在：组件卸载、`root.unmount()`、diff 时类型变化（如 `<div>` → `<span>`）。

14. **我以为** wIP 和 current 是两棵完整树。
    **其实** 是两条"路径"。没变化的子树（bailout）wIP 直接**共享 current 的子树引用**，不会建对应 alternate。这就是 `React.memo` 的物理实现，也是 Fiber 内存远小于"双倍树"的根本原因。

---

## Day 3 · Reconcile 的 diff 算法

15. **我以为** `key={index}` 是性能问题。
    **其实** 是**正确性问题**——会让 React"身份认错"，把语义身份不同的节点当同一个复用，导致 input value / focus / state 跟错人。性能问题是慢但结果对；正确性问题是结果错。**性能 bug 可以接受，正确性 bug 不行。**

16. **我以为** 没写 key 时 React 的警告是"性能提醒"（diff 会变慢）。
    **其实** 警告的真实动机是**防身份认错**。React 看到显式数组就默认它动态，没 key 无法可靠对应身份，警告是**语义安全保险**，不是性能优化。

17. **我以为** Fragment 在 Fiber 树里完全不存在（"第零个节点"）。
    **其实** Fragment 是 Fiber 树里的**真实节点**（tag=7），有 child/sibling/return 指针，只是不创建 DOM。它影响层级关系（决定哪些节点是兄弟），但不影响 DOM 操作。短语法 `<>` 不支持 key，要 key 必须用 `<React.Fragment key="x">`。

18. **我以为** React diff 是某种"精妙的最优算法"。
    **其实** 是**贪心算法**（lastPlacedIndex），刻意不追求最优。Vue 3 用 LIS（最长递增子序列）才是理论最优。React 团队的解释：真实场景里差距不显著，**简单算法换可维护性**。这是 React"够用就好"哲学的体现。

19. **我以为** React 的"三大假设"是为了优化做的妥协（牺牲正确性换性能）。
    **其实** 每条假设同时解决**两个**问题：降复杂度 + 消语义歧义。比如假设 1 不光省 O(n²)，还省了"type 不同时 attribute/event/ref/effect 怎么迁移"的边界规则爆炸。**React 设计哲学：语义清晰、行为可预测 > 算法精妙，性能只是顺便。**

20. **我以为** 第一轮 diff 时 `key 同 type 不同` 会 break。
    **其实** **不会 break**。React 的 key 和 type 是**两个独立判定**：key 决定"break or not"（要不要进第二轮 Map 算法），type 决定"复用对象 or 新建对象"。key 同 type 不同时：销毁旧 fiber + 新建 wIP，但**继续走第一轮下一对**。记忆口诀：**key 管位置对应关系，type 管对象身份。**

21. **我以为** Vue diff 算法和 React 差不多。
    **其实** Vue 2/3 用**双端比较 + Map**（4 指针 oldStart/oldEnd/newStart/newEnd，每轮尝试 4 种命中），Vue 3 额外加 **LIS（最长递增子序列）** 找到旧序列里相对顺序不变的最长子序列保持不动。Vue 3 的移动次数是理论最优，React 的贪心通常多 0-2 次。React 团队的选择：源码简单 > 算法极致。

22. **我以为** lastPlacedIndex 初始应该是 -1（"还没开始放节点"）。
    **其实** 初始 = 0。fiber.index 最小就是 0，用 0 作为"基准哨兵"和实际值类型一致，避免源码里到处写 `=== -1` 判空。效果上 0 和 -1 在算法行为上几乎等价（任何 oldIndex ≥ 0），选 0 是工程美学。

23. **我以为** 只要 type 没变就一定复用（input type 还是 input，就不会重建）。
    **其实** 假设 1 准确说法是 **"同位置 + type 同"才复用**。React 按位置判断，一旦祖先 type 变（如 `<div>` → `<span>`），**整棵子树连同内部 input 一起销毁重建**，React 不会"递归进去看 input 是不是同一个"。这是 React 工程效率的来源：判断在最浅一层完成。

24. **我以为** Fiber 复用 = useEffect 不会触发。
    **其实** **Fiber 对象是复用的（引用没变），但 DOM 节点的"移动"被 React 解释为"重新挂载"**，触发 useEffect cleanup + rerun。原因：Placement 在 commit 阶段执行 `insertBefore`，浏览器把已存在的 DOM 先 detach 再 attach。这个行为**和依赖数组无关**——即使 useEffect 写 `[id]`，DOM 移动也会触发 cleanup + rerun。**Fiber 复用 ≠ DOM 不动 ≠ useEffect 不跑**，三件事独立。

25. **我以为** key=index 在"列表只更新不增删不重排"场景下也会出 bug。
    **其实** 这种场景下 i 和 id 本质上一一对应，**key=index 没问题**。出 bug 的根本前提是 **"index 与语义身份的对应关系发生了改变"**——要么重排，要么增删。但这种保证非常脆弱（迭代加排序就崩），所以最佳实践**永远用 id，永远不要赌**。

---

## Day 4 · beginWork / completeWork 工作循环

26. **我以为** DOM 节点是在 commit 阶段创建的。
    **其实** DOM 节点（detached、不在 document 里）在 **completeWork 阶段就创建好了**。commit 阶段只负责把整棵 detached DOM 树 appendChild 到真实文档。装修类比：beginWork = 设计图纸，completeWork = 工厂预制家具，commit = 一口气搬进新家。

27. **我以为** beginWork 处理所有 Fiber 类型用同一套逻辑。
    **其实** 是按 `fiber.tag` 分发到 30+ 种 case：函数组件走 renderWithHooks（跑函数）；类组件复用 instance 调 render()；DOM 节点不跑函数直接取 props.children。三者完全不同。

28. **我以为** bailout 就是"跳过整棵子树"。
    **其实** bailout 只跳过**当前 Fiber 自身的渲染**。子 Fiber 是否跳过看 `childLanes`：`childLanes = 0` → 整棵子树彻底跳过；`childLanes` 命中 → 当前 bailout，子继续走。这就是为什么"父 memo 了，子还能渲染"。

29. **我以为** Hook 链表是某种全局变量。
    **其实** Hook 链表挂在**每个函数组件 Fiber 的 `memoizedState` 字段**上，按调用顺序建立。这就是"Hook 不能放 if/for 里"的根本原因——React 完全按调用顺序对应链表节点，顺序错了拿到的就是错位的 Hook。

30. **我以为** completeWork 主要是"清理工作"。
    **其实** completeWork 干两件极重要的事：① HostComponent 创建 detached DOM、HostText 创建 textNode；② 冒泡子节点 flags 到父节点 subtreeFlags（位运算合并）。**冒泡的唯一目的：让 commit 阶段沿着"有事干的路径"前进，整棵子树剪枝**——把 commit 复杂度从 O(n) 降到 O(深度) ≈ O(log n)。

31. **我以为** flags 和 subtreeFlags 都是 completeWork 时打的。
    **其实** **flags 在 beginWork 阶段（reconcileChildren 内部）打**，**subtreeFlags 在 completeWork 阶段冒泡得到**。口诀：**flags 在 beginWork 打，subtreeFlags 在 completeWork 冒。**

32. **我以为** 跟练饱和时硬学就行。
    **其实** 饱和 = 大脑短期记忆已满，硬塞 = 死记硬背。**正确做法：暂停 + 默写 + 短暂离线**。Day 4 跟练 19:30 饱和时选了"睡前默写主管道图"，22:43 默写出来时之前散点知识自动串通——证明 **"默写 > 重读"是源码学习方法论的灵魂**。

---

## Day 5 · commit 阶段三子阶段

33. **我以为** commit 是一步到位把 DOM 改了。
    **其实** 分 3 个子阶段：Before Mutation（拍快照 + 调度 useEffect）→ Mutation（改 DOM + 跑上次 cleanup + 切 root.current）→ Layout（同步跑 useLayoutEffect + 生命周期）。paint 之后才异步 flushPassiveEffects 跑本次的 useEffect 回调。

34. **我以为** useLayoutEffect DOM 就位、useEffect DOM 还没就位。
    **其实** 两者都在 DOM 已就位之后跑。区别只在 **paint 前后**。**口诀：Layout 看不到（绘制前），Effect 看到了（绘制后）。**

35. **我以为** root.current 切换是 commit 第一步。
    **其实** 切换发生在 **Mutation 阶段末尾、Layout 开始前**。这样 Layout 阶段的 componentDidMount / useLayoutEffect / this / ref 才能拿到正确的新树语义。如果放第一步，Mutation 操作 DOM 时出错都没法回滚。

36. **我以为** useTransition 用 Suspense 接住低优先级渲染。
    **其实** useTransition 和 Suspense 是**两个独立机制**。useTransition = 标记 setState 为低优先级 Lane（让 reconcile 可丢弃）；Suspense = 捕获 throw promise 显示 fallback。两者经常配合（搜索场景）但本质独立。**useTransition 不让 commit 可中断，只让 reconcile 可丢弃。**

37. **我以为** Mutation 跑的 cleanup 和异步跑的 effect 是同一个 useEffect 在两个阶段触发。
    **其实** 跑的不是同一个！Mutation 跑的是**上次 render 返回的 cleanup**，flushPassiveEffects 跑的是**这次 render 新建的回调**。cleanup 的 dep 是闭包捕获的旧值，effect 的 dep 是这次的新值。**口诀：上次 cleanup 同步跑，这次 effect 异步跑。**

38. **我以为** 微任务和宏任务"差不多"。
    **其实** **宏任务必须等微任务全部清空才能跑**。React 故意用 `MessageChannel.postMessage`（宏任务）调度 useEffect 而不用 `queueMicrotask`（微任务），目的就是让 paint 先发生：微任务调度会阻塞 paint，宏任务调度让浏览器在 commit 完成后立即 paint 给用户看，再跑 effect。

39. **我以为** getSnapshotBeforeUpdate 用于"聊天框新消息追加"。
    **其实** 底部追加新消息根本不需要这个 API（浏览器自动保持 scrollTop = 视觉不变）。**真正的场景是顶部插入历史消息（上拉加载更早消息）**：DOM 在头部插入 100px → 原内容向下挤 100px → 必须 scrollTop += 100 抵消才能视觉不变。公式：`scrollTop_new = scrollHeight_new - (scrollHeight_old - scrollTop_old)`。

---

## W2 Day 6（useState 源码）

40. **我以为** `setN(n+1)` 和 `setN(prev=>prev+1)` 只是写法不同效果一样。
    **其实** action 一个存值、一个存函数。同步多次调用时，值更新被同闭包锁定互相覆盖（3 次只 +1），函数式 prev 拿上次 reduce 结果链式累积（3 次到 3）。

41. **我以为** Hook 的 `memoizedState` 存 action、`queue` 存函数。
    **其实** 反了。`memoizedState` = 当前 state 的**值**；`queue` = update 队列**容器**（含 pending / dispatch）；`action` 在 **update 节点**上，不在 hook 上。（源码 `packages/react-reconciler/src/ReactFiberHooks.js`）

42. **我以为** 单次 `setN(n+1)` 也会暴露闭包陷阱。
    **其实** 闭包陷阱只在"同一事件里多次 setN"或"异步引用 n"时暴露。单次同步调用每次点击之间隔着一次 render，闭包自然刷新，所以正常 +1。`console.log(n)` 读到旧值才是闭包的体现，但它不影响 setState。

43. **我以为** `useState(expensiveCompute())` vs `useState(() => expensiveCompute())` 的差异在 useState 内部。
    **其实** 根源是 **JS 函数参数立即求值**——`expensiveCompute()` 在 useState 被调用之前就跑了，useState 控制不了。前者每次 render 都跑（即使 update 阶段结果被忽略），后者只 mount 跑一次。

44. **我以为** dispatch（setN）每次 render 重新创建。
    **其实** mount 时 `bind` 创建一次缓存进 `queue.dispatch`，update 阶段直接复用同一引用 → 引用永远稳定 → 不用写进 useEffect deps。

---

## W2 Day 7（useEffect / useLayoutEffect 源码）

45. **我以为** useEffect 和 useLayoutEffect 是两套不同实现。
    **其实** 调同一套 mountEffectImpl/updateEffectImpl，只差 fiberFlags（Passive2048 vs Update4）+ hookFlags（HookPassive8 vs HookLayout4）。（源码 ReactFiberHooks.js + ReactFiberFlags.js + ReactHookEffectTags.js）

46. **我以为** effect 在两条链表里是两份拷贝。
    **其实** 同一个 effect 对象被两处引用——hook.memoizedState（比 deps 用）+ fiber.updateQueue 环形链表（commit 执行用）。effect 多一条链表，因为它是唯一需延迟到 commit 执行的 hook。

47. **我以为** deps 比较是比整个数组对象引用。
    **其实** areHookInputsEqual 用 Object.is 逐项比每个元素。`[obj]` 每次新建引用变 → 每次重跑（要 useMemo）。HookHasEffect 是开关位：deps 没变 effect 仍进链表只是不跑。

48. **我以为** cleanup 存在 hook.memoizedState。
    **其实** 存在 effect.inst.destroy，隔两层。单独放 inst 是为了让 destroy 跨 render 存活（hook 外壳每次新建，inst 复用）。

49. **我以为** hook 像 fiber 一样复用对象。
    **其实** hook 外壳每次 render 新建（updateWorkInProgressHook 浅拷贝字段，newHook !== currentHook），只有 queue/inst 共享。三层复用规律：跨 render 存活的状态(queue/inst)共享，每次重组的结构(fiber链/hook外壳/effect链)重建。

---

## Day 8（useRef / useMemo / useCallback）

50. **我以为** useRef 的 `{current}` 盒子存在"全局"，所以稳定。
    **其实** 存在**该组件 fiber 的 Hook 链表节点**上（hook.memoizedState），不是全局——全局会导致同组件多实例共用一个 ref 串台。稳定的真因：updateRef 一行 `return hook.memoizedState`，配合三层复用（外壳浅拷贝指向同一盒子），从不新建。

51. **我以为** 改 ref.current React 会悄悄记录等下次用。
    **其实** `ref.current=x` 就是普通对象属性赋值，React 无监听/无 dispatch 通路 → 不调度 render。对比 setN 有 dispatch 会 scheduleUpdateOnFiber。结果：ref 值立即变，但视图不变。

52. **我以为** useMemo 缓存值存在 deps 里。
    **其实** memoizedState 是二元组 `[value, deps]`，缓存值在 `[0]`，deps 在 `[1]` 仅作下次比较依据。useRef 没有 deps，直接存 `{current}`。

53. **我以为** useMemo 和 useCallback 是两套实现。
    **其实** 同一套（deps 浅比较 + memoizedState 二元组），唯一区别：useMemo 存 `create()` 的结果，useCallback 存函数本身。`useCallback(fn,d) ≡ useMemo(()=>fn,d)`。

54. **我以为** useCallback 单独用就能提速。
    **其实** useCallback 的价值是让传给子组件的函数引用稳定，从而让子组件 React.memo 浅比较命中 bailout。不配 memo 基本没意义；deps 放新对象则永久失效（白写更慢）。

---

## Day 9（useContext 源码 + Context 穿透 memo）

55. **我以为** useContext 跟其他 Hook 一样在 memoizedState 链表上有节点。
    **其实** 它根本没有 mountContext 函数，不占 Hook 节点。每次直接 readContext 读 context._currentValue，依赖通过 fiber.dependencies 记录。

56. **我以为** Context value 变化时，React 通过"绑定/订阅"找到消费者。
    **其实** 是 propagateContextChanges DFS 遍历 Provider 子树，挨个检查 dependencies.firstContext 链表匹配 context 引用，匹配上就改 lanes。

57. **我以为** Context 穿透 memo 是某种"特殊通道"。
    **其实** 就是改 fiber.lanes → 破坏 bailout 条件（hasScheduledUpdateOrContext()）→ 逼 beginWork 走完整渲染路径。没有黑魔法。

58. **我以为** React.memo(Consumer) 能阻止 Context 引起的重复渲染。
    **其实** 拦不住——lanes 已被改，bailout 条件直接失效。Context 设计上就是所有消费者必须更新。

59. **我以为** useMemo 包裹 value 对象能完全解决 Context 性能问题。
    **其实** 只能解决"value 引用不稳定导致 Consumer 多渲染一次"的问题，但不能解决"所有消费了同一个 context 的组件都强制渲染"——那是 Context 机制本身的代价。真正解法是拆分 Context。

60. **我以为** Context 的"只渲染消费者"精准性，在普通组件里就能观察到。
    **其实** 必须配合 React.memo 才看得到。没 memo 时"父重渲染→子每次新 props 引用→bailout 失败→全部子组件渲染"这个粗行为会盖住 context 的精准标记，点任何按钮（哪怕和 context 无关的 setState）三个消费者都渲染，行为看起来一样。只有给消费者包 memo，propagateContextChanges 的"只标记该 Provider 子树内消费者"才显现。所以"Context 性能"几乎总和 memo 一起谈。（本认知由 Day9 J1 实验实测纠错得出）

61. **我以为** "没写 React.memo 就一定三个消费者全渲染"。
    **其实** 真正的分水岭是 **element 的 props 引用是否跨 render 稳定**（`ReactFiberBeginWork.js` 的 `beginWork`：`oldProps !== newProps` 才 didReceiveUpdate=true）。`React.memo` 只是"稳定 props 引用"的一种手段；**React Compiler（Vite+React19 常开）会自动缓存 element → props 引用稳定**，效果等同 memo。所以在开了编译器的项目里，**不写 memo 也只渲染内层消费者（改 inner 只打印 1 行 inner!）**——我之前裸 jsdom 测试没缓存 element 才得出"全渲染"，误判了。实测：react@19 裸 JSX→3 行；缓存 element（useMemo 模拟编译器）→1 行 inner! / 2 行 outer! / toggle 0 行，与学习者真实项目截图一致。（Day9 实测纠错）

---

<!-- 后续 Day 的认知纠正继续追加在这里 -->

