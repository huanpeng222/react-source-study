# Day 2 实验：在 DevTools 里看 Fiber

## 环境准备

```bash
cd demos/day2
npm create vite@latest playground -- --template react
cd playground
npm install
npm run dev
```

安装浏览器扩展 **React Developer Tools**。

---

## 实验 A：抓 Fiber 节点

把 `playground/src/App.jsx` 改成：

```jsx
import { useState, useRef, useEffect } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!btnRef.current) return;
    const fiberKey = Object.keys(btnRef.current).find(k => k.startsWith('__reactFiber$'));
    const fiber = btnRef.current[fiberKey];

    console.group('🧬 Fiber 节点字段');
    console.log('current fiber:', fiber);
    console.log('alternate (另一棵树):', fiber.alternate);
    console.groupEnd();
  }, [count]);

  return (
    <div>
      <h1>Fiber 探索器</h1>
      <button ref={btnRef} onClick={() => setCount(c => c + 1)}>
        点击 {count} 次
      </button>
    </div>
  );
}
```

**操作步骤**：

1. 打开页面，**点击按钮 2 次以上**（确保产生 alternate）。
2. 控制台展开 `current fiber`，截图保留到 `screenshots/A-fiber-fields.png`。
3. 在 `observations.md` 里记录这 9 个字段的值：
   - `tag` / `type` / `stateNode` / `return` / `child` / `sibling` / `alternate` / `memoizedProps` / `flags`

---

## 实验 B：验证 alternate 自反性

在 useEffect 里追加：

```js
console.assert(
  fiber.alternate?.alternate === fiber,
  '❌ alternate 不自反！'
);
console.log('✅ alternate.alternate === self:', fiber.alternate?.alternate === fiber);
```

**预期输出**：`✅ alternate.alternate === self: true`

如果是 `false`，说明抓快照的时机被打断了——commit 还没完成。

---

## 实验 C：手写遍历整棵 Fiber 树

继续追加：

```js
function printTree(node, depth = 0) {
  if (!node) return;
  const name = typeof node.type === 'function'
    ? (node.type.name || 'Anonymous')
    : (node.type || `<tag ${node.tag}>`);
  console.log(' '.repeat(depth * 2) + name + ` (tag=${node.tag})`);
  printTree(node.child, depth + 1);
  printTree(node.sibling, depth);  // ⚠️ 兄弟同级，不加 depth
}

let root = fiber;
while (root.return) root = root.return;
console.group('🌲 Fiber Tree from Root');
printTree(root);
console.groupEnd();
```

**预期输出**（大致）：

```
<tag 3>         ← HostRoot
  App (tag=0)
    div (tag=5)
      h1 (tag=5)
        <tag 6>     ← HostText "Fiber 探索器"
      button (tag=5)
        <tag 6>     ← HostText "点击 N 次"
```

**留档**：把控制台输出复制到 `walk-tree-output.txt`。

---

## 自检问题（写到 observations.md）

1. 你的 App 组件 `tag` 是几？（应该是 0 = FunctionComponent）
2. HostRoot 在哪里？它的 `stateNode` 是什么？
3. 第一次渲染（count=0）和第二次渲染（count=1）时，button Fiber 是**同一个对象**还是不同对象？怎么验证？
4. 改一下 walk 函数：让它**只打印有 effect 的节点**（`flags !== 0`）。

---

## 完成后

```bash
git add demos/day2 notes/day2.md notes/day2-quiz.md
git commit -m "W1 D2 Fiber 双缓存：完成 DevTools 字段拆解 + 三实验"
git push
```
