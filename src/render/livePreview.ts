// Live Preview merge renderer.
//
// Obsidian renders tables in Live Preview through a CodeMirror widget. We
// previously re-rendered the entire `<table>` (innerHTML wipe + async
// MarkdownRenderer.render), which confused CodeMirror: as soon as the user
// typed inside the table, CM6 decided the widget had been mutated under it
// and fell back to rendering the raw source as cm-line text — the table
// visibly "lost" its formatting.
//
// The lightweight strategy below avoids that by limiting our DOM mutations
// to attribute toggles and a single `display: none` on placeholder cells.
// Cell text is left untouched, no async work is scheduled, so the widget
// stays in a state CM6 considers consistent.

import { EditorView, ViewPlugin, ViewUpdate, PluginValue } from "@codemirror/view";
import { isSeparatorLine, looksLikeDelimitedTableLine, looksLikeTableLine, parseTable } from "../table/parser";
import type { TableModel } from "../table/model";

export function buildLivePreviewExt() {
  return ViewPlugin.fromClass(
    class implements PluginValue {
      view: EditorView;
      timer: number | null = null;

      constructor(view: EditorView) {
        this.view = view;
        this.schedule();
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.geometryChanged) this.schedule();
      }

      destroy() {
        if (this.timer != null) {
          // Use the editor's own window so the timer is cleared in popout
          // windows too. Bare `window` would only resolve to the main window
          // and trip obsidianmd's `prefer-active-doc` lint rule.
          const win = this.view.dom.ownerDocument.defaultView ?? activeWindow;
          win.clearTimeout(this.timer);
          this.timer = null;
        }
      }

      private schedule() {
        if (this.timer != null) return;
        const win = this.view.dom.ownerDocument.defaultView ?? activeWindow;
        this.timer = win.setTimeout(() => {
          this.timer = null;
          this.run();
        }, 50);
      }

      private run() {
        const tables = Array.from(this.view.dom.querySelectorAll<HTMLTableElement>("table"));
        if (!tables.length) return;
        const docLines = this.view.state.doc.toString().split(/\r?\n/);
        const sources = collectTableSources(docLines);
        if (!sources.length) return;
        // Match each rendered <table> to the source block that produced it by
        // mapping the table's DOM position back to a document line. Matching by
        // index would break as soon as CodeMirror unmounts off-screen widgets:
        // when only some tables are in the viewport, the surviving DOM tables
        // would otherwise be paired with the wrong source blocks (causing the
        // "merge style breaks when scrolled" symptom on long ^^ chains).
        for (const table of tables) {
          if (!table.isConnected) continue;
          const source = this.findSourceFor(table, sources);
          if (!source) continue;
          try {
            const { model } = parseTable(source.text);
            applyMergesInPlace(table, model);
          } catch {
            // Skip malformed tables silently.
          }
        }
      }

      private findSourceFor(
        table: HTMLTableElement,
        sources: TableSource[],
      ): TableSource | null {
        let pos: number;
        try {
          pos = this.view.posAtDOM(table);
        } catch {
          return null;
        }
        const line = this.view.state.doc.lineAt(Math.max(0, Math.min(pos, this.view.state.doc.length))).number - 1;
        // Pick the source block whose 0-indexed line range contains `line`,
        // falling back to the closest preceding block when the widget anchors
        // slightly outside its source range.
        let best: TableSource | null = null;
        for (const src of sources) {
          if (line >= src.fromLine && line <= src.toLine) return src;
          if (line >= src.fromLine && (!best || src.fromLine > best.fromLine)) best = src;
        }
        return best;
      }
    },
  );
}

/**
 * Apply the model's merge structure to an already-rendered `<table>` without
 * touching cell content. Anchor cells receive their `rowspan` / `colspan`
 * attributes; placeholder cells are visually removed via the
 * `.tm-merge-placeholder` CSS class so the row/column geometry collapses
 * around them.
 */
function modelHasMerges(model: TableModel): boolean {
  for (const row of model.rows) {
    for (const cell of row) {
      if (!cell.isAnchor) return true;
      if (cell.rowspan > 1 || cell.colspan > 1) return true;
    }
  }
  return false;
}

function applyMergesInPlace(table: HTMLTableElement, model: TableModel): void {
  if (!modelHasMerges(model)) {
    // No merges — clean up any stale merge attributes from a previous pass
    // (e.g. the source was re-matched after an edit that removed merges).
    for (const td of Array.from(table.querySelectorAll<HTMLTableCellElement>("[data-tm-merge]"))) {
      td.removeAttribute("colspan");
      td.removeAttribute("rowspan");
      td.classList.remove("tm-merge-placeholder");
      delete td.dataset.tmMerge;
    }
    return;
  }
  const rows = Array.from(table.rows);
  const rowLimit = Math.min(rows.length, model.rows.length);
  for (let r = 0; r < rowLimit; r++) {
    const tr = rows[r];
    const cells = Array.from(tr.cells);
    if (!cells.length) continue;
    const colLimit = Math.min(cells.length, model.cols);
    for (let c = 0; c < colLimit; c++) {
      const modelCell = model.rows[r][c];
      const td = cells[c];
      if (!modelCell || !td) continue;
      if (modelCell.isAnchor) {
        if (modelCell.rowspan > 1) td.setAttribute("rowspan", String(modelCell.rowspan));
        else td.removeAttribute("rowspan");
        if (modelCell.colspan > 1) td.setAttribute("colspan", String(modelCell.colspan));
        else td.removeAttribute("colspan");
        td.classList.remove("tm-merge-placeholder");
        td.dataset.tmMerge = modelCell.rowspan > 1 || modelCell.colspan > 1 ? "anchor" : "";
        // Some Obsidian builds render raw `<br>` in a GFM table cell as plain
        // text instead of a real line break. Promote any literal `<br>` text
        // node to a real <br> element so multi-line cells (Excel paste, etc.)
        // visually break to a new line in Live Preview too.
        upgradeLiteralBrs(td);
      } else {
        td.classList.add("tm-merge-placeholder");
        td.dataset.tmMerge = "placeholder";
      }
    }
  }
}

/**
 * Walk all text nodes inside `el` and split any that contain a literal `<br>`
 * substring into [text, <br>, text] sequences. Idempotent: once the `<br>`
 * has been promoted to a real element, the text-node walker skips over it on
 * subsequent invocations and the function becomes a no-op.
 */
function upgradeLiteralBrs(el: HTMLElement): void {
  const doc = el.ownerDocument;
  if (!doc) return;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (/<br\s*\/?>/i.test(text.data)) targets.push(text);
    node = walker.nextNode();
  }
  for (const text of targets) {
    const pieces = text.data.split(/<br\s*\/?>/i);
    if (pieces.length === 1) continue;
    const parent = text.parentNode;
    if (!parent) continue;
    const frag = doc.createDocumentFragment();
    pieces.forEach((piece, idx) => {
      if (idx > 0) frag.appendChild(doc.createElement("br"));
      if (piece) frag.appendChild(doc.createTextNode(piece));
    });
    parent.replaceChild(frag, text);
  }
}

interface TableSource {
  text: string;
  /** 0-indexed line where the block starts in the document. */
  fromLine: number;
  /** 0-indexed inclusive line where the block ends. */
  toLine: number;
}

function isCaptionLine(line: string): boolean {
  return /^\s*\[[^\]]+\](?:\s*\[[^\]]+\])?\s*$/.test(line);
}

/** Callout title like `[!note]` / `[!warning]` — never table content. */
function isCalloutMarker(line: string): boolean {
  return /^\s*\[![^\]]+\]\s*$/.test(line);
}

function isTableSeparatorLine(line: string): boolean {
  return looksLikeTableLine(line) && isSeparatorLine(line);
}

function isSourceTableLine(line: string): boolean {
  return looksLikeTableLine(line) || isTableSeparatorLine(line) || isCaptionLine(line);
}

/** Strip any number of leading blockquote markers (`> `), so tables inside
 *  Callouts are detected/parsed as if they were top-level tables (issue #6). */
function stripBlockquote(line: string): string {
  let s = line;
  for (;;) {
    const m = s.match(/^\s*>\s?/);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return s;
}

/** Index in `buf` where the header of the table ending at the next separator
 *  starts, dropping non-delimited prose (e.g. a `[[Page|alias]]` paragraph)
 *  that was mistaken for a header row (issue #5). */
function headerStartBeforeSeparator(buf: string[]): number {
  let start = buf.length;
  if (start === 0 || !looksLikeTableLine(buf[start - 1])) return start;
  start--;
  while (start > 0) {
    const prev = buf[start - 1];
    if (isCaptionLine(prev) || looksLikeDelimitedTableLine(prev)) {
      start--;
      continue;
    }
    break;
  }
  return start;
}

export function collectTableSources(lines: string[]): TableSource[] {
  const blocks: TableSource[] = [];
  let buf: string[] = [];
  let bufStart = -1;
  let bufEnd = -1;
  let blanks = 0;
  let inTable = false;
  let hasSep = false;

  const flush = () => {
    while (buf.length && buf[buf.length - 1].trim() === "") {
      buf.pop();
      bufEnd--;
    }
    if (buf.length && hasSep && bufStart >= 0) {
      blocks.push({ text: buf.join("\n"), fromLine: bufStart, toLine: bufEnd });
    }
    buf = [];
    bufStart = -1;
    bufEnd = -1;
    blanks = 0;
    inTable = false;
    hasSep = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = stripBlockquote(lines[i]);
    if (isCalloutMarker(line)) {
      // Callout title lines like `[!note]` are not table content; the callout
      // body that follows may still contain a (blockquote-prefixed) table.
      if (inTable) flush();
      continue;
    }
    if (line.trim() === "") {
      if (!inTable) continue;
      blanks++;
      if (blanks >= 2) {
        flush();
      } else {
        buf.push("");
        bufEnd = i;
      }
      continue;
    }
    if (isSourceTableLine(line)) {
      // A second separator line means a new table is starting — flush the
      // previous one. Pop any header line(s) that belong to the new table.
      if (isTableSeparatorLine(line) && !hasSep) {
        // Drop non-delimited prose (e.g. a `[[wikilink|alias]]` paragraph)
        // buffered as a would-be header before this separator (issue #5).
        const keepFrom = headerStartBeforeSeparator(buf);
        if (keepFrom > 0) {
          buf = buf.slice(keepFrom);
          bufStart += keepFrom;
        }
      } else if (isTableSeparatorLine(line) && hasSep) {
        // Count how many non-blank, non-separator lines at the end of buf
        // belong to the new table's header.
        let headerCount = 0;
        for (let j = buf.length - 1; j >= 0; j--) {
          if (buf[j].trim() === "" || isTableSeparatorLine(buf[j])) break;
          headerCount++;
        }
        const newHeaderLines = buf.splice(buf.length - headerCount, headerCount);
        // Also trim trailing blanks from old table
        while (buf.length && buf[buf.length - 1].trim() === "") {
          buf.pop();
          bufEnd--;
        }
        flush();
        // Re-derive bufStart from i: header lines precede separator at line i
        const headerStart = i - headerCount;
        for (let k = 0; k < newHeaderLines.length; k++) {
          if (!inTable) bufStart = headerStart + k;
          buf.push(newHeaderLines[k]);
          bufEnd = headerStart + k;
          inTable = true;
        }
      }
      if (!inTable) bufStart = i;
      buf.push(line);
      bufEnd = i;
      blanks = 0;
      inTable = true;
      if (isTableSeparatorLine(line)) hasSep = true;
      continue;
    }
    if (inTable) flush();
  }
  if (buf.length) flush();
  return blocks;
}
