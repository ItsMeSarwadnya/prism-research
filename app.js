import { performLiveSearch } from './services/search.js';
import { GROQ_MODELS, streamGroqChat } from './services/groq.js';
import { escapeHtml, renderMarkdownToHtml } from './utils/markdown.js';

const SESSION_API_KEY = 'playground_groq_api_key';
const THEME_KEY = 'playground_theme_v1';

const SYSTEM_PRESETS = [
  {
    id: 'Helpful',
    prompt: 'You are a helpful, friendly assistant. Be clear and accurate.',
  },
  {
    id: 'Concise',
    prompt: 'You are a concise assistant. Give direct, brief answers without filler.',
  },
  {
    id: 'Coder',
    prompt: 'You are an expert software engineer. Provide clean, well-tested code and brief explanations.',
  },
  {
    id: 'Teacher',
    prompt: 'You are a patient teacher. Explain concepts step by step using clear analogies.',
  },
  {
    id: 'Formal',
    prompt: 'You are a formal, professional assistant. Use structured, precise language.',
  },
];

const EXAMPLES = [
  { text: "What's new in AI this week?", tag: 'Web search' },
  {
    text: 'Write a Python function that checks if a string is a palindrome, with tests',
    tag: 'Coding',
  },
  { text: 'Suggest 10 names for a specialty coffee shop', tag: 'Brainstorm' },
  { text: 'Explain how transformers work in simple terms', tag: 'Explain' },
];

const DEFAULTS = {
  model: 'llama-3.3-70b-versatile',
  temperature: 0.7,
  maxTokens: 1024,
  topP: 1.0,
  webSearch: false,
  preset: 'Helpful',
  systemPrompt: SYSTEM_PRESETS[0].prompt,
};

const initialApiKey = sessionStorage.getItem(SESSION_API_KEY) || '';

const state = {
  ...DEFAULTS,
  theme: localStorage.getItem(THEME_KEY) || 'light',
  apiKey: initialApiKey,
  showApiModal: !initialApiKey.trim(),
  draftApiKey: initialApiKey,
  promptInput: '',
  messages: [],
  isStreaming: false,
  abortController: null,
};

function analyzePrompt(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const words = trimmed.split(/\s+/).length;
  const tokens = Math.max(1, Math.round(trimmed.length / 4));
  const lower = trimmed.toLowerCase();

  let taskType = 'General';
  let suggestedTemp = 0.7;

  if (/\b(code|python|javascript|function|bug|sql|regex|api|test|html|css)\b/.test(lower)) {
    taskType = 'Coding';
    suggestedTemp = 0.2;
  } else if (/\b(latest|today|this week|news|current|recent|2025|2026|search)\b/.test(lower)) {
    taskType = 'Web search';
    suggestedTemp = 0.4;
  } else if (/\b(suggest|ideas|names|brainstorm|creative|story|poem|tagline)\b/.test(lower)) {
    taskType = 'Brainstorm';
    suggestedTemp = 0.9;
  } else if (/\b(explain|how|why|what is|summarize|compare|difference)\b/.test(lower)) {
    taskType = 'Explain';
    suggestedTemp = 0.5;
  }

  let clarity = 55;
  if (words >= 5) clarity += 15;
  if (words >= 10) clarity += 10;
  if (/[?.!]$/.test(trimmed)) clarity += 8;
  if (/\b(with|using|in simple|step by step|for|format)\b/.test(lower)) clarity += 10;
  clarity = Math.min(98, clarity);

  return { tokens, words, taskType, clarity, suggestedTemp };
}

function updateAnalysisPanel() {
  const panel = document.getElementById('analysis-content');
  if (!panel) return;
  const info = analyzePrompt(state.promptInput);
  if (!info) {
    panel.innerHTML = `<p class="analysis-empty">Type a prompt to see its token count, task type, clarity score and a suggested temperature.</p>`;
    return;
  }

  panel.innerHTML = `
    <div class="analysis-card">
      <span class="analysis-label">Estimated tokens</span>
      <span class="analysis-val">${info.tokens} <span style="font-size:11.5px;font-weight:400;color:var(--text-muted);">${info.words} words</span></span>
    </div>
    <div class="analysis-card">
      <span class="analysis-label">Task type</span>
      <span class="analysis-val">${escapeHtml(info.taskType)}</span>
    </div>
    <div class="analysis-card">
      <span class="analysis-label">Clarity score</span>
      <span class="analysis-val">${info.clarity}/100</span>
      <div class="clarity-bar"><div class="clarity-fill" style="width:${info.clarity}%"></div></div>
    </div>
    <div class="analysis-card">
      <span class="analysis-label">Suggested temperature</span>
      <span class="analysis-val">
        ${info.suggestedTemp.toFixed(2)}
        <button type="button" id="apply-temp-btn" class="apply-btn">Apply</button>
      </span>
    </div>
  `;

  document.getElementById('apply-temp-btn')?.addEventListener('click', () => {
    state.temperature = info.suggestedTemp;
    render();
  });
}

function updateComposerChips() {
  const chips = document.getElementById('composer-chips');
  if (chips) {
    chips.innerHTML = `
      <span class="meta-chip">${escapeHtml(state.model)}</span>
      <span class="meta-chip">${state.webSearch ? 'Web search on' : 'Web search off'}</span>
      <span class="meta-chip">Temp ${state.temperature.toFixed(2)}</span>
    `;
  }
}

async function sendMessage(overrideText) {
  const text = (overrideText ?? state.promptInput).trim();
  if (!text || state.isStreaming) return;

  if (!state.apiKey.trim() && !state.webSearch) {
    state.showApiModal = true;
    state.draftApiKey = state.apiKey;
    render();
    return;
  }

  if (state.abortController) state.abortController.abort();
  const controller = new AbortController();
  state.abortController = controller;

  state.promptInput = '';
  state.isStreaming = true;

  const userMsg = { role: 'user', content: text };
  const assistantMsg = { role: 'assistant', content: '', sources: [], error: null };
  state.messages = [...state.messages, userMsg, assistantMsg];
  render();

  try {
    let sources = [];
    if (state.webSearch) {
      sources = await performLiveSearch(text, controller.signal);
      assistantMsg.sources = sources;
      render();
    }

    if (!state.apiKey.trim()) {
      assistantMsg.content =
        sources.length > 0
          ? 'Live web sources fetched above. Add a Groq API key in **API keys** to generate an AI response.'
          : 'No Groq API key set. Click **API keys** in the top right to add your `gsk_...` key.';
    } else {
      const historyForApi = state.messages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const full = await streamGroqChat({
        apiKey: state.apiKey,
        model: state.model,
        temperature: state.temperature,
        maxTokens: state.maxTokens,
        topP: state.topP,
        systemPrompt: state.systemPrompt,
        messages: historyForApi,
        sources,
        signal: controller.signal,
        onToken: (partial) => {
          assistantMsg.content = partial;
          const el = document.getElementById('streaming-msg-body');
          if (el) {
            el.innerHTML = renderMarkdownToHtml(partial, assistantMsg.sources);
          }
        },
      });
      assistantMsg.content = full;
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      assistantMsg.error = err.message || 'Request failed';
    }
  } finally {
    state.isStreaming = false;
    render();
  }
}

function render() {
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem(THEME_KEY, state.theme);
  const root = document.getElementById('app');
  const hasMessages = state.messages.length > 0;

  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <span class="brand-icon">N</span>
        <span>NovaLab</span>
        <span class="brand-tag">Workspace</span>
      </div>
      <div class="topbar-actions">
        <button type="button" id="theme-toggle-btn" class="text-btn">
          ${state.theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
        <button type="button" id="api-keys-btn" class="text-btn">
          API keys${state.apiKey.trim() ? '<span class="key-dot" title="Key active"></span>' : ''}
        </button>
        <button type="button" id="clear-btn" class="text-btn" ${!hasMessages ? 'disabled' : ''}>
          Clear
        </button>
      </div>
    </header>

    <div class="workspace">
      <aside class="sidebar-left">
        <h2 class="panel-heading">Settings</h2>

        <div class="field-group">
          <label class="field-header" for="model-select">Model</label>
          <select id="model-select" class="model-select">
            ${GROQ_MODELS.map(
              (m) =>
                `<option value="${escapeHtml(m.id)}" ${m.id === state.model ? 'selected' : ''}>${escapeHtml(
                  m.label
                )}</option>`
            ).join('')}
          </select>
        </div>

        <div class="field-group">
          <div class="field-header">
            <span>Temperature</span>
            <span id="temp-val" class="field-value">${state.temperature.toFixed(2)}</span>
          </div>
          <input id="temp-slider" type="range" class="range-slider" min="0" max="2" step="0.05" value="${
            state.temperature
          }" />
          <div class="slider-labels">
            <span>Precise</span>
            <span>Creative</span>
            <span>Random</span>
          </div>
        </div>

        <div class="field-group">
          <div class="field-header">
            <span>Max tokens</span>
            <span id="tokens-val" class="field-value">${state.maxTokens}</span>
          </div>
          <input id="tokens-slider" type="range" class="range-slider" min="128" max="4096" step="64" value="${
            state.maxTokens
          }" />
        </div>

        <div class="field-group">
          <div class="field-header">
            <span>Top P</span>
            <span id="topp-val" class="field-value">${state.topP.toFixed(2)}</span>
          </div>
          <input id="topp-slider" type="range" class="range-slider" min="0.1" max="1" step="0.05" value="${
            state.topP
          }" />
        </div>

        <div class="toggle-card">
          <div>
            <div class="toggle-title">Web search</div>
            <div class="toggle-sub">${
              state.webSearch ? 'Live web context enabled' : 'Model uses its own knowledge'
            }</div>
          </div>
          <label class="switch">
            <input id="web-search-toggle" type="checkbox" ${state.webSearch ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </label>
        </div>

        <div class="field-group">
          <div class="field-header"><span>System prompt</span></div>
          <div class="preset-row">
            ${SYSTEM_PRESETS.map(
              (p) =>
                `<button type="button" class="preset-pill ${
                  state.preset === p.id ? 'active' : ''
                }" data-preset="${p.id}">${p.id}</button>`
            ).join('')}
          </div>
          <textarea id="system-prompt-input" class="system-textarea">${escapeHtml(
            state.systemPrompt
          )}</textarea>
        </div>

        <button type="button" id="reset-defaults-btn" class="reset-link">Reset to defaults</button>
      </aside>

      <main class="center-pane">
        <div class="chat-scroll" id="chat-scroll">
          ${
            !hasMessages
              ? `
            <div class="empty-state">
              <h1 class="empty-title">Start a <em>conversation</em></h1>
              <p class="empty-sub">Choose an example or write your own prompt. Live token and clarity analysis updates as you type.</p>
              <div class="examples-grid">
                ${EXAMPLES.map(
                  (ex, idx) => `
                  <button type="button" class="example-card" data-example-idx="${idx}">
                    <span class="example-text">${escapeHtml(ex.text)}</span>
                    <span class="example-tag">${escapeHtml(ex.tag)}</span>
                  </button>`
                ).join('')}
              </div>
            </div>`
              : `
            <div class="messages-list">
              ${state.messages
                .map((msg, idx) => {
                  const isLastAssistant = idx === state.messages.length - 1 && msg.role === 'assistant';
                  return `
                  <div class="msg-row ${msg.role}">
                    <span class="msg-role">${msg.role === 'user' ? 'You' : escapeHtml(state.model)}</span>
                    <div class="msg-bubble">
                      ${
                        msg.sources?.length
                          ? `<div class="sources-row">
                              ${msg.sources
                                .map(
                                  (s, sIdx) =>
                                    `<a class="source-chip" href="${escapeHtml(
                                      s.url
                                    )}" target="_blank" rel="noopener noreferrer">[${sIdx + 1}] ${escapeHtml(
                                      s.title
                                    )}</a>`
                                )
                                .join('')}
                            </div>`
                          : ''
                      }
                      ${
                        msg.error
                          ? `<p class="error-text">${escapeHtml(msg.error)}</p>`
                          : `<div ${isLastAssistant ? 'id="streaming-msg-body"' : ''}>${
                              msg.role === 'user'
                                ? escapeHtml(msg.content)
                                : renderMarkdownToHtml(
                                    msg.content || (state.isStreaming ? 'Thinking...' : ''),
                                    msg.sources || []
                                  )
                            }</div>`
                      }
                    </div>
                  </div>`;
                })
                .join('')}
            </div>`
          }
        </div>

        <div class="composer-wrap">
          <div class="composer-box">
            <textarea
              id="prompt-input"
              class="composer-textarea"
              placeholder="Message the model... (Enter to send, Shift+Enter for a new line)"
            >${escapeHtml(state.promptInput)}</textarea>
            <div class="composer-bottom">
              <div id="composer-chips" class="composer-chips">
                <span class="meta-chip">${escapeHtml(state.model)}</span>
                <span class="meta-chip">${state.webSearch ? 'Web search on' : 'Web search off'}</span>
                <span class="meta-chip">Temp ${state.temperature.toFixed(2)}</span>
              </div>
              <button type="button" id="send-btn" class="send-btn" ${
                !state.promptInput.trim() || state.isStreaming ? 'disabled' : ''
              }>
                ${state.isStreaming ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </main>

      <aside class="sidebar-right">
        <h2 class="panel-heading">Prompt analysis</h2>
        <div id="analysis-content"></div>
      </aside>
    </div>

    ${
      state.showApiModal
        ? `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-card">
          <div class="modal-title">Groq API key</div>
          <p class="modal-sub">
            Enter your Groq API key (<code>gsk_...</code>). It stays masked and stored only for this browser session.
          </p>
          <input
            id="modal-key-input"
            type="password"
            class="modal-input"
            placeholder="gsk_..."
            value="${escapeHtml(state.draftApiKey)}"
          />
          <div class="modal-actions">
            <button type="button" id="modal-cancel-btn" class="btn-secondary">Cancel</button>
            <button type="button" id="modal-save-btn" class="btn-primary">Save key</button>
          </div>
        </div>
      </div>`
        : ''
    }
  `;

  updateAnalysisPanel();
  bindEvents();

  const chatScroll = document.getElementById('chat-scroll');
  if (chatScroll && hasMessages) {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }
}

function bindEvents() {
  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    render();
  });

  document.getElementById('api-keys-btn')?.addEventListener('click', () => {
    state.draftApiKey = state.apiKey;
    state.showApiModal = true;
    render();
  });

  document.getElementById('clear-btn')?.addEventListener('click', () => {
    if (state.abortController) state.abortController.abort();
    state.messages = [];
    state.isStreaming = false;
    render();
  });

  document.getElementById('model-select')?.addEventListener('change', (e) => {
    state.model = e.target.value;
    updateComposerChips();
  });

  document.getElementById('temp-slider')?.addEventListener('input', (e) => {
    state.temperature = parseFloat(e.target.value);
    const label = document.getElementById('temp-val');
    if (label) label.textContent = state.temperature.toFixed(2);
    updateComposerChips();
  });

  document.getElementById('tokens-slider')?.addEventListener('input', (e) => {
    state.maxTokens = parseInt(e.target.value, 10);
    const label = document.getElementById('tokens-val');
    if (label) label.textContent = String(state.maxTokens);
  });

  document.getElementById('topp-slider')?.addEventListener('input', (e) => {
    state.topP = parseFloat(e.target.value);
    const label = document.getElementById('topp-val');
    if (label) label.textContent = state.topP.toFixed(2);
  });

  document.getElementById('web-search-toggle')?.addEventListener('change', (e) => {
    state.webSearch = e.target.checked;
    render();
  });

  document.querySelectorAll('.preset-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = SYSTEM_PRESETS.find((p) => p.id === btn.dataset.preset);
      if (preset) {
        state.preset = preset.id;
        state.systemPrompt = preset.prompt;
        render();
      }
    });
  });

  document.getElementById('system-prompt-input')?.addEventListener('input', (e) => {
    state.systemPrompt = e.target.value;
    state.preset = '';
  });

  document.getElementById('reset-defaults-btn')?.addEventListener('click', () => {
    Object.assign(state, DEFAULTS);
    render();
  });

  document.querySelectorAll('.example-card').forEach((card) => {
    card.addEventListener('click', () => {
      const ex = EXAMPLES[Number(card.dataset.exampleIdx)];
      if (ex) {
        state.promptInput = ex.text;
        if (ex.tag === 'Web search') state.webSearch = true;
        render();
        document.getElementById('prompt-input')?.focus();
      }
    });
  });

  const promptInput = document.getElementById('prompt-input');
  const sendBtn = document.getElementById('send-btn');

  promptInput?.addEventListener('input', (e) => {
    state.promptInput = e.target.value;
    if (sendBtn) sendBtn.disabled = !state.promptInput.trim() || state.isStreaming;
    updateAnalysisPanel();
  });

  promptInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn?.addEventListener('click', () => sendMessage());

  document.getElementById('modal-cancel-btn')?.addEventListener('click', () => {
    state.showApiModal = false;
    render();
  });

  document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') {
      state.showApiModal = false;
      render();
    }
  });

  const modalKeyInput = document.getElementById('modal-key-input');
  if (state.showApiModal && modalKeyInput) {
    modalKeyInput.focus();
  }
  modalKeyInput?.addEventListener('input', (e) => {
    state.draftApiKey = e.target.value;
  });
  modalKeyInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('modal-save-btn')?.click();
    }
  });

  document.getElementById('modal-save-btn')?.addEventListener('click', () => {
    state.apiKey = state.draftApiKey.trim();
    if (state.apiKey) {
      sessionStorage.setItem(SESSION_API_KEY, state.apiKey);
    } else {
      sessionStorage.removeItem(SESSION_API_KEY);
    }
    state.showApiModal = false;
    render();
  });
}

render();
