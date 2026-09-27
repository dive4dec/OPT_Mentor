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
}

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

  navbar.appendChild(brand);
  navbar.appendChild(tabs);
  navbar.appendChild(spacer);
  navbar.appendChild(permBtn);
  navbar.appendChild(themeBtn);

  // --- content scaffold -----------------------------------------------------
  const content = document.createElement("div");
  content.id = "opt-content";

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
    row.appendChild(pyOutput);  // -> right
  }

  // --- keep AI band visibility in sync with its pane (MutationObserver) -----
  if (aiPane) {
    const mo = new MutationObserver(() => syncBand(aiBand, aiPane as HTMLElement));
    mo.observe(aiPane, { attributes: true, attributeFilter: ["style", "class"] });
    syncBand(aiBand, aiPane);
  }

  // The main band always has exactly one visible pane (edit XOR display); it
  // stays flex:1 regardless, so no band hiding is needed there.

  startResizer(resizer, aiBand);
}
