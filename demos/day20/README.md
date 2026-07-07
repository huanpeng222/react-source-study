# Day20 实验说明 — useTransition / useDeferredValue

> ⚠️ **本次实验遵循 2026-07-07 流程调整（见 STUDY_PROTOCOL.md 必做 #10）**：
> 以下三个实验脚本由 AI 直接写出（真实可跑的 React 代码，用真实的 `useTransition`/`useDeferredValue`/`startTransition` API，不是原生 JS 模拟逻辑），**尚未在本机预跑过**。README 里的"预期"是基于 `notes/day20.md` 里核实过的源码逻辑推理得出的，明确标注为"推理预期，未验证"。
>
> **请学习者自己跑一遍**（本机 jsdom 脚本，或迁移到你自己的真实 React 项目里跑），把真实输出记录进 `observations.md`。如果真实结果和这里的预期不一致，告诉我，我会去本地复现、核实真实原因，再回来修正 `notes/day20.md` 里的结论——不会凭嘴硬解释。

## 环境

```
react@19.2.7 + react-dom@19.2.7 + jsdom（工作区：/Users/guest_1/.workbuddy/binaries/node/workspace）
```

## 实验列表

| 实验 | 脚本 | 验证目标 |
|---|---|---|
| T1 | `t1-transition-pending.mjs` | `startTransition` 包裹的 setState 是否真的引发 isPending 的 true→false 变化序列 |
| T2 | `t2-interrupt.mjs` | 高优先级更新和 transition 更新同时发起时，最终结果以哪个为准 |
| T3 | `t3-deferred-skip.mjs` | `useDeferredValue` 在"渲染本身已是低优先级（transition 内）"场景下是否跳过二次延迟 |

## 运行方式

```bash
cd demos/day20
NODE_PATH=/Users/guest_1/.workbuddy/binaries/node/workspace/node_modules \
/Users/guest_1/.workbuddy/binaries/node/versions/22.22.2/bin/node t1-transition-pending.mjs

# T2、T3 同理，把脚本名换掉即可
```

## ⚠️ 已知的 jsdom 环境限制（实验前先知道，别被结果"惊到"）

参考 Day11/Day12 的 `observations.md` 先例，jsdom 缺少真实浏览器的事件循环和 Scheduler 的 MessageChannel 时间片机制，`act()` 会把调度过程"压平"同步执行。这意味着：

- **能验证**：最终渲染结果的正确性（比如 T2 里高优先级更新最终生效）、isPending 状态是否真的发生了变化、deferredValue 是否真的追上了新值。
- **不能验证**：真实的时间片让出时机、渲染进行到一半被打断的中间过程（这类观察需要真实浏览器 + React DevTools Profiler，Day12 已经给过浏览器版操作指引，可以复用同样的思路自己在真实项目里跑一遍）。

## 跑完之后

把每个脚本的真实输出（直接复制终端打印内容）填进 `observations.md` 对应位置，再补一句"和预期是否一致"。如果不一致，先别急着改结论，把真实输出发给我，我来复现核实。
