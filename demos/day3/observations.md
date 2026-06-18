# Day 3 · 实验观察记录

> 跑完 README.md 三个实验后回填本文件。

---

## 实验 D1：key=index 身份认错

> 截图：`screenshots/D1-input-mismatch.png`

### 我看到的现象

| 行 | input 内容 | span 显示 | 对应？ |
|---|---|---|---|
| 1 |   |   |   |
| 2 |   |   |   |
| 3 |   |   |   |
| 4 |   |   |   |

### 修复成 key=todo.id 后

| 行 | input 内容 | span 显示 | 对应？ |
|---|---|---|---|
| 1 |   |   |   |
| 2 |   |   |   |
| 3 |   |   |   |
| 4 |   |   |   |

### 我的反思（一句话）

> 

---

## 实验 D2：多节点 diff 日志追踪

> console 输出：`D2-console.txt`

### key=id 的 console 输出

```
（粘贴在这里）
```

### key=index 的 console 输出

```
（粘贴在这里）
```

### 进阶（li → p）后的输出

```
（粘贴在这里）
```

### 思考题

**Q**：key=id 和 key=index 在 console 里几乎一样（都没 MOUNT/UNMOUNT），那 key=index 的 bug 在哪？

> 答：

---

## 实验 D3：type 变化导致 state 重置

> 截图/录屏：`screenshots/D3-state-reset.gif`

### 我看到的现象

- n 变到 5 后切换 wrapper，n 变成 ___
- console 输出：

```
（粘贴）
```

### 对比实验（div className 变化）

- n 变到 5 后切换 className，n 变成 ___
- 这是因为：

---

## 自检题答案

**Q1**：D1 里**哪一行 input 跟错人**？为什么？

> 

**Q2**：D2 里如果全删 + 全新插，console 会打印什么？

> 

**Q3**：D3 里把 Counter 换成 input，切换 wrapper 时内容会重置吗？

> 

**Q4**（挑战）：能写出"只更新不增删"还出 key=index bug 的例子吗？

> 

---

## 我新发现的（自由记录）

-
-
-
