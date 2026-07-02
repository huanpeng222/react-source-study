# Day 15 精简笔记

> 主题：状态管理深挖（Redux / Zustand / Context / Jotai）

## 一句话总结
**Context 粒度太粗（value 变全更新），Redux 样板太多，Zustand 是最佳平衡点（无 Provider + 原子级订阅 + ~200b），Jotai 在派生状态场景更优。**

---

## Context 性能陷阱

**根因**：Context 只比较 value 引用，不做字段级 diff → 一个 Context 管太多 → 无关消费者被拖累重渲染

4 种修复：
1. **拆分 Context**（最常用）— 一个关注点一个
2. **selector 手写** — `useMemo(() => sel(ctx), [ctx])` 但 selector 本身引用也要稳定
3. **useSyncExternalStore** — React 18 原生外部 Store Hook
4. **换 Zustand/Jotai** — 生产推荐

## createSlice 自动生成了什么？

输入：`{ name, initialState, { reducer1, reducer2 } }`
输出：
- `actions.reducer1(payload)` → `{ type: 'name/reducer1', payload }`
- `reducer` 函数（Immer 包裹，可直接 mutation）
- action type 前缀自动加 `name/`

## Zustand 不需要 Provider 的原因

- Redux store 通过 React Context 注入 → 需要 Provider
- **Zustand store 存在模块级闭包里** → 组件通过 useSyncExternalStore 订阅 → 跟组件树无关
- `create(set => ({...}))` 返回纯 JS 对象 `{ getState, set, subscribe }`

## Jotai 核心概念

- **Atom** = 独立的状态原子单元
- **useAtom(atom)** = 类似 useState，但只有这个 atom 变才触发 re-render
- **派生 atom** = `atom(get => get(other) * 2)` 天然 computed，只在依赖变化时更新
- 更新粒度：**单个 atom 级别**（比 Zustand 的 selector 还细）

## 选择指南

| 场景 | 推荐 |
|---|---|
| 小项目 / 个人 | Context 或 Jotai |
| 中型团队 | **Zustand**（首选） |
| 大型企业 / 需要时间旅行调试 | **Redux Toolkit** |
| 派生状态多 / 细粒度要求极高 | **Jotai** |

## 面试口述版（30 秒）

> "状态管理的核心矛盾是'共享状态粒度 vs 重渲染范围'。Context 只做引用比较，一个值变所有消费者都更——这是它的性能陷阱，解决方案是拆分或换库。Redux Toolkit 用 createSlice 自动生成 action creator 和 reducer（Immer 允许直接 mutation），但样板代码仍多于 Zustand。Zustand 把 store 放在模块级闭包而非 React Context 里，所以不需要 Provider，通过 useSyncExternalStore 实现组件级精准订阅。Jotai 更进一步，把状态拆成独立原子(atom)，实现最小粒度更新。"
