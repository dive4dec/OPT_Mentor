// OPT Mentor — layout shell (shared by the visualize and live pages)
// ---------------------------------------------------------------------------
// Rebuilds the page as a full-height flex column with a PERSISTENT top nav bar:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ #opt-navbar  brand | [Visualize][Live Edit] | … | 🔗 🌗  │
//   ├──────────────────────────────────────────────────────────┤
//   │ #opt-ai-band      (AI chat; resizable height, drag bottom)│
//   ├──────────────────────────────────────────────────────────┤ .opt-resizer-h
//   │ #opt-main-band    (flex:1) → #pyInputPane (edit) or      │
//   │                       #pyOutputPane (display), whichever │
//   │                       is currently shown fills this band │
//   └──────────────────────────────────────────────────────────┘
//
// The bands REUSE the app's existing panes (#pyInputPane / #pyOutputPane /
// #visualize-ai-panel / #aichatbox). All legacy jQuery/D3/viz/CM6 code targets
// those elements BY ID and is untouched — we only move the nodes into the new
// structure. #pyInputPane and #pyOutputPane live in the same main band; the
// app already shows/hides them per mode, so the right one fills the band.
//
// The single drag boundary is between the AI band and the main band (a
// horizontal row-resize): dragging it resizes the AI chat height, and since the
// main band is flex:1 it resizes the editor/visualizer by complement. The
// visualization's own internal code|memory and print-output resizers (set up in
// pytutor.ts) are preserved for the objects/heap/stack components.
// ---------------------------------------------------------------------------

import { initTheme, currentTheme, cycleTheme, themeLabel } from "./theme";

export interface OptShellConfig {
  page: "visualize" | "live";
  brand: string;
  aiPaneId: string;                 // "visualize-ai-panel" | "aichatbox"
  buildPermalink: () => string;      // full, sanitized share URL for current state
  navigate: (target: "visualize" | "live") => void; // same-tab page switch
  // Keyboard shortcuts surfaced in the top-right "?" popup. Defaults to the
  // Python editor set; OPT_CPP (no docstring help) passes its own. Only list
  // shortcuts that actually work in that app.
  shortcuts?: { keys: string; desc: string }[];
}

const DEFAULT_SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "Shift + Tab", desc: "Docstring help for the symbol under the cursor (outdents instead when the cursor is at the line start)" },
  { keys: "Tab", desc: "Indent" },
  { keys: "Ctrl/⌘ + Click", desc: "Add a cursor at the click (multi-cursor)" },
  { keys: "Ctrl/⌘ + D", desc: "Select the next occurrence of the current word" },
  { keys: "Ctrl/⌘ + Shift + L", desc: "Select all occurrences of the current word" },
  { keys: "Alt + drag", desc: "Box / rectangular selection" },
  { keys: "Ctrl/⌘ + Z", desc: "Undo" },
  { keys: "Ctrl/⌘ + Shift + Z", desc: "Redo" },
  { keys: "Esc", desc: "Close the help / autocomplete popup" },
];

let ready = false;

// Small inline icon set (emoji — no extra asset, no font dependency).
function themeIcon(t: string): string {
  return t === "light" ? "☀️" : t === "dark" ? "🌙" : "🌗";
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback (non-secure context / older browsers): hidden textarea + execCommand.
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
    } catch (e) { reject(e as any); }
    finally { document.body.removeChild(ta); }
  });
}

function showToast(msg: string) {
  let el = document.getElementById("opt-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "opt-toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("opt-show");
  window.clearTimeout((showToast as any)._t);
  (showToast as any)._t = window.setTimeout(() => el.classList.remove("opt-show"), 1800);
}

// Keep a band's visibility in sync with its (single) pane child, which the
// legacy app shows/hides by display. Called on every relevant change. Also hides
// the seam (a direct previous sibling of the band) when the band is hidden —
// the AI band sits at the BOTTOM with the resizer above it, so the seam is the
// resizer's relationship to the band below it.
function syncBand(band: HTMLElement, pane: HTMLElement) {
  const hidden = getComputedStyle(pane).display === "none" || pane.style.display === "none";
  band.classList.toggle("opt-hidden", hidden);
  const res = band.previousElementSibling as HTMLElement | null;
  if (res && res.classList.contains("opt-resizer-h")) {
    res.style.display = hidden ? "none" : "";
  }
}

function startResizer(resizer: HTMLElement, band: HTMLElement) {
  // Drag the seam between the AI band and the main band to resize the AI band's
  // height. The AI band is anchored to the BOTTOM of the page, so the seam is
  // its TOP edge. Moving the finger DOWN (y increases) therefore SHRINKS the
  // band (h = startH - dy), which pulls the seam down to follow the finger.
  // (The opposite sign would push the seam up against the finger — the "opposite
  // to the drag direction" bug.) band is #opt-ai-band (flex: 0 0 auto + height).
  let startY = 0;
  let startH = 0;
  let dragging = false;

  const onDown = (e: MouseEvent | TouchEvent) => {
    if (band.classList.contains("opt-hidden")) return; // nothing to resize
    const y = "clientY" in e ? (e as MouseEvent).clientY : (e as TouchEvent).touches[0].clientY;
    startY = y;
    startH = band.offsetHeight;
    dragging = true;
    resizer.classList.add("opt-dragging");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    (e as any).preventDefault && (e as any).preventDefault();
  };
  const onMove = (e: MouseEvent | TouchEvent) => {
    if (!dragging) return;
    const y = "clientY" in e ? (e as MouseEvent).clientY : (e as TouchEvent).touches[0].clientY;
    const dy = y - startY;
    let h = startH - dy; // bottom-anchored band: drag down shrinks, up grows
    h = Math.max(0, Math.min(Math.floor(window.innerHeight * 0.8), h)); // clamp
    band.style.height = h + "px";
    // Lock touch to vertical (kill horizontal scroll/pan) and cancel the event.
    e.cancelable && (e as any).preventDefault && (e as any).preventDefault();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove("opt-dragging");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    // The visualization draws its object/heap/stack connectors against its
    // container width and only recomputes on a window resize — fire one so the
    // diagram re-lays-out at the new main-band width.
    window.dispatchEvent(new Event("resize"));
  };

  resizer.addEventListener("mousedown", onDown);
  resizer.addEventListener("touchstart", onDown, { passive: false });
  document.addEventListener("mousemove", onMove);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchend", onUp);

  // Double-click the seam to reset the AI band to its default height.
  resizer.addEventListener("dblclick", () => { band.style.height = ""; });
}

// Horizontal drag seam BETWEEN the code column (left, #pyInputPane) and the
// visualizer column (right, #pyOutputPane) in the Live Edit workspace row.
// Mirrors startResizer() but on the X axis: dragging LEFT shrinks the code
// column, dragging RIGHT widens it; the visualizer (flex:1) takes the rest.
function startVResizer(resizer: HTMLElement, pane: HTMLElement) {
  let startX = 0;
  let startW = 0;
  let dragging = false;

  const onDown = (e: MouseEvent | TouchEvent) => {
    const x = "clientX" in e ? (e as MouseEvent).clientX : (e as TouchEvent).touches[0].clientX;
    startX = x;
    startW = pane.offsetWidth;
    dragging = true;
    resizer.classList.add("opt-dragging");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    (e as any).preventDefault && (e as any).preventDefault();
  };
  const onMove = (e: MouseEvent | TouchEvent) => {
    if (!dragging) return;
    const x = "clientX" in e ? (e as MouseEvent).clientX : (e as TouchEvent).touches[0].clientX;
    let w = startW + (x - startX); // seam follows the finger horizontally
    const min = 260;                                   // keep the editor usable (matches CSS min-width)
    const max = Math.floor(window.innerWidth * 0.85);  // keep the viz usable
    w = Math.max(min, Math.min(max, w));
    // Inline width MUST be !important: the shared base rule
    // (#opt-main-band .opt-band-inner #pyInputPane { width:100% !important })
    // otherwise wins the cascade and the drag would do nothing.
    pane.style.setProperty("width", w + "px", "important");
    // Lock touch to horizontal and cancel (kills vertical page scroll).
    e.cancelable && (e as any).preventDefault && (e as any).preventDefault();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove("opt-dragging");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    // The visualization draws its connectors against its container width and
    // only recomputes on a window resize — fire one so the diagram re-lays-out
    // at the new width.
    window.dispatchEvent(new Event("resize"));
  };

  resizer.addEventListener("mousedown", onDown);
  resizer.addEventListener("touchstart", onDown, { passive: false });
  document.addEventListener("mousemove", onMove);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchend", onUp);

  // Double-click the seam to reset the code column to its default width.
  resizer.addEventListener("dblclick", () => { pane.style.width = ""; });
}

// ---------------------------------------------------------------------------
// Keyboard-shortcuts popover (top-right "⌨" button).
// ---------------------------------------------------------------------------
function setupShortcutsPopover(kbdBtn: HTMLElement, shortcuts: { keys: string; desc: string }[]) {
  const panel = document.createElement("div");
  panel.className = "opt-shortcuts-panel";
  panel.id = "opt-shortcuts-panel";
  panel.setAttribute("role", "dialog");
  const title = document.createElement("div");
  title.className = "opt-shortcuts-title";
  title.textContent = "Keyboard shortcuts";
  panel.appendChild(title);
  const list = document.createElement("ul");
  list.className = "opt-shortcuts-list";
  for (const s of shortcuts) {
    const li = document.createElement("li");
    const k = document.createElement("span");
    k.className = "opt-shortcut-keys";
    k.textContent = s.keys;
    const d = document.createElement("span");
    d.className = "opt-shortcut-desc";
    d.textContent = s.desc;
    li.appendChild(k);
    li.appendChild(d);
    list.appendChild(li);
  }
  panel.appendChild(list);
  document.body.appendChild(panel);

  const open = panel.classList.contains("open");
  const setOpen = (v: boolean) => {
    panel.classList.toggle("open", v);
    kbdBtn.setAttribute("aria-expanded", v ? "true" : "false");
  };
  kbdBtn.setAttribute("aria-expanded", "false");
  kbdBtn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!open); });
  document.addEventListener("click", (e) => {
    if (panel.classList.contains("open") && !panel.contains(e as Event as any)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
}

// ---------------------------------------------------------------------------
// Live Edit auto-expand.
// ---------------------------------------------------------------------------
// The workspace row is [code | v-resizer | viz]. When the visualization pane has
// no rendered content yet (fresh load / nothing executed — pyOutput is display:
// none or empty) the viz column and its seam collapse so the code window fills
// the ENTIRE width. When real content appears (an execution) it re-expands. User
// resizes still work — we only collapse when there is nothing to show.
function syncVizColumn(row: HTMLElement, viz: HTMLElement, seam: HTMLElement) {
  const shown = getComputedStyle(viz).display !== "none" && viz.getBoundingClientRect().width > 0;
  const hasContent = shown && !!viz.querySelector("svg,canvas") && viz.getBoundingClientRect().height > 8;
  const collapsed = !hasContent;
  row.classList.toggle("no-viz", collapsed);
  const code = row.querySelector("#pyInputPane") as HTMLElement | null;
  if (collapsed) {
    // Flex `gap` is only applied between two VISIBLE items, so hiding the viz +
    // seam lets the code column (the sole visible child) reclaim the full width
    // (the .no-viz rule makes it width:100% / flex:1). Remember a user-dragged
    // width so we can restore it when the viz returns, and clear the inline
    // width so the .no-viz CSS rule can take over.
    if (code && code.style.width) (row as any)._savedCodeW = code.style.width;
    viz.style.display = "none";
    seam.style.display = "none";
    if (code) code.style.removeProperty("width");
  } else {
    viz.style.removeProperty("display");
    seam.style.removeProperty("display");
    if (code) {
      const saved = (row as any)._savedCodeW as string | undefined;
      if (saved) code.style.setProperty("width", saved, "important");
      else code.style.removeProperty("width"); // fall back to the 550px default rule
      delete (row as any)._savedCodeW;
    }
  }
}

// The bottom AI / error band (the "seam" + its #aichatbox content).
//
// SINGLE SOURCE OF TRUTH for whether it should be open is the in-seam "Ask AI"
// button (#askAI) itself: webllm.ts shows it (display:block) exactly when an
// error is reported (or an answer is already on screen) and hides it
// (display:none) otherwise. So the band simply follows that visibility:
//   - #askAI visible   (error reported)   -> band expands
//   - #askAI invisible (no error / answer) -> band collapses (code fills height)
// We do NOT re-derive "is there an error?" here — we just read the button's
// computed display, so the two can never disagree.
//
// The top-nav "Debug" button is a manual override (`userForce`): clicking it
// toggles the band open or closed regardless of the current error state.
//
// A *new* error (#askAI transitioning invisible -> visible) always re-opens the
// band and clears a manual "closed", so a fresh error is never silently hidden.
function makeAiBandController(aiBand: HTMLElement, aiPane: HTMLElement, resizer: HTMLElement) {
  const askAI = aiPane.querySelector("#askAI") as HTMLElement | null;
  let userForce: "open" | "closed" | null = null;   // manual override via the Debug button
  let lastAskVisible = false;
  let lastExpanded = false;

  const askVisible = () => !!(askAI && getComputedStyle(askAI).display !== "none");
  const currentExpanded = () =>
    userForce === "open" ? true : userForce === "closed" ? false : lastAskVisible;

  const apply = (expanded: boolean) => {
    aiBand.classList.toggle("opt-ai-empty", !expanded);
    if (resizer) resizer.style.display = expanded ? "" : "none";
    if (expanded && !lastExpanded) aiBand.scrollIntoView({ behavior: "smooth", block: "nearest" });
    lastExpanded = expanded;
  };

  const sync = () => {
    const vis = askVisible();
    if (vis && !lastAskVisible) userForce = null;    // a new error appeared -> drop any manual close
    lastAskVisible = vis;
    apply(currentExpanded());
  };

  const mo = new MutationObserver(sync);
  mo.observe(aiPane, { subtree: true, attributes: true, attributeFilter: ["style", "class"], childList: true });
  sync();
  return {
    sync,
    toggle: () => {                                  // Debug button: flip the band
      userForce = lastExpanded ? "closed" : "open";
      sync();
    },
  };
}

export function initOptShell(cfg: OptShellConfig) {
  if (ready) return;
  ready = true;

  initTheme(); // apply persisted theme + track prefers-color-scheme

  // --- nav bar --------------------------------------------------------------
  const navbar = document.createElement("header");
  navbar.id = "opt-navbar";

  const brand = document.createElement("span");
  brand.className = "opt-brand";
  brand.textContent = cfg.brand;

  const tabs = document.createElement("div");
  tabs.className = "opt-tabs";
  const mkTab = (label: string, target: "visualize" | "live") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt-tab" + (target === cfg.page ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", () => { if (target !== cfg.page) cfg.navigate(target); });
    return b;
  };
  tabs.appendChild(mkTab("Default Mode", "visualize"));
  tabs.appendChild(mkTab("Live Edit", "live"));

  const spacer = document.createElement("span");
  spacer.className = "opt-spacer";

  const permBtn = document.createElement("button");
  permBtn.type = "button";
  permBtn.className = "opt-navbtn";
  permBtn.id = "opt-permalink";
  permBtn.title = "Copy share link to clipboard";
  permBtn.innerHTML = '<span class="opt-ico">🔗</span><span>Permalink</span>';
  permBtn.addEventListener("click", () => {
    let url = "";
    try { url = cfg.buildPermalink(); } catch (_e) { url = window.location.href; }
    copyToClipboard(url)
      .then(() => showToast("Share link copied to clipboard"))
      .catch(() => showToast("Could not copy — link: " + url));
  });

  const themeBtn = document.createElement("button");
  themeBtn.type = "button";
  themeBtn.className = "opt-navbtn";
  themeBtn.id = "opt-theme";
  const syncThemeBtn = () => {
    const t = currentTheme();
    // Icon-only (no label — keeps the nav compact); the current setting is
    // surfaced via the tooltip so hovering explains it.
    themeBtn.innerHTML = '<span class="opt-ico">' + themeIcon(t) + '</span>';
    themeBtn.title = "Theme: " + themeLabel(t) + " (click to change)";
  };
  themeBtn.addEventListener("click", () => { cycleTheme(currentTheme()); syncThemeBtn(); });
  window.addEventListener("opt-theme-change", syncThemeBtn);
  syncThemeBtn();

  const kbdBtn = document.createElement("button");
  kbdBtn.type = "button";
  kbdBtn.className = "opt-navbtn";
  kbdBtn.id = "opt-shortcuts";
  kbdBtn.title = "Keyboard shortcuts";
  kbdBtn.innerHTML = '<span class="opt-ico">⌨</span>';

  // Live Edit only: "Debug" button — a manual toggle for the bottom AI / error
  // band. The band normally follows the in-seam "Ask AI" button's visibility
  // (open when an error is reported, closed otherwise); clicking Debug forces it
  // open or closed on top of that. Tooltip explains the dual behaviour.
  const debugBtn = document.createElement("button");
  debugBtn.type = "button";
  debugBtn.className = "opt-navbtn";
  debugBtn.id = "opt-debug";
  debugBtn.title = "Debug: show / hide the error panel";
  debugBtn.innerHTML = '<span class="opt-ico">🐞</span><span>Debug</span>';
  if (cfg.page !== "live") debugBtn.style.display = "none";

  navbar.appendChild(brand);
  navbar.appendChild(tabs);
  navbar.appendChild(spacer);
  navbar.appendChild(debugBtn);
  navbar.appendChild(permBtn);
  navbar.appendChild(themeBtn);
  navbar.appendChild(kbdBtn);

  // --- content scaffold -----------------------------------------------------
  const content = document.createElement("div");
  content.id = "opt-content";

  // Live-page workspace-row handles (set in the workspace-row block below; used
  // by the auto-expand observers at the end). Declared here so they're in scope
  // for both.
  let workspaceRow: HTMLElement | null = null;
  let vizPane: HTMLElement | null = null;
  let vizResizer: HTMLElement | null = null;

  const aiBand = document.createElement("div");
  aiBand.className = "opt-band opt-hidden";
  aiBand.id = "opt-ai-band";
  const aiInner = document.createElement("div");
  aiInner.className = "opt-band-inner";
  aiBand.appendChild(aiInner);

  const resizer = document.createElement("div");
  resizer.className = "opt-resizer-h";
  resizer.title = "Drag to resize the AI panel (double-click to reset)";

  const mainBand = document.createElement("div");
  mainBand.className = "opt-band";
  mainBand.id = "opt-main-band";
  const mainInner = document.createElement("div");
  mainInner.className = "opt-band-inner";
  mainBand.appendChild(mainInner);

  content.appendChild(mainBand);
  content.appendChild(resizer);
  // AI band is at the BOTTOM (below the code/visualizer). The seam above it
  // resizes its height (same drag logic — it's position-agnostic).
  content.appendChild(aiBand);

  // Host <body>'s original children: move them under #opt-shell. We keep a
  // #opt-shell wrapper so the flex column fills the viewport.
  const shell = document.createElement("div");
  shell.id = "opt-shell";
  shell.setAttribute("data-page", cfg.page); // "visualize" | "live" — lets CSS scope page-specific layout
  document.body.insertBefore(shell, document.body.firstChild);
  shell.appendChild(navbar);
  shell.appendChild(content);

  // Reparent the existing panes into the bands.
  const pyInput = document.getElementById("pyInputPane");
  const pyOutput = document.getElementById("pyOutputPane");
  const aiPane = document.getElementById(cfg.aiPaneId);

  if (pyInput) mainInner.appendChild(pyInput);
  if (pyOutput) mainInner.appendChild(pyOutput);
  if (aiPane) aiInner.appendChild(aiPane);
  // (In live mode #pyOutputPane may initially sit in a table cell; the generic
  //  sweep below also pulls it into the main band.)

  // Any other stray top-level body nodes (optionsPane, footer, etc.) go into the
  // main band so nothing is lost.
  Array.from(document.body.children).forEach((node) => {
    if (node === shell) return;
    if (node.tagName === "SCRIPT" || node.tagName === "LINK" || node.tagName === "STYLE") return;
    mainInner.appendChild(node);
  });

  // --- live page: code (left) + visualizer (right) side by side -------------
  // Requested for Live Edit: the visualization sits to the RIGHT of the code
  // window. On Default Mode the code window stays FULL WIDTH and the viz stacks
  // below it (no wrapper). #pyInputPane (code) and #pyOutputPane (visualizer)
  // sit in mainInner interleaved with (hidden) stray nodes; wrap JUST those two
  // in a dedicated row (live page only) so they lay out side-by-side without the
  // strays breaking the flex. Styled as a horizontal flex in CSS.
  if (cfg.page === "live" && pyInput && pyOutput) {
    const row = document.createElement("div");
    row.className = "opt-workspace-row";
    mainInner.insertBefore(row, mainInner.firstChild);
    row.appendChild(pyInput);   // -> left

    // Vertical drag seam between the code column and the visualizer: drag to
    // resize the code window's width, double-click to reset.
    const vResizer = document.createElement("div");
    vResizer.className = "opt-resizer-v";
    vResizer.title = "Drag to resize the code window (double-click to reset)";
    vResizer.style.touchAction = "none"; // keep touch drags on the seam, not the page
    row.appendChild(vResizer);

    row.appendChild(pyOutput);  // -> right
    startVResizer(vResizer, pyInput);
    workspaceRow = row;
    vizPane = pyOutput;
    vizResizer = vResizer;
  }

  // --- live page: relocate the orphaned editor-table strays to the AI band --
  // The Live template wraps editor + visualizer in a 2-column <table>. We lift
  // #pyInputPane / #pyOutputPane / #aichatbox out into the bands above, but the
  // <table> (with its <td>) is left behind in the MAIN band holding only AI-
  // status strays: #frontendErrorOutput, #unSupportedFeatureBox, a 48px spacer,
  // and the AI reset-button row. Those render as a dead ~75px strip between the
  // code/visualizer and the AI seam. They're all AI/frontend status, so move the
  // cluster to the TOP of the AI band (right at the horizontal seam), drop the
  // now-meaningless spacer, and remove the empty table so the workspace row can
  // reclaim the freed vertical space.
  if (cfg.page === "live") {
    const strayTable = mainInner.querySelector("table");
    const feo = strayTable && strayTable.querySelector("#frontendErrorOutput");
    if (strayTable && feo) {
      const td = strayTable.querySelector("td") || strayTable;
      const cluster = document.createElement("div");
      cluster.id = "opt-ai-strays";
      for (const child of Array.from(td.children)) {
        // Skip the anonymous 48px spacer ("leave several lines before bottom
        // controls") — pointless once the controls sit at the top of the AI band.
        const el = child as HTMLElement;
        const isSpacer =
          el.tagName === "DIV" &&
          !el.id &&
          el.textContent.trim() === "" &&
          el.style && el.style.height === "48px";
        if (!isSpacer) cluster.appendChild(child);
      }
      aiInner.insertBefore(cluster, aiInner.firstChild); // top of the AI band, at the seam
      strayTable.remove();
    }
  }

  // --- keep AI band visibility in sync with its pane (MutationObserver) -----
  if (aiPane) {
    const mo = new MutationObserver(() => syncBand(aiBand, aiPane as HTMLElement));
    mo.observe(aiPane, { attributes: true, attributeFilter: ["style", "class"] });
    syncBand(aiBand, aiPane);
  }

  // The main band always has exactly one visible pane (edit XOR display); it
  // stays flex:1 regardless, so no band hiding is needed there.

  // --- Live Edit auto-expand wiring -----------------------------------------
  // (workspaceRow / vizPane / vizResizer are declared at the top of the function
  //  and set in the workspace-row block above.)
  if (cfg.page === "live") {
    // viz content changes (execution) -> show/hide the viz column
    if (vizPane && workspaceRow && vizResizer) {
      const row = workspaceRow, viz = vizPane, seam = vizResizer;
      const syncViz = () => syncVizColumn(row, viz, seam);
      const vmo = new MutationObserver(syncViz);
      vmo.observe(viz, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
      syncViz();
      window.addEventListener("resize", syncViz);
    }
    // The bottom AI / error band follows the in-seam "Ask AI" (#askAI) visibility
    // (its own MutationObserver does that); the top-nav "Debug" button is a
    // manual toggle that overrides the current error state.
    if (aiPane) {
      const aiCtl = makeAiBandController(aiBand, aiPane as HTMLElement, resizer);
      debugBtn.addEventListener("click", () => aiCtl.toggle());
    }
  }

  // Keyboard-shortcuts popover (both pages).
  setupShortcutsPopover(kbdBtn, cfg.shortcuts || DEFAULT_SHORTCUTS);

  startResizer(resizer, aiBand);
}
