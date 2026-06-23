# 实验验证脚手架（VERIFY HARNESS）

> ⚠️ STUDY_PROTOCOL 必做 #10：写进 `demos/dayN/` 的任何"预期结果"**必须先本地实测得出**，禁止凭印象。
> 本目录提供跨电脑可用的最小验证环境，每天写实验"预期"前先用它跑一遍。

## 一、环境（首次/换电脑时执行）

```bash
cd /Users/guest_1/.workbuddy/binaries/node/workspace   # 隔离工作区
/Users/guest_1/.workbuddy/binaries/node/versions/22.22.2/bin/npm install react@19 react-dom@19 jsdom
# 切版本对比：npm install react@17.0.2 react-dom@17.0.2  /  react@18  /  react@19
cat node_modules/react/package.json | grep '"version"'   # 确认版本
```

## 二、React 18/19 验证模板（react-dom/client + act）

```js
// harness.mjs  ——  node harness.mjs 运行
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { createContext, useContext, useState, useRef, useEffect, memo } = React;
const h = React.createElement;
const ReactDOMClient = await import('react-dom/client');
const { act } = await import('react');
console.log('React version:', React.version);

// ===== 在这里写被测组件，用 h(...) 而非 JSX =====
let setX;
function App() {
  const [x, _setX] = useState(0); setX = _setX;
  // ...
  return h('div', null, String(x));
}

const root = ReactDOMClient.createRoot(document.getElementById('root'));
await act(async () => { root.render(h(App)); });
console.log('--- 触发更新 ---');
await act(async () => { setX(v => v + 1); });
```

运行：
```bash
NODE_PATH=/Users/guest_1/.workbuddy/binaries/node/workspace/node_modules \
/Users/guest_1/.workbuddy/binaries/node/versions/22.22.2/bin/node harness.mjs
```

## 三、React 17 模板（差异点）

```js
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
const ReactDOM = (await import('react-dom')).default;
const { act } = await import('react-dom/test-utils.js');   // 17 的 act 在 test-utils
// ...
await act(async () => { ReactDOM.render(h(App), container); });
```

## 四、四条踩坑铁律（来自 Day9 实测纠错）

1. **数渲染次数 → 每个实例打唯一标识**：`console.log(label, val)`。DevTools 会折叠相邻相同日志（左侧计数徽标），不打标识会误判次数。
2. **抓 fiber 字段 → 区分 DOM fiber 和组件 fiber**：ref 抓 `__reactFiber$` 得到的是 DOM(HostComponent tag=5)，无 Hook 链表/dependencies。看组件状态要 `liFiber.return` 跳到组件 fiber(tag=0 函数 / 15 memo)。
3. **渲染行为受版本 + 编译器影响**：react17 无自动 memo（不写 memo → setState 必全渲染）；**Vite+React19 .tsx 常自动开 React Compiler，自动缓存 element = 自动 memo**（不写 memo 也只渲染消费者）。预期必须标版本 + 是否开编译器。
4. **结果与预期不符 → 先怀疑自己、本地复跑**，不硬编解释。

## 五、版本行为对照（本地实测，Context 三消费者嵌套 Provider，无手写 memo）

| 操作 | react@17（无编译器）| react@19 裸 JSX | react@19 + Compiler/手写 memo |
|---|---|---|---|
| 改 inner | 3 个全渲染 | 3 个全渲染 | 只内层 1 个 |
| 改 outer | 3 个全渲染 | 3 个全渲染 | 外层子树 3 个 |
| toggle(value 不变) | 3 个全渲染 | 3 个全渲染 | 0 个 |

> 根因(`ReactFiberBeginWork.js` beginWork)：`oldProps !== newProps` 才必渲染。分水岭是 element props 引用是否稳定；memo / React Compiler 都是稳定它的手段。
