# Day 7 笔记：useEffect / useLayoutEffect 源码 + effect 链表

> 日期：2026-06-22
> 主题：W2 第二天——effect 怎么挂、怎么对比 deps、怎么和 commit 阶段联动
> 状态：✅ 已完成
> 前置：Day 4 fiber.flags / Day 5 commit 三阶段 / Day 6 Hook 链表
>
> ⚠️ **源码出处（本文件所有源码事实均来自此处，已 WebFetch 实时核对 facebook/react main）**：
> - `packages/react-reconciler/src/ReactFiberHooks.js`（mountEffectImpl / updateEffectImpl / pushSimpleEffect / areHookInputsEqual / updateWorkInProgressHook）
> - `packages/react-reconciler/src/ReactFiberFlags.js`（Passive / Update 等 fiber flag）
> - `packages/react-reconciler/src/ReactHookEffectTags.js`（HookHasEffect / HookLayout / HookPassive）

---

## 零、入场自测（先自己答再往下看，"不会"明确说"不会"）

1. useEffect 和 useLayoutEffect 在源码里只差哪几个参数？
2. effect 对象挂在 fiber 的哪里？和 Day 6 的 Hook 链表（memoizedState）是什么关系？
3. deps 数组的浅比较精确发生在什么时候？比较的是什么？
4. cleanup 函数（effect 的 return）什么时候、存到哪里？

---

## 一、从 Day 5 + Day 6 接上来

- **Day 5**：commit 三阶段，cleanup 在 Mutation 跑、effect 在 paint 后异步（useEffect）或 Layout 同步（useLayoutEffect）。
- **Day 6**：useState 的 Hook 链表挂在 `fiber.memoizedState`。

**Day 7 回答**：useEffect 源码长什么样？怎么挂到 fiber？deps 怎么比？cleanup 存哪？

---

## 二、useEffect vs useLayoutEffect 的源码差异（Q1）

### 2.1 两者底层是同一个 impl，只差两个 flag

```js
// useEffect（mount）
function mountEffect(create, deps) {
  mountEffectImpl(PassiveEffect | PassiveStaticEffect, HookPassive, create, deps);
  //              ↑ fiberFlags                          ↑ hookFlags
}

// useLayoutEffect（mount）
function mountLayoutEffect(create, deps) {
  mountEffectImpl(UpdateEffect | LayoutStaticEffect, HookLayout, create, deps);
  //              ↑ fiberFlags                        ↑ hookFlags
}
```

⭐ **核心差异只有两个 flag**：

| | useEffect | useLayoutEffect |
|---|---|---|
| **fiberFlags**（打在 `fiber.flags`）| `PassiveEffect` | `UpdateEffect` |
| **hookFlags**（打在 `effect.tag`）| `HookPassive` | `HookLayout` |

### 2.2 两个 flag 各是什么（接 Day 4 fiber.flags 体系）

这两个 flag 不是新东西，是 Day 4 `fiber.flags` 位运算体系的延续。

| flag | 打到哪个对象的哪个字段 | 作用 | 类比 |
|---|---|---|---|
| **fiberFlags** | 组件 `fiber.flags` | **粗筛**：这个组件有没有副作用（配合 subtreeFlags 剪枝）| 大楼门口"本楼有快递"指示牌 |
| **hookFlags** | 每个 `effect.tag` | **细分**：这个 effect 是 passive 还是 layout，本次跑不跑 | 快递盒上"冷藏/常温"标签 |

```js
currentlyRenderingFiber.flags |= fiberFlags;      // 粗筛：组件级
effect.tag = HookHasEffect | hookFlags;           // 细分：effect 级
```

**commit 两层处理**：① 先看 `fiber.flags` 决定进不进这个 fiber；② 进了再看每个 `effect.tag` 决定在 Mutation / Layout / 异步哪个阶段跑。

### 2.3 确切数值（源码核对）

**fiberFlags 是 ReactFiberFlags.js 常量的别名**：

| Hooks 里的名字 | 实际常量 | 数值 |
|---|---|---|
| `PassiveEffect` | = `Passive` | 2048 |
| `UpdateEffect` | = `Update` | 4 |

⭐ PassiveEffect 就是 Passive，UpdateEffect 就是 Update（useLayoutEffect 复用了 DOM 更新那个 flag）。

**hookFlags 是 ReactHookEffectTags.js 的另一套常量**：

| 常量 | 数值 | 含义 |
|---|---|---|
| `HookHasEffect` | 1 | 本次要不要跑（开关位）|
| `HookLayout` | 4 | useLayoutEffect 类型 |
| `HookPassive` | 8 | useEffect 类型 |

**effect.tag 最终值（useEffect ≠ useLayoutEffect）**：

```
useEffect 的       effect.tag = HookHasEffect ∪ HookPassive = 1 ∪ 8 = 9
useLayoutEffect 的 effect.tag = HookHasEffect ∪ HookLayout  = 1 ∪ 4 = 5
                                              ↑ 差在这一位（8 vs 4）
```

（用 ∪ 表示"按位或"，因为 Markdown 表格里写 `|` 会被当成单元格分隔符截断——踩过这个坑。）

⚠️ **易混巧合**：useLayoutEffect 的 fiberFlags 是 `Update`(4)、hookFlags 是 `HookLayout`(4)——数值都是 4 但属于**两个不同体系的常量**，别当同一个东西。

### 2.4 fiber.flags 完整值 + commit 怎么分流

| flag | 数值 | 含义 | commit 处理阶段 |
|---|---|---|---|
| `Placement` | 2 | 新插入/移动 DOM | Mutation |
| `Update` | 4 | DOM 属性更新 / useLayoutEffect | Mutation(setAttr) / Layout(layoutEffect) |
| `ChildDeletion` | 16 | 删子节点 | Mutation |
| `ContentReset` | 32 | 重置文本 | Mutation |
| `Callback` | 64 | 类组件 cDM/cDU | Layout |
| `Ref` | 512 | 绑/卸 ref | Mutation(卸) / Layout(绑) |
| `Snapshot` | 1024 | getSnapshotBeforeUpdate | BeforeMutation |
| `Passive` | 2048 | useEffect | paint 后异步 flushPassiveEffects |
| `Visibility` | 8192 | Suspense 显隐 | Mutation |

源码用**分组掩码**直接证明 commit 三阶段靠 flag 分流：

```
MutationMask = Placement ∪ Update ∪ ChildDeletion ∪ ContentReset ∪ Ref ∪ ...
LayoutMask   = Update ∪ Callback ∪ Ref ∪ Visibility
PassiveMask  = Passive ∪ Visibility ∪ ChildDeletion
```

### 2.5 为什么只有 useEffect / useLayoutEffect 打 flag

| hook | 产出 | 何时用 | 打 flag |
|---|---|---|---|
| useState | state 值 | render 阶段直接 return | ❌ |
| useRef | ref 对象 | render 阶段直接 return | ❌ |
| useMemo | 缓存值 | render 阶段直接 return | ❌ |
| **useEffect / useLayoutEffect** | 回调 create() | **commit 阶段（DOM 改完后）才跑** | ✅ |

⭐ **判断规则**：产出在 render 阶段用掉的 hook 不打 flag；**回调要延迟到 commit 执行**的才打。
⚠️ **不是"有 cleanup 才打 flag"**——没 return cleanup 的 effect 照样打。根本原因是"回调推迟到 commit"，cleanup 只是回调返回值。

⭐ **Q1 答案**：调用同一套 `mountEffectImpl` / `updateEffectImpl`，只传不同的 fiberFlags（Passive vs Update）和 hookFlags（HookPassive vs HookLayout）。这两个 flag 决定 effect 在 commit 哪个阶段、同步还是异步执行。

---

## 三、effect 对象结构 + 两条链表（Q2）

### 3.1 effect 对象结构

```js
type Effect = {
  tag: HookFlags,        // HookHasEffect ∪ HookPassive/HookLayout
  create,                // 你写的 effect 回调
  deps,                  // 依赖数组
  inst: { destroy },     // ★ cleanup 函数存在 inst.destroy，不直接在 effect 上
  next,                  // 环形链表指针
};
```

⚠️ cleanup（create 的返回值）挂在 `effect.inst.destroy`——源码注释：destroy 有状态，要跨 render 保持同一个 inst 引用。

### 3.2 两条链表：同一个 effect 对象，两处引用

```
链表 1：Hook 链表（Day 6）
  fiber.memoizedState → Hook1 → Hook2 → ...（所有 hook，按调用顺序）

链表 2：effect 环形链表（Day 7 新学）
  fiber.updateQueue.lastEffect → Effect_A → Effect_B → ...（只串 effect）
```

连接点（源码 `mountEffectImpl`）：

```js
hook.memoizedState = pushSimpleEffect(...);
//                   ↑ push 进 updateQueue 环形链表，同时 return 给 hook.memoizedState
//                   → 同一个 effect 对象，两条链表各引用一次（不是两份拷贝）
```

⭐ **不存在"两条链表里 effect 有什么区别"——它们指向同一个对象**。区别在两条链表的**遍历方式**：

| | Hook 链表 | effect 环形链表 |
|---|---|---|
| 串了谁 | 所有 hook | 只串 useEffect/useLayoutEffect |
| 谁遍历 | **render 阶段**：按位置拿上次 effect 比 deps | **commit 阶段**：直接遍历执行 create/destroy |
| 目的 | 身份索引（我是第几个 hook）| 执行清单（这组件要跑哪些副作用）|

**为什么 effect 要多一条链表**：commit 想找副作用，如果只有 Hook 链表就得扫整条挨个判 tag（20 个 useState + 2 个 useEffect 要扫 22 个）。effect 链表把副作用单独串出来 → commit 直接遍历，零浪费。这就是"给 commit 用的快捷执行清单"。

### 3.3 effect 链表是环形的

```js
// pushEffectImpl
const lastEffect = componentUpdateQueue.lastEffect;
if (lastEffect === null) {
  componentUpdateQueue.lastEffect = effect.next = effect;   // 第一个：自己指自己
} else {
  const firstEffect = lastEffect.next;
  lastEffect.next = effect;
  effect.next = firstEffect;          // 插尾部，保持环形
  componentUpdateQueue.lastEffect = effect;
}
```

`lastEffect` 指向尾，`lastEffect.next` 是头（和 Day 6 useState 的 queue.pending 一样的环形写法）。

⭐ **Q2 答案**：effect 对象同时被两处引用——① 对应 Hook 节点的 `memoizedState`（render 时比 deps）；② `fiber.updateQueue` 的环形 effect 链表（commit 遍历执行）。同一对象，两个入口，遍历方式不同。

---

## 四、deps 浅比较：areHookInputsEqual（Q3）

### 4.1 在 update 阶段的 updateEffectImpl 里比

```js
function updateEffectImpl(fiberFlags, hookFlags, create, deps) {
  const hook = updateWorkInProgressHook();
  const effect = hook.memoizedState;
  const inst = effect.inst;

  if (currentHook !== null && deps !== null) {
    const prevDeps = currentHook.memoizedState.deps;
    if (areHookInputsEqual(deps, prevDeps)) {
      // deps 没变 → 仍 push effect，但 tag 不含 HookHasEffect，且不打 fiberFlags
      hook.memoizedState = pushSimpleEffect(hookFlags, inst, create, deps);
      return;
    }
  }
  // deps 变了 → 打 fiberFlags + tag 含 HookHasEffect
  currentlyRenderingFiber.flags |= fiberFlags;
  hook.memoizedState = pushSimpleEffect(HookHasEffect | hookFlags, inst, create, deps);
}
```

### 4.2 areHookInputsEqual 比什么

```js
function areHookInputsEqual(nextDeps, prevDeps) {
  if (prevDeps === null) return false;
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) continue;   // 逐项 Object.is
    return false;
  }
  return true;
}
```

⭐ **用 `Object.is` 逐项浅比较 deps 数组的每一个元素**（不是比整个数组对象的引用）：
- 基本类型 `[count]` → 比值
- 引用类型 `[obj]` → 比引用（内容一样但引用变也算变）

所以 deps 放对象/函数容易让 effect 每次都重跑（引用每次 render 新建）。

### 4.3 HookHasEffect 是"本次跑不跑"的开关

| 情况 | tag 含 HookHasEffect | fiberFlags | 本次 commit 跑 |
|---|---|---|---|
| mount | ✅ | 打 | ✅ |
| update + deps 没变 | ❌ | 不打 | ❌ 跳过 |
| update + deps 变了 | ✅ | 打 | ✅ |

⭐ **关键**：deps 没变时 effect **仍进两条链表**（保持顺序），只是 tag 无 HookHasEffect → commit 遍历到它时跳过。**"进链表"和"执行"是两件独立的事**。

⭐ **Q3 答案**：在 update 阶段 `updateEffectImpl` 调 `areHookInputsEqual`，用 `Object.is` 逐项比新旧 deps。相等 → 进链表但不打 HookHasEffect（跳过）；不等 → 打 HookHasEffect + fiberFlags（执行）。

---

## 五、Hook 链表每次 render 重建 + 三层复用粒度

### 5.1 Hook 链表每次 render 都重建（不是只建一次）

```js
// renderWithHooks 开头
workInProgress.memoizedState = null;   // Hook 链表清空
workInProgress.updateQueue = null;     // effect 链表清空
```

然后组件函数重跑，每个 hook 调用：
- **mount**：`mountWorkInProgressHook()` → new 全 null 的 hook 节点
- **update**：`updateWorkInProgressHook()` → 从 current 对应位置旧 hook **克隆**新节点

```js
// updateWorkInProgressHook（普通 update 分支）
const newHook = {                          // ★ new 全新对象
  memoizedState: currentHook.memoizedState, // 浅拷贝
  baseState: currentHook.baseState,
  baseQueue: currentHook.baseQueue,
  queue: currentHook.queue,                 // ★ 和 currentHook 共享同一个 queue
  next: null,                               // 唯一被重置
};
```

⭐ **结论**：hook 节点是**新建外壳 + 浅拷贝字段**，`newHook !== currentHook`。结构每次重建，数据通过克隆延续（和 Day 2 双缓存一致）。这也是 **Hook 必须顺序稳定**的根因——顺序乱了就克隆到错误位置的旧数据。

### 5.2 三层复用粒度（串 Day 2 + 6 + 7）

| 对象 | 跨 render 是同一个吗 | 策略 |
|---|---|---|
| current fiber ↔ wIP fiber | ✅ 两个对象轮流（alternate）| **复用对象本身**（Day 2）|
| hook 外壳 | ❌ 每次新建 | 新建 + 浅拷贝字段（Day 7）|
| hook.queue | ✅ 同一个（共享）| 共享 → dispatch 引用才稳定（Day 6）|
| effect 外壳 | ❌ 每次新建 | 新 push 进 updateQueue（Day 7）|
| effect.inst | ✅ 同一个（复用）| cleanup 要跨 render 存活（Day 7）|

⭐ **一句话规律**：**"需要跨 render 存活的状态"（queue / inst）共享复用；"每次 render 重新组织的结构"（fiber 链 / hook 外壳 / effect 链）重建。**

---

## 六、cleanup 什么时候存、什么时候跑（Q4）

### 6.1 存：create() 执行后存进 inst.destroy

```js
// commitHookEffectListMount（简化）
const destroy = create();        // 跑 effect，拿返回值
effect.inst.destroy = destroy;   // 存进 inst.destroy
```

时机：useLayoutEffect 在 Layout 同步存；useEffect 在 paint 后 flushPassiveEffects 存。

### 6.2 跑：下次 commit 执行上次的 inst.destroy

```js
// commitHookEffectListUnmount（简化）
const destroy = effect.inst.destroy;
if (destroy !== undefined) {
  effect.inst.destroy = undefined;
  destroy();
}
```

时机：useLayoutEffect 的 cleanup 在下次 Mutation 跑；useEffect 的在下次 flushPassiveEffects 里、新 effect 执行前跑。

### 6.3 完整生命周期

```
mount:    flushPassiveEffects → create() → 存 inst.destroy
update（deps 变）:
  flushPassiveEffects:
    step1 跑上次 inst.destroy（旧 cleanup）
    step2 create() → 存新 inst.destroy
```

⭐ **Q4 答案**：cleanup 是 create() 的返回值，存进 `effect.inst.destroy`（不是 memoizedState，隔两层：memoizedState → effect → inst.destroy）。存的时机 = create 执行时；跑的时机 = 下次 commit。

---

## 七、把 Day 4 + 5 + 6 + 7 串成一张图

```
useEffect(() => {...; return cleanup}, [dep])
  ↓ beginWork（Day4）→ renderWithHooks（Day6）
mountEffectImpl / updateEffectImpl
  ↓ areHookInputsEqual 比 deps（Day7）
deps 变 → 打 fiberFlags(Passive) + effect.tag(HookHasEffect ∪ HookPassive)
  ↓ pushSimpleEffect → effect 进两条链表
      ① hook.memoizedState（比 deps 用）
      ② fiber.updateQueue.lastEffect（commit 遍历用）
  ↓ completeWork 冒泡 fiberFlags 到 subtreeFlags（Day4）
  ↓ commit（Day5）
      Mutation: 跑旧 cleanup（inst.destroy）
      paint
      flushPassiveEffects: create() → 存新 inst.destroy
  ↓
屏幕 + 副作用生效
```

---

## 八、入场自测点评（14:51 现场）

| Q | 学习者答 | 评分 | 纠正要点 |
|---|---|---|---|
| Q1 源码差异 | 不清楚 | ⚪ | 见 §2：两个 flag（Passive/Update + HookPassive/HookLayout）|
| Q2 effect 挂哪 | 不清楚 | ⚪ | 见 §3：同一对象挂两条链表 |
| Q3 deps 浅比较 | "render 阶段，比对象引用" | 🟡 60% | 时机对；但是 **Object.is 逐项比**，不是比整个数组引用 |
| Q4 cleanup 存哪 | "下次更新执行上次 return；存 memoizedState" | 🟡 50% | 时机对；但存在 **effect.inst.destroy**，memoizedState 隔两层 |

---

## 九、动手实验

详见 `demos/day7/README.md`，3 个实验：

| 实验 | 目标 | 产出 |
|---|---|---|
| H1. deps 浅比较陷阱 | deps 放对象 vs 基本类型，看 effect 重跑次数 | console |
| H2. 两条链表实物 | DevTools 看 fiber.memoizedState 和 updateQueue | 截图 |
| H3. cleanup 时机 | useLayoutEffect vs useEffect 的 cleanup 跑动顺序 | console |

---

## 十、我之前以为 …，其实是 …（5 条认知纠正）

1. **我以为** useEffect 和 useLayoutEffect 是两套不同实现。
   **其实** 调用同一套 `mountEffectImpl`/`updateEffectImpl`，只差 fiberFlags（Passive vs Update）+ hookFlags（HookPassive vs HookLayout）两个 flag。

2. **我以为** effect 在 Hook 链表和 effect 链表里是两份。
   **其实** 是同一个 effect 对象被两处引用——memoizedState（比 deps 用）+ updateQueue 环形链表（commit 执行用）。

3. **我以为** deps 比较是比整个数组对象的引用。
   **其实** 是 `Object.is` 逐项比每个元素。基本类型比值、引用类型比引用——所以 `[obj]` 每次新建引用变就每次重跑。

4. **我以为** cleanup 存在 hook.memoizedState。
   **其实** 存在 `effect.inst.destroy`，隔两层（memoizedState → effect → inst.destroy）。单独放 inst 是为了让 destroy 跨 render 存活（hook 外壳每次新建，inst 复用）。

5. **我以为** hook 像 fiber 一样复用对象。
   **其实** hook 外壳每次 render 新建（浅拷贝字段），只有 queue/inst 共享复用。规律：跨 render 存活的状态共享，每次重组的结构重建。

> 这 5 条已追加到 `meta/cognitive-corrections.md`（#45-#49）。

---

## 十一、Day 7 验收清单

- [x] 能说出 useEffect / useLayoutEffect 源码差异（fiberFlags + hookFlags 两个 flag，及确切数值）
- [x] 能讲清两条链表是同一 effect 对象的两个引用、各自遍历方式
- [x] 能解释 deps 用 Object.is 逐项比 + HookHasEffect 开关位
- [x] 能说清 cleanup 存在 inst.destroy、存/跑的时机
- [x] 能讲三层复用粒度（fiber 复用 / hook 外壳新建 / queue 共享）
- [ ] 完成 3 个动手实验（demos/day7 已就绪）
- [x] 写下 5 条认知纠正（meta #45-#49）

---

## 十二、Day 8 预告

**主题**：useRef / useMemo / useCallback 源码（为什么 useRef 不触发 render）

**预读问题**：

1. useRef 的 `{ current: x }` 对象为什么跨 render 稳定？源码怎么存的？
2. useMemo 和 useCallback 本质是同一个东西吗？源码差异在哪？
3. 为什么改 ref.current 不会触发 render，但改 state 会？
4. useMemo 的缓存值存在 Hook 的哪个字段？

明天见 👋
