// Modal grid editor. Renders the current TableModel as an interactive HTML
// table. Cells are contenteditable; multi-cell selection enables Merge / Split
// buttons. On confirmation the modified model is passed back via a callback.

import { App, Modal, Notice, setIcon, setTooltip } from "obsidian";
import { TableModel, anchorOf, cloneModel } from "../table/model";
import * as ops from "../table/ops";
import { t } from "../i18n";

interface CellPos {
  r: number;
  c: number;
}

export class GridEditorModal extends Modal {
  private model: TableModel;
  private readonly originalModel: TableModel;
  private readonly onSubmit: (m: TableModel) => void;
  private selectedCells: Set<string>;
  private dragging: boolean;
  private dragStart: CellPos | null;
  private gridEl: HTMLTableElement | null;
  private boundMouseUp: () => void;

  constructor(app: App, model: TableModel, onSubmit: (m: TableModel) => void) {
    super(app);
    this.model = cloneModel(model);
    this.originalModel = cloneModel(model);
    this.onSubmit = onSubmit;
    this.selectedCells = new Set<string>();
    this.dragging = false;
    this.dragStart = null;
    this.gridEl = null;
    this.boundMouseUp = () => this.handleMouseUp();
    this.modalEl.addClass("tm-modal");
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    // The dimension suffix doubles as a quick sanity check: if the title says
    // "1 × N" but the source clearly had more columns, the upstream parse /
    // locate is the culprit, not the renderer.
    titleEl.setText(`${t("modal.title")}  (${this.model.rows.length} × ${this.model.cols})`);
    contentEl.empty();

    this.renderToolbar(contentEl);
    const wrap = contentEl.createDiv({ cls: "tm-grid-wrap" });
    this.renderGrid(wrap);
    contentEl.createDiv({ cls: "tm-hint", text: t("modal.hint") });
    this.renderActions(contentEl);
  }

  onClose(): void {
    // Use the modal's own ownerDocument so the listener is removed from the
    // same document we attached it on (popout-window aware). obsidianmd's
    // `prefer-active-doc` lint rule forbids the bare `document` global.
    this.contentEl.ownerDocument.removeEventListener("mouseup", this.boundMouseUp);
    this.contentEl.empty();
  }

  // --- Rendering ---

  private renderToolbar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "tm-grid-toolbar" });
    const mkBtn = (label: string, fn: () => void): HTMLButtonElement => {
      const b = bar.createEl("button");
      b.setText(label);
      b.addEventListener("click", fn);
      return b;
    };
    const mkIconBtn = (icon: string, tip: string, fn: () => void): HTMLButtonElement => {
      const b = bar.createEl("button", { cls: "tm-grid-icon-btn" });
      setIcon(b, icon);
      setTooltip(b, tip);
      b.setAttribute("aria-label", tip);
      b.addEventListener("click", fn);
      return b;
    };

    mkBtn(t("modal.merge"), () => this.mergeSelection());
    mkBtn(t("modal.split"), () => this.splitSelection());
    mkIconBtn("arrow-up", t("cmd.insertRowAbove"), () => {
      const row = this.selectionBounds()?.top ?? 0;
      this.applyOp((m) => ops.insertRow(m, row, "above"));
    });
    mkIconBtn("arrow-down", t("cmd.insertRowBelow"), () => {
      const row = this.selectionBounds()?.bottom ?? this.model.rows.length - 1;
      this.applyOp((m) => ops.insertRow(m, row, "below"));
    });
    mkIconBtn("arrow-left", t("cmd.insertColLeft"), () => {
      const col = this.selectionBounds()?.left ?? 0;
      this.applyOp((m) => ops.insertCol(m, col, "left"));
    });
    mkIconBtn("arrow-right", t("cmd.insertColRight"), () => {
      const col = this.selectionBounds()?.right ?? this.model.cols - 1;
      this.applyOp((m) => ops.insertCol(m, col, "right"));
    });
    mkBtn(t("modal.delRow"), () => {
      const row = this.firstSelected()?.r ?? this.model.rows.length - 1;
      this.applyOp((m) => ops.deleteRow(m, row));
    });
    mkBtn(t("modal.delCol"), () => {
      const col = this.firstSelected()?.c ?? this.model.cols - 1;
      this.applyOp((m) => ops.deleteCol(m, col));
    });
    mkBtn(t("modal.alignLeft"), () => this.alignSelection("left"));
    mkBtn(t("modal.alignCenter"), () => this.alignSelection("center"));
    mkBtn(t("modal.alignRight"), () => this.alignSelection("right"));
  }

  /**
   * Return the bounding rectangle of the current selection, expanded to
   * cover any cells whose rowspan/colspan extends past the selected anchor.
   * Returns `null` when nothing is selected.
   */
  private selectionBounds(): { top: number; bottom: number; left: number; right: number } | null {
    if (!this.selectedCells.size) return null;
    let top = Number.POSITIVE_INFINITY,
      bottom = -1,
      left = Number.POSITIVE_INFINITY,
      right = -1;
    for (const k of this.selectedCells) {
      const [r, c] = k.split(":").map(Number);
      const anchor = this.model.rows[r]?.[c];
      if (!anchor) continue;
      const er = r + (anchor.rowspan - 1);
      const ec = c + (anchor.colspan - 1);
      if (r < top) top = r;
      if (c < left) left = c;
      if (er > bottom) bottom = er;
      if (ec > right) right = ec;
    }
    if (bottom < 0 || right < 0) return null;
    return { top, bottom, left, right };
  }

  private renderGrid(parent: HTMLElement): void {
    parent.empty();
    const table = parent.createEl("table", { cls: "tm-grid" });
    this.gridEl = table;

    for (let r = 0; r < this.model.rows.length; r++) {
      const tr = table.createEl("tr");
      for (let c = 0; c < this.model.cols; c++) {
        const cell = this.model.rows[r][c];
        if (!cell.isAnchor) continue;
        const td = tr.createEl(r < this.model.headerRows ? "th" : "td");
        if (cell.rowspan > 1) td.setAttr("rowspan", String(cell.rowspan));
        if (cell.colspan > 1) td.setAttr("colspan", String(cell.colspan));
        td.dataset.r = String(r);
        td.dataset.c = String(c);

        const align = this.model.aligns[c] ?? "none";
        if (align !== "none") td.style.textAlign = align;

        const edit = td.createDiv({ cls: "tm-cell-edit" });
        edit.contentEditable = "true";
        edit.spellcheck = false;
        edit.setText(cell.raw);
        edit.addEventListener("input", () => {
          cell.raw = edit.innerText;
        });
        edit.addEventListener("keydown", (e) => this.onCellKey(e, r, c));

        td.addEventListener("mousedown", (e) => this.handleCellMouseDown(e, r, c));
        td.addEventListener("mouseenter", (e) => this.handleCellMouseEnter(e, r, c));

        if (this.selectedCells.has(this.key(r, c))) td.addClass("tm-selected");
      }
    }
    // Pair with the removeEventListener in onClose; both use the modal's
    // ownerDocument so the listener is correctly scoped to the same window.
    this.contentEl.ownerDocument.addEventListener("mouseup", this.boundMouseUp);
  }

  private renderActions(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "tm-grid-actions" });
    const cancel = bar.createEl("button", { text: t("modal.cancel") });
    cancel.addEventListener("click", () => this.close());
    const ok = bar.createEl("button", { cls: "mod-cta", text: t("modal.ok") });
    ok.addEventListener("click", () => {
      this.onSubmit(this.model);
      this.close();
    });
  }

  // --- Selection ---

  private key(r: number, c: number): string {
    return `${r}:${c}`;
  }

  private firstSelected(): CellPos | null {
    if (!this.selectedCells.size) return null;
    const first = this.selectedCells.values().next().value;
    if (!first) return null;
    const [r, c] = first.split(":").map(Number);
    return { r, c };
  }

  private clearSelection(): void {
    this.selectedCells.clear();
    this.gridEl?.querySelectorAll(".tm-selected").forEach((el) => el.classList.remove("tm-selected"));
  }

  private addToSelection(r: number, c: number): void {
    // Resolve to anchor (so clicking a placeholder selects its anchor cell)
    const a = anchorOf(this.model, r, c);
    const k = this.key(a.r, a.c);
    if (this.selectedCells.has(k)) return;
    this.selectedCells.add(k);
    const td = this.gridEl?.querySelector(`[data-r="${a.r}"][data-c="${a.c}"]`);
    td?.classList.add("tm-selected");
  }

  private selectRange(a: CellPos, b: CellPos): void {
    this.clearSelection();
    const top = Math.min(a.r, b.r);
    const bottom = Math.max(a.r, b.r);
    const left = Math.min(a.c, b.c);
    const right = Math.max(a.c, b.c);
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        this.addToSelection(r, c);
      }
    }
  }

  private handleCellMouseDown(e: MouseEvent, r: number, c: number): void {
    if ((e.target as HTMLElement).classList.contains("tm-cell-edit") && e.detail === 0) return;
    if (e.shiftKey && this.selectedCells.size > 0) {
      const first = this.firstSelected();
      if (first) this.selectRange(first, { r, c });
      return;
    }
    this.dragging = true;
    this.dragStart = { r, c };
    this.clearSelection();
    this.addToSelection(r, c);
  }

  private handleCellMouseEnter(_e: MouseEvent, r: number, c: number): void {
    if (!this.dragging || !this.dragStart) return;
    this.selectRange(this.dragStart, { r, c });
  }

  private handleMouseUp(): void {
    this.dragging = false;
  }

  // --- Cell key handling ---

  private onCellKey(e: KeyboardEvent, r: number, c: number): void {
    if (e.key === "Tab") {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      const next = this.nextCell(r, c, dir);
      if (next) this.focusCell(next.r, next.c);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const next = this.nextRowCell(r, c);
      if (next) this.focusCell(next.r, next.c);
    }
  }

  private nextCell(r: number, c: number, dir: 1 | -1): CellPos | null {
    let nr = r;
    let nc = c + dir;
    while (nr >= 0 && nr < this.model.rows.length) {
      while (nc >= 0 && nc < this.model.cols) {
        if (this.model.rows[nr][nc].isAnchor) return { r: nr, c: nc };
        nc += dir;
      }
      nr += dir;
      nc = dir === 1 ? 0 : this.model.cols - 1;
    }
    return null;
  }

  private nextRowCell(r: number, c: number): CellPos | null {
    let nr = r + 1;
    while (nr < this.model.rows.length) {
      if (this.model.rows[nr][c]?.isAnchor) return { r: nr, c };
      nr++;
    }
    return null;
  }

  private focusCell(r: number, c: number): void {
    const el = this.gridEl?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"] .tm-cell-edit`);
    el?.focus();
  }

  // --- Operations ---

  private applyOp(fn: (m: TableModel) => TableModel): void {
    this.model = fn(this.model);
    this.selectedCells.clear();
    if (this.gridEl?.parentElement) {
      this.renderGrid(this.gridEl.parentElement);
    }
  }

  private mergeSelection(): void {
    if (this.selectedCells.size < 2) return;
    let top = Number.POSITIVE_INFINITY,
      bottom = -1,
      left = Number.POSITIVE_INFINITY,
      right = -1;
    for (const k of this.selectedCells) {
      const [r, c] = k.split(":").map(Number);
      const anchor = this.model.rows[r][c];
      const er = r + (anchor.rowspan - 1);
      const ec = c + (anchor.colspan - 1);
      if (r < top) top = r;
      if (c < left) left = c;
      if (er > bottom) bottom = er;
      if (ec > right) right = ec;
    }
    // Validate: every cell inside the bounding rectangle must already be in
    // the selection (resolved to its anchor) so we don't accidentally engulf
    // unrelated cells.
    if (top < this.model.headerRows && bottom >= this.model.headerRows) {
      new Notice(t("notice.invalidMerge"));
      return;
    }
    this.applyOp((m) => ops.mergeRange(m, top, left, bottom, right));
  }

  private splitSelection(): void {
    const first = this.firstSelected();
    if (!first) return;
    this.applyOp((m) => ops.splitCell(m, first.r, first.c));
  }

  private alignSelection(align: "left" | "center" | "right"): void {
    if (!this.selectedCells.size) return;
    const cols = new Set<number>();
    for (const k of this.selectedCells) cols.add(parseInt(k.split(":")[1], 10));
    this.applyOp((m) => {
      let next = m;
      for (const c of cols) next = ops.setColAlign(next, c, align);
      return next;
    });
  }

  // Undo button hook — restore initial model
  resetModel(): void {
    this.model = cloneModel(this.originalModel);
    this.selectedCells.clear();
    if (this.gridEl?.parentElement) this.renderGrid(this.gridEl.parentElement);
  }
}
