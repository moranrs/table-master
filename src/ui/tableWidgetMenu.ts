// Live-Preview right-click interceptor.
//
// Obsidian 1.5+ renders markdown tables as an interactive widget in Live
// Preview. The widget swallows right-clicks for its own (built-in) cell
// menu, which means plugins never receive an `editor-menu` event for those
// clicks. To make Table Master's menu reachable inside the widget we attach
// a capture-phase `contextmenu` listener on every CM6 editor and, when the
// click lands on a table cell, suppress the default and show our own Menu.

import { ViewPlugin, ViewUpdate, EditorView, PluginValue } from "@codemirror/view";
import { Editor, EditorPosition, MarkdownView, Menu } from "obsidian";
import type TableMasterPlugin from "../main";
import { locateTable, isCaptionLine } from "../editor/tableLocator";
import { isSeparatorLine } from "../table/parser";
import { addInTableMenuItems, addOutOfTableMenuItems, CellRange } from "./contextMenu";

interface MenuHost {
  getPlugin(): TableMasterPlugin;
}

/**
 * Walk the workspace's leaves to find the `Editor` (Obsidian wrapper) whose
 * underlying CM6 EditorView matches `cm`. Necessary because the ViewPlugin
 * runs in the CM6 layer and has no direct reference to Obsidian's Editor.
 */
function findEditorForCMView(plugin: TableMasterPlugin, cm: EditorView): Editor | null {
  let found: Editor | null = null;
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    if (found) return;
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const inner = (view.editor as unknown as { cm?: EditorView }).cm;
    if (inner === cm) found = view.editor;
  });
  return found;
}

/**
 * Read Obsidian's table-widget visual cell selection from the rendered DOM
 * and translate it into a (r1, c1, r2, c2) bounding rectangle in *DOM*
 * coordinates. Those coordinates line up with the parsed `TableModel` rows
 * because Obsidian's widget renders one `<tr>` per source row and one
 * `<td>/<th>` per source cell (no row/colspan introduced by the widget
 * itself for simple markdown tables).
 *
 * Falls back to a single-cell range covering the click target when the
 * widget hasn't marked any selection. We treat a single cell as "no
 * selection" to avoid showing a useless merge entry.
 *
 * The class probing is intentionally permissive: Obsidian doesn't expose a
 * stable public class for selected cells, so we accept several known /
 * likely candidates. Adding more candidates is cheap.
 */
export function computeWidgetSelection(table: HTMLTableElement, clicked: Element | null): CellRange | undefined {
  const SELECTED_SELECTOR =
    "td.is-selected, th.is-selected, td.is-active, th.is-active, td[aria-selected='true'], th[aria-selected='true'], td.cm-selectedTableCell, th.cm-selectedTableCell";
  const selected = Array.from(table.querySelectorAll<HTMLElement>(SELECTED_SELECTOR));
  // Always include the clicked cell so a right-click outside the existing
  // selection still defines a valid range.
  if (clicked instanceof HTMLElement && !selected.includes(clicked)) {
    selected.push(clicked);
  }
  if (selected.length < 2) return undefined;

  const rows = Array.from(table.querySelectorAll("tr"));
  const rowIndex = (cell: HTMLElement): number => {
    const tr = cell.parentElement as HTMLTableRowElement | null;
    return tr ? rows.indexOf(tr) : -1;
  };
  const colIndex = (cell: HTMLElement): number => {
    const tr = cell.parentElement as HTMLTableRowElement | null;
    if (!tr) return -1;
    return Array.from(tr.children).indexOf(cell);
  };

  let r1 = Number.POSITIVE_INFINITY,
    c1 = Number.POSITIVE_INFINITY,
    r2 = -1,
    c2 = -1;
  for (const cell of selected) {
    const r = rowIndex(cell);
    const c = colIndex(cell);
    if (r < 0 || c < 0) continue;
    if (r < r1) r1 = r;
    if (c < c1) c1 = c;
    if (r > r2) r2 = r;
    if (c > c2) c2 = c;
  }
  if (r2 < 0 || c2 < 0) return undefined;
  if (r1 === r2 && c1 === c2) return undefined;
  return { r1, c1, r2, c2 };
}

/**
 * Translate a DOM click on a table-widget cell into the corresponding
 * source `{line, ch}` position. Walks the source by line so it doesn't
 * depend on CM6 widget mappings (which can map clicks anywhere inside
 * the widget back to either end of its replaced range — that's why
 * `posAtCoords` was sending us to the last row).
 *
 * Strategy:
 *   1. Use `posAtDOM(table, -1)` to get a doc offset *before* the widget,
 *      then `locateTable` to find the table's source block bounds.
 *   2. Walk the source lines counting non-separator / non-caption / non-
 *      blank rows until we reach the DOM row index of the clicked cell.
 *   3. Inside that line, advance past `domColIndex` unescaped pipes.
 */
function clickedSourcePosition(
  view: EditorView,
  editor: Editor,
  table: HTMLTableElement,
  cell: HTMLElement,
): EditorPosition | null {
  let widgetOffset: number;
  try {
    widgetOffset = view.posAtDOM(table);
  } catch {
    return null;
  }
  const probe = editor.offsetToPos(widgetOffset);
  // Try the line at the widget offset first; if locateTable fails (e.g. the
  // mapped position landed on a blank line just after the widget), step
  // back one line at a time until we hit table content.
  let loc: ReturnType<typeof locateTable> = null;
  for (let line = probe.line; line >= 0; line--) {
    loc = locateTable(editor, { line, ch: 0 });
    if (loc) break;
  }
  if (!loc) return null;

  const tr = cell.parentElement as HTMLTableRowElement | null;
  if (!tr) return null;
  const rows = Array.from(table.querySelectorAll("tr"));
  const domRow = rows.indexOf(tr);
  if (domRow < 0) return null;
  const domCol = Array.from(tr.children).indexOf(cell);

  let logical = -1;
  let targetLine = -1;
  for (let i = loc.startLine; i <= loc.endLine; i++) {
    const line = editor.getLine(i);
    if (isSeparatorLine(line) || isCaptionLine(line) || line.trim() === "") continue;
    logical++;
    if (logical === domRow) {
      targetLine = i;
      break;
    }
  }
  if (targetLine < 0) return null;

  const lineText = editor.getLine(targetLine);
  let pipes = 0;
  let escaped = false;
  let ch = 0;
  for (let i = 0; i < lineText.length; i++) {
    const c = lineText[i];
    if (c === "\\") {
      escaped = !escaped;
      continue;
    }
    if (c === "|" && !escaped) {
      pipes++;
      if (pipes === domCol + 1) {
        ch = i + 1;
        while (ch < lineText.length && lineText[ch] === " ") ch++;
        break;
      }
    }
    escaped = false;
  }
  return { line: targetLine, ch };
}

/**
 * Scan the active markdown editor's Live Preview content for a table whose
 * widget currently has a multi-cell selection. Used by the floating toolbar
 * so its "merge selection" button works inside the table widget (where the
 * editor's text selection alone never spans multiple cells).
 */
export function findActiveWidgetSelection(plugin: TableMasterPlugin): CellRange | undefined {
  const md = plugin.getTargetMarkdownView();
  if (!md) return undefined;
  const cm = (md.editor as unknown as { cm?: EditorView }).cm;
  if (!cm) return undefined;
  const root = cm.dom.querySelector(".cm-content") ?? cm.dom;
  const tables = root.querySelectorAll<HTMLTableElement>("table");
  for (const table of Array.from(tables)) {
    const range = computeWidgetSelection(table, null);
    if (range) return range;
  }
  return undefined;
}

export function buildTableWidgetContextMenuExt(host: MenuHost) {
  return ViewPlugin.fromClass(
    class implements PluginValue {
      view: EditorView;
      listener: (e: MouseEvent) => void;

      constructor(view: EditorView) {
        this.view = view;
        this.listener = (e) => this.onContextMenu(e);
        // Capture phase so we run before Obsidian's own table-widget handler.
        view.dom.addEventListener("contextmenu", this.listener, true);
      }

      update(_u: ViewUpdate): void {
        // No-op: we only care about the contextmenu event.
      }

      destroy(): void {
        this.view.dom.removeEventListener("contextmenu", this.listener, true);
      }

      private onContextMenu(e: MouseEvent): void {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        // Only intercept clicks that land on a Live-Preview-rendered table
        // cell. Everything else (plain text, lists, code blocks, headings)
        // continues to fire `editor-menu` normally.
        const cell = target.closest("td, th");
        if (!cell) return;
        const table = cell.closest("table");
        if (!table) return;
        // The CM6 content host. If the table isn't a descendant, it's some
        // other (rendered post-processor) DOM and we shouldn't touch it.
        if (!this.view.dom.contains(table)) return;
        if (!table.closest(".cm-content")) return;

        const plugin = host.getPlugin();
        const editor = findEditorForCMView(plugin, this.view);
        if (!editor) return;

        // Move the editor cursor to the source position of the clicked
        // cell so subsequent actions operate on the right (row, col).
        // CM6's posAtCoords / posAtDOM on a Live-Preview table widget can
        // map clicks anywhere inside the widget back to either end of the
        // replaced range — that previously sent us to the last row even
        // when clicking the first. `clickedSourcePosition` walks the
        // source by row index instead, which is unambiguous.
        // Skip this when the user already has a multi-cell text selection
        // — preserving it is what enables the "merge selected cells" entry.
        const fromOff = editor.posToOffset(editor.getCursor("from"));
        const toOff = editor.posToOffset(editor.getCursor("to"));
        if (fromOff === toOff) {
          const pos = clickedSourcePosition(this.view, editor, table, cell as HTMLElement);
          if (pos) editor.setCursor(pos);
        }

        // Compute any visual cell selection from the widget DOM *before*
        // suppressing the event — that way we can show the merge entry
        // even though no editor text selection exists.
        const widgetRange = computeWidgetSelection(table, cell);

        // Suppress Obsidian's default table-widget menu and any further
        // listeners (including the editor-menu dispatch) — we are taking
        // over completely for this click.
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const menu = new Menu();
        const loc = locateTable(editor);
        if (loc) {
          addInTableMenuItems(plugin, editor, menu, widgetRange);
        } else {
          addOutOfTableMenuItems(plugin, menu);
        }
        menu.showAtMouseEvent(e);
      }
    },
  );
}
