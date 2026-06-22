# Day 7 自测（答案折叠，先自己答）

> 主题：useEffect / useLayoutEffect 源码 + effect 链表
> 源码出处：ReactFiberHooks.js / ReactFiberFlags.js / ReactHookEffectTags.js

---

## Q1
useEffect 和 useLayoutEffect 在源码里调用同一套 impl，只差哪两个参数？分别打在哪个对象的哪个字段上？

<details><summary>👉 答案</summary>

差 **fiberFlags** 和 **hookFlags**：

| | useEffect | useLayoutEffect | 打在哪 |
|---|---|---|---|
| fiberFlags | `Passive`(2048) | `Update`(4) | `fiber.flags` |
| hookFlags | `HookPassive`(8) | `HookLayout`(4) | `effect.tag` |

fiberFlags 粗筛（组件有没有副作用），hookFlags 细分（这个 effect 在哪个阶段跑）。
</details>

## Q2
PassiveEffect 和 UpdateEffect 在源码里实际是什么常量？

<details><summary>👉 答案</summary>

它们是别名：`PassiveEffect = Passive`(2048)，`UpdateEffect = Update`(4)。useLayoutEffect 复用了 DOM 更新那个 Update flag。
</details>

## Q3
effect 对象有哪些字段？cleanup 存在哪个字段？为什么不直接放在 effect 上？

<details><summary>👉 答案</summary>

```js
type Effect = { tag, create, deps, inst: { destroy }, next };
```

cleanup 存在 `effect.inst.destroy`。单独放 inst 是因为 destroy 有状态，要跨 render 保持同一个 inst 引用（hook 外壳每次新建，但 inst 复用）。
</details>

## Q4
effect 对象挂在哪两条链表？它们是两份拷贝还是同一对象？各自给谁用？

<details><summary>👉 答案</summary>

**同一个对象，两处引用**：
1. `hook.memoizedState`（Hook 链表）—— render 阶段比 deps 用
2. `fiber.updateQueue.lastEffect`（环形 effect 链表）—— commit 阶段遍历执行用

Hook 链表串所有 hook，effect 链表只串 effect（commit 不用扫无关 hook）。
</details>

## Q5
deps 浅比较发生在什么时候？用什么方法比？`[obj]`（每次新建的对象）会怎样？

<details><summary>👉 答案</summary>

发生在 update 阶段的 `updateEffectImpl`，调 `areHookInputsEqual` 用 **Object.is 逐项**比 deps 数组每个元素。

`[obj]` 每次 render 新建 → 引用每次都变 → Object.is 永远 false → effect 每次都重跑。要用 useMemo 锁定引用。
</details>

## Q6
`HookHasEffect` 是干什么的？deps 没变时 effect 还进链表吗？

<details><summary>👉 答案</summary>

`HookHasEffect`(1) 是"本次要不要跑"的开关位。

deps 没变时：effect **仍进两条链表**（保持顺序），但 tag 不含 HookHasEffect，且不打 fiberFlags → commit 遍历到它时跳过执行。**"进链表"和"执行"是两件事。**
</details>

## Q7
为什么只有 useEffect/useLayoutEffect 打 flag，useState/useRef/useMemo 不打？

<details><summary>👉 答案</summary>

因为只有它俩的产出（回调 create）**需要延迟到 commit 阶段执行**（DOM 改完后才能跑）。useState/useRef/useMemo 的产出在 render 阶段直接 return 就用掉了，不需要 commit 回头找 → 不打 flag。

⚠️ 不是"有 cleanup 才打"——没 cleanup 的 effect 照样打。
</details>

## Q8
Hook 链表是只 mount 时建一次，还是每次 render 重建？

<details><summary>👉 答案</summary>

**每次 render 重建**。renderWithHooks 开头 `memoizedState = null` 清空，update 时 `updateWorkInProgressHook` 从 current 对应位置克隆新 hook 节点。

结构每次重建，数据通过克隆延续（双缓存）。这也是 Hook 必须顺序稳定的根因。
</details>

## Q9
update 时克隆 hook，是复用 currentHook 对象还是新建？和 Fiber 的复用策略一样吗？

<details><summary>👉 答案</summary>

**新建外壳 + 浅拷贝字段**（`newHook !== currentHook`），和 Fiber 不一样：
- Fiber：复用对象本身（alternate 两个轮流坐庄）
- Hook：每次新建对象

但 `queue` 字段共享（`newHook.queue === currentHook.queue`）—— 这就是 dispatch 引用稳定的根。
</details>

## Q10（时序题）
```jsx
const [n, setN] = useState(0);
useEffect(() => { console.log('e', n); return () => console.log('c', n); }, [n]);
useLayoutEffect(() => { console.log('le', n); return () => console.log('lc', n); }, [n]);
```
点击一次（n: 0→1），完整 console 顺序？每个 cleanup 的 n 是几？

<details><summary>👉 答案</summary>

```
render: 1
lc: 0        ← layoutCleanup，Mutation 同步，拿上次 n=0
le: 1        ← layoutEffect，Layout 同步
（paint）
c: 0         ← cleanup，异步，拿上次 n=0
e: 1         ← effect，异步，拿这次 n=1
```

cleanup 闭包捕获**上次**渲染的 n，effect 拿**这次**的 n。
</details>

## Q11（三层复用，开放题）
说出 fiber / hook 外壳 / hook.queue / effect 外壳 / effect.inst 五个对象，哪些跨 render 复用、哪些每次新建？规律是什么？

<details><summary>👉 答案</summary>

| 对象 | 跨 render |
|---|---|
| fiber | 复用（alternate）|
| hook 外壳 | 新建 |
| hook.queue | 共享 |
| effect 外壳 | 新建 |
| effect.inst | 复用 |

规律：**需要跨 render 存活的状态（queue/inst）共享复用；每次 render 重新组织的结构（fiber链/hook外壳/effect链）重建。**
</details>

---

## 完成后

答错的题回 `notes/day7.md` 对应章节重读。下一站：Day 8 useRef/useMemo/useCallback。
