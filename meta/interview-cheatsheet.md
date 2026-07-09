# React 源码面试话术卡

> 用途：面试前扫一遍,把源码知识讲成"逻辑链",不是背书。
> 每个条目结构:**面试官问 → 30秒电梯版(先给结论) → 展开版(逻辑链) → 如果追问怎么接**。
> 来源:Day1-23 全部笔记 + Day23 模拟面试暴露的 12 条薄弱点(`notes/day23-gap-list.md`)+ 深度讲解(`notes/day23-deep-dive.md`)。
> 源码基于 react-dom@19.1.0。

---

## 使用说明

- **先说结论,再展开**——面试讲源码最忌一上来就钻函数名。先用一句话给出"是什么/为什么",对方感兴趣再深入。
- **主动画边界**——本卡里带 ⚠️ 的都是 Day23 栽过的"相邻概念混淆点",讲的时候主动把边界点出来,反而显得你真懂。
- **"这是我的理解/这是类比"要标清楚**——遇到不确定的,诚实说"这块我记得是…,具体函数名可能要再确认",比硬编强。

---

# 一、渲染主流程(必考,占面试一半)

## 1.1 JSX 到底是什么 / 渲染的完整链路

**电梯版**:JSX 是 `React.createElement` 的语法糖,返回一个普通对象(React Element,是 UI 的"描述")。React 拿这个描述去构建 Fiber 树,在 render 阶段做 diff,在 commit 阶段一次性改真实 DOM。

**逻辑链(能顺下来就稳)**:
```
JSX → (编译) → createElement 调用 → React Element(普通对象,type/props/key)
  → 首次:根据 Element 创建 Fiber 节点 / 更新:和现有 Fiber diff
  → render 阶段:beginWork 下钻构建 wip 树 + completeWork 回溯建 DOM/冒泡 flags
  → commit 阶段:Before Mutation → Mutation(改DOM+切current) → Layout
  → 浏览器 paint → 异步 flushPassiveEffects 跑 useEffect
```

**追问:Element 和 Fiber 什么区别?**
Element 是**不可变的、轻量的 UI 描述**(每次 render 都新建);Fiber 是**可变的、重的工作单元**(跨 render 复用,存 state/effect/DOM 引用/lanes)。一个是"图纸",一个是"施工中的建筑"。(D1/D2)

---

## 1.2 Fiber 双缓存(高频追问)

**电梯版**:内存里始终最多有两棵 Fiber 树——`current`(当前屏幕显示的)和 `workInProgress`(正在构建的)。两棵树通过 `alternate` 指针互相指向。render 在 wip 树上做,做完 commit 时用 `root.current = wip` 一次性切换,新旧交替坐庄。

**为什么要双缓存**:
- 如果只有一棵树,边改边显示会看到中间态(撕裂)。
- 双缓存让"构建新树"和"显示旧树"隔离——wip 没构建完,屏幕上一直是 current 对应的 DOM,安全。
- 切换是一个指针赋值,原子操作,用户看不到过程。
- 复用对象:两棵树的 fiber 通过 alternate 复用,不用每次 render 都新建整棵树的对象(GC 友好)。

**追问:current 什么时候切?** ⚠️(D23 Q3 栽过)
在 **commit 的 Mutation 阶段末尾、Layout 阶段之前**切(`root.current = finishedWork`)。不能放最前面——那时 DOM 还没改,current 却指向新树,指针和真实 DOM 不一致,出错没法回滚。放 Mutation 末尾:DOM 已全改完是一致状态,再切,之后 Layout 阶段的 componentDidMount/ref 读到的都是新树。(D2/D5)

---

## 1.3 Diff 算法:O(n³)→O(n) 的三个假设 ⚠️(D23 Q1:记得答"牺牲了什么")

**电梯版**:通用树 diff 是 O(n³),React 用三个假设砍到 O(n),每个假设都是"用极端情况的正确性换普遍情况的性能"。

**三个假设 + 各自的代价**:
| 假设 | 优化 | 牺牲 |
|---|---|---|
| type 不同直接重建,不递归比子树 | 省掉跨类型比对 | 极少数情况多创建 DOM |
| 只在同层比较 | 干掉跨层匹配的 O(n²) | 跨层移动节点会丢 state |
| 同层用 key 标识身份 | 列表 reorder 能 O(n) 复用 | 要求开发者写稳定唯一 key |

**追问:key=index 为什么不好?**
是**正确性问题**不是性能问题。列表头部插入时所有 index 后移,React 按 index 匹配会把语义不同的节点当同一个复用——非受控 input 的值、focus、组件 state 跟错行,数据跟错对象=bug。(D3)

---

## 1.4 render 遍历:可中断的 DFS ⚠️(D24 追问)

**电梯版**:render 阶段是深度优先遍历,但不用递归,靠 fiber 上的 `child/sibling/return` 三个指针手动挪——这样每挪一步都能停下来检查要不要让出主线程,这就是"可中断"。

**逻辑链**:
- 优先走 child 下钻(前序 = beginWork),没 child 走 sibling,没 sibling 沿 return 回父。
- 一个节点经过两次:下钻 beginWork(构建/diff/打自己的 flags),回溯 completeWork(建 DOM、bubbleProperties 把子树 flags 冒泡上来)。
- 为什么不用递归:递归一开始就得跑到底,没法暂停,可打断渲染就废了。

**追问:哪些操作会遍历树?**
一套骨架(三指针 DFS),多种剪枝:render 靠 `childLanes` 剪枝、commit 靠 `subtreeFlags` 剪枝、Context 变化靠 `dependencies` 匹配遍历、卸载靠不剪枝的 deletion 遍历。(D24 deep-dive 追问A)

---

## 1.5 commit 三个子阶段 ⚠️(D23 Q3:别和 render 阶段混)

**电梯版**:commit 是同步不可打断的,分三步:Before Mutation → Mutation → Layout。注意 beginWork/completeWork 不是 commit 的子阶段,那是 render 阶段的。

| 子阶段 | 干什么 |
|---|---|
| Before Mutation | getSnapshotBeforeUpdate;异步调度 useEffect |
| Mutation | 按 flags 改 DOM;卸载旧 ref;跑上次 useLayoutEffect 的 cleanup;**末尾切 current** |
| Layout | 同步跑 useLayoutEffect;componentDidMount/Update;绑新 ref |
| (paint后) | 异步 flushPassiveEffects 跑本次 useEffect |

**追问:为什么 render 可中断、commit 不可中断?**
render 在内存里操作 wip 树,用户看不到,可以反复丢弃重来;commit 直接改真实 DOM,中断到一半用户会看到残缺画面。核心哲学:**思考阶段(render)允许反复来 → 可中断;动手阶段(commit)一次性搞完 → 同步**。(D5)

**追问:整棵树统一 commit 还是逐个?** ⚠️
整棵 wip 树全部 completeWork 完(workInProgress 回溯到 null,标 RootCompleted)才一次性 commit,绝不边 complete 边 commit。因为 commit 改 DOM 不可打断,且 subtreeFlags 要冒泡完整才能剪枝。(D24 deep-dive 补充)

---

# 二、Hooks(必考)

## 2.1 setState 被调用后发生了什么 ⚠️(D23 Q4:讲 Hook 内部,别只讲宏观流程)

**电梯版**:setState 不立即改 state。它创建一个 update 对象塞进当前 hook 的更新队列(环形链表),然后调度一次重渲染。真正的新 state 在下次 render 时从 baseState 把队列 reduce 出来。

**逻辑链**:
```
setN(x) = dispatchSetState.bind(fiber, queue)
  → 创建 update = {lane, action: x, next}
  → enqueueConcurrentHookUpdate 塞进 hook.queue.pending(环形链表)
  → scheduleUpdateOnFiber 调度(不是立即渲染)
下次 render:
  → updateReducer 从 baseState 出发,按顺序 reduce 队列里每个 update.action
```

**追问:`setN(n+1)` 三次 vs `setN(x=>x+1)` 三次?**
- 值式:三个 action 都是 1(n 闭包锁定为0),reduce `0→1→1→1`,结果 1。
- 函数式:每次拿上步结果当参数 `0→1→2→3`,结果 3。

**追问:setN 后立刻 console.log(n) 为什么是旧值?**
n 是这次 render 闭包锁定的值,setN 只入队+调度,不回头改当前作用域的 n。新值只在下次 render 重新执行函数体时生效。(D6)

---

## 2.2 useEffect vs useLayoutEffect + cleanup 时机 ✅(D23 Q5 答对了,保持)

**电梯版**:两者都在 DOM 改完后跑,区别在 paint 前后——useLayoutEffect 在 paint 前同步跑(会阻塞绘制),useEffect 在 paint 后异步跑。

**cleanup 的闭包陷阱(高频)**:
点击一次(n:0→1),完整顺序:
```
render:1 → layoutCleanup:0(拿上次旧值) → layoutEffect:1 →(paint)→ cleanup:0(上次旧值) → effect:1(这次新值)
```
cleanup 跑的是**上次 render 留下的**(闭包捕获旧 n),effect 跑的是**这次的**。

**追问:为什么用 MessageChannel(宏任务)调度 useEffect,不用微任务?**
微任务会在 paint 前清空,阻塞绘制;宏任务让 paint 先执行,用户先看到画面,effect 后跑。(D5/D7)

---

## 2.3 useMemo / useCallback ⚠️(D23 Q6:缓存的是"返回值"不是"变量地址")

**电梯版**:底层同一套逻辑,memoizedState 都存 `[value, deps]`。useMemo 存 factory **执行后的返回值**,useCallback 存**函数本身**。等价:`useCallback(fn,d) ≡ useMemo(()=>fn, d)`。

**追问:useCallback 单独用(不配 memo)有意义吗?**
基本没有。它的价值是让传给子组件的函数引用稳定,从而让子组件的 React.memo 浅比较命中、bailout。子组件没包 memo 的话,函数稳不稳定都照样重渲染,反而多了 deps 比较开销。(D8)

---

## 2.4 useContext + Context 穿透 memo ⚠️(D23 Q7:核心是"改lanes"不是"直接rerender")

**电梯版**:组件 useContext 时,readContext 把依赖记到 `fiber.dependencies`。value 变了,propagateContextChanges 做 DFS 找到消费者,用 mergeLanes 改它的 lanes,**破坏 bailout 的前置条件**,所以能穿透 memo。

**关键:不是 memo 主动放行,是 bailout 前提(lanes为空)被打破了。** beginWork 里 bailout 会检查 fiber.lanes 是否命中 renderLanes,lanes 被改了(非空且命中)就 bailout 失败,即使 memo 的 props 浅比较通过也要重渲染。

**追问:`value={{count}}` 每次新对象有什么问题?**
每次引用变 → propagateContextChanges 触发 → 所有消费者(即使只用别的字段、即使包了memo)全被标 lanes 强制重渲染。修复:useMemo 稳定 value + 拆分 Context。(D9)

---

# 三、并发渲染(区分度最高,答好是加分项)

## 3.1 Lane 优先级模型

**电梯版**:Lane 用 31 位的位掩码表示优先级,而不是一个数字比大小。位掩码能 O(1) 做集合运算(合并/求交/子集判断),还能用多位 OR 表示"这几个更新是同一批"。bit 越靠右(值越小)优先级越高。

**核心位运算**:
- `mergeLanes(a,b) = a|b`(合并/冒泡)
- `getHighestPriorityLane = l & -l`(取最低位1=最高优先级)
- `includesSomeLane(a,b) = (a&b)!==0`(有没有交集)
- `isSubsetOfLanes(set,subset) = (set&subset)===subset`

**追问:isSubsetOfLanes 判断什么?** ⚠️(D23 Q8:跟父子fiber无关!)
判断的是 **renderLanes(本趟渲染批次)** 和 **update.lane(某条更新)** 的子集关系,用在 updateReducer 里决定"这条 update 该不该被这次渲染处理"——这是低优先级更新被跳过、留到自己批次的底层机制。**不是父子组件关系**(那个是 fiber.lanes vs fiber.childLanes)。(D10)

---

## 3.2 fiber.lanes vs childLanes + bailout ⚠️(D23 Q2:"父memo子还渲染"的真正原因)

**电梯版**:`fiber.lanes` 是本节点自己欠的更新,`fiber.childLanes` 是后代子树欠的(setState 时沿 return 链冒泡累加)。beginWork bailout 时看 childLanes:子树没活整棵跳过,有活就 clone 子 fiber 继续下钻。

**"父 memo 了子还能渲染"的真正原因**:子组件**自己调了 setState**,冒泡时把 childLanes 标到了父身上。父虽自己 bailout(props没变),但 childLanes 命中就继续处理子树。**跟"父传给子的 props 引用"无关**——父都 bailout 了,压根没重新给子传 props。(D4/D14)

---

## 3.3 打断的本质 ✅(D23 Q14 答对了)

**电梯版**:"打断"不是 CPU 层面的物理抢占——JS 单线程做不到。真正机制是"协作式":render 每处理完一个 fiber 单元,主动检查 `shouldYield()`,该让就让出主线程;让出后下一轮重新用 `getNextLanes` 决策该跑哪批,如果有更高优先级的就先跑它。

**被打断的 wip 树怎么办?**
整棵丢弃、从头重做(prepareFreshStack 从 current 重新 clone)。旧 wip 哪怕只差最后一步也不复用——这正是"组件函数必须纯"的底层原因(随时可能跑一半被扔掉重跑)。

**追问:一直被打断会饿死吗?**
不会。每个 lane 挂号时带一个不受打断影响的过期时间戳(紧急类250ms/Transition类5000ms)。过期后 performWorkOnRoot 改走 renderRootSync(workLoopSync 没有 shouldYield 检查),强制一口气跑完提交。"打断"保证响应,"过期"保证不无限延迟。(D21)

**追问:高优先级=立刻响应吗?**
不。高优先级只保证"排队靠前",不保证"渲染耗时归零"。树大又没 memo,SyncLane 同步渲染照样卡。(D21)

---

## 3.4 Scheduler 两套机制 ⚠️(D23 Q13:别自相矛盾)

**电梯版**:Scheduler 内部两套**独立**机制——① 任务排序(回答"谁先跑",最小堆按 expirationTime 排,跟优先级相关);② 时间片让出(回答"跑多久该歇",shouldYieldToHost 计时 5ms,**跟优先级无关**)。

**shouldYieldToHost 属于机制②**。让出和优先级在 Scheduler 层是解耦的:先让出(②),再重新 peek 堆顶决定下一个跑谁(①)。

**追问:过期任务会被时间片打断吗?**
不会。让出条件是 `expirationTime > currentTime && shouldYieldToHost()`,任务过期后 `&&` 左边 false 短路,shouldYieldToHost 根本不被调用,强制跑完。防饿死兜底。

**追问:为什么用 MessageChannel 不用 setTimeout?**
setTimeout 嵌套超过一定层数被浏览器 clamp 到最低 4ms;MessageChannel 的 postMessage 走宏任务无此限制,调度更精确。(D19)

---

## 3.5 useTransition / useDeferredValue

**电梯版**:都是把更新降级为 TransitionLane(低优先级、可被打断)。区别:能改到 setState 就用 useTransition(包"动作");值来自 props 改不到 setState 就用 useDeferredValue(包"值")。(D10/D20)

**追问:entangleTransitions 防什么?** ⚠️(D21 曾误解)
**不是**"同一 startTransition 里多个 setState 保持一致"(那个靠 currentEventTransitionLane 全局缓存天然保证,同事件多次 setState 复用同一 lane 号)。**真正防的是**:同一个 state 被两次独立事件(各领不同 transition lane 号)先后触发时,防止调度系统拆开处理导致顺序错乱。操作的是单个 queue.lanes。(D21)

---

# 四、Suspense / Actions / 状态管理

## 4.1 Suspense 原理 ✅(D23 Q9 答对了)

**电梯版**:组件数据没好就 throw 一个 promise,React 沿 return 链找到最近的 Suspense 边界,显示 fallback;promise resolve 后 ping 触发重试,重新渲染。

**throwException 怎么区分 promise 和 Error?**
`typeof value.then === 'function'` —— 有 .then 就是 thenable 走 Suspense,没有就是 Error 走 Error Boundary。(D11)

---

## 4.2 useActionState vs useReducer ⚠️(D23 Q10:完全没答上,重点补)

**电梯版**:两者都是"根据上个 state 算下个 state",但 useActionState 是 React 19 为异步表单提交造的超集,内建了 useReducer 需要手写的一堆东西。

| 维度 | useReducer | useActionState |
|---|---|---|
| 同步/异步 | reducer 必须纯同步 | action 可以是 async |
| loading | 自己 useState 维护 | 内建返回 isPending |
| 错误处理 | throw 会崩,要自己 try-catch | 自动捕获转成 state |
| 返回值 | [state, dispatch] | [state, dispatchFn, isPending] |
| transition | 无 | 自动包 transition |
| 表单集成 | 无 | dispatchFn 直接传给 form action,自动收 FormData |

**源码亮点(讲这个碾压)**:action 队列**串行执行**(环形链表,一个 Promise resolve 才跑下一个,onActionSuccess 递归跑 next),保证并发提交不乱序——useReducer 完全没这个机制。(D13)

---

## 4.3 状态管理:Zustand 为什么不要 Provider ⚠️(D23 Q12:是"模块级闭包"不是"react全局")

**电梯版**:Redux 用 Context 传 store 所以要 Provider;Zustand 的 store 存在**模块级闭包变量**里,跟 React 组件树、Context 完全无关,谁想用直接 import。组件通过 useSyncExternalStore 订阅它。

**追问:useSyncExternalStore 怎么解决渲染撕裂?** ⚠️(D23 Q15:回归错误!别说"丢弃")
三层防护:① render 阶段同步读快照;② useEffect 里建订阅;③ commit 后 checkIfSnapshotChanged 重新读快照跟渲染时的比,不一致就 forceStoreRerender(SyncLane 强制重渲染去读新值)。
**⚠️ 全程不丢弃任何数据**——撕裂是"读到了过期快照",修复是"逼组件重新读",不是"丢弃重构建"。真实 state 一直在 store 里。(D22)

---

# 五、面试临场提醒(D23 教训总结)

1. **相邻概念别混**(栽过 4 次):render阶段↔commit阶段 / fiber.lanes↔renderLanes / Scheduler排序机制↔时间片机制 / "丢弃"↔"重新读"。讲的时候主动点边界。
2. **"次数"和"耗时"正交**:commit 次数由 lane 批次决定(≠setState次数),组件复杂度只影响单次耗时不影响次数。(D24追问B)
3. **先结论后细节**,别一上来钻函数名。
4. **不确定就诚实标注**"这块具体函数名我要再确认",别硬编——面试官更看重你知道自己知识的边界。
5. Q15 撕裂修复这个点已经错两次了,开口前先默念"数据没丢,是逼组件重新读"。

---

> 配套阅读:`notes/day23-deep-dive.md`(每题完整展开+源码链路)、`meta/cognitive-corrections.md`(83条认知纠正全记录)。
