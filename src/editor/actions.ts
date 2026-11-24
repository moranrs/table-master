// Centralized editor-level actions. Each action loads the table at the cursor,
// mutates the model with a pure ops function, then writes the new markdown back
// to the editor and restores cursor at the appropriate position.

import { Editor, Notice } from "obsidian";
import { locateTable, TableLocation } from "./tableLocator";
import { isSeparatorLine, parseTable } from "../table/parser";
import { serialize, OutputFormat } from "../table/serializer";
import { TableModel, anchorOf, emptyModel } from "../table/model";
import * as ops from "../table/ops";
import { importHtmlTable } from "../table/htmlImporter";
import { importTsvTable } from "../table/tsvImporter";
import { t } from "../i18n";

export interface ActionContext {
  editor: Editor;
  format: OutputFormat;
}

interface ResolvedLocation extends TableLocation {
  model: TableModel;
}

function resolve(editor: Editor): ResolvedLocation | null {
  const loc = locateTable(editor);
  if (!loc) {
    new Notice(t("notice.notInTable"));
    return null;
  }
  let model: TableModel;
  try {
    model = parseTable(loc.text).model;
  } catch {
    new Notice(t("notice.notInTable"));
    return null;
  }
  return { ...loc, model };
}

function applyModel(ctx: ActionContext, loc: TableLocation, newModel: TableModel, opts?: { row?: number; col?: number }): void {
  const text = serialize(newModel, ctx.format);
  const r = opts?.row ?? loc.row;
  const c = opts?.col ?? loc.col;
  // Compute the target cursor *before* mutating the document so we can submit
  // the change + selection in a single editor.transaction(). Using the
  // single-shot transaction is essential for scroll stability: the previous
  // implementation called `replaceRange` followed by `setCursor`, and
  // Obsidian's setCursor dispatches a CM6 transaction with `scrollIntoView:
  // true`. Because that scroll happens asynchronously on the next frame, a
  // synchronous `editor.scrollTo(…)` afterwards gets clobbered — the user
  // saw the scrollbar snap to the bottom of the (large) table even though
  // the row was inserted at the right place. Combining the change and the
  // selection in one transaction avoids the auto-scroll entirely.
  const cursor = r >= 0 && c >= 0 ? computeCursorPos(text, loc.startLine, r, c) : null;
  ctx.editor.transaction({
    changes: [
      {
        from: { line: loc.startLine, ch: 0 },
        to: { line: loc.endLine, ch: ctx.editor.getLine(loc.endLine).length },
        text,
      },
    ],
    selection: cursor ? { from: cursor, to: cursor } : undefined,
  });
}

/**
 * Compute the absolute editor position {line, ch} of the first non-pipe,
 * non-space character of the (row, col) cell within the freshly-serialized
 * `text`. Returns `null` for HTML output or when the cell can't be located.
 */
function computeCursorPos(
  text: string,
  startLine: number,
  row: number,
  col: number,
): { line: number; ch: number } | null {
  if (text.startsWith("<table")) return null; // HTML output, can't place per-cell.
  const lines = text.split("\n");
  // Walk the serialized text and count logical rows, skipping the caption,
  // separator and blank tbody-break lines so the new MultiMarkdown layout maps
  // back to the original cell coordinates.
  let logical = -1;
  let lineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isSeparatorLine(line)) continue;
    if (line.trim() === "") continue;
    if (/^\s*\[[^\]]+\](?:\s*\[[^\]]+\])?\s*$/.test(line)) continue;
    logical++;
    if (logical === row) {
      lineIdx = i;
      break;
    }
  }
  if (lineIdx < 0) return null;
  const line = lines[lineIdx];
  let pipes = 0;
  let pos = 0;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      escaped = !escaped;
      continue;
    }
    if (ch === "|" && !escaped) {
      pipes++;
      if (pipes === col + 1) {
        pos = i + 1;
        while (pos < line.length && line[pos] === " ") pos++;
        break;
      }
    }
    escaped = false;
  }
  return { line: startLine + lineIdx, ch: pos };
}

// ===== Public actions =====

export function insertRowAbove(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const r = Math.max(loc.row, 0);
  const m = ops.insertRow(loc.model, r, "above");
  applyModel(ctx, loc, m, { row: Math.max(r, 1), col: loc.col });
}

export function insertRowBelow(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const r = Math.max(loc.row, 0);
  const m = ops.insertRow(loc.model, r, "below");
  applyModel(ctx, loc, m, { row: r + 1, col: loc.col });
}

export function insertColLeft(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.insertCol(loc.model, loc.col, "left");
  applyModel(ctx, loc, m, { row: loc.row, col: loc.col });
}

export function insertColRight(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.insertCol(loc.model, loc.col, "right");
  applyModel(ctx, loc, m, { row: loc.row, col: loc.col + 1 });
}

export function deleteRow(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.deleteRow(loc.model, loc.row);
  applyModel(ctx, loc, m, { row: Math.max(1, loc.row - 1), col: loc.col });
}

export function deleteCol(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.deleteCol(loc.model, loc.col);
  applyModel(ctx, loc, m, { row: loc.row, col: Math.max(0, loc.col - 1) });
}

export function moveRowUp(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.moveRow(loc.model, loc.row, "up");
  applyModel(ctx, loc, m, { row: Math.max(1, loc.row - 1), col: loc.col });
}

export function moveRowDown(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.moveRow(loc.model, loc.row, "down");
  applyModel(ctx, loc, m, { row: loc.row + 1, col: loc.col });
}

export function moveColLeft(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.moveCol(loc.model, loc.col, "left");
  applyModel(ctx, loc, m, { row: loc.row, col: Math.max(0, loc.col - 1) });
}

export function moveColRight(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.moveCol(loc.model, loc.col, "right");
  applyModel(ctx, loc, m, { row: loc.row, col: loc.col + 1 });
}

export function alignColumn(ctx: ActionContext, align: "left" | "center" | "right" | "none"): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.setColAlign(loc.model, loc.col, align);
  applyModel(ctx, loc, m);
}

export function mergeUp(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc || loc.row <= 0) return;
  // Use anchor of cell above
  const above = anchorOf(loc.model, loc.row - 1, loc.col);
  const cur = anchorOf(loc.model, loc.row, loc.col);
  if (above.r === cur.r) return; // already merged
  const m = ops.mergeRange(loc.model, above.r, Math.min(above.c, cur.c), loc.row, Math.max(above.c + (loc.model.rows[above.r][above.c].colspan - 1), cur.c));
  applyModel(ctx, loc, m, { row: above.r, col: above.c });
}

/**
 * Merge the current cell with the cell immediately below it. Anchor stays at
 * the upper cell — i.e. inverse of `mergeUp` — so the user keeps editing the
 * cell they were in. The serializer always anchors at the top-left and emits
 * `^^` for the bottom row, matching MultiMarkdown semantics.
 */
export function mergeDown(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  if (loc.row >= loc.model.rows.length - 1) return;
  const cur = anchorOf(loc.model, loc.row, loc.col);
  const below = anchorOf(loc.model, loc.row + 1, loc.col);
  if (cur.r === below.r) return; // already in the same merge region.
  const curAnchor = loc.model.rows[cur.r][cur.c];
  const belowAnchor = loc.model.rows[below.r][below.c];
  const m = ops.mergeRange(
    loc.model,
    cur.r,
    Math.min(cur.c, below.c),
    below.r + belowAnchor.rowspan - 1,
    Math.max(cur.c + curAnchor.colspan - 1, below.c + belowAnchor.colspan - 1),
  );
  applyModel(ctx, loc, m, { row: cur.r, col: cur.c });
}

export function mergeLeft(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc || loc.col <= 0) return;
  const left = anchorOf(loc.model, loc.row, loc.col - 1);
  const cur = anchorOf(loc.model, loc.row, loc.col);
  if (left.c === cur.c) return;
  const leftAnchor = loc.model.rows[left.r][left.c];
  const m = ops.mergeRange(
    loc.model,
    Math.min(left.r, cur.r),
    left.c,
    Math.max(left.r + leftAnchor.rowspan - 1, cur.r),
    loc.col,
  );
  applyModel(ctx, loc, m, { row: left.r, col: left.c });
}

/**
 * Merge the rectangular region spanned by the editor's current selection.
 * Both the selection start and end must be inside the same table.
 */
export function mergeSelection(ctx: ActionContext): void {
  const from = ctx.editor.getCursor("from");
  const to = ctx.editor.getCursor("to");
  const loc = locateTable(ctx.editor, from);
  if (!loc) {
    new Notice(t("notice.notInTable"));
    return;
  }
  // Resolve the "to" position to (row, col) within the same table block
  const locTo = locateTable(ctx.editor, to);
  if (!locTo || locTo.startLine !== loc.startLine) {
    new Notice(t("notice.notInTable"));
    return;
  }
  let model: TableModel;
  try {
    model = parseTable(loc.text).model;
  } catch {
    new Notice(t("notice.notInTable"));
    return;
  }
  const r1 = loc.row;
  const c1 = loc.col;
  const r2 = locTo.row;
  const c2 = locTo.col;
  if (r1 < 0 || r2 < 0) return;
  if (r1 === r2 && c1 === c2) {
    new Notice(t("notice.invalidMerge"));
    return;
  }
  const m = ops.mergeRange(model, r1, c1, r2, c2);
  if (m === model) {
    new Notice(t("notice.invalidMerge"));
    return;
  }
  const topR = Math.min(r1, r2);
  const topC = Math.min(c1, c2);
  applyModel(ctx, loc, m, { row: topR, col: topC });
}

/**
 * Merge a rectangular range of cells identified by explicit (row, col)
 * bounds. Used by the Live Preview right-click interceptor where the
 * selection comes from Obsidian's table widget DOM rather than from the
 * editor's text selection.
 */
export function mergeCellRange(
  ctx: ActionContext,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  if (r1 === r2 && c1 === c2) {
    new Notice(t("notice.invalidMerge"));
    return;
  }
  const m = ops.mergeRange(loc.model, r1, c1, r2, c2);
  if (m === loc.model) {
    new Notice(t("notice.invalidMerge"));
    return;
  }
  applyModel(ctx, loc, m, { row: Math.min(r1, r2), col: Math.min(c1, c2) });
}

export function splitCell(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.splitCell(loc.model, loc.row, loc.col);
  applyModel(ctx, loc, m);
}

export function formatTable(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  // Re-serializing already pads columns; just write back
  applyModel(ctx, loc, loc.model);
}

export function sort(ctx: ActionContext, dir: "asc" | "desc"): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const r = ops.sortByCol(loc.model, loc.col, dir);
  if (!r.ok) {
    new Notice(t("notice.sortBlockedByMerge"));
    return;
  }
  applyModel(ctx, loc, r.model);
}

/** Transpose the table at the cursor (swap rows and columns). */
export function transposeTable(ctx: ActionContext): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  const m = ops.transpose(loc.model);
  applyModel(ctx, loc, m, { row: 0, col: 0 });
}

/** Replace the current table block with a new model produced elsewhere. */
export function replaceTable(ctx: ActionContext, newModel: TableModel): void {
  const loc = resolve(ctx.editor);
  if (!loc) return;
  applyModel(ctx, loc, newModel);
}

/** Insert a brand-new empty table at the cursor. */
export function insertNewTable(ctx: ActionContext, rows: number, cols: number, hasHeader = true): void {
  const empty = emptyModel(rows, cols);
  if (!hasHeader) empty.headerRows = 0;
  insertModelAtCursor(ctx, empty);
}

/** Serialize an arbitrary model and drop it at the cursor. */
export function insertModelAtCursor(ctx: ActionContext, model: TableModel): void {
  const text = serialize(model, ctx.format);
  const cursor = ctx.editor.getCursor();
  const line = ctx.editor.getLine(cursor.line) ?? "";
  // Ensure the new table starts on its own line.
  const prefix = line.trim() === "" ? "" : "\n";
  ctx.editor.replaceRange(`${prefix}${text}\n`, cursor);
}

/**
 * Read the system clipboard for an Excel / web table (HTML or TSV) and insert
 * the converted markdown at the cursor. If the cursor is currently inside a
 * table we replace that table instead so re-importing is non-destructive.
 *
 * Returns a tuple describing what was inserted, or null on failure.
 */
export async function importTableFromClipboard(
  ctx: ActionContext,
): Promise<{ source: "html" | "tsv"; replaced: boolean } | null> {
  const payload = await readClipboardPayload();
  if (!payload) return null;

  let model: TableModel | null = null;
  let source: "html" | "tsv" = "tsv";
  if (payload.html) {
    model = importHtmlTable(payload.html);
    if (model) source = "html";
  }
  if (!model && payload.text) {
    model = importTsvTable(payload.text);
    if (model) source = "tsv";
  }
  if (!model) return null;

  const loc = locateTable(ctx.editor);
  if (loc) {
    applyModel(ctx, loc, model, { row: 0, col: 0 });
    return { source, replaced: true };
  }
  insertModelAtCursor(ctx, model);
  return { source, replaced: false };
}

interface ClipboardPayload {
  html?: string;
  text?: string;
}

async function readClipboardPayload(): Promise<ClipboardPayload | null> {
  // Modern path: navigator.clipboard.read() exposes both text/html and text/plain.
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (nav && "clipboard" in nav && typeof (nav.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> }).read === "function") {
    try {
      const items = await nav.clipboard.read();
      const out: ClipboardPayload = {};
      for (const item of items) {
        if (item.types.includes("text/html") && !out.html) {
          const blob = await item.getType("text/html");
          out.html = await blob.text();
        }
        if (item.types.includes("text/plain") && !out.text) {
          const blob = await item.getType("text/plain");
          out.text = await blob.text();
        }
      }
      if (out.html || out.text) return out;
    } catch {
      // Permission denied or unsupported MIME; fall through to readText.
    }
  }
  // Fallback: text-only clipboard (loses Excel HTML envelope but TSV still works).
  if (nav && nav.clipboard && typeof nav.clipboard.readText === "function") {
    try {
      const text = await nav.clipboard.readText();
      return text ? { text } : null;
    } catch {
      return null;
    }
  }
  return null;
}
