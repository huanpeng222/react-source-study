# Day 9 实验观察记录（待回填）

## J1：Provider 嵌套与值覆盖

- 初始三个 `DeepChild` 打印的值：
  - 外层：____（预期：outer）
  - 内层：____（预期：inner）
  - 外层后：____（预期：outer）

- 点"改 inner"后：____（预期：只有内层 DeepChild 重渲染）

- 点"改 outer"后：____（预期：外层 + 内层 DeepChild 都重渲染）

## J2：Context 穿透 React.memo

- 点"改 count"：MemoChild 是否重渲染？____（预期：不重渲染，字符串字面量稳定）

- 点"改 theme"：MemoChild 是否重渲染？____（预期：重渲染，穿透 memo）

## J3：看 fiber.dependencies

- DevTools 中 `fiber.dependencies.firstContext.context` 指向：
  ____（预期：指向 ThemeCtx 这个 context 对象）

- `fiber.memoizedState` 上有没有 useContext 对应的 Hook 节点？
  ____（预期：没有。memoizedState 链表里是 useState 的节点，没有 useEffect 的）
