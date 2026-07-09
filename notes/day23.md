# Day 23 — 源码模块模拟面试

> **主线位置**：`meta/job-sprint-plan.md` 阶段 A 第三天，衔接原 roadmap（无对应编号，是新增的自检环节）。今天**不学新知识**，做一次纯输出型自检——复用 `leetcode-algorithm` skill 的模拟面试节奏（先思路后代码、限时、不查资料）。

---

## 规则说明（模拟面试的真实场景）

- **不查任何资料**——不看 `dayN.md`、不看 `dayN-quiz.md` 的答案、不查源码。直接对着空气/录音讲清楚，就像真的坐在面试官对面。
- **限时**：每题 3-5 分钟口述（简单概念题3分钟，涉及源码链路/多步骤机制的给5分钟）。
- **讲不清楚就如实说"这块我讲不清楚"**，不要蒙混过关——诚实暴露薄弱点才是这次自检的价值所在。
- 讲完 15 题后，对照 `notes/dayN-quiz.md` 里的原答案自己评分，标记每题是 ✅全对 / 🟡部分对 / ❌讲不出来。
- 当天晚上把 ❌ 和 🟡 的点，一条条整理进 `notes/day23-gap-list.md`，**不过夜**。

---

## 15 题抽取名单（覆盖 Day1-22 的核心模块，按主题分布，不局限具体题号）

| # | 来源 | 主题模块 | 题目 |
|---|---|---|---|
| 1 | Day3 | Diff算法 | React 把通用树 diff 从 O(n³) 砍到 O(n)，用了哪 3 个假设？每个假设牺牲了什么？ |
| 2 | Day4 | beginWork/completeWork | bailout 只跳过当前 Fiber 自身的渲染，那子 Fiber 是否跳过看什么字段？为什么"父 memo 了，子还能渲染"？ |
| 3 | Day5 | commit阶段 | commit 分哪三个子阶段？`root.current` 的切换发生在哪个时间点，为什么不能放第一步？ |
| 4 | Day6 | useState源码 | `setN(x)` 被调用时，state 是立即改变的吗？如果不是，中间发生了什么？ |
| 5 | Day7 | useEffect源码 | Mutation阶段跑的cleanup和flushPassiveEffects跑的effect，是不是同一个useEffect在两个阶段各触发一次？ |
| 6 | Day8 | useMemo/useCallback | `useCallback(fn, deps)` 和 `useMemo(() => fn, deps)` 是什么关系？useCallback单独使用有意义吗？ |
| 7 | Day9 | useContext | Context value 变化时，React 是怎么找到消费者组件的？propagateContextChanges 具体做了什么？ |
| 8 | Day10 | Lane模型 | `isSubsetOfLanes(a, b)` 判断的是什么？两个参数分别代表什么？ |
| 9 | Day11 | Suspense原理 | throwException 内部怎么区分捕获到的是 promise 还是 Error？判断条件是什么？ |
| 10 | Day13 | React19 Actions | `useActionState` 和 `useReducer` 有什么本质区别？（至少说出3个维度） |
| 11 | Day14 | Compiler/性能优化 | React.memo 的自定义比较函数返回 true 表示什么？和 Array.filter 的语义有什么反直觉的地方？ |
| 12 | Day15 | 状态管理对比 | 为什么 Zustand 不需要 Provider？它的store存在哪里？ |
| 13 | Day19 | Scheduler | Scheduler 内部有两套独立机制，分别回答什么问题？`shouldYieldToHost` 属于哪一套？ |
| 14 | Day21 | 高优先级打断 | "打断"的真正含义是什么？为什么说它不是CPU层面的抢占？ |
| 15 | Day22 | mini-store | `useSyncExternalStore` 是怎么解决"渲染撕裂"问题的？说出具体的源码机制。 |

---

## 口述记录区（跟练时逐题填写：讲了什么 + 自评）

### Q1（Day3 · Diff算法）限时3分钟

**我讲的**：假设key不相同时，就为不同的组件，直接重建；假设只在同层对比，不同直接重建；假设类型不同时，直接重建。

**自评**：⬜✅ ✅🟡 ⬜❌

**AI点评**：三个假设的内容（type不同重建 / 只同层对比 / key标识身份）都提到了，但三句话混在一起表述不清晰（"同层对比不同直接重建"这句本身逻辑不通——同层比对不是"不同就重建"，是type不同才重建），且**完全没答"每个假设牺牲了什么"**这半个问题。参考答案：牺牲分别是"极少情况多创DOM / 跨层移动会丢组件state / 要求开发者写稳定key"。

---

### Q2（Day4 · beginWork/completeWork）限时3分钟

**我讲的**：子fiber跳过看childLanes，如果为空就跳过；父memo，如果子组件中的props引用没有一致，子组件还是重新渲染。

**自评**：⬜✅ ✅🟡 ⬜❌

**AI点评**：childLanes机制答对了。但"父memo子还能渲染"的原因答偏了——你说的是"props引用不一致"（这其实是另一个话题：memo失效场景）。真正原因是**子组件自己有setState**（子自身的scheduled update），跟这次父组件传给它的props引用一致不一致完全无关。

---

### Q3（Day5 · commit阶段）限时3分钟

**我讲的**：commit分为：beginWork主要进行Wip fiber的重建，completeWork主要进行两颗树的diff对比、effect打标，最后一部分commit是真正将虚拟dom进行渲染的时候。

**自评**：⬜✅ ⬜🟡 ✅❌

**AI点评**：**概念性错误**——commit真正的三个子阶段是 **Before Mutation / Mutation / Layout**，你把render阶段的beginWork/completeWork当成commit的子阶段了，这是把两个不同的大阶段（render阶段 vs commit阶段）搞混了。也完全没答"root.current切换时机+为什么不能放第一步"。这题需要回day5.md重读。

---

### Q4（Day6 · useState源码）限时3分钟

**我讲的**：setN被调用时state不是立即变化，react会将set操作进行批处理；且在setN触发后，首先会经过render阶段进行Wip fiber的构建，构建过程中如果有高优先级的任务会随时打断，丢弃当前进度去执行优先级高的render，之后再重新进行fiber树的计算，计算完全后，在effect打标后，两颗树的指针进行切换，进行commit提交，渲染到页面。

**自评**：⬜✅ ✅🟡 ⬜❌

**AI点评**：方向对（不是立即变化，走批处理），但**没讲到这题真正该讲的核心机制**——`dispatchSetState`创建一个`update = {action, lane, next}`对象，塞进`hook.queue.pending`环形链表，然后调`scheduleUpdateOnFiber`调度重渲染；真正的state计算发生在下次render的`updateReducer`里。你讲的是后面"渲染打断+commit"的流程（这些是对的，但属于Day10/21的知识），相当于用别的知识"绕过"了这题该聚焦的Hook内部机制。

---

### Q5（Day7 · useEffect源码）限时3分钟

**我讲的**：不是，Mutation阶段跑的cleanup是上一次render时effect的return函数，里面的状态值还都是旧值，而flushPassiveEffects跑的就是当前状态下effect。

**自评**：✅✅ ⬜🟡 ⬜❌

**AI点评**：完全正确。精确抓住了核心：cleanup是上次render留下的旧值闭包，effect是当前render新建的、拿的是新值。

---

### Q6（Day8 · useMemo/useCallback）限时3分钟

**我讲的**：useCallback其实与useMemo底层用的一套逻辑，一个是将函数引用缓存，一个是将变量地址引用，useCallback在没有React.Memo包裹的组件下使用时，没有意义，节省不了多少时间，反而因为构建hooks对象还是增大复杂性。

**自评**：⬜✅ ✅🟡 ⬜❌

**AI点评**：核心结论都对（底层同一套逻辑、没memo配合没意义）。但"一个是将变量地址引用"这个表述不准确——useMemo缓存的是`nextCreate()`**执行后的返回值**（可以是基本类型也可以是引用类型），不是笼统的"变量地址引用"。

---

### Q7（Day9 · useContext）限时5分钟

**我讲的**：在组件初始挂载时，所有组件会有一个属性存放自己订阅了哪些context Value，当context value在引用地址改了后，会遍历组件的这个属性，找到有订阅自己的组件时，会触发组件的重新渲染。

**自评**：⬜✅ ✅🟡 ⬜❌

**AI点评**：基本流程对（组件有个属性记录订阅的context，对应`fiber.dependencies.firstContext`；value变了后遍历查找消费者）。但缺了关键机制——**怎么触发重渲染**：不是"找到就直接触发"，而是`propagateContextChanges`做DFS遍历，通过`mergeLanes`把`consumer.lanes`改掉，**破坏bailout条件**，这才是"能穿透memo"的真正原因。

---

### Q8（Day10 · Lane模型）限时3分钟

**我讲的**：判断b是否是a的子集，a是父组件的lanes值，b是子组件的Lanas。

**自评**：⬜✅ ⬜🟡 ✅❌

**AI点评**：**概念性错误**——`isSubsetOfLanes`跟父子组件fiber关系没有任何关系。签名是`isSubsetOfLanes(set, subset)`，判断的是**renderLanes（本趟渲染批次）**和**update.lane（某条更新的lane）**之间的子集关系，用在`updateReducer`里判断"这条update该不该被这次render处理"。这题需要回day10.md重读，注意跟父子fiber没关系。

---

### Q9（Day11 · Suspense原理）限时5分钟

**我讲的**：判断.then 是不是函数，如果是函数则为promise，反之为error。

**自评**：✅✅ ⬜🟡 ⬜❌

**AI点评**：完全正确，简洁准确抓住了`typeof value.then === 'function'`这个判断条件。

---

### Q10（Day13 · React19 Actions）限时5分钟

**我讲的**：说不清楚。

**自评**：⬜✅ ⬜🟡 ✅❌

**AI点评**：如实暴露薄弱点，按规则这正是模拟面试的价值所在。需要回day13.md重读`useActionState`和`useReducer`的本质区别。

---

### Q11（Day14 · Compiler/性能优化）限时3分钟

**我讲的**：返回true表示新旧props的引用地址都一样，返回的是地址不一样的组件；Array.filter是返回为true的。

**自评**：⬜✅ ✅🟡 ⬜❌

**AI点评**：方向大致对（true跟"引用一样"有关联），但没有清晰说出核心结论——**返回true = props等价 = 跳过渲染(bailout)**，也没有讲清跟Array.filter"反直觉"的具体对比点（filter返回true=保留该元素；memo返回true=不重新渲染，两者刚好相反）。

---

### Q12（Day15 · 状态管理对比）限时3分钟

**我讲的**：Zustand的store存储在react组件全局的，通过useSyncExternalStore来做组件与store的联动。

**自评**：⬜✅ ✅🟡 ⬜❌

**AI点评**：useSyncExternalStore联动机制答对了。但"存储在react组件全局"这个表述不准确——应该是**模块级闭包变量**，`create(fn)`在模块级别调用生成的store跟React完全无关、不经过Context，"react组件全局"这个说法容易让人误以为它跟React有绑定关系。

---

### Q13（Day19 · Scheduler）限时5分钟

**我讲的**：Scheduler内部的两套机制：一套回答当前任务执行是否超过5ms。一套回答当前是否有更高优先级的任务需要执行，shouldYieldToHost属于后者。

**自评**：⬜✅ ⬜🟡 ✅❌

**AI点评**：**前后矛盾**——你第一句描述的"是否超过5ms"其实就是`shouldYieldToHost`本身的行为（时间片机制），但第二句又说`shouldYieldToHost`属于"判断更高优先级"那一套，这两句自相矛盾了。正确归属：机制①任务排序（"谁先跑"，最小堆按expirationTime排，跟优先级有关）；机制②时间片让出（"跑多久该歇"，`shouldYieldToHost`计时5ms，**跟优先级无关**）。这题需要回day19.md重读，这是一个明确强调过的易错点。

---

### Q14（Day21 · 高优先级打断）限时5分钟

**我讲的**：打断的含义是指在最小单元执行过后释放主线程时打断，而不是随时打断，因为fiber在commit过程中是不能打断的。

**自评**：✅✅ ⬜🟡 ⬜❌

**AI点评**：抓住了核心——"打断"是协作式的（处理完一个最小单元后检查该不该让步），不是CPU层面随时抢占；commit过程不可打断。虽然没提具体函数名（`getNextLanes`），但概念理解正确。

---

### Q15（Day22 · mini-store）限时5分钟

**我讲的**：useSyncExternalStore在最后时会重新对比新旧快照，如果不匹配直接丢弃重新构建。

**自评**：⬜✅ ✅🟡 ⬜❌

**AI点评**：**回归性错误**——Day22 §八点五已经专门纠正过这个点："不是丢弃，是发现快照过期后逼组件重新渲染去读新值，真实数据从来没有丢失过"，你现在又说回了"丢弃重新构建"这个不准确的说法。这题要重点标进gap-list，属于"已经纠正过但没有真正吸收"的类型。

---

## 最终统计（15题跑完后填写）

| 结果 | 数量 | 题号 |
|---|---|---|
| ✅ 全对 | 3 | Q5, Q9, Q14 |
| 🟡 部分对 | 8 | Q1, Q2, Q4, Q6, Q7, Q11, Q12, Q15 |
| ❌ 讲不出来/概念错误 | 4 | Q3, Q8, Q10, Q13 |

---

## 收尾：把薄弱点写进 gap-list（当天必做，不过夜）

跑完 15 题后，把所有 🟡 和 ❌ 的题目，逐条整理进 `notes/day23-gap-list.md`：
- 具体讲不清楚的是哪个环节（源码函数名/机制名）
- 回去翻的是哪个 DayN 笔记的哪一节
- 用自己的话重新讲一遍，直到能流畅说出来

这份 gap-list 是明天（Day24）面试话术卡的核心输入。

---

## Day24 预告

**主题**：源码知识体系图 + 面试话术卡，衔接 `meta/job-sprint-plan.md` 阶段A第四天（收尾整个"并发渲染+状态管理"模块）。产出两份材料：①一张从 JSX→Element→Fiber→Diff→beginWork/completeWork→Commit→Hooks→Lane→Scheduler→并发特性的知识体系图，标清楚每个节点对应哪天笔记；②`meta/interview-cheatsheet.md`——把今天 gap-list 暴露的薄弱点 + 常见追问整理成"我会怎么讲"的口语化脚本。做完 D21-D24，整个 W1-W4 的 React 源码学习就有了一份可以直接拿去面试的完整交付物。
