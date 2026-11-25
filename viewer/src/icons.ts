// Icons use the same stroke and view box as the viewer's visibility controls.
const glyph = (body: string) => `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;

export const icons = {
  link: glyph('<path d="m8 12 4-4M7 14l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m3-1 1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0"/>'),
  picture: glyph('<path d="M3 4.5h14v11H3zM3 13l4-4 3 3 2-2 5 5"/><circle cx="13" cy="8" r=".9"/>'),
  settings: glyph('<path d="m8.5 2-.6 2-1.4.8-2-.5-1.5 2.5 1.4 1.5v1.5L3 11.5l1.5 2.5 2-.5 1.4.8.6 2h3l.6-2 1.4-.8 2 .5 1.5-2.5-1.4-1.7V8.3l1.4-1.5-1.5-2.5-2 .5-1.4-.8-.6-2z" transform="translate(0 .8)"/><circle cx="10" cy="10" r="2.4"/>'),
  grip: glyph('<path d="M8 5v10m4-10v10"/>'),
  reopen: glyph('<path d="M4 4v12m4-10 4 4-4 4m4-4h5"/>'),
  collapse: glyph('<path d="M4 4v12m8-10-4 4 4 4m-4-4h9"/>'),
  components: glyph('<path d="M3 5h3v3H3zM3 12h3v3H3zM9 6.5h8M9 13.5h8"/>'),
  popOut: glyph('<path d="M15 11v5H4V5h5m3-1h4v4m-6 2 6-6"/>'),
  dock: glyph('<path d="M3 4h14v12H3zM8 4v12m6-6h-3m1-2-2 2 2 2"/>'),
  close: glyph('<path d="m5 5 10 10M15 5 5 15"/>'),
  viewMenu: glyph('<circle cx="10" cy="10" r="7"/><path d="m12.8 7.2-1.3 4.3-4.3 1.3 1.3-4.3z"/>'),
  reset: glyph('<path d="M3.5 9A6.5 6.5 0 1 1 5 14.5M3.5 4.5V9H8"/>'),
  three_quarter: glyph('<path d="m10 2.7 6.5 3.7v7.2L10 17.3l-6.5-3.7V6.4zm0 7.4 6.5-3.7M10 10.1 3.5 6.4m6.5 3.7v7.2"/>'),
  front: glyph('<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M10 6.5v7m-3-3 3 3 3-3"/>'),
  rear: glyph('<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M10 13.5v-7m-3 3 3-3 3 3"/>'),
  left: glyph('<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M13.5 10h-7m3-3-3 3 3 3"/>'),
  right: glyph('<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M6.5 10h7m-3-3 3 3-3 3"/>'),
  top: glyph('<path d="M3.5 6V3.5H6m8 0h2.5V6m0 8v2.5H14m-8 0H3.5V14m4-3.5 2.5-3 2.5 3"/>'),
  operator: glyph('<path d="M2.5 7V4.5H5m10 0h2.5V7m0 6v2.5H15m-10 0H2.5V13M4.5 10s2.1-2.8 5.5-2.8 5.5 2.8 5.5 2.8-2.1 2.8-5.5 2.8S4.5 10 4.5 10Z"/><circle cx="10" cy="10" r="1.4"/>'),
};
