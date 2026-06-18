# Day 2 · 实验观察记录

> 在跑完 `README.md` 里的三个实验后，把观察到的事实填进来。
> 这份文件是你自己的"实验日记"，不是抄答案——填错了 AI 帮你纠正。

---

## 实验 A：抓 Fiber 节点

> 截图：`screenshots/A-fiber-fields.png`

### 我抓到的 button Fiber 字段值

| 字段 | 我的值 | 含义（自己复述一遍） |
|---|---|---|
| `tag` |   |   |
| `type` |   |   |
| `stateNode` |   |   |
| `return` |   |   |
| `child` |   |   |
| `sibling` |   |   |
| `alternate` |   |   |
| `memoizedProps` |   |   |
| `flags` |   |   |

---

## 实验 B：alternate 自反性

```
console 输出：
✅ alternate.alternate === self: ___
```

**思考**：什么时候这个 assert 会失败？

---

## 实验 C：遍历整棵 Fiber 树

> 输出：`walk-tree-output.txt`

### 我数到的节点数：___ 个

### 自检问题答案

**Q1**：我的 App 组件 `tag` 是 ___

**Q2**：HostRoot 的 `stateNode` 是什么？
> 答：

**Q3**：第一次渲染和第二次渲染时，button Fiber 是同一个对象吗？怎么验证？
> 答：

**Q4**：只打印有 effect 节点（`flags !== 0`）的输出是什么？
> 答：

---

## 我新发现的（自由记录）

-
-
-
