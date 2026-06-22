# Day 8 实验观察记录（待回填）

> 跑完 `demos/day8/README.md` 的 I1/I2/I3 后填这里

## I1：ref 引用稳定 + 改 current 不 render

- 连点"改 ref.current"5 次，console 输出：
  ```
  （粘贴）
  ```
- 页面 `<p>` 是否变化：____（预期：不变，停在 0）
- 点"强制 render"后 `ref === 上次?` 输出：____（预期：true）

## I2：useMemo 缓存命中 vs 失效

- 点"other+1"（count 不变），expensive 执行情况：
  - good（deps=[count]）：____（预期：不执行）
  - bad（deps=[cfg]）：____（预期：执行）

## I3：useCallback 配 memo

- 传 stable，点父 count+1 多次，Child render 次数：____（预期：仅首次）
- 传 unstable，Child render 次数：____（预期：每次）

## 自检回答

1.
2.
3.
