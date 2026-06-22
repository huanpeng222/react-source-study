# Day 7 笔记：useEffect / useLayoutEffect 源码 + effect 链表

> 日期：2026-06-22
> 主题：W2 第二天——effect 怎么挂、怎么对比 deps、怎么和 commit 阶段联动
> 状态：📖 学习中
> 前置：Day 5 commit 三阶段 + Day 6 Hook 链表
>
> ⚠️ **源码出处（本文件所有源码事实均来自此处，已 WebFetch 实时核对）**：
> `packages/react-reconciler/src/ReactFiberHooks.js`
> 涉及函数：`mountEffectImpl` / `updateEffectImpl` / `pushSimpleEffect` / `pushEffectImpl` / `areHookInputsEqual` / `mountLayoutEffect` / `updateLayoutEffect`

---

## 零、入场自测（5 分钟，先自己答再往下看）

> ⚠️ 答完再往下看，"不会"明确说"不会"。

1. **useEffect 和 useLayoutEffect 在源码里只有一两个参数不同，是哪个？**
   提示：它们底层调用的是同一个 impl 函数，只传了不同的 flag。

2. **effect 对象挂在 fiber 的哪里？和 Day 6 学的 Hook 链表（memoizedState）是什么关系？**
   提示：有两条链表，别搞混。

3. **deps 数组的浅比较（[a, b] 变没变）精确发生在什么时候？比较的是什么？**
   提示：Day 6 学过 areHookInputsEqual 吗？没有就猜。

4. **cleanup 函数（effect 的 return）是什么时候、存到哪里的？**
   提示：Day 5 学过 cleanup 在 Mutation 阶段跑，但它是什么时候"被存起来"的？

---

## 一、回顾：从 Day 5 + Day 6 接上来

- **Day 5** 学了 commit 三阶段，知道 cleanup 在 Mutation 跑、effect 在 paint 后异步跑（useEffect）或 Layout 同步跑（useLayoutEffect）。
- **Day 6** 学了 useState 的 Hook 链表（`fiber.memoizedState`）。

**Day 7 要回答**：useEffect 本身在源码里长什么样？它怎么挂到 fiber 上？deps 怎么比？

---

## 二、useEffect 和 useLayoutEffect 的源码差异（Q1）

### 2.1 两者底层是同一个 impl

```js
// useEffect（mount）
function mountEffect(create, deps) {
  mountEffectImpl(
    PassiveEffect | PassiveStaticEffect,   // ← fiberFlags
    HookPassive,                           // ← hookFlags
    create,
    deps,
  );
}

// useLayoutEffect（mount）
function mountLayoutEffect(create, deps) {
  let fiberFlags = UpdateEffect | LayoutStaticEffect;  // ← fiberFlags
  return mountEffectImpl(fiberFlags, HookLayout, create, deps);
  //                                 ↑ hookFlags
}
```

⭐ **核心差异只有两个 flag**：

| | useEffect | useLayoutEffect |
|---|---|---|
| **fiberFlags** | `PassiveEffect` | `UpdateEffect` |
| **hookFlags** | `HookPassive` | `HookLayout` |

- **fiberFlags** 打在 `fiber.flags` 上 → commit 阶段靠它知道"这个 fiber 有 passive / layout effect 要处理"
- **hookFlags** 打在 effect 对象的 `tag` 上 → 区分"这个 effect 是 passive 还是 layout"

### 2.2 这两个 flag 决定了"什么时候跑"

| flag | commit 阶段表现（Day 5 学过）|
|---|---|
| `HookLayout`（useLayoutEffect）| Layout 子阶段**同步**跑（paint 前）|
| `HookPassive`（useEffect）| paint 后 **flushPassiveEffects** 异步跑 |

⭐ **Q1 答案**：useEffect 和 useLayoutEffect 在源码里调用同一套 `mountEffectImpl` / `updateEffectImpl`，**只传了不同的 fiberFlags（PassiveEffect vs UpdateEffect）和 hookFlags（HookPassive vs HookLayout）**。这两个 flag 决定了 effect 在 commit 哪个阶段、同步还是异步执行。

---

## 三、effect 对象结构 + 两条链表（Q2）

### 3.1 effect 对象长什么样

源码 `type Effect`：

```js
type Effect = {
  tag: HookFlags,        // HookHasEffect | HookPassive/HookLayout
  create: () => (() => void) | void,   // 你写的 effect 回调
  deps: Array<mixed> | null,           // 依赖数组
  inst: EffectInstance,  // { destroy: cleanup 函数 } ← cleanup 存这里
  next: Effect,          // 环形链表指针
};

type EffectInstance = {
  destroy: void | (() => void),   // ★ cleanup 函数存在这里，不在 effect 上
};
```

⚠️ **易错点**：cleanup（`create` 的返回值）**不直接挂在 effect 上，而是挂在 `effect.inst.destroy`**。
源码注释解释：destroy 是有状态的，需要跨 render 保持同一个 inst 对象引用。

### 3.2 ⭐ 两条链表（别搞混）

这是 Day 7 最容易混淆的点：

```
链表 1：Hook 链表（Day 6 学的）
  fiber.memoizedState → Hook1 → Hook2 → Hook3 → ...
  （每个 useState / useEffect 调用对应一个 Hook 节点）

链表 2：effect 链表（Day 7 新学）
  fiber.updateQueue.lastEffect → Effect_A → Effect_B → ...（环形）
  （只有 useEffect / useLayoutEffect 才进这条链表）
```

**两条链表的连接点**：

```js
// mountEffectImpl 里
hook.memoizedState = pushSimpleEffect(...);   // ★ 返回的 effect 也存进 Hook 节点
```

- useEffect 对应的 **Hook 节点**的 `memoizedState` 字段 = 它的 **effect 对象**
- 同时这个 effect 对象又被 push 进 `fiber.updateQueue` 的**环形 effect 链表**

⭐ **为什么要两条**：
- **Hook 链表**：按调用顺序索引（update 时 `currentHook.memoizedState` 拿上次的 effect 比 deps）
- **effect 链表**：commit 阶段直接遍历它执行（不用走整个 Hook 链表，只走有 effect 的）

### 3.3 effect 链表是环形的

源码 `pushEffectImpl`：

```js
const lastEffect = componentUpdateQueue.lastEffect;
if (lastEffect === null) {
  // 第一个：自己指自己
  componentUpdateQueue.lastEffect = effect.next = effect;
} else {
  // 插到尾部，保持环形
  const firstEffect = lastEffect.next;
  lastEffect.next = effect;
  effect.next = firstEffect;
  componentUpdateQueue.lastEffect = effect;
}
```

⭐ `lastEffect` 指向尾，`lastEffect.next` 是头——环形链表的经典写法（和 Day 6 useState 的 queue.pending 一样）。

⭐ **Q2 答案**：effect 对象同时挂在两处——① 对应 Hook 节点的 `memoizedState`（用于 update 时比 deps）；② `fiber.updateQueue` 的环形 effect 链表（用于 commit 阶段遍历执行）。Hook 链表按调用顺序索引，effect 链表只串有副作用的。

---

## 四、deps 浅比较：areHookInputsEqual（Q3）

### 4.1 比较发生在 update 阶段的 updateEffectImpl

```js
function updateEffectImpl(fiberFlags, hookFlags, create, deps) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const effect = hook.memoizedState;
  const inst = effect.inst;

  if (currentHook !== null) {
    if (nextDeps !== null) {
      const prevEffect = currentHook.memoizedState;
      const prevDeps = prevEffect.deps;
      // ★ 这里比较新旧 deps
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        // deps 没变 → 仍 push 一个 effect，但 tag 不含 HookHasEffect
        hook.memoizedState = pushSimpleEffect(hookFlags, inst, create, nextDeps);
        return;   // ★ 提前 return，不打 fiberFlags
      }
    }
  }

  // deps 变了 → 打 fiberFlags + tag 含 HookHasEffect
  currentlyRenderingFiber.flags |= fiberFlags;
  hook.memoizedState = pushSimpleEffect(
    HookHasEffect | hookFlags,   // ★ 多了 HookHasEffect
    inst, create, nextDeps,
  );
}
```

### 4.2 areHookInputsEqual 比的是什么

```js
function areHookInputsEqual(nextDeps, prevDeps) {
  if (prevDeps === null) return false;
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (is(nextDeps[i], prevDeps[i])) {   // Object.is 逐个比
      continue;
    }
    return false;
  }
  return true;
}
```

⭐ **关键**：用 **`Object.is` 逐个浅比较** deps 数组的每一项。

- `[count]` 的 count 是基本类型 → 值变才算变
- `[obj]` 的 obj 是引用 → **引用变就算变**（即使内容一样）

这就是为什么 deps 里放对象/函数容易导致 effect 每次都重跑（引用每次 render 都新）。

### 4.3 HookHasEffect 是"本次要不要跑"的开关

| 情况 | tag | fiberFlags | 本次 commit 跑这个 effect 吗 |
|---|---|---|---|
| mount | `HookHasEffect \| hookFlags` | 打 | ✅ 跑 |
| update + deps 没变 | `hookFlags`（无 HookHasEffect）| **不打** | ❌ 跳过 |
| update + deps 变了 | `HookHasEffect \| hookFlags` | 打 | ✅ 跑 |

⭐ **重点**：deps 没变时，effect **仍然进链表**（保持顺序），但 `tag` 不含 `HookHasEffect` → commit 阶段遍历到它时跳过执行。**不是不进链表，是进了但被标记"本次不跑"**。

⭐ **Q3 答案**：deps 浅比较发生在 update 阶段的 `updateEffectImpl` 里，调用 `areHookInputsEqual` 用 `Object.is` 逐项比较新旧 deps 数组。相等 → effect 进链表但不打 HookHasEffect（跳过执行）；不等 → 打 HookHasEffect + fiberFlags（本次执行）。

---

## 五、cleanup 什么时候存、什么时候跑（Q4）

### 5.1 cleanup 的"存"

cleanup 是 `create()` 的返回值。**create 执行的时候才产生 cleanup**：

```js
// commit 阶段 commitHookEffectListMount 里（简化）
const create = effect.create;
const destroy = create();        // ★ 跑 effect，拿到 cleanup
effect.inst.destroy = destroy;   // ★ 存进 inst.destroy
```

时机：
- **useLayoutEffect**：Layout 子阶段同步跑 create → 存 cleanup
- **useEffect**：paint 后 flushPassiveEffects 跑 create → 存 cleanup

### 5.2 cleanup 的"跑"（Day 5 学过）

```js
// commit 阶段 commitHookEffectListUnmount 里（简化）
const destroy = effect.inst.destroy;
if (destroy !== undefined) {
  effect.inst.destroy = undefined;
  destroy();   // ★ 跑上次的 cleanup
}
```

时机：
- **useLayoutEffect 的 cleanup**：下次 commit 的 Mutation 阶段同步跑
- **useEffect 的 cleanup**：下次 flushPassiveEffects 里、新 effect 执行前跑

### 5.3 完整生命周期串起来

```
第 1 次 render（mount）:
  beginWork: useEffect → pushEffect（tag 含 HookHasEffect）
  commit:
    flushPassiveEffects: create() → 存 inst.destroy

第 2 次 render（deps 变了）:
  beginWork: updateEffectImpl → areHookInputsEqual = false
            → pushEffect（tag 含 HookHasEffect）
  commit:
    flushPassiveEffects:
      step 1: 跑上次的 inst.destroy（旧 cleanup）
      step 2: create() → 存新的 inst.destroy
```

⭐ **Q4 答案**：cleanup 是 effect 的 `create()` 执行后的返回值，存进 `effect.inst.destroy`。存的时机 = create 执行时（useLayoutEffect 在 Layout 同步、useEffect 在 paint 后异步）。跑的时机 = 下次 commit（useLayoutEffect 的在 Mutation、useEffect 的在 flushPassiveEffects 新 effect 执行前）。

---

## 六、把 Day 5 + 6 + 7 串成一张图

```
你写 useEffect(() => {...; return cleanup}, [dep])
          ↓ beginWork（Day 4）→ renderWithHooks（Day 6）
mountEffectImpl / updateEffectImpl
          ↓ areHookInputsEqual 比 deps（Day 7）
deps 变 → 打 fiberFlags(PassiveEffect) + tag(HookHasEffect|HookPassive)
          ↓ pushSimpleEffect
effect 进两条链表：
  ① hook.memoizedState（Hook 链表，比 deps 用）
  ② fiber.updateQueue.lastEffect（环形 effect 链表，commit 遍历用）
          ↓ completeWork 冒泡 fiberFlags 到 subtreeFlags（Day 4）
          ↓ commit（Day 5）
  Mutation: 跑旧 cleanup（inst.destroy）
  paint
  flushPassiveEffects: 跑 create() → 存新 inst.destroy
          ↓
屏幕 + 副作用生效
```

---

## 七、动手实验

详见 `demos/day7/README.md`，3 个实验：

| 实验 | 目标 | 产出 |
|---|---|---|
| H1. deps 浅比较陷阱 | deps 里放对象 vs 基本类型，看 effect 重跑次数 | console |
| H2. 两条链表实物 | DevTools 看 fiber.memoizedState 和 updateQueue | 截图 |
| H3. cleanup 时机 | useLayoutEffect vs useEffect 的 cleanup 跑动顺序 | console |

---

## 八、我之前以为 …，其实是 …（待跟练后回填）

（学完后回填 5 条）

---

## 九、Day 7 验收清单

- [ ] 能说出 useEffect / useLayoutEffect 源码差异（fiberFlags + hookFlags 两个 flag）
- [ ] 能讲清两条链表（Hook 链表 vs effect 环形链表）的关系
- [ ] 能解释 deps 浅比较用 Object.is，以及 HookHasEffect 开关位作用
- [ ] 能说清 cleanup 存在 inst.destroy、存/跑的时机
- [ ] 完成 3 个动手实验
- [ ] 写下 5 条认知纠正

---

## 十、Day 8 预告

**主题**：useRef / useMemo / useCallback 源码（为什么 useRef 不触发 render）

**预读问题**：

1. useRef 的 `{ current: x }` 对象为什么跨 render 稳定？源码怎么存的？
2. useMemo 和 useCallback 本质是同一个东西吗？源码差异在哪？
3. 为什么改 ref.current 不会触发 render，但改 state 会？
4. useMemo 的缓存值存在 Hook 的哪个字段？

明天见 👋
