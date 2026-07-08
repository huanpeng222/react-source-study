# Day 21 精简笔记 — 高优先级打断低优先级实战

> 速查卡，面试前快速过一遍。完整教程见 `day21.md`。

## 核心结论（口诀式）

**"打断"不是 CPU 抢占，是"每次让出后重新决策"。**

```
让出点1 → 问一次getNextLanes该跑谁 → 答案不变，继续跑
让出点2 → 问一次getNextLanes该跑谁 → 出现更高优先级！→ prepareFreshStack丢弃重做
```

## 五个关键函数/概念一览

| 概念 | 一句话 |
|---|---|
| `getNextLanes` | 每次微任务里重新扫 `root.pendingLanes`，挑出"下一批该处理"的 lane |
| `prepareFreshStack` | 从 `root.current` 重新 `createWorkInProgress`，旧 wip 树**完全丢弃不可复用**（这是组件函数必须保持纯的底层原因） |
| 容错窗口 | 批次变化 ≠ 一定重开，只有新批次优先级确实更高才换（避免"无脑抖动"） |
| 过期保底 | 每个 lane 挂号时带一个不受打断影响的过期时间戳（紧急250ms/Default&Transition 5000ms），过期后切到不可打断的 `renderRootSync` |
| `entangleTransitionUpdate` | 防止**同一个 state**被**两次独立事件**触发的 transition 更新被拆开处理导致乱序（不是"同一事件里多个state一起提交"，那个靠 lane 缓存天然保证） |

## 我的疑问追问记录

1. **"wip反复被打断会不会饿死？"** → 不会，5秒过期保底会强制切到同步不可打断模式跑完。（认知纠正#76）
2. **"为什么urgent也卡、SlowItem还打印旧tag？"** → ①没加memo导致高优先级也陪跑耗时计算；②lane过滤机制，SyncLane渲染不处理TransitionLane的update，state显示旧值是正常现象。（认知纠正#77）
3. **"entangleTransitions到底管什么？"** → 最初以为管"同transition里多个state一起提交"，实际管"同一个state跨两次独立事件的transition不乱序"。（认知纠正#78）

## 我的踩坑记录

- **实验设计坑**：I1最初SlowItem没加memo，导致"高优先级"看起来也很卡——这不是打断机制的问题，是缺少渲染隔离的连带重算。
- **实验设计坑2**：I3最初用"同transition里setA+setB"验证entangleTransitions，实际测的是lane缓存复用（不同机制）。真正验证要用"同一state+两次独立事件"。
- **工具使用坑**：Profiler面板对新手不友好，数commit条+点开看顺序操作门槛高，改用`useEffect`打印`commit #N`序号的纯Console方案更可靠。

## 三天知识串联图

```
Day10 Lane模型      → 这次更新有多急（requestUpdateLane打标）
Day19 Scheduler     → 轮到你时能跑多久（5ms时间片+shouldYield）
Day21 §二getNextLanes → 每次让出后重新问一次该跑谁
Day21 §三prepareFreshStack → 答案变了就丢弃wip树重做
Day20 useTransition  → 开发者手动参与这套机制的API入口
```

## 面试话术版

**Q: 讲讲React的"高优先级打断低优先级"是怎么实现的？**

"React没有真正的CPU抢占能力，'打断'本质是协作式的——Scheduler每处理完一个fiber就调一次shouldYield让出主线程，每次让出后React会重新调用getNextLanes问一次'现在最该处理哪一批lane'。如果这次算出的批次跟正在渲染的不一样，且新批次优先级确实更高，就会触发prepareFreshStack，从root.current重新创建一棵全新的wip树，之前已经做的beginWork工作全部丢弃——这也是为什么React反复强调组件函数必须是纯函数，因为渲染随时可能被推倒重做。但这套机制不会导致低优先级永远被饿死，因为每个lane挂号时都带着一个过期时间戳，一旦过期就会强制切到同步不可打断模式跑完。"
