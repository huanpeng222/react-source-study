# Day 5 · 实验观察记录

> 跑完 README.md 三个实验后回填本文件。

---

## 实验 F1：useLayoutEffect vs useEffect 时序

### console 输出（首次 + 点击 2 次）

```
（粘贴）
```

### 自检

**Q1**：cleanup 和新 effect 哪个先跑？为什么 React 这样安排？

> 

**Q2**：两个 cleanup 的执行顺序是什么？

> 

**Q3**：快速连续点击 3 次，cleanup 还是每次都跑吗？

> 

---

## 实验 F2：用 useLayoutEffect 修复闪烁

### useEffect 版本

> 录屏：`F2-flicker-with-useEffect.gif`

观察：

> 

### useLayoutEffect 版本

> 录屏：`F2-no-flicker-useLayoutEffect.gif`

观察：

> 

### 自检

**Q**：如果不阻塞 50ms（去掉 while 循环），还能看到闪烁吗？为什么？

> 

---

## 实验 F3：cleanup 闭包验证

### console 输出（点击 3 次）

```
（粘贴）
```

### 关键观察

cleanup 的 n 永远比 effect 的 n 小 ___（数字）

### 自检

**Q**：如果故意不写 cleanup，会有什么 bug？

> 

---

## 我新发现的（自由记录）

-
-
-
