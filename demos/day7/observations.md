# Day 7 实验观察记录

> 跑完 `README.md` 三个实验后回填。

---

## 实验 H1：deps 浅比较陷阱

### 我的预测

| effect | deps | 我猜点击后重跑 |
|---|---|---|
| A `[n]` |  |  |
| B `[obj]` |  |  |
| C `[stableObj]` |  |  |

### 实际现象

| effect | 重跑？ | 备注 |
|---|---|---|
| A `[n]` |  |  |
| B `[obj]` |  |  |
| C `[stableObj]` |  |  |

### 我的感悟

（为什么 deps 放对象要用 useMemo 包？）

---

## 实验 H2：两条链表实物

### 观察

1. Hook 链表节点数：
2. useEffect 的 Hook.memoizedState 是不是 effect 对象：
3. updateQueue.lastEffect 是不是环形：
4. 同一性验证 `hook.memoizedState === updateQueue 对应 effect`：

### 我的感悟

（为什么要两条链表？）

---

## 实验 H3：cleanup 时机

### 我的预测

初次加载顺序：

点击后顺序：

cleanup 打印的 n 是几：

### 实际现象

```
初次加载：

点击后：

```

### 我的感悟

（为什么 cleanup 拿到的是上次的 n？）

---

## Day 7 综合反思（必填）

1. 今天最颠覆我认知的是：

2. 我仍然不清楚的是：

3. effect 跟 useState/useRef 最大的不同是：
