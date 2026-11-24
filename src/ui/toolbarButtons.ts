import type TableMasterPlugin from "../main";
import { Icons } from "./icons";
import { t } from "../i18n";
import * as actions from "../editor/actions";
import { getActionContext } from "../editor/contextHelper";

interface ToolbarItem {
  icon: string;
  tip: string;
  run: () => void;
  requiresTable?: boolean;
}

export function appendSvgIcon(parent: HTMLElement, icon: string): void {
  const parsedIcon = new DOMParser().parseFromString(icon, "image/svg+xml");
  const iconEl = parsedIcon.documentElement;
  if (iconEl && iconEl.nodeName.toLowerCase() === "svg") {
    parent.appendChild(iconEl);
  }
}

export function renderToolbar(content: HTMLElement, plugin: TableMasterPlugin): void {
  const act = (fn: (ctx: actions.ActionContext) => void) => {
    const ctx = getActionContext(plugin.app, plugin);
    if (ctx) fn(ctx);
  };
  const groups: ToolbarItem[][] = [
    [
      { icon: Icons.rowAbove, tip: t("tip.insertRowAbove"), run: () => act(actions.insertRowAbove) },
      { icon: Icons.rowBelow, tip: t("tip.insertRowBelow"), run: () => act(actions.insertRowBelow) },
      { icon: Icons.colLeft, tip: t("tip.insertColLeft"), run: () => act(actions.insertColLeft) },
      { icon: Icons.colRight, tip: t("tip.insertColRight"), run: () => act(actions.insertColRight) },
      { icon: Icons.delRow, tip: t("tip.deleteRow"), run: () => act(actions.deleteRow) },
      { icon: Icons.delCol, tip: t("tip.deleteCol"), run: () => act(actions.deleteCol) },
    ],
    [
      { icon: Icons.moveUp, tip: t("tip.moveRowUp"), run: () => act(actions.moveRowUp) },
      { icon: Icons.moveDown, tip: t("tip.moveRowDown"), run: () => act(actions.moveRowDown) },
      { icon: Icons.moveLeft, tip: t("tip.moveColLeft"), run: () => act(actions.moveColLeft) },
      { icon: Icons.moveRight, tip: t("tip.moveColRight"), run: () => act(actions.moveColRight) },
    ],
    [
      { icon: Icons.alignLeft, tip: t("tip.alignLeft"), run: () => act((c) => actions.alignColumn(c, "left")) },
      { icon: Icons.alignCenter, tip: t("tip.alignCenter"), run: () => act((c) => actions.alignColumn(c, "center")) },
      { icon: Icons.alignRight, tip: t("tip.alignRight"), run: () => act((c) => actions.alignColumn(c, "right")) },
    ],
    [
      {
        icon: Icons.mergeSelection,
        tip: t("tip.mergeSelection"),
        run: () => plugin.mergeSelectedCells(),
      },
      { icon: Icons.mergeUp, tip: t("tip.mergeUp"), run: () => act(actions.mergeUp) },
      { icon: Icons.mergeDown, tip: t("tip.mergeDown"), run: () => act(actions.mergeDown) },
      { icon: Icons.mergeLeft, tip: t("tip.mergeLeft"), run: () => act(actions.mergeLeft) },
      { icon: Icons.split, tip: t("tip.split"), run: () => act(actions.splitCell) },
    ],
    [
      { requiresTable: false, icon: Icons.grid, tip: t("tip.gridEditor"), run: () => plugin.openGridEditor() },
      { icon: Icons.format, tip: t("tip.format"), run: () => act(actions.formatTable) },
      {
        requiresTable: false,
        icon: Icons.importTable,
        tip: t("tip.importTable"),
        run: () => void plugin.importTableFromClipboard(),
      },
    ],
  ];

  for (const group of groups) {
    const g = content.createDiv({ cls: "tm-group" });
    for (const item of group) {
      const btn = g.createEl("button", { cls: "tm-btn" });
      btn.dataset.requiresTable = String(item.requiresTable !== false);
      btn.setAttribute("aria-label", item.tip);
      btn.title = item.tip;
      appendSvgIcon(btn, item.icon);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.run();
      });
    }
  }

}
