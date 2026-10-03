// Optional build-time constants (injected when API_INJECT_TARGET === 'define')
declare const __API_BASE_URL__: string | undefined;
declare const __API_KEY__: string | undefined;
declare const __API_MODEL__: string | undefined;
declare const __API_DEFAULT_MODE__: string | undefined;
declare const __API_HIDE_API_PANEL__: boolean | undefined;
declare const __SINGLE_MODE__: string | undefined;

import * as webllm from "../../webllm-components";
import { getAiSystemPrompt, buildAiQuestion } from "./ai-prompt";

type VisualizeAIInitParams = {
  getCode: () => string;
};

/*************** Mode Lock Helper ***************/
function getSingleModelSetting(): 'local' | 'api' | '' {
    const w: any = (window as any) || {};
    const raw: any = (typeof __SINGLE_MODE__ !== 'undefined') ? __SINGLE_MODE__ : w.SINGLE_MODE;
    const val = (raw || '').toString().toLowerCase();
    if (val === 'local' || val === 'api') return val as 'local' | 'api';
    return '';
}

/*************** API Configuration ***************/
const API_CONFIG = {
    enabled: (typeof __API_DEFAULT_MODE__ !== 'undefined' && __API_DEFAULT_MODE__ === 'api') ? true : false,
    baseUrl: (typeof __API_BASE_URL__ !== 'undefined') ? __API_BASE_URL__ : "",
    apiKey: (typeof __API_KEY__ !== 'undefined') ? __API_KEY__ : "",
    model:  (typeof __API_MODEL__ !== 'undefined') ? __API_MODEL__ : ""
};

// Enforce SINGLE_MODE lock at init
const lock = getSingleModelSetting();
if (lock === 'api') {
    API_CONFIG.enabled = true;
} else if (lock === 'local') {
    API_CONFIG.enabled = false;
}

const messages: any[] = [
  {
    content: getAiSystemPrompt(),
    role: "system",
  },
];

const availableModels = webllm.prebuiltAppConfig.model_list.map((m) => m.model_id);
// Raised from 512: the ai-test backend is a reasoning model — it spends
// output tokens thinking (reasoning_content) before emitting the final
// content, so small caps starve the actual answer.
const CHAT_MAX_OUTPUT_TOKENS = 2048;
const CHAT_STOP_SEQUENCES = ["</s>", "<|im_end|>"];

const engine = new webllm.MLCEngine();
let selectedModel = "sft_model_1.5B-q4f16_1-MLC (Hugging Face)";
let isEngineReady = false;

function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function formatAIResponse(text: string): string {
  if (!text) {
    return "";
  }
  text = text.replace(/(<\/think>)/gi, "\n$1");
  text = text.replace(/(<\/?(?:think|final)>)/gi, "$1\n");
  return text;
}

function setStatusText(text: string, visible: boolean = true): void {
  const status = getEl<HTMLElement>("download-status");
  if (!status) {
    return;
  }
  status.textContent = text;
  if (visible) {
    status.classList.remove("hidden");
  } else {
    status.classList.add("hidden");
  }
}

function updateEngineInitProgressCallback(report: any): void {
  if (report && report.text) {
    setStatusText(report.text);
  }
}

engine.setInitProgressCallback(updateEngineInitProgressCallback);

function getCurrentErrorText(): string {
  const visualizerError = (getEl<HTMLElement>("errorOutput")?.textContent || "").trim();
  if (visualizerError) {
    return visualizerError;
  }
  return (getEl<HTMLElement>("frontendErrorOutput")?.textContent || "").trim();
}

function hasFrontendError(): boolean {
  return getCurrentErrorText() !== "";
}

function shouldShowAskButton(): boolean {
  // Show Ask AI whenever a frontend error is present and the engine is ready,
  // regardless of mode. This covers both cases:
  //   - a compile/runtime error shown in the editor (edit mode), where the
  //     user keeps their code visible while getting help; and
  //   - a visualizer runtime error shown in display mode (#errorOutput).
  // (Previously required appMode==='ai_display', which forced the button hidden
  // whenever a syntax error surfaced in edit mode — the reported bug.)
  const ready = API_CONFIG.enabled || isEngineReady;
  return ready && hasFrontendError();
}

function setPanelVisibility() {
  const panel = getEl<HTMLElement>("visualize-ai-panel");
  const askButton = getEl<HTMLButtonElement>("viz-ask-ai");

  // The panel is ALWAYS visible — it is the content of #opt-ai-band, which sits
  // at the BOTTOM seam (see opt-shell.ts). It hosts the AI Tutor status bar +
  // config, which must be reachable WITHOUT a frontend error (mirroring live
  // mode, whose #aichatbox is always open). opt-shell's syncBand keeps the seam
  // band open while this pane is visible, and hides the whole band (status bar
  // included) in exam mode via the panel-wide API_HIDE_API_PANEL check below.
  if (panel) {
    const w: any = (window as any) || {};
    const hideAll = (typeof __API_HIDE_API_PANEL__ !== 'undefined')
      ? (!!__API_HIDE_API_PANEL__)
      : (!!w.API_HIDE_API_PANEL);
    panel.style.display = hideAll ? 'none' : 'block';
  }
  // Only the Ask AI button is gated on a frontend error + engine readiness.
  if (askButton) {
    askButton.style.display = shouldShowAskButton() ? "inline-block" : "none";
  }
}

// Reset the AI chat so a new execution starts clean. Invoked from the
// "opt-mentor:new-execution" window event that OptFrontend.executeCode() fires
// (see the listener in initVisualizeAI). Does NOT clear the error
// (clearFrontendError() does that separately) — it only wipes the assistant's
// reply + streaming stats. Exported so tests/other entry points can call it.
export function clearAiConversation(): void {
  const output = getEl<HTMLElement>("viz-message-out");
  const stats = getEl<HTMLElement>("viz-chat-stats");
  if (output) {
    output.classList.add("hidden");
    output.textContent = "";
  }
  if (stats) {
    stats.classList.add("hidden");
    stats.textContent = "";
  }
}

async function initializeWebLLMEngine() {
  const modelSelect = getEl<HTMLSelectElement>("viz-model-selection");
  if (!modelSelect) {
    return;
  }

  setStatusText("Loading local model ...");
  selectedModel = modelSelect.value;
  try {
    await engine.reload(selectedModel, {
      temperature: 1.0,
      top_p: 1,
    } as any);
    isEngineReady = true;
  } catch (err) {
    isEngineReady = false;
    setStatusText("Model load failed.");
    throw err;
  }
}

// (buildQuestion removed — superseded by buildAiQuestion() in ai-prompt.ts,
// which sends the code with explicit line numbers matching the editor.)

/*************** API Calling Function ***************/
async function callOpenAIAPI(question: string) {
  const output = getEl<HTMLElement>("viz-message-out");
  const stats = getEl<HTMLElement>("viz-chat-stats");
  if (!output || !stats) {
    return;
  }

  messages.length = 1;
  messages.push({ content: question, role: "user" });

  output.classList.remove("hidden");
  output.innerText = "AI is thinking...";
  stats.classList.add("hidden");
  stats.textContent = "";

  try {
    // When using the nginx reverse proxy (baseUrl ends with /ai-proxy),
    // the API key is injected server-side by nginx.
    const isProxy = API_CONFIG.baseUrl.endsWith('/ai-proxy');
    const url = isProxy
      ? API_CONFIG.baseUrl + '/chat/completions'
      : `${API_CONFIG.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json',
        ...( !isProxy && API_CONFIG.apiKey && { 'Authorization': `Bearer ${API_CONFIG.apiKey}` }),
      },
      body: JSON.stringify({
        model: API_CONFIG.model,
        messages: messages,
        stream: true,
        temperature: 1.0,
        top_p: 1,
        max_tokens: CHAT_MAX_OUTPUT_TOKENS,
        stop: CHAT_STOP_SEQUENCES,
      }),
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let fullResponse = '';

    if (contentType.includes('text/event-stream')) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;

          const data = line.slice(5).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              fullResponse += delta;
              output.innerText = "AI Response:\n" + formatAIResponse(fullResponse).replace(/\?/g, '?\n');
            }
          } catch {
            // Ignore non-JSON heartbeats
          }
        }
      }
    } else {
      // Non-streaming JSON fallback
      const data = await response.json();
      fullResponse =
        data.choices?.[0]?.message?.content ??
        data.choices?.[0]?.text ??
        data.message?.content ??
        data.response ??
        '';
    }

    output.innerText = "AI Response:\n" + formatAIResponse(fullResponse).replace(/\?/g, '?\n');
  } catch (err) {
    output.innerText = "Error: " + String(err);
  }
}

async function sendAskAI(question: string) {
  const output = getEl<HTMLElement>("viz-message-out");
  if (!output) {
    return;
  }

  // API mode: use the reverse proxy
  if (API_CONFIG.enabled) {
    return callOpenAIAPI(question);
  }

  // Local WebLLM mode
  const stats = getEl<HTMLElement>("viz-chat-stats");
  if (!stats) {
    return;
  }

  if (!isEngineReady) {
    output.classList.remove("hidden");
    output.innerText = "Local model is still loading. Please wait.";
    return;
  }

  messages.length = 1;
  messages.push({ content: question, role: "user" });

  console.log("[VisualizeAI] Messages before sending:", JSON.parse(JSON.stringify(messages)));

  output.classList.remove("hidden");
  output.innerText = "AI is thinking...";
  stats.classList.add("hidden");
  stats.textContent = "";

  try {
    let usage: any = undefined;
    let curMessage = "";
    const completion: any = await engine.chat.completions.create({
      stream: true,
      messages,
      temperature: 1.0,
      top_p: 1,
      max_tokens: CHAT_MAX_OUTPUT_TOKENS,
      stop: CHAT_STOP_SEQUENCES,
      stream_options: { include_usage: true },
    } as any);
    for await (const chunk of completion) {
      const curDelta = chunk.choices[0]?.delta.content;
      if (curDelta) {
        curMessage += curDelta;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
      output.innerText = "AI Response:\n" + formatAIResponse(curMessage).replace(/\?/g, '?\n');
    }

    const finalMessage = await engine.getMessage();

    console.log("[VisualizeAI] Raw model response:", finalMessage);

    output.innerText = "AI Response:\n" + formatAIResponse(finalMessage).replace(/\?/g, '?\n');
    if (usage && usage.prompt_tokens && usage.extra) {
      stats.classList.remove("hidden");
      stats.textContent =
        `prompt_tokens: ${usage.prompt_tokens}, completion_tokens: ${usage.completion_tokens}, ` +
        `prefill: ${usage.extra.prefill_tokens_per_s.toFixed(4)} tokens/sec, ` +
        `decoding: ${usage.extra.decode_tokens_per_s.toFixed(4)} tokens/sec`;
    }
  } catch (err) {
    output.innerText = "Error: " + String(err);
  }
}

/*************** Runtime AI config (shared with the live page) ***************/
// The default page and the live page share ONE OpenAI-compatible API
// configuration, persisted to the SAME localStorage key ('api_config') that
// webllm.ts uses — so an endpoint/key/model entered on either page is picked
// up by the other. Before this, the default page had NO runtime config UI: the
// API path (callOpenAIAPI) existed, but API_CONFIG could only come from
// build-time __API_*__ defines, which are all empty on the public Pages build.
// These functions add the "AI Tutor" status bar + config panel (mirroring
// live.html and the CPP default page) and wire it into this page's existing
// call path.
function vizHidePanel(): boolean {
  const w: any = (window as any) || {};
  return (typeof __API_HIDE_API_PANEL__ !== 'undefined')
    ? (!!__API_HIDE_API_PANEL__)
    : (!!w.API_HIDE_API_PANEL);
}

// Read the shared api_config from localStorage; fall back to build-time
// __API_*__ defines / window flags when nothing is saved. Mirrors
// loadAPIConfig() in webllm.ts so both pages agree on the same config.
function loadVizAPIConfig() {
  const w: any = (window as any) || {};
  if (vizHidePanel()) {
    try { localStorage.removeItem('api_config'); } catch { /* ignore */ }
    return;
  }
  let hadLocal = false;
  try {
    const saved = localStorage.getItem('api_config');
    if (saved) {
      const config = JSON.parse(saved);
      API_CONFIG.enabled = (config.enabled ?? API_CONFIG.enabled);
      API_CONFIG.baseUrl = (config.baseUrl ?? API_CONFIG.baseUrl);
      API_CONFIG.apiKey = (config.apiKey ?? API_CONFIG.apiKey);
      API_CONFIG.model = (config.model ?? API_CONFIG.model);
      hadLocal = !!(API_CONFIG.baseUrl || API_CONFIG.apiKey || API_CONFIG.model);
    }
  } catch { /* ignore malformed config */ }
  if (!hadLocal && (!API_CONFIG.baseUrl && !API_CONFIG.apiKey && !API_CONFIG.model)) {
    if (typeof __API_BASE_URL__ !== 'undefined') API_CONFIG.baseUrl = __API_BASE_URL__;
    if (typeof __API_KEY__ !== 'undefined') API_CONFIG.apiKey = __API_KEY__;
    if (typeof __API_MODEL__ !== 'undefined') API_CONFIG.model = __API_MODEL__;
    if (typeof __API_DEFAULT_MODE__ !== 'undefined' && __API_DEFAULT_MODE__ === 'api') API_CONFIG.enabled = true;
    if (!API_CONFIG.baseUrl && w.API_BASE_URL) API_CONFIG.baseUrl = w.API_BASE_URL;
    if (!API_CONFIG.apiKey && (w.API_KEY !== undefined)) API_CONFIG.apiKey = w.API_KEY;
    if (!API_CONFIG.model && w.API_MODEL) API_CONFIG.model = w.API_MODEL;
    if (API_CONFIG.baseUrl || API_CONFIG.apiKey || API_CONFIG.model) persistVizAPIConfig();
  }
  // A SINGLE_MODE lock (exam/locked build) always wins over a stored
  // 'enabled' value — same precedence the live page (webllm.ts) uses.
  const lock = getSingleModelSetting();
  if (lock === 'api') API_CONFIG.enabled = true;
  else if (lock === 'local') API_CONFIG.enabled = false;
}

function persistVizAPIConfig() {
  if (vizHidePanel()) return;
  try {
    localStorage.setItem('api_config', JSON.stringify({
      enabled: API_CONFIG.enabled,
      baseUrl: API_CONFIG.baseUrl,
      apiKey: API_CONFIG.apiKey,
      model: API_CONFIG.model
    }));
  } catch { /* ignore quota / private-mode errors */ }
}

function updateVizStatusBar() {
  const t = getEl<HTMLElement>("viz-ai-status-text");
  if (!t) return;
  if (API_CONFIG.enabled) {
    const endpoint = API_CONFIG.baseUrl || '(not set)';
    const model = API_CONFIG.model || '(not set)';
    t.textContent = '✓ API: ' + endpoint + ' · Model: ' + model;
  } else {
    const savedModel = (typeof localStorage !== 'undefined') ? localStorage.getItem('webllm_active_model') : null;
    const model = isEngineReady ? selectedModel : (savedModel || 'not configured');
    t.textContent = 'Local: ' + model;
  }
}

/** Hide the mode controls + both mode's config blocks; keep the status bar. */
function hideVizConfigPanel() {
  const mc = getEl<HTMLElement>("viz-mode-controls-div");
  if (mc) mc.style.display = 'none';
  document.querySelectorAll('.viz-api-only').forEach((el) => (el as HTMLElement).style.display = 'none');
  document.querySelectorAll('.viz-local-only').forEach((el) => (el as HTMLElement).style.display = 'none');
  const bar = getEl<HTMLElement>("viz-ai-status-bar");
  if (bar) bar.style.display = vizHidePanel() ? 'none' : 'block';
  if (!vizHidePanel()) updateVizStatusBar();
}

/** Show the mode controls + the current mode's config (local list or API fields). */
function showVizConfigPanel() {
  const bar = getEl<HTMLElement>("viz-ai-status-bar");
  if (bar) bar.style.display = vizHidePanel() ? 'none' : 'block';
  const mc = getEl<HTMLElement>("viz-mode-controls-div");
  if (mc) mc.style.display = '';
  updateVizModeDisplay();
  if (API_CONFIG.enabled) {
    // API mode: show API fields, hide the local model list.
    document.querySelectorAll('.viz-api-only').forEach((el) => (el as HTMLElement).style.display = 'block');
    document.querySelectorAll('.viz-local-only').forEach((el) => (el as HTMLElement).style.display = 'none');
    const url = getEl<HTMLInputElement>("viz-api-url"); if (url) url.value = API_CONFIG.baseUrl;
    const key = getEl<HTMLInputElement>("viz-api-key"); if (key) key.value = API_CONFIG.apiKey;
    const model = getEl<HTMLInputElement>("viz-api-model"); if (model) model.value = API_CONFIG.model;
    updateVizConfirmState();
  } else {
    // Local mode: show the local model list + download, hide API fields.
    document.querySelectorAll('.viz-local-only').forEach((el) => (el as HTMLElement).style.display = 'block');
    document.querySelectorAll('.viz-api-only').forEach((el) => (el as HTMLElement).style.display = 'none');
    // Make sure the model <select> is itself visible when there is at least one
    // available local model (matches live mode, which always shows the list in
    // Local mode). It stays hidden only when no model is available at all.
    const modelSel = getEl<HTMLSelectElement>("viz-model-selection");
    if (modelSel && availableModels.length >= 1) modelSel.style.display = '';
    const dl = getEl<HTMLElement>("viz-download");
    if (dl) dl.style.display = '';
  }
  // Refresh the status bar text so it reflects the mode after a toggle
  // (toggling to API must NOT leave a stale "Local: <model>" line — live mode
  // updates its status whenever the config is shown).
  if (!vizHidePanel()) updateVizStatusBar();
}

function updateVizModeDisplay() {
  const lock = getSingleModelSetting();
  const status = getEl<HTMLElement>("viz-mode-status");
  const toggleBtn = getEl<HTMLElement>("viz-toggle-api");
  const mc = getEl<HTMLElement>("viz-mode-controls-div");
  if (status) {
    if (lock === 'local' || lock === 'api') {
      status.style.display = 'none';
    } else {
      status.style.display = '';
      status.textContent = API_CONFIG.enabled ? 'API Mode' : 'Local Mode';
      status.className = API_CONFIG.enabled ? 'mode-status api-mode' : 'mode-status local-mode';
    }
  }
  if (toggleBtn) {
    if (lock === 'local' || lock === 'api') {
      toggleBtn.style.display = 'none';
    } else {
      toggleBtn.style.display = '';
      toggleBtn.textContent = API_CONFIG.enabled ? 'Switch to Local Mode' : 'Switch to API Mode';
    }
  }
  if (mc) {
    if (lock === 'local' || lock === 'api') mc.style.display = 'none';
  }
}

function vizApiInputsDiffer(): boolean {
  const url = getEl<HTMLInputElement>("viz-api-url");
  const key = getEl<HTMLInputElement>("viz-api-key");
  const model = getEl<HTMLInputElement>("viz-api-model");
  if (!url || !key || !model) return false;
  return url.value.trim() !== API_CONFIG.baseUrl ||
         key.value !== API_CONFIG.apiKey ||
         model.value.trim() !== API_CONFIG.model;
}

function updateVizConfirmState() {
  const b = getEl<HTMLButtonElement>("viz-api-confirm-btn");
  if (b) b.disabled = !vizApiInputsDiffer();
}

function confirmVizConfig() {
  const url = getEl<HTMLInputElement>("viz-api-url");
  const key = getEl<HTMLInputElement>("viz-api-key");
  const model = getEl<HTMLInputElement>("viz-api-model");
  if (url) API_CONFIG.baseUrl = url.value.trim();
  if (key) API_CONFIG.apiKey = key.value;
  if (model) API_CONFIG.model = model.value.trim();
  persistVizAPIConfig();
  hideVizConfigPanel();
  updateVizAskButton();
}

function cancelVizConfigEdit() {
  const url = getEl<HTMLInputElement>("viz-api-url");
  const key = getEl<HTMLInputElement>("viz-api-key");
  const model = getEl<HTMLInputElement>("viz-api-model");
  if (url) url.value = API_CONFIG.baseUrl;
  if (key) key.value = API_CONFIG.apiKey;
  if (model) model.value = API_CONFIG.model;
  updateVizConfirmState();
  hideVizConfigPanel();
}

function toggleVizApiMode() {
  const lock = getSingleModelSetting();
  if (lock === 'local' || lock === 'api') return;
  API_CONFIG.enabled = !API_CONFIG.enabled;
  persistVizAPIConfig();
  showVizConfigPanel();
  updateVizAskButton();
}

// Ask AI is enabled in API mode (no local download needed) or when the local
// engine is ready. Toggling/confirming re-evaluates it.
function updateVizAskButton() {
  const ask = getEl<HTMLButtonElement>("viz-ask-ai");
  if (!ask) return;
  ask.disabled = API_CONFIG.enabled ? false : !isEngineReady;
}

// Bind the AI Tutor status bar + config panel and set the initial state.
// Called from initVisualizeAI (always, regardless of mode / early return).
function initVizConfigPanel() {
  const bar = getEl<HTMLElement>("viz-ai-status-bar");
  if (bar) bar.style.display = vizHidePanel() ? 'none' : 'block';

  const editBtn = getEl<HTMLButtonElement>("viz-ai-edit-btn");
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      const mc = getEl<HTMLElement>("viz-mode-controls-div");
      const shown = mc && mc.style.display !== 'none';
      if (shown) hideVizConfigPanel();
      else showVizConfigPanel();
    });
  }
  const toggleBtn = getEl<HTMLButtonElement>("viz-toggle-api");
  if (toggleBtn) toggleBtn.addEventListener('click', toggleVizApiMode);
  ['viz-api-url', 'viz-api-key', 'viz-api-model'].forEach((id) => {
    const inp = getEl<HTMLInputElement>(id);
    if (inp) inp.addEventListener('input', updateVizConfirmState);
  });
  const confirmBtn = getEl<HTMLButtonElement>("viz-api-confirm-btn");
  if (confirmBtn) confirmBtn.addEventListener('click', confirmVizConfig);
  const cancelBtn = getEl<HTMLButtonElement>("viz-api-cancel-btn");
  if (cancelBtn) cancelBtn.addEventListener('click', cancelVizConfigEdit);

  // Initial state: status bar visible (if not exam mode), sub-panels hidden.
  if (!vizHidePanel()) hideVizConfigPanel();
}

export function initVisualizeAI(params: VisualizeAIInitParams) {
  // Load the shared API config (same localStorage key as the live page) and
  // init the "AI Tutor" status bar + config panel. Done FIRST, before the
  // local-UI guard below, so the panel is available even if the local model
  // controls are absent. This must run before any code below reads
  // API_CONFIG.enabled, so the page honours a saved endpoint/model at call time.
  loadVizAPIConfig();
  initVizConfigPanel();

  const modelSelection = getEl<HTMLSelectElement>("viz-model-selection");
  const downloadBtn = getEl<HTMLButtonElement>("viz-download");
  const askAIButton = getEl<HTMLButtonElement>("viz-ask-ai");

  if (!modelSelection || !downloadBtn || !askAIButton) {
    return;
  }

  modelSelection.innerHTML = "";
  availableModels.forEach((modelId) => {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = modelId;
    modelSelection.appendChild(option);
  });
  if (availableModels.length > 0) {
    selectedModel = availableModels[0];
  }
  modelSelection.value = selectedModel;
  // The model <select> is always populated with the available local models and
  // shown/hidden by showVizConfigPanel()/.viz-local-only (visible in Local mode).
  // It shows whenever >=1 model is available — matching live mode, which always
  // shows the model list in Local mode (a single-model build just shows one
  // option). It is only hidden when there is no model at all (no WebGPU / none
  // available).

  askAIButton.disabled = true;

  askAIButton.addEventListener("click", () => {
    const code = params.getCode();
    const errorText = getCurrentErrorText();
    const question = buildAiQuestion(code, errorText);
    sendAskAI(question);
  });

  // Watch only the elements the panel visibility actually depends on
  // (error panes) instead of the whole document — a body-level observer
  // fires on every keystroke and every streamed AI token.
  const errorTargets: Element[] = [];
  const fe = getEl<HTMLElement>("frontendErrorOutput");
  const out = getEl<HTMLElement>("pyOutputPane"); // pytutor injects #errorOutput here
  if (fe) errorTargets.push(fe);
  if (out) errorTargets.push(out);
  if (errorTargets.length > 0) {
    const observer = new MutationObserver(() => {
      setPanelVisibility();
    });
    errorTargets.forEach((el) =>
      observer.observe(el, { childList: true, characterData: true, subtree: true }));
  }

  window.addEventListener("hashchange", () => {
    setPanelVisibility();
  });

  // A new execution (fired from OptFrontend.executeCode) invalidates any prior
  // AI answer, so clear the conversation. The answer is preserved across
  // editing (setPanelVisibility no longer wipes it) but reset on a fresh run.
  window.addEventListener("opt-mentor:new-execution", () => {
    clearAiConversation();
  });

  // The local model list (select + Load button) lives in .viz-local-only, which
  // showVizConfigPanel()/hideVizConfigPanel() toggle by mode: hidden in API mode
  // (the model is fixed server-side, so there is nothing to pick) and visible in
  // Local mode so the user can choose a model. Do NOT unconditionally hide the
  // model row here — that was the bug: it hid the list even in Local mode.
  const localStatus = getEl<HTMLElement>("download-status");
  if (localStatus) {
    localStatus.classList.add("hidden");
  }

  // Local model "Load" button: pick a model from the list and (re)load it.
  // Mirrors live mode's model-selection + download button. initializeWebLLMEngine()
  // reads modelSelection.value, so the button applies the currently-selected model.
  downloadBtn.addEventListener("click", () => {
    if (API_CONFIG.enabled || availableModels.length === 0) return; // local engine only
    selectedModel = modelSelection.value;
    askAIButton.disabled = true;
    initializeWebLLMEngine()
      .then(() => { askAIButton.disabled = false; setPanelVisibility(); })
      .catch(() => { askAIButton.disabled = true; setPanelVisibility(); });
  });

  // In API mode, no model download needed — enable Ask AI immediately
  if (API_CONFIG.enabled) {
    askAIButton.disabled = false;
    setPanelVisibility();
    return;
  }

  // Auto-load local model on init only if WebGPU is available
  if (availableModels.length > 0 && ('gpu' in navigator)) {
    setStatusText("Initializing local model ...");
    initializeWebLLMEngine().then(() => {
      askAIButton.disabled = false;
      setPanelVisibility();
    }).catch(() => {
      askAIButton.disabled = true;
      setPanelVisibility();
    });
  } else {
    setStatusText("WebGPU not available — local model disabled.");
  }

  setPanelVisibility();
}
