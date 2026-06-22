# Day 8 精简笔记：useRef / useMemo / useCallback

> 复习只看这一份。源码出处：`packages/react-reconciler/src/ReactFiberHooks.js`

## 一句话总纲

> 这三个是**最轻量**的 Hook：只用 `hook.memoizedState` 一个字段，**没有 queue、不打 flag、不参与 commit、自己永不发起 render**。render 阶段纯读写。

## 三者速查

| Hook | memoizedState 存 | mount | update |
|---|---|---|---|
| useRef | `{ current: x }` | 建盒子 | **一行 `return memoizedState`**（复用旧盒子）|
| useMemo | `[value, deps]` | 执行 create 存结果 | deps 命中→返 `[0]`；不等→重算 |
| useCallback | `[callback, deps]` | **直接存函数（不执行）** | deps 命中→返 `[0]`；不等→存新函数 |

## 核心结论（必背）

1. **ref 跨 render 稳定**：盒子挂在**该组件 fiber 的 hook 上**（不是全局！），updateRef 直接复用旧引用，从不新建。
2. **改 ref.current 不 render**：`setN` 有 dispatch 通路会调度更新；`ref.current=x` 只是**普通对象赋值**，React 不介入。→ 值立即变，视图不变。
3. **useMemo vs useCallback**：同一套机制，唯一区别——useMemo 存 `create()` 的**结果**，useCallback 存**函数本身**。`useCallback(fn,d) ≡ useMemo(()=>fn,d)`。
4. **缓存值在 `memoizedState[0]`**，deps 在 `[1]`（仅比较依据，不是缓存值）。
5. **deps 比较 = `areHookInputsEqual` 用 `Object.is` 逐项比**；引用类型比引用 → deps 放新对象/新函数 → 缓存永久失效（白写）。
6. **useCallback 的价值**：让传给子组件的函数引用稳定 → 子组件 `React.memo` 才能 bailout。不配 memo 基本没意义。

---

## 我的疑问追问记录（真实）

### 追问 1：ref 是不是存在全局？
- 我答："存在全局，不会随 render 重建，所以稳定"
- **纠正**：结论（稳定）对，但**位置错**。不是全局——全局的话同组件多实例会串。是挂在**该组件 fiber 的 Hook 链表**上（`hook.memoizedState`）。稳定的真因：updateRef 一行 `return hook.memoizedState`，配合 Day 7 三层复用（外壳浅拷贝指向同一盒子）。

### 追问 2：缓存值存在哪？
- 我答："hook 内 effect.deps 里"
- **纠正**：❌ 串台了。useRef/useMemo 没有 effect 结构。useMemo 缓存值在 `hook.memoizedState[0]`，deps 在 `[1]`（只是比较依据）。

### 追问 3：useCallback 引用稳定为什么对 React.memo 重要？
- 我答："引用不变时 memo 子组件不会重渲染"✅
- 完善链条：父传内联函数 → 每次新引用 → memo 浅比较 props 不等 → 子重渲染（memo 失效）；用 useCallback → 引用稳定 → memo 命中 → 子 bailout。

---

## 我的踩坑记录（真实）

| # | 踩坑 | 纠正 |
|---|---|---|
| 1 | 以为 ref 存"全局" | 挂在该组件 fiber 的 hook 上，不是全局 |
| 2 | 把缓存值说成存 deps/effect.deps | 缓存值在 memoizedState[0]，deps 是比较依据 |
| 3 | 改 ref.current 为何不 render（不会） | 普通对象赋值，无 dispatch 通路，React 不介入 |

---

## 5 句口诀

1. 三个轻 Hook：只用 memoizedState，不发起 render
2. ref 在 fiber 不在全局；updateRef 一行还旧盒子
3. 改 ref 值立即变，视图不变（无 dispatch）
4. memo 存结果，callback 存函数；`useCallback(fn,d)≡useMemo(()=>fn,d)`
5. deps 用 Object.is 逐项比；放新对象 = memo 白写
