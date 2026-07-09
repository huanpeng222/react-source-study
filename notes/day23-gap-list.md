# Day 23 Gap List — 模拟面试暴露的薄弱点

> 来源：`notes/day23.md` 15题模拟面试的口述记录。当天必做，不过夜。
> 规则：每条写清楚"讲不清楚的具体环节 + 该回哪个DayN笔记哪一节 + 用自己的话重新讲一遍"。

---

## ❌ 讲不出来 / 概念性错误（优先级最高，4条）

### Gap 1：commit 三个子阶段搞混成了 render 阶段的步骤（Q3 · Day5）
- **讲不清楚的环节**：把 `beginWork`/`completeWork`（render阶段的东西）当成了commit的子阶段
- **回哪节**：`notes/day5.md` 开头"commit 阶段的三个子阶段"
- **正确版本（用自己的话重讲）**：commit分三个子阶段——**Before Mutation**（调getSnapshotBeforeUpdate + 异步调度useEffect）→ **Mutation**（按flags改DOM + 卸载旧ref + 跑上次useEffect的cleanup + **切root.current**）→ **Layout**（同步跑useLayoutEffect + cDM/cDU + 绑定新ref）。`root.current`切换发生在Mutation末尾、Layout开始前——因为这时DOM已经全部改完是一致状态，如果放在Phase1开始就切，DOM还没改但current已经指向wip，中途出错没法回滚。

### Gap 2：`isSubsetOfLanes` 的用途完全说错（Q8 · Day10）
- **讲不清楚的环节**：把它当成"判断父子fiber关系"，跟真实用途（renderLanes vs update.lane）完全不搭边
- **回哪节**：`notes/day10.md` Q3 / `notes/day10-quiz.md` Q3
- **正确版本**：`isSubsetOfLanes(set, subset)`，`(set & subset) === subset`——判断**第二个参数是不是第一个参数的子集**。用在`updateReducer`里：`isSubsetOfLanes(renderLanes, update.lane)`，判断"这条update的lane是否被本趟渲染的renderLanes完全覆盖"——覆盖了才执行这条update，没覆盖就跳过、留给下一趟对应优先级的渲染处理。跟父子fiber没关系，是"批次 vs 单条更新"的关系。

### Gap 3：Day13 React19 Actions 完全讲不出来（Q10）
- **讲不清楚的环节**：`useActionState` 和 `useReducer` 的本质区别，一个字都没答上
- **回哪节**：`notes/day13.md` + `notes/day13-quiz.md` Q2
- **需要掌握的最少内容**：`useActionState(actionFn, initialState)` 返回`[state, dispatchFn, isPending]`；`dispatchFn`是传给`<form action={...}>`的函数；`isPending`是内置的loading状态；prevState第一次是initialState，之后是actionFn上一次的返回值。跟`useReducer`最大区别：①`useActionState`天然支持async action，②自带`isPending`不用自己维护loading state，③action抛错会自动变成state（Error对象），不用手写try-catch。

### Gap 4：Scheduler 两套机制的归属自相矛盾（Q13 · Day19）
- **讲不清楚的环节**："判断是否超过5ms" 和 "shouldYieldToHost属于判断更高优先级" 这两句话自己前后矛盾
- **回哪节**：`notes/day19.md` Q1 / `notes/day19-quiz.md` Q1
- **正确版本**：Scheduler内部两套**独立**机制——机制①**任务排序**（回答"谁先跑"，最小堆按expirationTime排，跟优先级直接相关）；机制②**时间片让出**（回答"跑多久该歇"，`shouldYieldToHost`计时5ms，**跟优先级无关**，纯粹是"这个时间片用完了没有"）。`shouldYieldToHost`属于**机制②**，不是机制①。记忆口诀：**排序管"谁先跑"，让出管"跑多久"**，两件事互相独立。

---

## 🟡 部分对（需要补齐的点，8条）

### Gap 5：Diff三个假设，没答"各自牺牲了什么"（Q1 · Day3）
- 回`notes/day3.md`/`day3-quiz.md` Q1：牺牲分别是——假设1(type不同直接重建)牺牲"极少情况多创建DOM"；假设2(只同层比对)牺牲"跨层移动会丢组件state"；假设3(key标识身份)牺牲"要求开发者写稳定key"。

### Gap 6："父memo子还能渲染"的原因答错了方向（Q2 · Day4）
- 回`notes/day4.md`/`day4-quiz.md` Q2：真正原因是**子组件自己有setState**（子自身的scheduled update），跟"props引用是否一致"无关——那是另一个话题（memo失效场景）。

### Gap 7：setN被调用后没讲到Hook内部真正机制（Q4 · Day6）
- 回`notes/day6.md`/`day6-quiz.md` Q1：核心是`dispatchSetState`创建`update={action, lane, next}`塞进`hook.queue.pending`环形链表，再调`scheduleUpdateOnFiber`调度。真正的state计算在下次render的`updateReducer`里从baseState开始reduce整条队列。

### Gap 8：useMemo缓存的是"返回值"不是"变量地址"（Q6 · Day8）
- 回`notes/day8.md`/`day8-quiz.md` Q5：useMemo存的是`nextCreate()`**执行后的返回值**（可以是任意类型），不是笼统的"地址引用"这个表述。

### Gap 9：Context穿透memo的机制没讲全（Q7 · Day9）
- 回`notes/day9.md`/`day9-quiz.md` Q4/Q5：不是"找到消费者就直接触发"，是`propagateContextChanges`做DFS遍历，通过`mergeLanes`改`consumer.lanes`来**破坏bailout条件**，这才是能穿透memo的根本原因。

### Gap 10：memo比较函数返回true的语义 + 和filter反直觉对比没讲清（Q11 · Day14）
- 回`notes/day14.md`/`day14-quiz.md` Q2：**返回true = props等价 = 跳过渲染(bailout)**。跟Array.filter刚好相反——filter返回true=保留该元素；memo返回true=不重新渲染。

### Gap 11：Zustand store位置表述不准确（Q12 · Day15）
- 回`notes/day15.md`/`day15-quiz.md` Q2：不是"存在react组件全局"，是存在**模块级闭包变量**里，跟React完全无关，不经过Context。

### Gap 12（⚠️ 重点标记 · 回归性错误）：useSyncExternalStore撕裂修复又说成了"丢弃"（Q15 · Day22）
- **这是已经被专门纠正过、但没有真正吸收的点**——`notes/day22.md` §八点五（认知纠正#79）明确写过"不是丢弃，是发现快照不一致后强制重渲染去读新值，真实数据从来没丢过"
- 回`notes/day22.md` §二 + §八点五重读一遍
- **正确版本**：`checkIfSnapshotChanged`每次commit后重新读一次快照，跟render时读到的快照做`Object.is`比较，如果不一致，**不丢弃任何数据**——真实state一直在store里，只是通过`forceStoreRerender`（SyncLane强制）让组件**重新渲染去读最新值**
- **建议**：下次遇到这个知识点，先在脑内默念一遍"不丢弃，是逼组件重新读"再开口，这是个容易脱口而出说反的点

---

## 收尾说明

- ✅全对3题（Q5/Q9/Q14）不需要动作，但可以留意：这几题的共同特点是"能用一句话讲清晰核心机制"，可以作为其他题目改讲的参照标准
- 上面12条 Gap 是 **Day24 面试话术卡**（`meta/interview-cheatsheet.md`）的核心输入，尤其 Gap 4（Scheduler两套机制）和 Gap 12（撕裂修复回归错误）优先级最高——一个是逻辑自相矛盾会在真实面试里被追问出漏洞，一个是已经纠正过还是没吸收，说明需要额外的强化记忆
