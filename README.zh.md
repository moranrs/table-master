# Table Master 表格大师 · Obsidian 插件

[English](./README.md) ｜ **简体中文**

为 Obsidian 提供一站式 Markdown 表格工作流，把三个流行表格插件最有用的能力合并到一个现代化的 UI 里：

- **GUI 快捷操作**（行/列的插入、删除、移动、对齐）—— 取代 *Advanced Tables*
- **可视化网格编辑器**，支持拖拽多选与合并单元格 —— 取代 *Markdown Table Editor*
- **合并单元格** 在阅读视图与 Live Preview 中都能正确渲染，与 Table Extended / MultiMarkdown 语法完全兼容 —— 取代 *Table Extended*

> Table Master 与 Table Extended 使用同一套源文件解析约定，**两者不可同时启用**。检测到 Table Extended 启用时会弹 8 秒提醒，请手动禁用其它表格插件以获得最佳体验。

## 功能

### 1. 浮动工具栏

光标进入 GFM 表格时，工具栏会浮在表头上方，按组排列：

- 插入 / 删除行与列
- 上移 / 下移行，左移 / 右移列
- 列对齐：左 / 居中 / 右
- **向上合并 ↑** / **向下合并 ↓** / **向左合并 ←** / **拆分单元格**
- 打开网格编辑器
- 格式化 / 重新对齐表格
- 从 Excel / 网页剪贴板导入表格（自动识别 HTML / TSV）

### 2. 右键菜单

光标在表格内时，编辑器右键菜单会附加全部表格命令。

### 3. 可视化网格编辑器

执行命令 **打开网格编辑器**（或工具栏上的网格图标），把当前表格以 Excel 风格的网格呈现：

- 单击单元格 → 内联编辑
- 拖拽 / `Shift` 点击 → 选中矩形区域
- **合并** 按钮 → 合并选区
- **拆分** 按钮 → 拆分当前合并块
- 添加 / 删除 行列
- **应用** 把改动写回 Markdown 源文件

### 4. 合并单元格（MultiMarkdown / Table Extended 语法）

```markdown
| Stage              | Direct Products | ATP Yields |
| ------------------ | --------------- | ---------- |
| Glycolysis         | 2 ATP           ||
| ^^                 | 2 NADH          | 3-5 ATP    |
| Pyruvate oxidation | 2 NADH          | 5 ATP      |
| **30-32** ATP                                  |||
```

- `^^` ：与正上方单元格合并（`rowspan`）
- 行末多写一个 `|` 把上一格延伸 1 列；`||` 多 2 列、`|||` 多 3 列…（`colspan`）

解析器同时支持 Table Extended 的所有进阶写法：

- **无表头表格**（首行就是分隔行）—— 解析 / 序列化支持；但 Obsidian 自带的渲染器仍要求有表头行，因此"首行即分隔行"的写法在源码 / 实时预览 / 阅读视图中可能仍显示为普通文本。若需要它正常渲染，请改用带（可为空的）表头行的普通表格，或把输出格式改为 HTML。
- **表格标题** —— 紧邻表格上方或下方一行写 `[标题文本]` 或 `[标题文本][锚点标签]`
- **多行表头**（分隔行之上的所有非空行都进 `<thead>`）
- **多个 `<tbody>` 分段** —— 表格主体中插入一行空行即可
- **多行单元格** —— 行末加 `\` 把下一行同列内容拼接进当前单元格
- 单元格内允许包含 Markdown 行内/块级语法（列表、代码块、链接、嵌入），阅读视图会重新渲染；Live Preview 保留 Obsidian 原生 widget 渲染，仅叠加合并效果

如果需要最大兼容度，可以在设置里把 **合并单元格输出格式** 切到 `HTML`，这样写出的会是带 `colspan` / `rowspan` 的原生 `<table>` 标签。

Live Preview 采用轻量方式仅修改 `rowspan` / `colspan` 属性并隐藏占位单元格，不会重写 Obsidian 表格 widget 的 innerHTML，因此不会干扰你的编辑。多行单元格、表格标题、单元格内 Markdown 重渲染仍仅阅读视图支持。

### 5. 单元格跳转

`Tab` / `Shift-Tab` 在单元格之间移动，`Enter` 跳到下一行（必要时自动新增一行）。如果跟你已有的快捷键冲突，可以在设置里关闭。

### 6. 从零设计新表格

执行命令 **用网格编辑器设计新表格…**：先弹出行 / 列 / 是否含表头的选项，再直接进入网格编辑器调整；点 *应用* 后会把成品插入到当前光标处——不需要先有一张表也能用。

### 7. 从 Excel / 网页粘贴表格

从 Excel、Google Sheets、Numbers 或任何包含 HTML `<table>` 的网页复制一段区域，然后运行命令 **从剪贴板导入表格**（在表格内时也可以点浮动工具栏上的录入按钮）：

- Excel / 网页：会优先读取剪贴板中的 `text/html`，`colspan` / `rowspan` 会被转为 MultiMarkdown 占位符。
- 纯文本：退化为 TSV（制表符分隔）解析，Excel 总会同时写入这种格式。
- 如果当前光标在某张表格中，导入会 **替换** 该表格；否则在光标处插入新表。
- 单元格内的 `|` 会被自动转义，保证生成的 markdown 可以原样反解析。
- 多行单元格（Excel 的 `Alt+Enter`、HTML 中的 `<br>`、`<p>`/`<div>`/`<li>` 等）会以 `<br>` 拼接的方式写在一行 GFM 单元格内。阅读视图与 Live Preview 都会把字面 `<br>` 自动升级为真正的换行元素——单元格视觉上仍是多行，同时合并属性（`rowspan` / `colspan`）的渲染不会错位。

## 安装

### 从源码构建

```bash
git clone <repo> obsidian-table-master
cd obsidian-table-master
npm install
npm run build
```

将生成的 `main.js`、`manifest.json` 与 `styles.css` 拷贝到 `<vault>/.obsidian/plugins/table-master/`，然后在 Obsidian 第三方插件设置里启用 Table Master。

### 开发热重载

```bash
npm run dev
```

esbuild 会监听 `src/` 并实时重新生成 `main.js`。配合 [hot-reload](https://github.com/pjeby/hot-reload) 插件可以做到改完即生效。

## 命令

每个动作都注册成命令，可以在 **设置 → 快捷键** 里绑定热键。

| ID                       | 功能                                |
| ------------------------ | ----------------------------------- |
| `insert-row-above`       | 在上方插入行                        |
| `insert-row-below`       | 在下方插入行                        |
| `insert-col-left`        | 在左侧插入列                        |
| `insert-col-right`       | 在右侧插入列                        |
| `delete-row`             | 删除行                              |
| `delete-col`             | 删除列                              |
| `move-row-up`            | 上移行                              |
| `move-row-down`          | 下移行                              |
| `move-col-left`          | 左移列                              |
| `move-col-right`         | 右移列                              |
| `align-left/center/right/none` | 列对齐                       |
| `merge-up`               | 与上方单元格合并                    |
| `merge-down`             | 与下方单元格合并                    |
| `merge-left`             | 与左侧单元格合并                    |
| `split-cell`             | 拆分合并单元格                      |
| `format-table`           | 格式化（重新对齐列宽）              |
| `sort-asc` / `sort-desc` | 按列升 / 降序排序                   |
| `open-grid-editor`       | 在当前表格上打开网格编辑器          |
| `design-new-table`       | 用网格编辑器设计新表格并插入        |
| `toggle-floating-toolbar`| 显示 / 隐藏浮动工具栏               |
| `new-table`              | 直接插入空表格                      |
| `import-table-from-clipboard` | 从 Excel / 网页剪贴板导入表格       |

## 设置

- **合并单元格输出格式** —— Extended（`^^` 表示行合并、行末追加 `||` 表示列合并；与 Table Extended 一致）或 HTML（带 `colspan` / `rowspan` 的原生 `<table>`）
- **显示浮动工具栏**
- **浮动工具栏位置** —— 三种模式（都用 `position: fixed` 相对视口定位，避开主题或父容器的样式坑；非焦点 tab 的工具栏自动隐藏）：
  - `点击表格时在点击处弹出（默认）`：默认隐藏；点击表格的瞬间在点击处弹出工具栏，点表格之外的位置则隐藏。
  - `鼠标进入表格时跟随鼠标，平时停在编辑器左上角`：编辑器激活时工具栏始终可见；鼠标在任何表格上时跟随鼠标，平时停在编辑器左上角。
  - `始终停在编辑器左上角`：无论光标 / 鼠标在哪都停在编辑器左上角。
- **启用 Tab 单元格跳转**
- **默认列对齐**
- **界面语言** —— 跟随 Obsidian / English / 中文

## 开发

```bash
npm test            # 运行 parser / serializer / ops 单元测试
npm run build       # 类型检查 + esbuild 打包发布
```

代码按层组织，业务逻辑与 Obsidian API 解耦：

```
src/
  table/      纯数据模型 + parser + serializer + ops（无 Obsidian 依赖）
  editor/     针对光标位置的编辑器修改
  ui/         浮动工具栏、右键菜单、网格编辑器
  render/     阅读视图 post-processor + Live Preview view plugin
  i18n/       en / zh 词典
  settings.ts 设置面板
  main.ts     插件入口
```

## 致谢

灵感来自：

- [Advanced Tables](https://github.com/tgrosinger/advanced-tables-obsidian) by Tony Grosinger
- [Markdown Table Editor](https://github.com/vanadium23/obsidian-markdown-table-editor) by Ivan Tikhonov
- [Table Extended](https://github.com/zhouhua/obsidian-table-extended) by Zhou Hua

三者均为 MIT 协议；本插件同样采用 MIT。
