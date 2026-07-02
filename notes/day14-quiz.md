# Day 14 自测（答案折叠，先自己答）

> 主题：React.memo / useMemo / useCallback / bailout / Compiler

## Q1
下面代码有几个性能问题？分别怎么修？

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  const handleClick = () => setCount(c => c + 1);
  const heavyData = computeExpensive(count);
  return (
    <div>
      <button onClick={handleClick}>{count}</button>
      <Child data={heavyData} onClick={handleClick} />
      <VeryHeavyComponent />
    </div>
  );
}
```

<details><summary>答案</summary>
**4 个问题：**

| # | 问题 | 修复 |
|---|---|---|
| 1 | `handleClick` 每次新函数 → Child 收到不稳定 onClick | `useCallback(() => setCount(c=>c+1), [])` 或 Compiler 自动处理 |
| 2 | `computeExpensive(count)` 每次 render 重算 | `useMemo(() => computeExpensive(count), [count])` |
| 3 | Child 的 data 和 onClick 引用不稳定 | 修复 1+2 后自然解决；或给 Child 加 React.memo |
| 4 | VeryHeavyComponent 无 props 但随 Parent re-render | 给它加 `React.memo()`；或移到不会频繁 re-render 的位置 |

**注意**：即使子组件没接收任何 props，Parent re-render 时它**依然会 re-render**。这是最容易被忽略的性能杀手。
</details>

## Q2
`React.memo(Comp, (prevProps, nextProps) => boolean)` 的比较函数返回 true 表示什么？

<details><summary>答案</summary>
返回 **true = props 等价 = 跳过渲染 (bailout)**。

和 Array.filter **相反**：
- filter: fn 返回 true = **保留该元素**
- memo:   fn 返回 true = **不重新渲染**

很多人这里搞反。
</details>

## Q3
React Compiler 的"输入等价性保证"是什么意思？为什么重要？

<details><summary>答案</summary>
**定义**：编译后的代码在相同输入下产生与源码完全相同的输出。Compiler 不改变组件逻辑、副作用顺序、Hooks 顺序、错误时机。

**为什么重要**：
- 你可以**安全地启用 Compiler 不担心引入 bug**
- 如果编译后行为不一致 → 是 Compiler 的 bug 不是你的问题
- 团队协作时：不用逐行审查编译产物

**不保证**：渲染次数可能减少（这正是目的），内存可能略增。
</details>

## Q4
什么情况下仍然需要手写 memo / useMemo / useCallback？（至少 4 个）

<details><summary>答案</summary>
1. **跨组件共享的常量/配置** → 提到组件外部
2. **自定义比较逻辑** → React.memo 第二参数（Compiler 只用 Object.is）
3. **ref.current 相关缓存** → ref 不在依赖追踪系统内，手动 useMemo
4. **第三方组件优化** → Compiler 通常忽略 node_modules，外层包 React.memo
5. **性能调试断点** → 显式 memo 作为 DevTools 分析标记
6. **意图声明** → 告诉队友"这个组件不应该频繁 re-render"
</details>

## Q5
bailout 发生在哪个阶段？效果是什么？

<details><summary>答案</summary>
**阶段**：beginWork 阶段（`ReactFiberBeginLoop.js`）

**条件**：
```
oldProps === newProps (Object.is)
&& 当前 renderLanes 不包含该 fiber 的 updateLanes
→ bailout!
```

**效果**：复用上次的 Fiber 节点，**跳过整个子树渲染**——不只是当前组件省了，所有子孙组件都省了。

**关键认知**：父组件无法 bailout（因为它自己触发了更新，didReceiveUpdate=true）。**memo 的价值在子组件不在父组件。**
</details>

## Q6（综合题）
解释下面这段代码中 Child 为什么每次都 re-render，以及三种修复方式：

```jsx
function Parent({ items }) {
  return items.map(item =>
    <Child key={item.id}
      item={item}
      onClick={() => handle(item.id)}
      options={{ mode: 'edit' }}
    />
  );
}
const Child = React.memo(({ item, onClick, options }) => ...);
```

<details><summary>答案</summary>
**原因**：虽然 Child 包了 React.memo，但三个 prop 引用都不稳定：
- `onClick`: 箭头函数 → 每次 map 迭代都是新函数引用
- `options`: 对象字面量 `{ mode: 'edit' }` → 每次都是新对象
- `item`: 如果 items 数组是新引用但 item 内容相同 → Object.is 通过 ✅（这个没问题）

**React.memo 用 Object.is 默认比较** → 新函数 !== 旧函数 → **永远不命中 bailout**

**三种修复**：

方式 A — useCallback + useMemo：
```jsx
// Parent 里
const handleRef = useCallback(handle, []); // 但这样拿不到 item.id...
// 更好的方式：把 id 作为 data 属性传递
```

方式 B — 把数据嵌入 DOM（绕过闭包）：
```jsx
onClick={(e) => handle(e.currentTarget.dataset.id)}
data-id={item.id}
```

方式 C — 子组件内部用 ref 缓存（不推荐）：
```jsx
// 或者直接用 curried 形式 + 外层 Map 缓存
```

**最佳实践**：用 `React Compiler` 自动处理，或在列表项组件里用稳定的 ID 做自定义比较。
</details>
