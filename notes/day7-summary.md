# Day 7 精简笔记：useEffect / useLayoutEffect 源码 + effect 链表

> 学完 Day 7 的"压缩 + 个人化"笔记。含跟练时的真实疑问 + 踩坑。
> 源码出处：ReactFiberHooks.js / ReactFiberFlags.js / ReactHookEffectTags.js

---

## 🎯 一句话主轴

> **useEffect 和 useLayoutEffect 是同一套 impl，只靠两个 flag 区分；effect 对象同时挂两条链表（比 deps 用 + commit 执行用）；deps 用 Object.is 逐项比；cleanup 存 effect.inst.destroy，下次 commit 跑。**

---

## 📦 4 个核心结论

### 1. 两个 flag（这是今天最绕的点）

| | useEffect | useLayoutEffect | 打在哪 | 作用 |
|---|---|---|---|---|
| fiberFlags | Passive(2048) | Update(4) | `fiber.flags` | 粗筛：组件有没有副作用 |
| hookFlags | HookPassive(8) | HookLayout(4) | `effect.tag` | 细分：在哪个阶段跑 |

- effect.tag 最终值：useEffect = HookHasEffect∪HookPassive = 9；useLayoutEffect = 1∪4 = 5
- 只有 useEffect/useLayoutEffect 打 flag，useState/useRef/useMemo 不打（产出 render 阶段就用掉）

### 2. 两条链表（同一对象两处引用）

```
hook.memoizedState ──┐
                     ├─→ 同一个 effect 对象
updateQueue 环形链表 ─┘
```

- Hook 链表：所有 hook，render 阶段比 deps 用
- effect 环形链表：只串 effect，commit 阶段遍历执行用（不用扫无关 hook）

### 3. deps 浅比较

`areHookInputsEqual` 用 **Object.is 逐项**比 deps 每个元素：基本类型比值，引用类型比引用。`[obj]` 每次新建引用变 → 每次重跑（要 useMemo 包）。

`HookHasEffect` 是开关位：deps 没变时 effect 仍进链表，只是 tag 无 HookHasEffect → commit 跳过。

### 4. cleanup

存在 `effect.inst.destroy`（不是 memoizedState，隔两层）。create() 执行后存；下次 commit 执行上次的 destroy。cleanup 闭包捕获**上次**的值。

---

## 🧩 三层复用粒度（今天最值钱的串联）

| 对象 | 跨 render | 策略 |
|---|---|---|
| fiber | ✅ 复用本身 | alternate 两个轮流（Day 2）|
| hook 外壳 | ❌ 每次新建 | 浅拷贝字段（Day 7）|
| hook.queue | ✅ 共享 | dispatch 才稳定（Day 6）|
| effect 外壳 | ❌ 每次新建 | 新 push（Day 7）|
| effect.inst | ✅ 复用 | cleanup 跨 render 存活（Day 7）|

⭐ **规律**：跨 render 存活的状态（queue/inst）共享；每次重组的结构（链表/外壳）重建。

---

## ❓ 我跟练时的真实疑问追问

### 追问 1（15:09）：两条链表里的 effect 有啥区别？为啥 effect 跟其他 hook 不一致？
**纠正**：不是两份 effect，是同一对象两处引用。effect 多一条链表，因为它是唯一需延迟到 commit 执行的 hook，commit 直接遍历 effect 链表比扫整条 Hook 链表高效。

### 追问 2（15:14）：deps 没变 effect 进哪条链表？Hook 链表只建一次吗？
**纠正**：① deps 没变两条链表都进，区别在 tag 无 HookHasEffect。② Hook 链表每次 render 重建（renderWithHooks 开头清空），不是只建一次。

### 追问 3（15:20）：克隆 hook 是复用对象还是新建？
**纠正**：新建外壳 + 浅拷贝字段，和 Fiber 复用对象不同。queue 字段共享 → dispatch 稳定。引出三层复用粒度。

### 追问 4（15:31~15:43）：两个 flag 到底啥意思？effect.tag 一样吗？
**纠正**：接 Day 4 fiber.flags 体系。确切数值核对：useEffect tag=9 / useLayoutEffect tag=5（不一样）。fiberFlags 是 ReactFiberFlags 常量别名，hookFlags 是 ReactHookEffectTags 另一套。

---

## 🐛 我的踩坑记录

### 坑 1：以为两条链表里 effect 是两份不同的
**纠正**：同一对象，两处引用。

### 坑 2：以为 Hook 链表只 mount 建一次
**纠正**：每次 render 重建，数据靠双缓存克隆延续。

### 坑 3：以为 hook 像 fiber 一样复用对象
**纠正**：hook 外壳每次新建，只有 queue/inst 共享复用。

### 坑 4：以为"有 cleanup 才打 flag"
**纠正**：根本原因是回调延迟到 commit 执行，没 cleanup 也打。

### 坑 5：以为 deps 比的是整个数组对象的引用
**纠正**：Object.is 逐项比每个元素，基本类型比值/引用类型比引用。

### 坑 6（自测）：cleanup 存在 memoizedState
**纠正**：存在 effect.inst.destroy，memoizedState 只是指向 effect 对象，隔两层。

---

## 🎤 5 句面试口诀

1. **两个 flag**："fiberFlags(fiber.flags) 粗筛组件、hookFlags(effect.tag) 细分阶段；Passive 异步、Update/Layout 同步"
2. **两条链表**："同一 effect 对象，memoizedState 比 deps、updateQueue 环形链表给 commit 当执行清单"
3. **deps 比较**："Object.is 逐项比，引用类型比引用——所以对象 deps 要 useMemo"
4. **cleanup**："存 effect.inst.destroy，下次 commit 跑，闭包捕获上次的值"
5. **三层复用**："fiber 复用对象、hook 外壳新建、queue/inst 共享——跨 render 存活的共享，每次重组的重建"

---

## ✅ 学完后回到入场自测（首尾呼应）

| Q | 学完后我能答吗 |
|---|---|
| Q1 两个 flag 差异 | ✅ |
| Q2 effect 挂哪 + 两条链表 | ✅ |
| Q3 deps 浅比较时机 + Object.is | ✅ |
| Q4 cleanup 存 inst.destroy + 时机 | ✅ |

下一站：Day 8 · useRef / useMemo / useCallback。
