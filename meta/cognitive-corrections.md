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

---

<!-- 后续 Day 的认知纠正继续追加在这里 -->
