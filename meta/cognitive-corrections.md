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

<!-- 后续 Day 的认知纠正继续追加在这里 -->
