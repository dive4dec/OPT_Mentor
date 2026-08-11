// Optional build-time constants (injected when API_INJECT_TARGET === 'define')
declare const __API_BASE_URL__: string | undefined;
declare const __API_KEY__: string | undefined;
declare const __API_MODEL__: string | undefined;
declare const __API_DEFAULT_MODE__: string | undefined;
declare const __SINGLE_MODE__: string | undefined;

import * as webllm from "../../webllm-components";

type VisualizeAIInitParams = {
  getCode: () => string;
  getMode: () => string;
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
    content: "You are a Python tutor. Respond ONLY with Socratic-style hints: short, guiding QUESTIONS (no solutions, no code, no imperative fixes). At most 100 words.",
    role: "system",
  },
];

const availableModels = webllm.prebuiltAppConfig.model_list.map((m) => m.model_id);
const CHAT_MAX_OUTPUT_TOKENS = 512;
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

function shouldShowAskButton(getMode: () => string): boolean {
  const ready = API_CONFIG.enabled || isEngineReady;
  return getMode() === "ai_display" && ready && hasFrontendError();
}

function setPanelVisibility(getMode: () => string) {
  const panel = getEl<HTMLElement>("visualize-ai-panel");
  const askButton = getEl<HTMLButtonElement>("viz-ask-ai");
  if (!panel || !askButton) {
    return;
  }

  const inAiDisplay = getMode() === "ai_display";
  panel.style.display = inAiDisplay && hasFrontendError() ? "block" : "none";
  askButton.style.display = shouldShowAskButton(getMode) ? "inline-block" : "none";

  if (!inAiDisplay) {
    const msg = getEl<HTMLElement>("viz-message-out");
    const stats = getEl<HTMLElement>("viz-chat-stats");
    if (msg) {
      msg.classList.add("hidden");
      msg.textContent = "";
    }
    if (stats) {
      stats.classList.add("hidden");
      stats.textContent = "";
    }
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

function buildQuestion(code: string, frontendError: string): string {
  const cleanedError = (frontendError || "").replace("(UNSUPPORTED FEATURES)", "").trim();
  return "## Code ```python  " + code + "  ```  ## Error  ```text  " + cleanedError +
    "  ```  ## Task  Ask guiding questions that help me discover the mistake.";
}

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

export function initVisualizeAI(params: VisualizeAIInitParams) {
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
  if (availableModels.length <= 1) {
    modelSelection.style.display = "none";
  }

  askAIButton.disabled = true;

  askAIButton.addEventListener("click", () => {
    const code = params.getCode();
    const errorText = getCurrentErrorText();
    const question = buildQuestion(code, errorText);
    sendAskAI(question);
  });

  const observer = new MutationObserver(() => {
    setPanelVisibility(params.getMode);
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });

  window.addEventListener("hashchange", () => {
    setPanelVisibility(params.getMode);
  });

  // In API mode, no model download needed — enable Ask AI immediately
  if (API_CONFIG.enabled) {
    setStatusText("Using server AI (API mode).", false);
    askAIButton.disabled = false;
    setPanelVisibility(params.getMode);
    return;
  }

  // Auto-load local model on init only if WebGPU is available
  if (availableModels.length > 0 && ('gpu' in navigator)) {
    setStatusText("Initializing local model ...");
    initializeWebLLMEngine().then(() => {
      askAIButton.disabled = false;
      setPanelVisibility(params.getMode);
    }).catch(() => {
      askAIButton.disabled = true;
      setPanelVisibility(params.getMode);
    });
  } else {
    setStatusText("WebGPU not available — local model disabled.");
  }

  setPanelVisibility(params.getMode);
}
