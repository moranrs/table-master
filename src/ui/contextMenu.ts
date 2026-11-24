// Right-click context menu inside the editor. When the cursor is sitting
// inside a recognized table, exposes row / column / merge / align / format
// actions; otherwise still offers the table-editor entry points (open grid
// editor, insert new table, paste from clipboard).

import { Editor, MarkdownView, Menu } from "obsidian";
import type TableMasterPlugin from "../main";
import { locateTable } from "../editor/tableLocator";
import * as actions from "../editor/actions";
import { t } from "../i18n";

/**
 * Return true when the editor has an active selection that covers more than
 * one logical table cell. Both endpoints must resolve to (row, col) inside
 * the same table block. This is what `actions.mergeSelection` operates on.
 */
export function hasMultiCellSelection(editor: Editor): boolean {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  if (from.line === to.line && from.ch === to.ch) return false;
  const a = locateTable(editor, from);
  const b = locateTable(editor, to);
  if (!a || !b) return false;
  if (a.startLine !== b.startLine) return false;
  if (a.row < 0 || b.row < 0) return false;
  return a.row !== b.row || a.col !== b.col;
}

export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/**
 * Append the in-table action items to a Menu. Caller has already verified
 * that the editor's cursor is sitting inside a recognized table.
 *
 * `widgetRange` is an optional rectangular cell selection coming from
 * Obsidian's Live Preview table widget (whose visual cell selection isn't
 * reflected in the editor's text selection). When supplied, the menu
 * uses it to enable "Merge selected cells".
 */
export function addInTableMenuItems(
  plugin: TableMasterPlugin,
  editor: Editor,
  menu: Menu,
  widgetRange?: CellRange,
): void {
  const ctx: actions.ActionContext = {
    editor,
    format: plugin.settings.outputFormat,
  };

  menu.addSeparator();

  menu.addItem((i) => i.setTitle(t("cmd.insertRowAbove")).setIcon("arrow-up").onClick(() => actions.insertRowAbove(ctx)));
  menu.addItem((i) => i.setTitle(t("cmd.insertRowBelow")).setIcon("arrow-down").onClick(() => actions.insertRowBelow(ctx)));
  menu.addItem((i) => i.setTitle(t("cmd.insertColLeft")).setIcon("arrow-left").onClick(() => actions.insertColLeft(ctx)));
  menu.addItem((i) => i.setTitle(t("cmd.insertColRight")).setIcon("arrow-right").onClick(() => actions.insertColRight(ctx)));
  menu.addItem((i) => i.setTitle(t("cmd.deleteRow")).setIcon("trash").onClick(() => actions.deleteRow(ctx)));
  menu.addItem((i) => i.setTitle(t("cmd.deleteCol")).setIcon("trash-2").onClick(() => actions.deleteCol(ctx)));

  menu.addSeparator();

  // Prefer the widget's visual selection (Live Preview) when supplied;
  // otherwise fall back to the editor's text selection.
  if (widgetRange) {
    const { r1, c1, r2, c2 } = widgetRange;
    menu.addItem((i) =>
      i
        .setTitle(t("cmd.mergeSelection"))
        .setIcon("table-cells-merge")
        .onClick(() => actions.mergeCellRange(ctx, r1, c1, r2, c2)),
    );
  } else if (hasMultiCellSelection(editor)) {
    menu.addItem((i) =>
      i
        .setTitle(t("cmd.mergeSelection"))
        .setIcon("table-cells-merge")
        .onClick(() => actions.mergeSelection(ctx)),
    );
  }

  menu.addItem((i) => i.setTitle(t("cmd.splitCell")).setIcon("scissors").onClick(() => actions.splitCell(ctx)));

  menu.addSeparator();

  menu.addItem((i) => i.setTitle(t("cmd.alignLeft")).setIcon("align-left").onClick(() => actions.alignColumn(ctx, "left")));
  menu.addItem((i) => i.setTitle(t("cmd.alignCenter")).setIcon("align-center").onClick(() => actions.alignColumn(ctx, "center")));
  menu.addItem((i) => i.setTitle(t("cmd.alignRight")).setIcon("align-right").onClick(() => actions.alignColumn(ctx, "right")));

  menu.addSeparator();
  menu.addItem((i) => i.setTitle(t("cmd.openGridEditor")).setIcon("grid").onClick(() => plugin.openGridEditor()));
  menu.addItem((i) => i.setTitle(t("cmd.formatTable")).setIcon("text").onClick(() => actions.formatTable(ctx)));
  menu.addItem((i) => i.setTitle(t("cmd.transposeTable")).setIcon("arrow-left-right").onClick(() => actions.transposeTable(ctx)));
}

/** Append the not-in-table fallback entries (open grid editor / paste). */
export function addOutOfTableMenuItems(plugin: TableMasterPlugin, menu: Menu): void {
  menu.addSeparator();
  menu.addItem((i) =>
    i
      .setTitle(t("cmd.openGridEditor"))
      .setIcon("grid")
      .onClick(() => plugin.openGridEditor()),
  );
  menu.addItem((i) =>
    i
      .setTitle(t("cmd.importTable"))
      .setIcon("clipboard-paste")
      .onClick(() => void plugin.importTableFromClipboard()),
  );
}

export function registerContextMenu(plugin: TableMasterPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
      void view;
      const loc = locateTable(editor);
      if (!loc) {
        addOutOfTableMenuItems(plugin, menu);
        return;
      }
      addInTableMenuItems(plugin, editor, menu);
    }),
  );
}
