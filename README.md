# Table Master for Obsidian

**English** ｜ [简体中文](./README.zh.md)

All-in-one Markdown table workflow for Obsidian. Combines the most useful pieces of three popular table plugins into a single, modern UI:

- **GUI shortcuts** (insert / delete / move row & column, alignment) — replaces *Advanced Tables*
- **Visual grid editor** with drag-to-select and merged-cell support — replaces *Markdown Table Editor*
- **Merged cells** rendered in both Reading view and Live Preview, fully compatible with Table Extended / MultiMarkdown syntax — replaces *Table Extended*

> Table Extended uses the same parser hook for source rendering. Running both plugins together is **not supported**: Table Master will warn you on load and you should disable the others.

## Features

### 1. Floating toolbar

When the cursor enters a GFM table the floating toolbar appears above the first row:

- Insert / delete row & column
- Move row up / down, column left / right
- Align column left / center / right
- **Merge ↑** / **Merge ↓** / **Merge ←** / **Split cell**
- Open the grid editor
- Format / re-pad table
- Paste a table copied from Excel / a web page (HTML or TSV is detected automatically)

### Docked sidebar toolbar

Set **Toolbar position** to **Sidebar** to move the same toolbar actions into
Obsidian's right dock. The floating toolbar is hidden in this mode. The panel can
be moved or closed like other workspace views; use **Open toolbar in sidebar**
to reveal it again. Switch back to **Floating** to keep the existing floating
placement options.

Sidebar actions use the last active, still-open Markdown editor when the panel
receives focus. Table actions are disabled outside a table; the grid editor and
clipboard import remain available in an editable note. Existing installations
keep their floating toolbar preference, including a previously hidden toolbar.

### 2. Right-click menu

All table operations are also available from the editor's right-click menu when the cursor is inside a table.

### 3. Visual grid editor

Run the command **Open grid editor** (or click the grid button on the toolbar) to launch a Modal that displays the table as an Excel-like grid.

- Click a cell to edit it inline
- Click and drag, or `Shift`-click, to select a rectangular range
- Use the **Merge** button to merge the selected range
- Use the **Split** button to split the cell at the active selection
- Add / delete rows and columns
- Click **Apply** to write the changes back to the markdown source

### 4. Merged cells (MultiMarkdown / Table Extended syntax)

```markdown
| Stage              | Direct Products | ATP Yields |
| ------------------ | --------------- | ---------- |
| Glycolysis         | 2 ATP           ||
| ^^                 | 2 NADH          | 3-5 ATP    |
| Pyruvate oxidation | 2 NADH          | 5 ATP      |
| **30-32** ATP                                  |||
```

- `^^` — the cell merges with the row directly above (`rowspan`)
- A trailing `||` extends the previous cell by one column; `|||` by two, and so on (`colspan`)

The parser also accepts every other Table Extended construct:

- **Headerless tables** (block starts with the separator row)
- **Table caption** — `[Caption text]` or `[Caption text][label]` immediately above or below
- **Multiple header rows** (any rows above the separator row)
- **Multiple `<tbody>` sections** by inserting a single blank line inside the body
- **Multi-line cells** continued from the next row with a trailing `\`
- Inline Markdown (lists, code, links, embeds) is rendered inside cells in Reading view; Live Preview keeps Obsidian's native widget rendering and only applies merges.

If you prefer maximum portability, set **Merged-cell output format** to `HTML` and Table Master will write a regular `<table>` with `colspan` / `rowspan` attributes instead.

Live Preview applies merges by toggling `rowspan` / `colspan` attributes and hiding placeholder cells in Obsidian's existing table widget — cell text is left untouched, so the widget remains compatible with normal Obsidian editing. Multi-line cells, captions, and inline markdown re-rendering remain Reading View only.

### 5. Cell navigation

`Tab` / `Shift-Tab` move between cells and `Enter` jumps to the next row (creating one if needed). Disable in settings if it interferes with your workflow.

### 6. Design-from-scratch flow

Run **Design new table in grid editor…** to be asked for rows / columns / header presence first, then drop straight into the grid editor. Hit *Apply* to insert the finished table at the cursor — no need to be inside an existing table beforehand.

### 7. Paste tables from Excel / web

Copy a range from Excel, Google Sheets, Numbers, or any web page that contains an HTML `<table>`, then run **Paste table from clipboard** (also available as a button on the floating toolbar when the cursor is in a table):

- Excel / web pages: the rich `text/html` clipboard payload is parsed; `colspan` / `rowspan` are preserved and translated to MultiMarkdown placeholders.
- Plain TSV: tab-separated text is parsed as a fallback (Excel always provides this).
- If the cursor is currently inside a table, the import **replaces** that table; otherwise the new table is inserted at the cursor.
- Pipes inside imported cells are escaped automatically so the markdown round-trips cleanly.
- Multi-line cells (Excel `Alt+Enter`, `<br>` in HTML, `<p>`/`<div>`/`<li>` blocks) are emitted as a single GFM row with `<br>` between segments. Reading view + Live Preview both upgrade those `<br>` tokens to real line breaks, so a multi-line cell still wraps visually while merge structure (`rowspan`/`colspan`) stays intact.

## Installation

### From source

```bash
git clone <repo> obsidian-table-master
cd obsidian-table-master
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/table-master/`, then enable the plugin in Obsidian.

### Hot-reload during development

```bash
npm run dev
```

esbuild watches `src/` and rebuilds `main.js` on change. Combine with the [hot-reload](https://github.com/pjeby/hot-reload) plugin for an instant feedback loop.

## Commands

Every action is exposed as a command and can be bound to a hotkey from **Settings → Hotkeys**.

| ID                       | Description                       |
| ------------------------ | --------------------------------- |
| `insert-row-above`       | Insert row above                  |
| `insert-row-below`       | Insert row below                  |
| `insert-col-left`        | Insert column to the left         |
| `insert-col-right`       | Insert column to the right        |
| `delete-row`             | Delete row                        |
| `delete-col`             | Delete column                     |
| `move-row-up`            | Move row up                       |
| `move-row-down`          | Move row down                     |
| `move-col-left`          | Move column left                  |
| `move-col-right`         | Move column right                 |
| `align-left/center/right/none` | Align column                |
| `merge-selection` | Merge selected cells (Live Preview widget or text selection) |
| `merge-up`               | Merge with cell above             |
| `merge-down`             | Merge with cell below             |
| `merge-left`             | Merge with cell to the left       |
| `split-cell`             | Split merged cell                 |
| `format-table`           | Re-pad table cells                |
| `sort-asc` / `sort-desc` | Sort by column                    |
| `open-grid-editor`       | Open the visual grid editor on the table at the cursor |
| `design-new-table`       | Open the grid editor with a fresh empty table and insert on apply |
| `toggle-floating-toolbar`| Show/hide the floating toolbar    |
| `new-table`              | Insert a new empty table          |
| `import-table-from-clipboard` | Paste an Excel / web table from the clipboard |

## Settings

- **Merged-cell output format** — Extended (`^^` for rowspan, trailing `||` for colspan; same as Table Extended) or raw HTML (`colspan` / `rowspan` attributes on a `<table>`)
- **Show floating toolbar**
- **Floating toolbar position** — three modes (all use `position: fixed` so a custom theme can't hide them; non-focused tabs auto-hide their own toolbar):
  - `Pop up at click position when clicking a table` (default): the toolbar stays hidden until you click inside a table, then springs up at the click point and stays there until you click outside any table.
  - `Follow mouse inside table; top-left otherwise`: always visible while the editor is focused. Trails the mouse pointer whenever it's hovering a table; falls back to the top-left of the editor when not.
  - `Always at the editor's top-left`: pinned at the top-left of the editor pane regardless of where you click.
- **Enable Tab navigation**
- **Default column alignment**
- **Interface language** — Auto / English / 中文

## Development

```bash
npm test            # run unit tests for parser / serializer / ops
npm run build       # type-check and bundle for production
```

Architecture is layered so logic is decoupled from Obsidian:

```
src/
  table/      pure model + parser + serializer + ops (no Obsidian deps)
  editor/     editor mutations driven from the cursor
  ui/         floating toolbar, context menu, modal grid editor
  render/     reading-view post-processor + live-preview view plugin
  i18n/       en / zh dictionaries
  settings.ts settings tab
  main.ts     plugin entry
```

## Credits

Inspired by:

- [Advanced Tables](https://github.com/tgrosinger/advanced-tables-obsidian) by Tony Grosinger
- [Markdown Table Editor](https://github.com/vanadium23/obsidian-markdown-table-editor) by Ivan Tikhonov
- [Table Extended](https://github.com/zhouhua/obsidian-table-extended) by Zhou Hua

All three are MIT-licensed; this plugin is also MIT.
