# Day 1 笔记：JSX → React Element

> 日期：2026-06-17 ~ 2026-06-18 凌晨
> 主题：JSX 是什么的语法糖、React Element 对象结构、$$typeof 与 XSS 防御
> 状态：✅ Day1 通过（细节有保留，已补正）

---

## 一、我今天最大的认知更新

> **JSX 不是模板也不是 HTML，而是 `React.createElement(...)` 或 `jsx(...)` 函数调用的语法糖。**
> babel 编译之后剥掉糖衣，就是普通的 JS 函数调用，返回一个**普通 JS 对象（React Element）**，跟 DOM 没有任何关系——它只是一份"渲染描述快照"。

这是整套 React 心智模型的起点。所有后面的 Fiber / 调和 / Hooks，本质上都是在"消费" React Element 这个对象。

---

## 二、JSX 是什么的语法糖

### 老 Transform（React 17 之前，classic）

源代码：

```jsx
<div className="box" id="main">hello</div>
```

babel 编译后：

```js
React.createElement(
  "div",                              // type
  { className: "box", id: "main" },   // props（不含 children）
  "hello"                              // 第三个参数及以后：children
);
```

特点：
- 必须 `import React from 'react'`，否则 `React` 找不到。
- children 通过 rest 参数收集，不在 props 里。

### 新 Transform（React 17+，automatic）

源代码：

```jsx
<div className="box">hello</div>
```

babel 自动注入并编译为：

```js
import { jsx as _jsx } from "react/jsx-runtime";   // babel 自动注入
_jsx("div", {
  className: "box",
  children: "hello"                  // children 进了 props 里
});
```

带 key 的情况：

```jsx
<div key="k">hello</div>
```

编译为：

```js
_jsx("div", { children: "hello" }, "k");
//                                  ↑ key 单独作为第三个参数，不在 props 里
```

特点：
- 不需要手动 import React。
- children 进了 props。
- key 单独作为 jsx() 第三参数，**剥离出 props**，所以组件函数里 `props.key === undefined`。
- 区分 `jsx`（单 child）/ `jsxs`（多 children）/ `jsxDEV`（开发模式带 source 信息），方便编译器和 linter 优化。

### 大小写决定 type 是字符串还是变量

```jsx
<div>hi</div>     →  _jsx("div", ...)    // 小写：type 是字符串，React 当 DOM 标签
<Foo>hi</Foo>     →  _jsx(Foo, ...)      // 大写：type 是变量引用（函数 / 类组件）
```

**这就是 React 组件名必须大写的原因**——babel 在编译期就靠首字母大小写区分。
如果你写 `<foo>`，babel 当成 DOM 标签输出 `_jsx("foo", ...)`，浏览器不认识 `<foo>`，组件不会被调用。

---

## 三、React Element 对象的完整结构

```js
{
  $$typeof: Symbol(react.element),   // 类型标记，防 XSS（下文专讲）
  type: "div",                       // 字符串（DOM 标签）或函数/类（组件）
  key: null,                         // 顶层字段，不在 props 里
  ref: null,                         // 顶层字段，不在 props 里
  props: {
    className: "box",
    children: "hello"                // ★ children 在 props 里！
  },
  _owner: null                       // 内部调试信息，记录谁创建了这个 element
}
```

**必须记牢的 6 个顶层字段**：

| 字段 | 含义 |
| --- | --- |
| `$$typeof` | Symbol，标记"这是 React Element"，防 XSS |
| `type` | 字符串（DOM 标签）或 函数/类（组件） |
| `key` | 列表渲染时用于 diff，组件内读不到 |
| `ref` | 持有真实 DOM/组件实例的引用 |
| `props` | 所有传入的属性 + children |
| `_owner` | 内部 owner，调试用 |

### 为什么 key / ref 是顶层而不是 props 里？

因为它们是 **React 内部使用的"元属性"**，组件函数永远读不到 `props.key` / `props.ref`——React 在 jsx() 编译时就把它们剥离了。如果你想透传 ref 到子组件，必须用 `forwardRef`（React 18 及之前）或直接 `ref={...}` 当 prop（React 19）。

---

## 四、$$typeof 为什么是 Symbol

### 一句话本质

> **Symbol 不能被 JSON 序列化**。攻击者无法通过 JSON 注入伪造一个真正的 `Symbol(react.element)`，React 渲染前校验 `element.$$typeof === REACT_ELEMENT_TYPE`，能拦截所有伪造对象。

### 攻击场景还原

假设后端把用户输入直接 JSON.stringify 返回，前端不校验就塞给 React 渲染。攻击者构造：

```json
{
  "type": "script",
  "props": { "src": "https://evil.com/x.js" },
  "$$typeof": "Symbol(react.element)"
}
```

JSON.parse 之后：

```js
fakeElement.$$typeof === "Symbol(react.element)"   // 字符串
typeof fakeElement.$$typeof === "string"           // 不是 symbol
```

React 内部校验：

```js
if (element.$$typeof !== REACT_ELEMENT_TYPE) {
  // 直接拒绝渲染
}
```

字符串 `"Symbol(react.element)"` ≠ 真正的 Symbol，**通过率永远为 0**。这是 React 安全模型里非常优雅的一笔。

---

## 五、React Element 的不可变性

```jsx
const a = <div>hello</div>;
const b = <div>hello</div>;

a === b                  // false  （每次 jsx() 调用都生成新对象）
a.type === b.type        // true   （都是字符串 "div"）
Object.isFrozen(a)       // dev: true（开发模式 freeze 防 mutate）
                         // prod: false（生产模式为性能不 freeze）

a.props.children         // 'hello'
a.props.children = 'world'
// dev 严格模式 → TypeError: Cannot assign to read only property
// prod → 赋值成功，但 React 不会重渲染（没触发 setState）
```

**核心结论**：React Element 是一次性的渲染描述快照，**永远不要 mutate**。要改 UI 只能 setState 让 React 重新生成新的 element。

---

## 六、我之前以为 …，其实是 …（5 条认知纠正）

1. **我之前以为** `ReactDOM.createRoot` 和 `React.createElement` 是一回事——
   **其实** 前者是应用启动入口（整个应用调一次），后者是 JSX 编译目标（每个标签调一次），两者职责完全不同。

2. **我之前以为** React Element 是 DOM 节点——
   **其实** 它只是个普通 JS 对象，是渲染的"描述快照"，没有任何 DOM 属性。DOM 是 React 后续在 commit 阶段根据它生成的。

3. **我之前以为** 修改 `element.props.children = 'xxx'` 能改变渲染——
   **其实** 开发模式 element 被 `Object.freeze` 冻结，赋值会报错；生产模式赋值成功但 React 不会重渲染。Element 是一次性快照。

4. **我之前以为** `<Foo>` 和 `<foo>` 都能用——
   **其实** babel 按首字母大小写决定 type 是 `"foo"` 字符串还是 `Foo` 变量。小写视为 DOM 标签，组件名必须大写。

5. **我之前以为** key 是 props 的一部分，组件里能读 `props.key`——
   **其实** 17+ 新 Transform 把 key 单独作为 `jsx()` 第三参数，从编译期就剥离 props，组件内 `props.key === undefined`。

---

## 七、今天踩的坑（大小写陷阱专项）

| 错误写法 | 正确写法 | 原因 |
| --- | --- | --- |
| `ReactDom` | `ReactDOM` | DOM 是缩写，三字母全大写 |
| `React.CreateElement` | `React.createElement` | 所有 React API 都是小驼峰 |
| `ClassName` | `className` | JSX 属性小驼峰，且 `class` 是 JS 关键字 |
| `$$typeOf` | `$$typeof` | 全小写 |
| `Symbol(React.Element)` | `Symbol(react.element)` | Symbol 描述全小写 |
| `<script />` | `<script></script>` | HTML 不是 XHTML，script 必须闭合标签 |

**铁律**：
1. 写 React API 在脑里默念"小驼峰"。
2. 大小写出错时第一时间 `console.log(window.XXX)` 看变量是否存在。
3. HTML 所有标签都用闭合写法，不要图省事自闭合。

---

## 八、一句话记忆（30 字版）

> **JSX 是 `jsx()` 的语法糖，React Element 是普通对象快照，`$$typeof` 用 Symbol 防 XSS 伪造。**

---

## 九、Day1 验收清单

- [x] 知道 JSX 是函数调用的语法糖（不是模板/HTML）。
- [x] 能脱口而出 React Element 的 6 个顶层字段：`$$typeof / type / key / ref / props / _owner`。
- [x] 理解新老 Transform 区别，能讲出新 Transform 解决了什么问题。
- [x] 理解 `$$typeof` 用 Symbol 是为了防 JSON 伪造的 XSS。
- [x] 理解大小写决定 type 是字符串还是变量。
- [x] 亲手跑过 `React.createElement` 的纯 HTML demo。
- [x] 5 条"我之前以为…，其实是…"已记录。

---

## 十、Day 2 预告

明天主题：**React Element → Fiber + 双缓存**。
将回答：
1. 为什么 React 不直接渲染 Element，要再转成 Fiber？
2. current 树和 workInProgress 树为什么是两棵？什么时候交换？
3. Fiber 的 return / child / sibling 三个指针怎么遍历整棵树？
4. 为什么 Fiber 是链表而不是树？

**预读建议**：明天入场测前，先在脑子里回答上面 4 个问题（不会答没关系，我会带你走）。
