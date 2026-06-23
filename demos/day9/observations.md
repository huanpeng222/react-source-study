# Day 9 实验观察记录（待回填）

## J1：无 memo vs 有 memo 对照

### 无 memo 版
- 点 toggle / inner / outer，各打印几行？____（预期：每个都 3 行，A/B/C 全渲染）
- 三个按钮行为一样吗？____（预期：一样，都全渲染 —— context 机制被"默认全渲染"盖住）

### 有 memo 版
- 改 toggle（value 不变）：____（预期：0 行）
- 改 inner（内层 value 变）：____（预期：只 B 内层 1 行）
- 改 outer（外层 value 变）：____（预期：A/B/C 3 行）

⭐ 关键体会：context "只渲染消费者" 的精准性，必须配合 memo 才能看出来。

## J2：Context 穿透 React.memo

- 改 count（无关）：MemoChild 渲染吗？____（预期：不渲染）
- 改 theme：MemoChild 渲染吗？____（预期：渲染，穿透 memo）

## J3：fiber.dependencies

- `dependencies.firstContext.context` 指向：____（预期：ThemeCtx）
- `memoizedState` 链表里有 useContext 节点吗？____（预期：没有，只有 useRef/useEffect）

## 我的最大收获

（回填：原以为"改 inner 只有内层渲染"——其实没 memo 时三个都渲染；
context 的精准标记必须配合 memo 才显现。）
