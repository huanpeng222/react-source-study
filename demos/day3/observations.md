# Day 3 · 实验观察记录

> 跟练时间：2026-06-18 下午
> 状态：✅ D1/D2 实验完成，D3 跳过实操但回答了延伸题

---

## 实验 D1：key=index 身份认错

> 截图：`screenshots/D1-input-mismatch.png`（点击 prepend NEW 两次后的错位状态）

### 我看到的现象（两次 prepend NEW 后）

| 行 | input 内容 | span 显示 | 对应？ |
|---|---|---|---|
| 0 | A | NEW | ❌ 错位 |
| 1 | B | NEW | ❌ 错位 |
| 2 | C | A | ❌ 错位 |
| 3 | C | B | ❌ 错位（这是第一次 prepend 时新建的 fiber，defaultValue=C 留下来）|
| 4 | C | C | ⚠️ 看似对上，实际是巧合（第二次 prepend 时新建的，defaultValue 恰好是 C）|

### 修复成 key=todo.id 后

| 行 | input 内容 | span 显示 | 对应？ |
|---|---|---|---|
| 0 | NEW2 | NEW | ✅ 新建 |
| 1 | NEW1 | NEW | ✅ 第一次的新建 |
| 2 | A | A | ✅ 复用，跟随语义身份 |
| 3 | B | B | ✅ |
| 4 | C | C | ✅ |

### 我的反思

**所有 input 都错位了，不是一两行的偶发问题**——只要列表头部插入元素，React 复用旧 fiber 对应的 DOM，input 内部 value 不会因 defaultValue prop 二次设置而更新，于是用户输入的内容"留在了原位置"，但语义身份（id/text）已经漂移。

精确表达：**input 显示的是"这个 fiber 第一次创建时的 defaultValue"，span 显示的是"当前应该的 text"**。React 复用了不该复用的对象身份。

---

## 实验 D2：多节点 diff 日志追踪（key=id 实验）

> 操作：`shuffle to [B,A,D,C]`

### 我看到的 console（出乎意料的现象）

```
[B-banana] UPDATE
[A-apple]  UPDATE
[D-durian] UPDATE
[C-cherry] UPDATE
[A-apple]  UNMOUNT   ← ⚠️
[A-apple]  MOUNT     ← ⚠️
[A-apple]  UPDATE
[C-cherry] UNMOUNT   ← ⚠️
[C-cherry] MOUNT     ← ⚠️
[C-cherry] UPDATE
```

**A 和 C 出现了 UNMOUNT + MOUNT**——和我原本预期的"全部复用，只 UPDATE"不一致。

### AI 的解释（学到的新知识）

**Placement 在 commit 阶段执行 `insertBefore`，浏览器把已存在的 DOM 节点移动到新位置时，会先 detach 再 attach**。React 把这个过程解释为"useEffect 清理 + 重跑"。

- 用 lastPlacedIndex 算法推演，A 和 C 正好是被标 Placement 的两个节点
- B、D 没被标 Placement → DOM 没移动 → useEffect 不重跑 → 只有 UPDATE

⭐ **核心新认知**：**Fiber 是复用的（同一个对象），但 DOM 移动会触发 useEffect 重跑**。这两件事独立。

### key=index 列表的 console

```
[B-banana] UPDATE
[A-apple] UPDATE
[D-durian] UPDATE
[C-cherry] UPDATE
```

✅ 4 行 UPDATE，没有 mount/unmount，跟预期一致。

### 关键思考题：key=id 和 key=index 都没有 fiber 重建，那 key=index 的 bug 在哪？

**Bug 不在 console 输出里能看到的地方**——console 打印的是从 props 读取的 id/name，每次 render 都是最新值，所以"看起来对得上"。

**Bug 在 Fiber 内部不可见的部分**：
- useState 内部 state
- useRef 持有的引用
- 非受控 DOM 内部 value（input.value、scroll position、focus、动画）

**口诀**：**key=id 是抽屉跟着身份走（搬家也搬着抽屉走），key=index 是抽屉钉死在位置上、身份是贴在外面的标签。** console.log 看的是标签 → 当然对得上。内部状态在抽屉里 → 跟着抽屉走 → 错位。

---

## 实验 D3：type 变化导致 state 重置

⚠️ **没真跑，但答了反问题——其中一题答错了**。

### AI 反问 + 我的答 + 纠正

**Q**：把 `<Counter />` 换成 `<input defaultValue="hello" />`，切换 wrapper 时 input 内容会重置吗？

**我答**：不会，type 一致

**❌ 错**：input 内容**会重置**。原因：

> Day 3 假设 1 准确说法是 **"同一位置的 Fiber，如果 type 变了，整棵子树重建"**。

```jsx
{wrapper === 'div' 
  ? <div><input defaultValue="hello" /></div>
  : <span><input defaultValue="hello" /></span>
}
```

第 0 层位置 0 的节点：`div` → `span`，**type 变了** → 整棵子树（包括内部 input）销毁重建 → DOM 是新的 → defaultValue='hello' 重新生效 → 用户输入丢失。

**我的认知误区**：以为"看，input 还是 input，type 没变" → 但 React **按位置判断**，发现祖先 div→span 立刻判定子树重建，根本不会"递归进去看 input 是不是同一个"。

**这就是假设 1 的工程效率来源**：判断在最浅一层就完成，不深入。

### 反例（同 wrapper 类型，只是 className 变）

```jsx
<div><input /></div> ↔ <div className="x"><input /></div>
```

div type 同 → input 不重建 → 输入内容保留 ✅

---

## 挑战题：列表只更新（不增不删不重排），key=index 也能出 bug 吗？

**我答**：想不到，因为根据 index 来的，就是可以完全对应

**AI 反馈**：你的困惑是**对的** 🟢。

> "key=index 出 bug" 的根本前提是 **"index 和语义身份的对应关系发生了改变"**——要么数组顺序变了，要么数组长度变了。
>
> 如果能保证"index 永远对应同一个语义实体"，那 key=index 就没问题。
>
> **但这种保证非常脆弱**——今天保证不重排，下次迭代加个排序就崩了。
>
> 所以最佳实践：**永远用 id，永远不要赌**。

---

## 我新发现的（自由记录）

- **复用范围比想象中严格**：同位置 + type 同 = 复用。任何祖先 type 变 = 整棵子树重建。
- **Fiber 复用 ≠ useEffect 不跑**：DOM 移动（Placement）会触发 useEffect cleanup + rerun，即使 Fiber 对象没变。
- **抽屉模型**：Fiber 是抽屉，state/ref/DOM 内部状态在抽屉里跟着走，props 是标签每次重贴。key 决定"哪个抽屉对应哪个身份"。
- **看 console 别只看 props 输出**：props 每次 render 都是最新值，看起来"对得上"，但内部状态才是 bug 真正发生的地方。
