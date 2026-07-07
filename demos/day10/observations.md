# Day 10 实测记录（observations.md）

> ⚠️ **2026-07-07 更新**：README.md 已改为 Vite/浏览器版实验（学习者要求 demo 是真实可跑的 React 组件，不是 jsdom 脚本）。下面的 jsdom 实测记录**作为历史参照保留**（结论没有变化，只是这次改成让学习者在浏览器里亲自验证）。跑完浏览器版后，把真实结果填进最下方"浏览器版实测记录"区块。

## 浏览器版实测记录（待填）

### K1：点击按钮后新增了几条 render 日志？

（待填）

### K2：直接更新 / transition 更新的 isPending 变化序列分别是？

（待填）

### K3：敲一个字符后 console 打印了几次？deferred 是否慢一拍？

（待填）

---

## jsdom 版历史记录（2026-06-23，保留作参照）

> 环境：`/Users/guest_1/.workbuddy/binaries/node/workspace`，react@19.2.7 / react-dom@19.2.7 / jsdom@29.1.1，node 22.22.2。
> 实测日期：2026-06-23。所有输出为真实运行结果，README 的"预期"由此回填。

## 踩坑记录（环境）

1. **ESM 不认 `NODE_PATH`**：`NODE_PATH=.../node_modules node k1.mjs` 报 `ERR_MODULE_NOT_FOUND: Cannot find package 'jsdom'`。NODE_PATH 是 CommonJS 的解析机制，ESM（.mjs）不走它。
   → 解法：脚本必须**放进 workspace 目录内**直接 `node k1.mjs`，靠就近的 node_modules 解析。
2. **Node 22 的 `global.navigator` 是只读 getter**：`global.navigator = dom.window.navigator` 报 `Cannot set property navigator which has only a getter`。
   → 解法：删掉这行，jsdom 跑这三个实验不需要它。

## K1 实测原始输出
```
React version: 19.2.7
[mount] renderCount = 1
--- 同一 act(模拟同一事件) 里连续 setA + setB ---
两次 setState 后 renderCount 增量 = 1
最终 DOM = a=1 b=1
```
结论：同一事件里 setA+setB → 只多渲染 1 次。自动批处理成立。

## K2 实测原始输出
```
React version: 19.2.7
[mount] isPending 序列 = [false]
--- 直接 setN(1) ---
直接更新后 isPending 序列 = [false] | DOM= n=1 pending=false
--- startTransition 里 setN(2) ---
transition 更新后 isPending 序列 = [true,false] | DOM= n=2 pending=false
```
结论：直接更新 isPending 恒 false；transition 更新出现 `[true,false]`（过渡中 true → 完成 false）。证实 transition 是被单独调度的低优先级更新。

## K3 实测原始输出
```
React version: 19.2.7
[mount] 渲染序列:
    text="" deferred=""
--- setText("a") ---
setText("a") 后渲染序列:
    text="a" deferred=""
    text="a" deferred="a"
最终 DOM = text=a deferred=a
```
结论：一次 setText('a') 触发**两次渲染**——第一次 deferred 还是旧值 `""`，第二次低优先级追上变 `"a"`。证实 useDeferredValue 的"值滞后一帧"。

## 没测的部分（诚实标注）
- **低优先级 wIP 被高优先级打断后丢弃重做**：jsdom + node 无真实时间分片/可中断调度，act 会把更新跑到一致状态，观察不到中断丢弃。该行为只在 day10.md §4 以源码机制讲解，未做实验，不编造输出。
