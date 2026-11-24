// Inline SVG icon strings (lucide-style stroke). Kept tiny to avoid bundling a
// full icon library.

// Inline width/height ensures icons stay visible even if the plugin's CSS is
// unloaded (e.g. while Obsidian is mid-disable and the toolbar is being torn
// down). Without explicit dimensions, browsers render an SVG without `width`
// attributes at 0x0 once the `.tm-icon { width:16px; height:16px }` rule is
// removed.
const wrap = (path: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="tm-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const Icons = {
  rowAbove: wrap('<path d="M3 12h18"/><path d="M3 18h18"/><path d="M12 3v6"/><path d="M9 6l3-3 3 3"/>'),
  rowBelow: wrap('<path d="M3 6h18"/><path d="M3 12h18"/><path d="M12 21v-6"/><path d="M9 18l3 3 3-3"/>'),
  colLeft: wrap('<path d="M6 3v18"/><path d="M12 3v18"/><path d="M3 12h6"/><path d="M6 9l-3 3 3 3"/>'),
  colRight: wrap('<path d="M12 3v18"/><path d="M18 3v18"/><path d="M21 12h-6"/><path d="M18 9l3 3-3 3"/>'),
  delRow: wrap('<path d="M3 12h18"/><path d="M5 6h14"/><path d="M5 18h14"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/>'),
  delCol: wrap('<path d="M12 3v18"/><path d="M6 5v14"/><path d="M18 5v14"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/>'),
  moveUp: wrap('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
  moveDown: wrap('<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>'),
  moveLeft: wrap('<path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/>'),
  moveRight: wrap('<path d="M5 12h14"/><path d="M12 19l7-7-7-7"/>'),
  alignLeft: wrap('<path d="M3 6h18"/><path d="M3 12h12"/><path d="M3 18h18"/><path d="M3 24"/>'),
  alignCenter: wrap('<path d="M3 6h18"/><path d="M6 12h12"/><path d="M3 18h18"/>'),
  alignRight: wrap('<path d="M3 6h18"/><path d="M9 12h12"/><path d="M3 18h18"/>'),
  mergeUp: wrap('<rect x="4" y="4" width="16" height="7"/><rect x="4" y="13" width="16" height="7"/><path d="M9 9l3-3 3 3"/>'),
  mergeDown: wrap('<rect x="4" y="4" width="16" height="7"/><rect x="4" y="13" width="16" height="7"/><path d="M9 15l3 3 3-3"/>'),
  mergeLeft: wrap('<rect x="4" y="4" width="7" height="16"/><rect x="13" y="4" width="7" height="16"/><path d="M9 9l-3 3 3 3"/>'),
  mergeSelection: wrap('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8l4 4-4 4"/><path d="M16 8l-4 4 4 4"/>'),
  split: wrap('<rect x="3" y="3" width="18" height="18"/><path d="M3 12h18"/><path d="M12 3v18"/>'),
  grid: wrap('<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'),
  format: wrap('<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h16"/>'),
  // A clipboard with a small grid superimposed; signals "paste a table".
  importTable: wrap('<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3"/><rect x="6" y="11" width="12" height="7"/><path d="M6 14.5h12"/><path d="M12 11v7"/>'),
  // Chevron arrows for toolbar collapse/expand toggle.
  chevronLeft: wrap('<polyline points="15 18 9 12 15 6"/>'),
  chevronRight: wrap('<polyline points="9 18 15 12 9 6"/>'),
  // Transpose: two arrows swapping horizontal <-> vertical.
  transpose: wrap('<path d="M4 7h13"/><path d="M14 4l3 3-3 3"/><path d="M20 17H7"/><path d="M10 14l-3 3 3 3"/>'),
};
