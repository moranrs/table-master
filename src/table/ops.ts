// Pure operations on TableModel. Each function returns a new model (no mutation
// of the input) and keeps merge regions consistent by rebuilding the grid.

import {
  Align,
  Cell,
  TableModel,
  anchorOf,
  cloneModel,
  emptyModel,
  makeAnchor,
  makeMergeLeft,
  makeMergeUp,
  recomputeSpans,
} from "./model";

/** Replace a row's cells with anchors; used when inserting blank rows. */
function blankRow(cols: number): Cell[] {
  return new Array(cols).fill(0).map(() => makeAnchor(""));
}

/**
 * Detach any merged region that crosses the boundary `boundaryRow` (between
 * boundaryRow-1 and boundaryRow). Each affected anchor is split by replacing
 * placeholders below the boundary with anchor cells inheriting the original
 * raw text only on the very first such cell.
 */
function splitVerticalMergesAcrossRow(model: TableModel, boundaryRow: number): TableModel {
  const m = cloneModel(model);
  for (let c = 0; c < m.cols; c++) {
    if (boundaryRow <= 0 || boundaryRow >= m.rows.length) continue;
    const cell = m.rows[boundaryRow][c];
    if (cell.isAnchor || cell.anchorRowOffset === 0) continue;
    // Convert placeholder at (boundaryRow, c) into a new anchor; subsequent
    // placeholders below pointing into the original anchor must now point to
    // the new anchor.
    m.rows[boundaryRow][c] = makeAnchor("");
    for (let r = boundaryRow + 1; r < m.rows.length; r++) {
      const below = m.rows[r][c];
      if (below.isAnchor) break;
      if (below.anchorRowOffset > 0 && r - below.anchorRowOffset < boundaryRow) {
        below.anchorRowOffset = r - boundaryRow;
      } else {
        break;
      }
    }
  }
  recomputeSpans(m);
  return m;
}

/** Same as above for vertical splits across a column boundary. */
function splitHorizontalMergesAcrossCol(model: TableModel, boundaryCol: number): TableModel {
  const m = cloneModel(model);
  for (let r = 0; r < m.rows.length; r++) {
    if (boundaryCol <= 0 || boundaryCol >= m.cols) continue;
    const cell = m.rows[r][boundaryCol];
    if (cell.isAnchor || cell.anchorColOffset === 0) continue;
    m.rows[r][boundaryCol] = makeAnchor("");
    for (let c = boundaryCol + 1; c < m.cols; c++) {
      const right = m.rows[r][c];
      if (right.isAnchor) break;
      if (right.anchorColOffset > 0 && c - right.anchorColOffset < boundaryCol) {
        right.anchorColOffset = c - boundaryCol;
      } else {
        break;
      }
    }
  }
  recomputeSpans(m);
  return m;
}

/** Like splitVerticalMergesAcrossRow but only for columns in [colFrom, colTo]. */
function splitVerticalMergesInRange(model: TableModel, boundaryRow: number, colFrom: number, colTo: number): TableModel {
  if (boundaryRow <= 0 || boundaryRow >= model.rows.length) return model;
  const m = cloneModel(model);
  for (let c = colFrom; c <= colTo; c++) {
    if (c < 0 || c >= m.cols) continue;
    const cell = m.rows[boundaryRow][c];
    if (cell.isAnchor || cell.anchorRowOffset === 0) continue;
    m.rows[boundaryRow][c] = makeAnchor("");
    for (let r = boundaryRow + 1; r < m.rows.length; r++) {
      const below = m.rows[r][c];
      if (below.isAnchor) break;
      if (below.anchorRowOffset > 0 && r - below.anchorRowOffset < boundaryRow) {
        below.anchorRowOffset = r - boundaryRow;
      } else {
        break;
      }
    }
  }
  recomputeSpans(m);
  return m;
}

/** Like splitHorizontalMergesAcrossCol but only for rows in [rowFrom, rowTo]. */
function splitHorizontalMergesInRange(model: TableModel, boundaryCol: number, rowFrom: number, rowTo: number): TableModel {
  if (boundaryCol <= 0 || boundaryCol >= model.cols) return model;
  const m = cloneModel(model);
  for (let r = rowFrom; r <= rowTo; r++) {
    if (r < 0 || r >= m.rows.length) continue;
    const cell = m.rows[r][boundaryCol];
    if (cell.isAnchor || cell.anchorColOffset === 0) continue;
    m.rows[r][boundaryCol] = makeAnchor("");
    for (let c = boundaryCol + 1; c < m.cols; c++) {
      const right = m.rows[r][c];
      if (right.isAnchor) break;
      if (right.anchorColOffset > 0 && c - right.anchorColOffset < boundaryCol) {
        right.anchorColOffset = c - boundaryCol;
      } else {
        break;
      }
    }
  }
  recomputeSpans(m);
  return m;
}

export function insertRow(model: TableModel, row: number, position: "above" | "below"): TableModel {
  const at = position === "above" ? row : row + 1;
  // Cannot insert above header row 0 (would create new header). Force at >= 1.
  const insertAt = Math.max(1, at);
  // Split any merges crossing this boundary so the new row is "clean"
  const split = splitVerticalMergesAcrossRow(model, insertAt);
  const m = cloneModel(split);
  m.rows.splice(insertAt, 0, blankRow(m.cols));
  recomputeSpans(m);
  return m;
}

export function insertCol(model: TableModel, col: number, position: "left" | "right"): TableModel {
  const at = position === "left" ? col : col + 1;
  const insertAt = Math.max(0, Math.min(model.cols, at));
  const split = splitHorizontalMergesAcrossCol(model, insertAt);
  const m = cloneModel(split);
  for (const row of m.rows) {
    row.splice(insertAt, 0, makeAnchor(""));
  }
  m.cols += 1;
  m.aligns.splice(insertAt, 0, "none");
  recomputeSpans(m);
  return m;
}

export function deleteRow(model: TableModel, row: number): TableModel {
  if (row <= 0 || row >= model.rows.length) return model;
  // Split merges that span across both this row's top and bottom boundaries
  let m = splitVerticalMergesAcrossRow(model, row);
  m = splitVerticalMergesAcrossRow(m, row + 1);
  m = cloneModel(m);
  m.rows.splice(row, 1);
  recomputeSpans(m);
  // Body must keep at least one row
  if (m.rows.length < 2) m.rows.push(blankRow(m.cols));
  return m;
}

export function deleteCol(model: TableModel, col: number): TableModel {
  if (col < 0 || col >= model.cols) return model;
  let m = splitHorizontalMergesAcrossCol(model, col);
  m = splitHorizontalMergesAcrossCol(m, col + 1);
  m = cloneModel(m);
  for (const row of m.rows) row.splice(col, 1);
  m.cols -= 1;
  m.aligns.splice(col, 1);
  recomputeSpans(m);
  if (m.cols < 1) return emptyModel(m.rows.length, 1);
  return m;
}

export function moveRow(model: TableModel, row: number, dir: "up" | "down"): TableModel {
  if (row <= 0) return model; // header is fixed
  const target = dir === "up" ? row - 1 : row + 1;
  if (target <= 0 || target >= model.rows.length) return model;
  // Split merges across both rows' boundaries
  let m = splitVerticalMergesAcrossRow(model, Math.min(row, target));
  m = splitVerticalMergesAcrossRow(m, Math.min(row, target) + 1);
  m = splitVerticalMergesAcrossRow(m, Math.max(row, target));
  m = splitVerticalMergesAcrossRow(m, Math.max(row, target) + 1);
  m = cloneModel(m);
  const tmp = m.rows[row];
  m.rows[row] = m.rows[target];
  m.rows[target] = tmp;
  recomputeSpans(m);
  return m;
}

export function moveCol(model: TableModel, col: number, dir: "left" | "right"): TableModel {
  const target = dir === "left" ? col - 1 : col + 1;
  if (col < 0 || target < 0 || target >= model.cols) return model;
  let m = splitHorizontalMergesAcrossCol(model, Math.min(col, target));
  m = splitHorizontalMergesAcrossCol(m, Math.min(col, target) + 1);
  m = splitHorizontalMergesAcrossCol(m, Math.max(col, target));
  m = splitHorizontalMergesAcrossCol(m, Math.max(col, target) + 1);
  m = cloneModel(m);
  for (const row of m.rows) {
    const tmp = row[col];
    row[col] = row[target];
    row[target] = tmp;
  }
  const a = m.aligns[col];
  m.aligns[col] = m.aligns[target];
  m.aligns[target] = a;
  recomputeSpans(m);
  return m;
}

export function setColAlign(model: TableModel, col: number, align: Align): TableModel {
  if (col < 0 || col >= model.cols) return model;
  const m = cloneModel(model);
  m.aligns[col] = align;
  return m;
}

/** Merge a rectangular region. Returns model unchanged on invalid input. */
export function mergeRange(
  model: TableModel,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): TableModel {
  const top = Math.min(r1, r2);
  const bottom = Math.max(r1, r2);
  const left = Math.min(c1, c2);
  const right = Math.max(c1, c2);
  if (top < 0 || left < 0 || bottom >= model.rows.length || right >= model.cols) return model;
  // Cannot merge across header boundary (top stays in body or stays in header)
  if (top < model.headerRows && bottom >= model.headerRows) return model;
  if (top === bottom && left === right) return model;

  // First, expand the region to include any merge regions partially inside it
  let { top: T, bottom: B, left: L, right: R } = expandToCoverMerges(model, top, bottom, left, right);
  // Split merges that cross the expanded boundary, but only within the
  // affected row/column range so unrelated merges outside the rectangle
  // are not broken.
  let m = splitVerticalMergesInRange(model, T, L, R);
  m = splitVerticalMergesInRange(m, B + 1, L, R);
  m = splitHorizontalMergesInRange(m, L, T, B);
  m = splitHorizontalMergesInRange(m, R + 1, T, B);
  m = cloneModel(m);

  // Collect non-empty raw text in row-major order, separated by spaces
  const parts: string[] = [];
  for (let r = T; r <= B; r++) {
    for (let c = L; c <= R; c++) {
      const cell = m.rows[r][c];
      if (cell.isAnchor && cell.raw.trim() !== "") parts.push(cell.raw.trim());
    }
  }
  const merged = parts.join(" ");

  // Set anchor and placeholders
  m.rows[T][L] = makeAnchor(merged);
  for (let c = L + 1; c <= R; c++) {
    m.rows[T][c] = makeMergeLeft(1, 0);
  }
  for (let r = T + 1; r <= B; r++) {
    m.rows[r][L] = makeMergeUp(1, 0);
    for (let c = L + 1; c <= R; c++) {
      m.rows[r][c] = makeMergeLeft(1, 0);
    }
  }
  recomputeSpans(m);
  return m;
}

function expandToCoverMerges(
  model: TableModel,
  top: number,
  bottom: number,
  left: number,
  right: number,
): { top: number; bottom: number; left: number; right: number } {
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        const a = anchorOf(model, r, c);
        const anchor = model.rows[a.r][a.c];
        const er = a.r + anchor.rowspan - 1;
        const ec = a.c + anchor.colspan - 1;
        if (a.r < top) {
          top = a.r;
          changed = true;
        }
        if (a.c < left) {
          left = a.c;
          changed = true;
        }
        if (er > bottom) {
          bottom = er;
          changed = true;
        }
        if (ec > right) {
          right = ec;
          changed = true;
        }
      }
    }
  }
  return { top, bottom, left, right };
}

/** Split the merged region that contains (r, c) back into individual anchors. */
export function splitCell(model: TableModel, r: number, c: number): TableModel {
  const a = anchorOf(model, r, c);
  const anchor = model.rows[a.r][a.c];
  if (anchor.rowspan === 1 && anchor.colspan === 1) return model;
  const m = cloneModel(model);
  for (let rr = a.r; rr < a.r + anchor.rowspan; rr++) {
    for (let cc = a.c; cc < a.c + anchor.colspan; cc++) {
      if (rr === a.r && cc === a.c) continue;
      m.rows[rr][cc] = makeAnchor("");
    }
  }
  // Reset anchor span
  m.rows[a.r][a.c].rowspan = 1;
  m.rows[a.r][a.c].colspan = 1;
  recomputeSpans(m);
  return m;
}

/** Sort body rows by column. Disabled if the body contains any merges. */
export function sortByCol(
  model: TableModel,
  col: number,
  dir: "asc" | "desc",
): { model: TableModel; ok: boolean } {
  if (col < 0 || col >= model.cols) return { model, ok: false };
  // Check for merges in body rows
  for (let r = 1; r < model.rows.length; r++) {
    for (let c = 0; c < model.cols; c++) {
      const cell = model.rows[r][c];
      if (!cell.isAnchor) return { model, ok: false };
      if (cell.rowspan > 1 || cell.colspan > 1) return { model, ok: false };
    }
  }
  const m = cloneModel(model);
  const body = m.rows.slice(1);
  body.sort((ra, rb) => {
    const va = (ra[col]?.raw ?? "").toString();
    const vb = (rb[col]?.raw ?? "").toString();
    const na = parseFloat(va);
    const nb = parseFloat(vb);
    let cmp: number;
    if (!isNaN(na) && !isNaN(nb) && va.trim() !== "" && vb.trim() !== "") {
      cmp = na - nb;
    } else {
      cmp = va.localeCompare(vb);
    }
    return dir === "asc" ? cmp : -cmp;
  });
  m.rows = [m.rows[0], ...body];
  recomputeSpans(m);
  return { model: m, ok: true };
}

/** Set the raw text of a single cell. The position must be an anchor. */
export function setCellText(model: TableModel, r: number, c: number, text: string): TableModel {
  const a = anchorOf(model, r, c);
  const m = cloneModel(model);
  m.rows[a.r][a.c].raw = text;
  return m;
}

/**
 * Transpose the whole table (rows <-> columns). Merged regions swap their
 * rowspan/colspan; placeholders are regenerated so the merge structure stays
 * consistent. Column alignment has no row equivalent after a transpose, so it
 * is reset to `none`. tbody breaks become meaningless and are cleared.
 */
export function transpose(model: TableModel): TableModel {
  recomputeSpans(model);
  const oldRows = model.rows.length;
  const oldCols = model.cols;
  const newRows = oldCols;
  const newCols = oldRows;

  const grid: Cell[][] = [];
  for (let r = 0; r < newRows; r++) {
    grid.push(new Array(newCols).fill(0).map(() => makeAnchor("")));
  }

  for (let r = 0; r < oldRows; r++) {
    for (let c = 0; c < oldCols; c++) {
      const cell = model.rows[r][c];
      if (!cell.isAnchor) continue;
      const spanRows = Math.max(1, cell.rowspan);
      const spanCols = Math.max(1, cell.colspan);
      const nr = c;
      const nc = r;
      if (nr >= newRows || nc >= newCols) continue;
      grid[nr][nc] = makeAnchor(cell.raw);
      // Old (spanRows x spanCols) becomes (spanCols x spanRows).
      for (let dr = 0; dr < spanCols; dr++) {
        for (let dc = 0; dc < spanRows; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = nr + dr;
          const cc = nc + dc;
          if (rr >= newRows || cc >= newCols) continue;
          grid[rr][cc] = dr > 0 ? makeMergeUp(1, 0) : makeMergeLeft(1, 0);
        }
      }
    }
  }

  const m: TableModel = {
    rows: grid,
    aligns: new Array(newCols).fill("none") as Align[],
    headerRows: model.headerRows > 0 ? Math.min(model.headerRows, newRows) : 0,
    cols: newCols,
    caption: model.caption ? { ...model.caption } : undefined,
    tbodyBreaks: [],
  };
  recomputeSpans(m);
  return m;
}
