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

### 3.2.5 ⭐ 关键澄清：两条链表存的是"同一个 effect 对象"

> 学习者追问（15:09）：两条链表里各自的 effect 有啥区别？为啥 effect 跟其他 hook 不一致？

**第一个误解先消除：两条链表存的不是两份 effect，是同一个对象被引用两次。**

```
        ┌──────────────────────────┐
        │  effect 对象（内存中只有1个）│
        │  { tag, create, deps,     │
        │    inst:{destroy}, next } │
        └──────────────────────────┘
            ↑                    ↑
   hook.memoizedState    updateQueue 环形链表的一个节点
   （引用它）              （引用它）
```

源码（`mountEffectImpl`）：

```js
hook.memoizedState = pushSimpleEffect(...);
//                   ↑ pushSimpleEffect 内部把 effect push 进 updateQueue 环形链表，
//                     并 return 这个 effect → 存进 hook.memoizedState
//                   → 同一个 effect，两处引用
```

所以**不存在"两条链表里的 effect 有什么区别"**——它们指向同一个对象。

#### 那为什么要两个引用入口？因为两条链表"遍历方式"完全不同

| | Hook 链表 | updateQueue effect 环形链表 |
|---|---|---|
| 串了谁 | **所有 hook**（useState/useRef/useEffect…）| **只串 useEffect/useLayoutEffect** |
| 顺序 | 严格按调用顺序（位置敏感）| 按 push 顺序（环形）|
| 谁来遍历 | **render 阶段**：renderWithHooks 按位置走，拿上次 effect 比 deps | **commit 阶段**：commitHookEffectList 直接遍历执行 create/destroy |
| 目的 | "我是第几个 hook，上次的我在哪"——**身份索引** | "这个组件有哪些副作用要跑"——**执行清单** |

⭐ **一句话**：
- Hook 链表回答 **"render 时，这个 effect 对应上次哪个 effect（好比 deps）"**
- effect 链表回答 **"commit 时，这个组件要执行哪些副作用（不用翻 useState/useRef 那些无关 hook）"**

#### 为什么 effect 跟其他 hook 不一致（要多一条链表）

因为 **effect 是唯一需要"延迟到 commit 阶段执行"的 hook**：

| hook | 值在哪用 | 要不要延迟到 commit 跑 |
|---|---|---|
| useState | render 阶段直接返回 state | ❌ 不需要 |
| useRef | render 阶段直接返回 ref 对象 | ❌ 不需要 |
| useMemo | render 阶段直接返回缓存值 | ❌ 不需要 |
| **useEffect/useLayoutEffect** | **回调要在 DOM 变更后才能跑** | ✅ **必须延迟到 commit** |

useState/useRef/useMemo 的"产出"在 render 阶段就用掉了，**不需要 commit 阶段再回头找它们**。
但 effect 的 `create()` 必须等 DOM 改完才能跑（要操作真实 DOM / 绑事件 / 请求数据）。

如果没有 effect 链表，commit 阶段想找"哪些 hook 是 effect"，就得**遍历整条 Hook 链表，挨个判断 tag**——组件有 20 个 useState、2 个 useEffect 时，要扫 22 个才能挑出 2 个。

有了 effect 环形链表，commit 阶段**直接遍历它，里面全是 effect**，零浪费。

⭐ **本质**：effect 链表是一条"**给 commit 阶段用的快捷执行清单**"，把散落在 Hook 链表里的副作用单独串出来。这就是为什么只有 effect 有第二条链表，其他 hook 没有。

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

### 4.4 ⭐ 追问：deps 没变进的是哪条链表？Hook 链表每次 render 会变吗？

> 学习者追问（15:14）：① deps 没变时 effect 进的是哪个链表？② Hook 链表只初始化建一次吗，后面 update 还会变吗？

#### ① deps 没变时，effect 两条链表都进

源码 deps 相等分支：

```js
if (areHookInputsEqual(nextDeps, prevDeps)) {
  hook.memoizedState = pushSimpleEffect(hookFlags, inst, create, nextDeps);
  //                   ↑ pushSimpleEffect 照样：1) push 进 updateQueue 环形链表
  //                                            2) return 给 hook.memoizedState
  return;   // tag 只有 hookFlags，没有 HookHasEffect
}
```

⭐ 所以 **Hook 链表 + effect 链表都进**，区别只在 `tag` 没有 `HookHasEffect` → commit 遍历到它时跳过执行。

**"进链表"和"执行"是两件独立的事**：
- 进链表 = 保持位置 / 顺序（下次还要按位置比 deps）
- 执行 = 看 `HookHasEffect` 开关位

#### ② Hook 链表每次 render 都重建（不是只建一次！）

这是大误区。`renderWithHooks` 每次 render 开头会**清空重建**：

```js
// renderWithHooks 开头
workInProgress.memoizedState = null;   // ★ Hook 链表清空
workInProgress.updateQueue = null;     // ★ effect 链表清空
```

然后组件函数重新执行，每个 hook 调用：
- **mount**：`mountWorkInProgressHook()` → new 一个 hook 节点
- **update**：`updateWorkInProgressHook()` → **从 current 树对应位置的旧 hook 克隆一个新节点**到 wIP

```js
function updateWorkInProgressHook() {
  const currentHook = ...;   // 从 current.memoizedState 拿对应位置旧 hook
  const newHook = {          // ★ 克隆成新对象
    memoizedState: currentHook.memoizedState,
    baseState: currentHook.baseState,
    queue: currentHook.queue,
    next: null,
  };
  // 追加到 wIP 的 hook 链表
  return newHook;
}
```

⭐ **核心结论**（和 Day 2 双缓存完全一致）：

| | 每次 render |
|---|---|
| Hook 链表**结构** | wIP 上**全新重建**（从 current 克隆一条新链表）|
| hook 里的**数据**（state / effect 对象 / queue）| 通过克隆**跨 render 保留** |

> **链表结构每次 render 重建，里面的数据通过双缓存克隆延续。**

这也解释了**为什么 Hook 必须顺序稳定**——每次 render 都要按相同顺序从 current 克隆对应位置的 hook，顺序乱了就克隆到错误的旧数据（state 跑到别的 hook 上）。

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

## 7.5、入场自测点评（14:51 现场）

学习者答题记录：

| Q | 学习者答 | 评分 |
|---|---|---|
| Q1 useEffect/useLayoutEffect 源码差异 | 不清楚 | ⚪ |
| Q2 effect 挂哪、和 Hook 链表关系 | 不清楚 | ⚪ |
| Q3 deps 浅比较时机 + 比什么 | "render 阶段，比较对象引用" | 🟡 60% |
| Q4 cleanup 何时存、存哪 | "下次更新执行上次 effect return；存在 memoizedState" | 🟡 50% |

### Q3 纠正：时机对了一半，"比引用"不全对

> 学习者答："render 阶段，比较对象引用"

🟡 **"render 阶段"方向对**（精确说是 update 阶段的 `updateEffectImpl`，属于 beginWork → renderWithHooks 的一部分，确实在 render 阶段）。

❌ **"比较对象引用"不全对**：

`areHookInputsEqual` 用 **`Object.is` 逐项比较 deps 数组的每一个元素**，不是"比较整个数组对象的引用"：

```js
for (let i = 0; i < prevDeps.length; i++) {
  if (Object.is(nextDeps[i], prevDeps[i])) continue;  // 逐项
  return false;
}
```

- deps 里是**基本类型**（`[count]`）→ 比的是值
- deps 里是**引用类型**（`[obj]`）→ 比的是引用

⭐ 精确说法：**对 deps 数组逐项做 Object.is**。基本类型比值、引用类型比引用——所以 deps 放对象/函数容易每次都"变"（引用每次 render 新建）。

### Q4 纠正：时机对，存的位置错

> 学习者答："下次更新执行上次 effect 的 return；存在 memoizedState"

✅ **"下次更新执行上次 return"——时机对**（Day 5 学的 cleanup 在下次 commit 跑）。

❌ **"存在 memoizedState"——位置不够精确**：

cleanup（create 的返回值）存在 **`effect.inst.destroy`**，不是直接存在 memoizedState 上：

```js
type Effect = {
  tag, create, deps,
  inst: { destroy },   // ★ cleanup 存这里
  next,
};
```

关系链：
```
hook.memoizedState = effect 对象
effect.inst.destroy = cleanup 函数   ← cleanup 真正的家
```

所以"存在 memoizedState"只对了一半——memoizedState 指向 effect 对象，cleanup 在 effect 的 inst.destroy 里，**隔了两层**。

⭐ 为什么单独放 inst：源码注释说 destroy 是有状态的，要跨 render 保持同一个 inst 引用。

### Q1 / Q2 不清楚 → 看正文

- Q1：useEffect 和 useLayoutEffect 调同一套 impl，只差 **fiberFlags（PassiveEffect vs UpdateEffect）+ hookFlags（HookPassive vs HookLayout）** 两个 flag（§2）
- Q2：effect 同时挂**两条链表**——Hook 链表（memoizedState，比 deps 用）+ updateQueue 环形 effect 链表（commit 遍历用）（§3）

---


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
