# Day 1 Demo：手写 React.createElement

> 这个文件就是 Day1 跑通的 demo，可以直接双击在浏览器打开。
> 用 UMD 版 React，故意不用 babel/JSX，目的是让你**亲眼看到 React Element 长什么样**。

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Day 1 - React Element Demo</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
</head>
<body>
  <div id="root"></div>

  <script>
    // ============ Part 1: 手写一个 React Element ============
    const el = React.createElement(
      "div",
      { className: "box" },
      "hello ",
      React.createElement("span", null, "world")
    );

    console.log("React Element 长这样：", el);
    console.log("$$typeof:", el.$$typeof);          // Symbol(react.element)
    console.log("type:", el.type);                  // "div"
    console.log("key:", el.key);                    // null
    console.log("ref:", el.ref);                    // null
    console.log("props.children:", el.props.children);  // ['hello ', {...}]

    // ============ Part 2: 验证 element 在 dev 模式被 freeze ============
    console.log("Object.isFrozen(el):", Object.isFrozen(el));  // true (dev)
    try {
      el.props.children = "world";   // dev 严格模式会抛错
    } catch (e) {
      console.log("修改 element 报错：", e.message);
    }

    // ============ Part 3: 验证 $$typeof 防 XSS ============
    const fake = JSON.parse('{"type":"script","props":{"src":"evil.js"},"$$typeof":"Symbol(react.element)"}');
    console.log("假 element 的 $$typeof:", fake.$$typeof);        // 字符串
    console.log("是字符串而非 Symbol:", typeof fake.$$typeof);   // "string"
    // React 渲染时会校验 $$typeof === REACT_ELEMENT_TYPE，假对象通不过

    // ============ Part 4: 渲染真的 element 到 DOM ============
    ReactDOM.createRoot(document.getElementById("root")).render(el);
  </script>
</body>
</html>
```

## 跑起来该看到什么

页面：**hello world**

控制台：
```
React Element 长这样： {$$typeof: Symbol(react.element), type: 'div', key: null, ref: null, props: {...}, ...}
$$typeof: Symbol(react.element)
type: div
key: null
ref: null
props.children: ['hello ', {…}]
Object.isFrozen(el): true
修改 element 报错： Cannot assign to read only property 'children' of object '#<Object>'
假 element 的 $$typeof: Symbol(react.element)
是字符串而非 Symbol: string
```

## 今天踩的坑

1. `ReactDom` → 正确：`ReactDOM`（DOM 全大写）。
2. `<script />` → 正确：`<script></script>`（HTML 不允许自闭合）。

## 改成 JSX 长什么样（对比用）

如果你用 babel + JSX 写同样的东西：

```jsx
const el = (
  <div className="box">
    hello <span>world</span>
  </div>
);
```

它和上面的纯函数写法**完全等价**。这就是 JSX 语法糖的本质。
