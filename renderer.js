const companion = window.companion;
document.querySelectorAll('.drag-region').forEach((zone) => {
  zone.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || event.target.closest('button, input, textarea, select')) return;
    window.webkit?.messageHandlers?.companion?.postMessage({ action: 'window:drag' });
  });
});
const elements = {
  brand: document.querySelector('#brand-name'),
  greeting: document.querySelector('#greeting'),
  bubble: document.querySelector('#speech-bubble'),
  petWrap: document.querySelector('#pet-wrap'),
  celebrationCanvas: document.querySelector('#celebration-canvas'),
  celebrateButton: document.querySelector('#celebrate-button'),
  messages: document.querySelector('#messages'),
  jumpLatest: document.querySelector('#jump-latest'),
  contextMeter: document.querySelector('#context-meter'),
  contextLabel: document.querySelector('#context-label'),
  contextFill: document.querySelector('#context-fill'),
  form: document.querySelector('#chat-form'),
  input: document.querySelector('#chat-input'),
  send: document.querySelector('#send-button'),
  stop: document.querySelector('#stop-button'),
  petState: document.querySelector('#pet-state'),
  speechLanguage: document.querySelector('#speech-language'),
  speechButton: document.querySelector('#speech-button'),
  speechStatus: document.querySelector('#speech-status'),
  attachmentToggle: document.querySelector('#attachment-toggle'),
  attachmentMenu: document.querySelector('#attachment-menu'),
  tipsLayer: document.querySelector('#tips-layer'),
  tipsButton: document.querySelector('#tips-button'),
  fileButton: document.querySelector('#file-button'),
  fileInput: document.querySelector('#file-input'),
  folderButton: document.querySelector('#folder-button'),
  localContext: document.querySelector('#local-context'),
  localContextLabel: document.querySelector('#local-context-label'),
  localContextClear: document.querySelector('#local-context-clear'),
  focusButton: document.querySelector('#focus-button'),
  focusPanel: document.querySelector('#focus-panel'),
  focusTitle: document.querySelector('#focus-title'),
  focusClock: document.querySelector('#focus-clock'),
  focusLength: document.querySelector('#focus-length'),
  breakLength: document.querySelector('#break-length'),
  focusStart: document.querySelector('#focus-start'),
  focusReset: document.querySelector('#focus-reset'),
  focusStatus: document.querySelector('#focus-status'),
  screenButton: document.querySelector('#screen-button'),
  screenTarget: document.querySelector('#screen-target'),
  screenStatus: document.querySelector('#screen-status'),
  screenStatusText: document.querySelector('#screen-status-text'),
  screenSettings: document.querySelector('#screen-settings'),
  screenClear: document.querySelector('#screen-clear'),
  pill: document.querySelector('#connection-pill'),
  settingsLayer: document.querySelector('#settings-layer'),
  historyButton: document.querySelector('#history-button'),
  historyLayer: document.querySelector('#history-layer'),
  historyList: document.querySelector('#history-list'),
  activeChatsTab: document.querySelector('#active-chats-tab'),
  archivedChatsTab: document.querySelector('#archived-chats-tab'),
  newChat: document.querySelector('#new-chat-button'),
  petName: document.querySelector('#pet-name'),
  userName: document.querySelector('#user-name'),
  modelProvider: document.querySelector('#model-provider'),
  providerHint: document.querySelector('#provider-hint'),
  modelTokenSettings: document.querySelector('#model-token-settings'),
  configureModelToken: document.querySelector('#configure-model-token'),
  modelTokenStatus: document.querySelector('#model-token-status'),
  endpoint: document.querySelector('#api-endpoint'),
  model: document.querySelector('#model-select'),
  personality: document.querySelector('#personality'),
  morningGreeting: document.querySelector('#morning-greeting'),
  timerCelebrations: document.querySelector('#timer-celebrations'),
  ahaCelebrations: document.querySelector('#aha-celebrations'),
  celebrationPetCheer: document.querySelector('#celebration-pet-cheer'),
  celebrationFireworks: document.querySelector('#celebration-fireworks'),
  fireworkIntensity: document.querySelector('#firework-intensity'),
  celebrationPreview: document.querySelector('#celebration-preview'),
  allowNetworkSpeech: document.querySelector('#allow-network-speech'),
  detect: document.querySelector('#detect-button'),
  modelStatus: document.querySelector('#model-status'),
  timerTool: document.querySelector('#timer-tool'),
  clockPanel: document.querySelector('#clock-panel'),
  clockHide: document.querySelector('#clock-hide'),
  countdownList: document.querySelector('#countdown-list'),
  stopwatchClock: document.querySelector('#stopwatch-clock'),
  stopwatchToggle: document.querySelector('#stopwatch-toggle'),
  stopwatchReset: document.querySelector('#stopwatch-reset'),
  clockHint: document.querySelector('#clock-hint'),
  screenSources: document.querySelector('#screen-sources'),
  toolControls: document.querySelector('#tool-controls'),
  toolHint: document.querySelector('#tool-hint'),
  searchButton: document.querySelector('#web-search-button'),
  webSearchStatus: document.querySelector('#web-search-status'),
  configureSearchKey: document.querySelector('#configure-search-key'),
  getSearchKey: document.querySelector('#get-search-key'),
  save: document.querySelector('#save-settings'),
  saveStatus: document.querySelector('#save-status')
};

let config;
const history = [];
let activeChat = null;
let historyTab = 'active';
let searchMode = 'off';
let speechState = 'idle';
let speechDraftBefore = '';
let speechCapabilities = new Map();
const enabledTools = new Set();
let petMoodTimer = null;
let petBlinkTimer = null;
let petBlinkReturnTimer = null;
let petBubbleTimer = null;
let petBubbleExitTimer = null;
let isReplying = false;
let stopRequested = false;
let activeWriter = null;
let isPreparingFile = false;
let followLatestMessage = true;
let lastHoverAt = -Infinity;
const petPictures = [...elements.petWrap.querySelectorAll('[data-pet-pose]')];

function userAddress() {
  return config?.userName ? `, ${config.userName}` : '';
}

function showPetPose(pose, blinking = false) {
  elements.petWrap.classList.toggle('is-blinking', blinking);
  for (const picture of petPictures) {
    picture.classList.toggle('is-visible', picture.dataset.petPose === pose);
  }
}

function hidePetBubble(immediate = false) {
  clearTimeout(petBubbleTimer);
  clearTimeout(petBubbleExitTimer);
  elements.bubble.classList.remove('visible');
  elements.bubble.classList.add('leaving');
  if (immediate) elements.bubble.hidden = true;
  else petBubbleExitTimer = setTimeout(() => { elements.bubble.hidden = true; }, 320);
}

function showPetBubble(text, duration = 3400) {
  clearTimeout(petBubbleTimer);
  clearTimeout(petBubbleExitTimer);
  elements.bubble.textContent = text;
  elements.bubble.hidden = false;
  elements.bubble.classList.remove('leaving');
  requestAnimationFrame(() => elements.bubble.classList.add('visible'));
  if (duration > 0) petBubbleTimer = setTimeout(() => hidePetBubble(), duration);
}

// Every mood transition is caused by a named interaction or outcome.
const petTransitions = {
  greet: ['mood-hello', 'Greeting'],
  think: ['mood-thinking', 'Thinking'],
  complete: ['mood-happy', 'Happy'],
  cheer: ['mood-happy', 'Celebrating'],
  focus: ['mood-curious', 'Focused'],
  error: ['mood-concerned', 'Needs attention'],
  stopped: ['mood-hello', 'Stopped'],
  settle: ['', 'Resting'],
};
let petState = 'settle';
function petEvent(event, duration = 0) {
  if (!petTransitions[event]) return;
  // A timer, hover, or focus event must not interrupt an active response.
  if (petState === 'think' && isReplying && !['think', 'complete', 'cheer', 'error', 'stopped'].includes(event)) return;
  clearTimeout(petMoodTimer);
  clearInterval(petBlinkTimer);
  clearTimeout(petBlinkReturnTimer);
  petState = event;
  elements.petWrap.classList.toggle('is-cheering', event === 'cheer');
  const [mood, label] = petTransitions[petState];
  elements.petWrap.dataset.mood = mood || 'resting';
  elements.petWrap.setAttribute('aria-label', `Pikachu: ${label.toLowerCase()}`);
  elements.petState.textContent = label;
  showPetPose(mood === 'mood-thinking' ? 'thinking' : (mood === 'mood-hello' || event === 'cheer') ? 'hello' : 'resting');
  if (event === 'think') {
    showPetBubble('thinking...', 0);
    petBlinkTimer = setInterval(() => {
      if (document.hidden || petState !== 'think') return;
      showPetPose('thinking-blink', true);
      petBlinkReturnTimer = setTimeout(() => { if (petState === 'think') showPetPose('thinking', true); }, 300);
    }, 3000);
  }
  if (duration > 0) petMoodTimer = setTimeout(() => petEvent(isReplying ? 'think' : 'settle'), duration);
}

let fireworksFrame = null;
const celebratedTimers = new Set();

function playFireworks(intensity = 'balanced') {
  const canvas = elements.celebrationCanvas;
  const context = canvas.getContext('2d');
  if (!context) return;
  if (fireworksFrame !== null) cancelAnimationFrame(fireworksFrame);

  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  canvas.hidden = false;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const settings = {
    gentle: { count: 3, sparks: 30 },
    balanced: { count: 5, sparks: 48 },
    bright: { count: 5, sparks: 64 },
  }[intensity] || { count: 5, sparks: 48 };
  const colors = ['#367fd2', '#3da85f', '#db5255', '#d9aa1c', '#5799e6', '#69bd72', '#ed6d60', '#edc448', '#ef9250', '#a66ccc', '#cf6caa'];
  const places = [
    { x: .16, y: .24 }, { x: .82, y: .37 }, { x: .43, y: .66 },
    { x: .68, y: .17 }, { x: .15, y: .73 },
  ];
  const count = reducedMotion ? 2 : settings.count;
  const radius = Math.min(112, Math.max(45, Math.min(width, height) * .22));
  const bursts = places.slice(0, count).map((place, burstIndex) => ({
    x: width * place.x,
    y: height * place.y,
    delay: burstIndex * (reducedMotion ? 180 : 430),
    sparks: Array.from({ length: reducedMotion ? 8 : settings.sparks }, (_, index) => {
      const angle = (Math.PI * 2 * index / (reducedMotion ? 8 : settings.sparks)) + (Math.random() - .5) * .18;
      const speed = radius * (.72 + Math.random() * .45);
      return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1.2 + Math.random() * .45, color: colors[(index + burstIndex * 3) % colors.length] };
    }),
  }));
  const started = performance.now();
  const launchTime = reducedMotion ? 0 : 360;
  const duration = bursts[bursts.length - 1].delay + launchTime + (reducedMotion ? 950 : 1800);

  function draw(now) {
    const elapsed = now - started;
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    for (const burst of bursts) {
      const local = elapsed - burst.delay;
      if (local < 0) continue;
      if (local < launchTime) {
        const progress = local / launchTime;
        const y = height - 12 + (burst.y - (height - 12)) * (1 - (1 - progress) ** 2);
        context.globalAlpha = .75;
        context.strokeStyle = '#d3a62d';
        context.lineWidth = 2;
        context.beginPath(); context.moveTo(burst.x, y + 18); context.lineTo(burst.x, y); context.stroke();
        continue;
      }
      const age = (local - launchTime) / 1000;
      for (const spark of burst.sparks) {
        if (age >= spark.life) continue;
        const motionAge = reducedMotion ? .32 : age;
        const x = burst.x + spark.vx * motionAge;
        const y = burst.y + spark.vy * motionAge + (reducedMotion ? 0 : 28 * age * age);
        context.globalAlpha = Math.pow(Math.max(0, 1 - age / spark.life), .7) * .9;
        context.strokeStyle = spark.color;
        context.fillStyle = spark.color;
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(x - spark.vx * (reducedMotion ? 0 : .105), y - spark.vy * (reducedMotion ? 0 : .105));
        context.lineTo(x, y); context.stroke();
        context.beginPath(); context.arc(x, y, 2.5, 0, Math.PI * 2); context.fill();
      }
    }
    context.globalAlpha = 1;
    if (elapsed < duration) fireworksFrame = requestAnimationFrame(draw);
    else { context.clearRect(0, 0, width, height); canvas.hidden = true; fireworksFrame = null; }
  }
  fireworksFrame = requestAnimationFrame(draw);
}

function celebrate(reason, message, overrideSettings = null) {
  const routines = overrideSettings || config?.routines || {};
  if (reason === 'timer' && routines.timerCelebrations === false) return false;
  if (reason === 'aha' && routines.ahaCelebrations === false) return false;
  if (message) showPetBubble(message, 5000);
  if (routines.petCheer !== false) petEvent('cheer', 3000);
  else if (!isReplying) petEvent('complete', 1800);
  if (routines.fireworks !== false) playFireworks(routines.fireworkIntensity);
  return true;
}

function celebrateTimer(id, message) {
  if (id && celebratedTimers.has(id)) return;
  if (id) celebratedTimers.add(id);
  if (!celebrate('timer', message)) {
    showPetBubble(message, 5000);
    if (!isReplying) petEvent('complete', 1800);
  }
}

function isAhaMoment(text) {
  return /\b(?:i\s+(?:finally\s+)?(?:get it|got it|understand(?: it| now)?|see now)|(?:now\s+)?i\s+(?:get|understand)\s+it|i(?:'ve| have)\s+figured\s+it\s+out|it\s+(?:finally\s+)?(?:clicked|clicks)|(?:that|it)\s+makes\s+(?:so much\s+)?sense|aha|eureka|got it)\b|我(?:终于)?(?:懂了|明白了|理解了)|原来如此|恍然大悟|明白了|原来是这样/iu.test(text);
}

elements.celebrateButton.addEventListener('click', () => celebrate('manual', `Yay${userAddress()}!`));

elements.petWrap.addEventListener('pointerenter', () => {
  const now = performance.now();
  if (isReplying || now - lastHoverAt < 4500) return;
  lastHoverAt = now;
  petEvent('greet', 2600);
  showPetBubble(`Hey${userAddress()}!`, 2600);
});

function setConnection(connected, text) {
  elements.pill.classList.toggle('connected', connected);
  elements.pill.querySelector('span').textContent = text;
}

function updateSearchButton() {
  elements.searchButton.classList.toggle('active', searchMode !== 'off');
  elements.searchButton.setAttribute('aria-pressed', String(searchMode !== 'off'));
  const labels = { auto: '🌐 Auto', on: '🌐 Always', off: '🌐 Offline' };
  const hints = {
    auto: 'Search automatically when useful. Click to always search.',
    on: 'Always search for ordinary questions. Click for offline mode.',
    off: 'Web search is off for this chat. Click for automatic search.'
  };
  elements.searchButton.textContent = labels[searchMode];
  elements.searchButton.title = hints[searchMode];
  elements.searchButton.setAttribute('aria-label', hints[searchMode]);
}

function updateToolControls() {
  elements.toolControls.hidden = true;
}

// Delay an unfinished math expression while streaming so raw markup never flashes.
function visibleStreamText(content) {
  const openers = /\$\$|\\\[|\\\(|\$/g;
  let match;
  while ((match = openers.exec(content)) !== null) {
    const start = match.index;
    if (start > 0 && content[start - 1] === '\\' && match[0][0] === '$') continue;
    const token = match[0];
    const closing = token === '\\(' ? '\\)' : token === '\\[' ? '\\]' : token;
    const end = content.indexOf(closing, start + token.length);
    if (end < 0) {
      if (token === '$' && /^\$\d+(?:[.,]\d+)*(?:\s|$)/.test(content.slice(start))) continue;
      return content.slice(0, start);
    }
    openers.lastIndex = end + closing.length;
  }
  const partialCommand = content.match(/\\[A-Za-z]*$/);
  if (partialCommand) return content.slice(0, partialCommand.index);
  const incompleteExpression = content.match(/\\(?:frac|sqrt)\b[^\\\n]*$/);
  if (incompleteExpression) {
    const tail = incompleteExpression[0];
    const complete = /^\\frac\s*\{[^{}]*\}\s*\{[^{}]*\}/.test(tail) || /^\\sqrt\s*\{[^{}]*\}/.test(tail);
    if (!complete) return content.slice(0, incompleteExpression.index);
  }
  return content;
}

function readablePlainText(value) {
  const symbols = { times: '×', cdot: '·', div: '÷', pm: '±', leq: '≤', geq: '≥', neq: '≠', approx: '≈', pi: 'π', infty: '∞' };
  return value.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)⁄($2)')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, '√($1)')
    .replace(/\\(times|cdot|div|pm|leq|geq|neq|approx|pi|infty)\b/g, (_, command) => symbols[command])
    .replace(/\\[()[\]]/g, '');
}

function appendFormattedContent(target, content, { streaming = false } = {}) {
  if (streaming) content = visibleStreamText(content);
  const mathPattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
  let cursor = 0;
  let match;

  while ((match = mathPattern.exec(content)) !== null) {
    // Do not turn two ordinary currency amounts into a math expression.
    if (match[4] && /^\d[\d,.]*\s/.test(match[4]) && /\d/.test(content[mathPattern.lastIndex] || '')) continue;
    if (match.index > cursor) {
      target.append(document.createTextNode(readablePlainText(content.slice(cursor, match.index))));
    }

    const displayMode = match[1] !== undefined || match[2] !== undefined;
    const tex = [match[1], match[2], match[3], match[4]].find((part) => part !== undefined);
    const math = document.createElement('span');
    math.className = displayMode ? 'math-display' : 'math-inline';
    try {
      katex.render(tex.trim(), math, { displayMode, throwOnError: true, trust: false, strict: 'ignore' });
    } catch {
      math.textContent = readablePlainText(tex);
    }
    target.append(math);
    cursor = mathPattern.lastIndex;
  }

  if (cursor < content.length) target.append(document.createTextNode(readablePlainText(content.slice(cursor))));
}

function addMessage(role, content, { pending = false } = {}) {
  const row = document.createElement('div');
  row.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}${pending ? ' pending-message' : ''}`;
  if (role !== 'user') {
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.textContent = (config?.petName || 'm').slice(0, 1).toLowerCase();
    row.append(avatar);
  }
  const text = document.createElement('p');
  appendFormattedContent(text, content);
  row.append(text);
  elements.messages.append(row);
  keepMessagesAtEnd();
  return row;
}

function isMessagesNearEnd() {
  const messages = elements.messages;
  return messages.scrollHeight - messages.clientHeight - messages.scrollTop <= 6;
}

function updateJumpLatestButton() {
  const canScroll = elements.messages.scrollHeight - elements.messages.clientHeight > 8;
  elements.jumpLatest.hidden = !canScroll || isMessagesNearEnd();
}

function keepMessagesAtEnd(force = false) {
  if (force) followLatestMessage = true;
  if (followLatestMessage) elements.messages.scrollTop = elements.messages.scrollHeight;
  updateJumpLatestButton();
}

elements.messages.addEventListener('scroll', () => {
  followLatestMessage = isMessagesNearEnd();
  updateJumpLatestButton();
}, { passive: true });
elements.messages.addEventListener('wheel', (event) => {
  if (event.deltaY < 0) {
    followLatestMessage = false;
    updateJumpLatestButton();
  }
}, { passive: true });
elements.jumpLatest.addEventListener('click', () => {
  followLatestMessage = true;
  elements.messages.scrollTop = elements.messages.scrollHeight;
  updateJumpLatestButton();
});
new ResizeObserver(updateJumpLatestButton).observe(elements.messages);

window.__companionTimerFired = ({ message, id }) => {
  const content = `⏰ ${message}`;
  addMessage('assistant', content);
  history.push({ role: 'assistant', content });
  if (activeChat) companion.appendMessage(activeChat.id, { role: 'assistant', content }).catch(() => {});
  celebrateTimer(id, message);
  keepMessagesAtEnd();
};

function resizeInput() {
  elements.input.style.height = 'auto';
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 100)}px`;
}

function updateSpeechTranscript(transcript) {
  const prefix = speechDraftBefore ? `${speechDraftBefore}\n` : '';
  elements.input.value = `${prefix}${transcript || ''}`;
  resizeInput();
}

function finishSpeechUI(state, status = '') {
  speechState = state;
  elements.speechButton.disabled = false;
  elements.speechButton.classList.remove('active');
  elements.speechButton.textContent = '🎙';
  elements.speechButton.setAttribute('aria-label', 'Start voice dictation');
  elements.speechButton.title = 'Speak a draft';
  elements.input.disabled = false;
  elements.speechLanguage.disabled = false;
  elements.send.disabled = false;
  elements.historyButton.disabled = false;
  elements.speechStatus.hidden = !status;
  elements.speechStatus.textContent = status;
  elements.input.focus();
}

window.__companionSpeechEvent = (event) => {
  if (event.transcript !== undefined) updateSpeechTranscript(event.transcript);
  if (event.state === 'recording') {
    speechState = 'recording';
    elements.speechButton.disabled = false;
    elements.speechButton.classList.add('active');
    elements.speechButton.textContent = '■';
    elements.speechButton.setAttribute('aria-label', 'Stop voice dictation');
    elements.speechButton.title = 'Stop and review the transcript';
    elements.input.disabled = true;
    elements.speechLanguage.disabled = true;
    elements.send.disabled = true;
    elements.historyButton.disabled = true;
    elements.speechStatus.hidden = false;
    elements.speechStatus.textContent = event.status || 'Listening…';
  } else if (event.state === 'finalizing') {
    speechState = 'finalizing';
    elements.speechButton.disabled = true;
    elements.input.disabled = true;
    elements.speechLanguage.disabled = true;
    elements.send.disabled = true;
    elements.speechStatus.hidden = false;
    elements.speechStatus.textContent = event.status || 'Finishing your draft…';
  } else if (event.state === 'ready') {
    finishSpeechUI('idle', event.status || 'Transcript ready to edit');
  } else if (event.state === 'error') {
    finishSpeechUI('idle', event.error || event.status || 'Dictation stopped. You can edit the words captured so far.');
  } else if (event.state === 'cancelled') {
    updateSpeechTranscript('');
    finishSpeechUI('idle', 'Dictation cancelled');
  }
};

window.__companionScreenEvent = (event) => {
  const active = !!event && ['capturing', 'ready-image', 'ready-text'].includes(event.state);
  elements.screenButton.classList.toggle('active', active);
  elements.screenButton.setAttribute('aria-pressed', String(active));
  if (!event || event.state === 'clear') {
    elements.screenStatus.hidden = true;
    elements.screenStatusText.textContent = '';
    elements.screenSettings.hidden = true;
    elements.screenClear.hidden = true;
    elements.screenButton.disabled = isReplying;
    elements.screenTarget.disabled = isReplying;
    return;
  }
  elements.screenStatus.hidden = false;
  elements.screenStatusText.textContent = event.status || 'Screen context is active for this request.';
  elements.screenSettings.hidden = event.settingsRequired !== true;
  elements.screenClear.hidden = event.clearable !== true;
  elements.screenButton.disabled = isReplying || event.state === 'capturing';
  elements.screenTarget.disabled = isReplying || event.state === 'capturing';
  elements.screenSources.disabled = isReplying || event.state === 'capturing';
};

async function refreshScreenDisplays() {
  try {
    const displays = await companion.screenDisplays();
    const selected = elements.screenTarget.value || 'frontmost';
    elements.screenTarget.replaceChildren(new Option("Select an area", "region"), ...displays.map((display) => new Option(display.name, display.id)));
    if (displays.some((display) => display.id === selected)) elements.screenTarget.value = selected;
  } catch (error) {
    elements.screenTarget.replaceChildren(new Option('Frontmost app window', 'frontmost'), new Option('Select an area', 'region'));
  }
}

async function refreshScreenSources() {
  if (isReplying || elements.screenButton.disabled) return;
  elements.screenSources.disabled = true;
  try {
    const result = await companion.screenSources();
    const selected = elements.screenTarget.value || 'frontmost';
    const oldName = elements.screenTarget.selectedOptions[0]?.textContent;
    const groups = new Map();
    const region = new Option('Select an area', 'region');
    elements.screenTarget.replaceChildren(region);
    for (const source of result.sources || []) {
      let group = groups.get(source.group || 'Displays');
      if (!group) { group = document.createElement('optgroup'); group.label = source.group || 'Displays'; groups.set(group.label, group); elements.screenTarget.append(group); }
      group.append(new Option(source.name, source.id));
    }
    if ([...elements.screenTarget.options].some(option => option.value === selected)) elements.screenTarget.value = selected;
    else if (selected !== 'region' && oldName) { const option = new Option(`${oldName} (refresh needed)`, selected); elements.screenTarget.append(option); elements.screenTarget.value = selected; }
    else elements.screenTarget.value = 'region';
    elements.screenSources.title = result.notice || 'Choose an application or window from the source list.';
    if (result.notice) showPetBubble(result.notice, 5500);
    elements.screenTarget.focus();
  } catch (error) { showPetBubble(error.message, 5000); }
  finally { elements.screenSources.disabled = false; }
}
elements.screenSources.addEventListener('click', refreshScreenSources);

async function refreshSpeechCapabilities() {
  try {
    const capabilities = await companion.speechCapabilities();
    speechCapabilities = new Map(capabilities.map((item) => [item.id, item]));
    for (const option of elements.speechLanguage.options) {
      const capability = speechCapabilities.get(option.value);
      option.disabled = capability ? !capability.supported : true;
    }
    showSpeechLanguageInfo();
  } catch {
    elements.speechStatus.textContent = 'Mac speech recognition is unavailable.';
    elements.speechStatus.hidden = false;
  }
}

function showSpeechLanguageInfo() {
  const capability = speechCapabilities.get(elements.speechLanguage.value);
  if (!capability) return;
  if (!capability.supported) {
    elements.speechStatus.textContent = 'This language is not supported by Mac speech recognition.';
  } else if (capability.onDevice) {
    elements.speechStatus.hidden = true;
    elements.speechButton.title = `${capability.label} dictation · on this Mac`;
    return;
  } else if (elements.allowNetworkSpeech.checked) {
    elements.speechStatus.textContent = `${capability.label} uses Apple network speech; audio may be sent to Apple while dictating.`;
  } else {
    elements.speechStatus.textContent = `${capability.label} needs network speech on this Mac. Enable it in Settings; no audio is sent unless you opt in.`;
  }
  elements.speechStatus.hidden = false;
}

function renderChat(chat) {
  hidePetBubble(true);
  activeChat = chat;
  localSelection = { file: null, folder: null };
  updateLocalSelection();
  searchMode = ['auto', 'on', 'off'].includes(chat.searchMode) ? chat.searchMode : 'off';
  updateSearchButton();
  updateToolControls();
  history.splice(0, history.length, ...chat.messages.map(({ role, content }) => ({ role, content })));
  elements.messages.replaceChildren();
  if (!chat.messages.length) {
    addMessage('assistant', 'Ask me anything. Your messages stay on this computer when I’m connected to a local model.');
  } else {
    for (const message of chat.messages) {
      const row = addMessage(message.role, message.content);
      if (message.role === 'assistant') {
        addSources(row, message.sources);
        if (message.searchNotice) addSearchNotice(row, message.searchNotice);
      }
    }
  }
  keepMessagesAtEnd(true);
  refreshContextMeter();
  closeHistory();
}

function closeHistory() {
  elements.historyLayer.classList.add('hidden');
  elements.historyLayer.setAttribute('aria-hidden', 'true');
}

async function openHistory() {
  elements.historyLayer.classList.remove('hidden');
  elements.historyLayer.setAttribute('aria-hidden', 'false');
  await refreshHistoryList();
}

function setHistoryTab(tab) {
  historyTab = tab;
  elements.activeChatsTab.classList.toggle('active', tab === 'active');
  elements.activeChatsTab.setAttribute('aria-pressed', String(tab === 'active'));
  elements.archivedChatsTab.classList.toggle('active', tab === 'archived');
  elements.archivedChatsTab.setAttribute('aria-pressed', String(tab === 'archived'));
  refreshHistoryList();
}

function historyAction(label, icon, className, handler) {
  const button = document.createElement('button');
  button.className = `history-row-action${className ? ` ${className}` : ''}`;
  button.type = 'button';
  button.textContent = icon;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', handler);
  return button;
}

async function refreshHistoryList() {
  elements.historyList.replaceChildren();
  try {
    const chats = await companion.listChats(historyTab === 'archived');
    if (!chats.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = historyTab === 'archived' ? 'Archived chats will appear here.' : 'Your saved chats will appear here.';
      elements.historyList.append(empty);
      return;
    }
    for (const chat of chats) {
      const row = document.createElement('article');
      row.className = 'history-row';
      const open = document.createElement('button');
      open.className = 'history-row-main';
      open.type = 'button';
      const title = document.createElement('span');
      title.className = 'history-row-title';
      title.textContent = chat.title || 'New chat';
      const preview = document.createElement('span');
      preview.className = 'history-row-preview';
      preview.textContent = chat.preview || 'No messages yet';
      const date = document.createElement('span');
      date.className = 'history-row-date';
      date.textContent = new Date(chat.updatedAt).toLocaleString();
      open.append(title, preview, date);
      open.addEventListener('click', async () => {
        try { renderChat(await companion.openChat(chat.id)); }
        catch (error) { elements.historyList.textContent = error.message; }
      });

      const buttons = document.createElement('div');
      buttons.className = 'history-row-buttons';
      if (historyTab === 'archived') {
        buttons.append(historyAction('Restore chat', '↩', '', async () => {
          try { renderChat(await companion.openChat(chat.id)); }
          catch (error) { elements.historyList.textContent = error.message; }
        }));
      } else {
        buttons.append(historyAction('Archive chat', '▣', '', async () => {
          try {
            const result = await companion.archiveChat(chat.id);
            if (result.wasActive) renderChat(await companion.createChat());
            await refreshHistoryList();
          } catch (error) { elements.historyList.textContent = error.message; }
        }));
      }
      buttons.append(historyAction('Delete chat', '⌫', 'delete', () => { confirm.hidden = false; }));

      const confirm = document.createElement('div');
      confirm.className = 'history-delete-confirm';
      confirm.hidden = true;
      const confirmText = document.createElement('span');
      confirmText.textContent = 'Delete this chat permanently?';
      const confirmButtons = document.createElement('div');
      confirmButtons.className = 'history-delete-buttons';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => { confirm.hidden = true; });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'confirm-delete';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        try {
          const result = await companion.deleteChat(chat.id);
          if (result.wasActive) renderChat(await companion.createChat());
          await refreshHistoryList();
        } catch (error) { elements.historyList.textContent = error.message; }
      });
      confirmButtons.append(cancel, remove);
      confirm.append(confirmText, confirmButtons);
      row.append(open, buttons, confirm);
      elements.historyList.append(row);
    }
  } catch (error) {
    elements.historyList.textContent = error.message;
  }
}

async function startNewChat() {
  try { renderChat(await companion.createChat()); }
  catch (error) { setConnection(false, 'Could not create chat'); }
}

function addSources(row, sources) {
  if (!sources?.length) return;
  const list = document.createElement('span');
  list.className = 'source-list';
  const label = document.createElement('span');
  label.className = 'sources-label';
  label.textContent = 'Sources';
  list.append(label);

  sources.forEach((source, index) => {
    const link = document.createElement('a');
    link.className = 'source-link';
    link.href = '#';
    link.textContent = `[${index + 1}] ${source.title}`;
    link.title = source.url;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      companion.openURL(source.url);
    });
    list.append(link);
  });

  row.querySelector('p').append(list);
  keepMessagesAtEnd();
}

function addSearchNotice(row, notice) {
  const note = document.createElement('span');
  note.className = 'search-notice';
  note.textContent = notice;
  row.querySelector('p').append(note);
  keepMessagesAtEnd();
}

function createStreamWriter(row) {
  const paragraph = row.querySelector('p');
  let text = '';
  let buffer = '';
  let queue = [];
  let timer = null;
  let drainResolvers = [];
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null;

  function splitPieces(value) {
    if (!value) return [];
    if (segmenter) {
      const pieces = [];
      for (const part of segmenter.segment(value)) {
        if (/^\s+$/u.test(part.segment) && pieces.length) pieces[pieces.length - 1] += part.segment;
        else if (!part.isWordLike && pieces.length) pieces[pieces.length - 1] += part.segment;
        else pieces.push(part.segment);
      }
      return pieces;
    }
    return value.match(/\S+\s*|\s+/gu) || [value];
  }

  function paint() {
    paragraph.replaceChildren();
    appendFormattedContent(paragraph, text, { streaming: true });
    keepMessagesAtEnd();
  }

  function settleIfDrained() {
    if (queue.length || timer) return;
    drainResolvers.forEach((resolve) => resolve());
    drainResolvers = [];
  }

  function pump() {
    if (!queue.length) {
      timer = null;
      settleIfDrained();
      return;
    }
    row.classList.remove('pending-message');
    text += queue.shift();
    paint();
    timer = setTimeout(pump, 24);
  }

  function startPump() {
    if (timer || !queue.length) return;
    timer = setTimeout(pump, 0);
  }

  function receive(delta) {
    buffer += delta;
    if (segmenter) {
      const parts = [...segmenter.segment(buffer)];
      const last = parts.at(-1);
      const isPartialWord = last?.isWordLike && last.index + last.segment.length === buffer.length;
      const readyLength = isPartialWord ? last.index : buffer.length;
      if (readyLength > 0) {
        queue.push(...splitPieces(buffer.slice(0, readyLength)));
        buffer = buffer.slice(readyLength);
      }
    } else {
      const pieces = buffer.match(/\S+\s*/gu) || [];
      const hasTrailingSpace = /\s$/u.test(buffer);
      if (hasTrailingSpace) {
        queue.push(...pieces);
        buffer = '';
      } else if (pieces.length > 1) {
        queue.push(...pieces.slice(0, -1));
        buffer = pieces.at(-1);
      }
    }
    startPump();
  }

  function stop() {
    clearTimeout(timer); timer = null; queue = []; buffer = '';
    settleIfDrained();
  }

  function finish() {
    if (buffer) queue.push(...splitPieces(buffer));
    buffer = '';
    startPump();
    if (!queue.length && !timer) return Promise.resolve();
    return new Promise((resolve) => drainResolvers.push(resolve));
  }

  return { receive, finish, stop, get text() { return text; }, paint };
}

function updatePetName(name) {
  elements.brand.textContent = name;
  elements.greeting.textContent = `What’s on your mind${userAddress()}?`;
  document.title = `${name} · Little Companion`;
}

function formatTokenCount(value) {
  const tokens = Math.max(0, Math.floor(Number(value) || 0));
  if (tokens < 1024) return String(tokens);
  const kibitokens = Math.round((tokens / 1024) * 10) / 10;
  return `${Number.isInteger(kibitokens) ? kibitokens.toFixed(0) : kibitokens.toFixed(1)}k`;
}

async function refreshContextMeter() {
  const chatID = activeChat?.id;
  if (!chatID) return;
  try {
    const context = await companion.contextStatus(chatID);
    if (activeChat?.id !== chatID) return;
    const limit = Math.max(1, Number(context.limitTokens) || 27000);
    const reportedRemaining = Number(context.remainingTokens);
    const remaining = Math.min(limit, Math.max(0, Number.isFinite(reportedRemaining) ? reportedRemaining : 0));
    const promptLimit = Math.max(1, Number(context.promptLimitTokens) || 24000);
    const compactAt = Math.max(1, Number(context.compactAtTokens) || 24000);
    const percent = Math.min(100, Math.max(0, (remaining / limit) * 100));
    const label = `${formatTokenCount(remaining)} / ${formatTokenCount(limit)} tokens`;
    elements.contextLabel.textContent = label;
    elements.contextMeter.setAttribute('aria-valuenow', percent.toFixed(1));
    elements.contextMeter.setAttribute('aria-valuetext', `About ${formatTokenCount(remaining)} of ${formatTokenCount(limit)} context tokens remain`);
    elements.contextMeter.title = `Approximate use: ${formatTokenCount(context.usedTokens)} of ${formatTokenCount(limit)} tokens. Pikachu summarizes older turns near ${formatTokenCount(compactAt)} tokens and keeps the prompt under ${formatTokenCount(promptLimit)}, leaving about ${formatTokenCount(limit - promptLimit)} for the reply.${context.isCompacted ? ' This chat already has a saved summary of older turns.' : ''}`;
    elements.contextMeter.dataset.level = percent <= 12 ? 'critical' : percent <= 25 ? 'low' : 'normal';
    elements.contextFill.style.width = `${percent.toFixed(1)}%`;
  } catch {
    elements.contextLabel.textContent = 'Estimate unavailable';
    elements.contextMeter.setAttribute('aria-valuetext', 'Context estimate unavailable');
  }
}

function openSettings() {
  elements.petName.value = config.petName;
  elements.userName.value = config.userName || '';
  elements.modelProvider.value = config.modelProvider;
  showModelProfile();
  elements.personality.value = config.personality;
  const routines = config.routines || {};
  elements.morningGreeting.checked = routines.morningGreeting !== false;
  elements.timerCelebrations.checked = routines.timerCelebrations !== false;
  elements.ahaCelebrations.checked = routines.ahaCelebrations !== false;
  elements.celebrationPetCheer.checked = routines.petCheer !== false;
  elements.celebrationFireworks.checked = routines.fireworks !== false;
  elements.fireworkIntensity.value = routines.fireworkIntensity || 'balanced';
  updateFireworkSettings();
  elements.speechLanguage.value = config.speechLanguage || 'en-US';
  elements.allowNetworkSpeech.checked = config.allowNetworkSpeech === true;
  elements.webSearchStatus.textContent = config.hasSearchKey
    ? 'A Tavily key is stored on this Mac. Tavily confirms it when a search runs; free feeds are the fallback.'
    : 'When search is enabled, Pikachu can use public feeds or your own Tavily key.';
  elements.settingsLayer.classList.remove('hidden');
  elements.settingsLayer.setAttribute('aria-hidden', 'false');
  refreshModels();
}

function closeSettings() {
  elements.settingsLayer.classList.add('hidden');
  elements.settingsLayer.setAttribute('aria-hidden', 'true');
  elements.saveStatus.textContent = '';
}

function routineFormValues() {
  return {
    morningGreeting: elements.morningGreeting.checked,
    timerCelebrations: elements.timerCelebrations.checked,
    ahaCelebrations: elements.ahaCelebrations.checked,
    petCheer: elements.celebrationPetCheer.checked,
    fireworks: elements.celebrationFireworks.checked,
    fireworkIntensity: elements.fireworkIntensity.value,
  };
}

function updateFireworkSettings() {
  elements.fireworkIntensity.disabled = !elements.celebrationFireworks.checked;
  elements.celebrationPreview.disabled = !elements.celebrationFireworks.checked;
}

elements.celebrationFireworks.addEventListener('change', updateFireworkSettings);
elements.celebrationPreview.addEventListener('click', () => playFireworks(elements.fireworkIntensity.value));

const providerHints = {
  bionic: 'Start the Local Model API in Bionic.',
  lmStudio: 'Start the server in LM Studio’s Developer tab. Add a token if Require Authentication is enabled.',
  ollama: 'Start Ollama and download a local model. The standard local server works without a token.',
  custom: 'Enter an OpenAI-compatible API address on this Mac.'
};
let modelLookup = 0;

function showModelProfile() {
  const provider = elements.modelProvider.value;
  const profile = config.modelProfiles[provider];
  elements.endpoint.value = profile.endpoint;
  elements.model.replaceChildren(new Option(profile.model || 'Detect models…', profile.model));
  elements.providerHint.textContent = providerHints[provider];
  elements.modelTokenSettings.hidden = provider !== 'lmStudio' && provider !== 'ollama';
  elements.modelTokenStatus.textContent = '';
}

function draftModelConnection() {
  return { modelProvider: elements.modelProvider.value, endpoint: elements.endpoint.value.trim() };
}

async function refreshModels(useSavedConnection = false) {
  const lookup = ++modelLookup;
  const connection = useSavedConnection ? { modelProvider: config.modelProvider, endpoint: config.endpoint } : draftModelConnection();
  const previous = useSavedConnection ? config.model : elements.model.value;
  const isSaved = connection.modelProvider === config.modelProvider && connection.endpoint === config.endpoint;
  const setModelStatus = (ready, label) => { if (isSaved && !isReplying) setConnection(ready, label); };
  elements.detect.disabled = true;
  elements.modelStatus.textContent = 'Connecting to your local model…';
  try {
    const models = await companion.listModels(connection);
    if (lookup !== modelLookup) return;
    elements.model.replaceChildren();
    if (!models.length) {
      elements.model.add(new Option('No models available', ''));
      elements.modelStatus.textContent = 'Connected. Load or download a model in the selected server, then detect again.';
      setModelStatus(true, 'Server ready · no model');
      return;
    }
    for (const model of models) elements.model.add(new Option(model, model));
    elements.model.value = models.includes(previous) ? previous : models[0];
    elements.modelStatus.textContent = `${models.length} model${models.length === 1 ? '' : 's'} found on this computer.`;
    setModelStatus(true, 'Local model ready');
  } catch (error) {
    if (lookup !== modelLookup) return;
    elements.model.replaceChildren(new Option(previous || 'Could not connect', previous));
    elements.modelStatus.textContent = error.message;
    setModelStatus(false, 'Check local server');
  } finally {
    if (lookup === modelLookup) elements.detect.disabled = false;
  }
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = elements.input.value.trim();
  if (!text || elements.send.disabled || isPreparingFile || !activeChat) return;
  const chatID = activeChat.id;
  const requestedSearchMode = searchMode;
  const toolsAvailable = [...enabledTools];
  const translationLanguage = 'English';

  elements.input.value = '';
  resizeInput();
  history.push({ role: 'user', content: text });
  addMessage('user', text);
  keepMessagesAtEnd(true);
  const localToolEnabled = toolsAvailable.length > 0;
  isReplying = true;
  stopRequested = false;
  petEvent('think');
  if (isAhaMoment(text)) celebrate('aha', `Aha, you got it${userAddress()}!`);
  elements.send.disabled = true;
  elements.send.hidden = true;
  elements.stop.hidden = false;
  elements.stop.disabled = false;
  elements.speechButton.disabled = true;
  elements.speechLanguage.disabled = true;
  elements.screenButton.disabled = true;
  elements.screenTarget.disabled = true;
  elements.historyButton.disabled = true;
  setConnection(false, 'Thinking');
  const pending = addMessage('assistant', localToolEnabled ? 'Checking tools' : 'Thinking', { pending: true });
  const writer = createStreamWriter(pending);
  activeWriter = writer;

  try {
    await companion.appendMessage(chatID, { role: 'user', content: text });
    if (stopRequested) throw new Error('Response stopped.');
    const result = await companion.chat(chatID, requestedSearchMode, toolsAvailable, translationLanguage, elements.screenTarget.value,
      (delta) => { if (!stopRequested) writer.receive(delta); },
      (status) => {
        pending.querySelector('p').textContent = status;
        if (/summariz|compact/i.test(status)) elements.contextLabel.textContent = 'Compacting…';
        keepMessagesAtEnd();
        if (/folder locally/i.test(status)) setConnection(false, 'Searching your folder');
        else if (/search|web|sources/i.test(status)) setConnection(false, 'Searching the web');
      }
    );
    if (stopRequested) writer.stop(); else await writer.finish();
    const answer = result.answer || writer.text;
    rowReplaceContent(pending, answer);
    addSources(pending, result.sources);
    if (result.searchNotice) addSearchNotice(pending, result.searchNotice);
    history.push({ role: 'assistant', content: answer });
    showPetBubble(`Here you go${userAddress()}.`, 2800);
    petEvent('complete', 2100);
    const toolLabels = { calculator: 'Calculated locally', timer: 'Timer updated', stopwatch: 'Stopwatch updated', pomodoro: 'Pomodoro updated', translate: 'Translated locally' };
    setConnection(true, toolLabels[result.toolUsed] || (result.searched ? 'Local answer · web sources' : 'Local model ready'));
  } catch (error) {
    if (stopRequested) writer.stop(); else await writer.finish();
    const partial = writer.text;
    const stopped = stopRequested || error.message === 'Response stopped.';
    const savedError = partial ? `${partial}\n\n${stopped ? 'Response stopped.' : error.message}` : (stopped ? 'Response stopped.' : error.message);
    rowReplaceContent(pending, savedError);
    history.push({ role: 'assistant', content: savedError });
    await companion.appendMessage(chatID, { role: 'assistant', content: savedError }).catch(() => {});
    if (stopped) {
      showPetBubble('Stopped.', 2000);
      petEvent('stopped', 1800);
      setConnection(true, 'Response stopped');
    } else {
    const isToolError = toolsAvailable.length > 0 && /timer|calculator|expression|calculate|notifications/i.test(error.message);
    const isContextError = /context|shorten it/i.test(error.message);
    const isStorageError = /chat history|saved chat|save chat|delete this chat/i.test(error.message);
    showPetBubble(isToolError ? 'I had trouble using that tool.' : isContextError ? 'That message is too large for my context.' : isStorageError ? 'I couldn’t save this chat.' : 'I can’t reach my local model yet.', 5000);
    petEvent('error', 2400);
    setConnection(false, isToolError ? 'Tool needs attention' : isContextError ? 'Shorten the message' : isStorageError ? 'Chat storage needs attention' : 'Check local server');
    }
  } finally {
    await refreshContextMeter();
    isReplying = false;
    activeWriter = null;
    elements.stop.hidden = true;
    elements.send.hidden = false;
    elements.send.disabled = false;
    elements.speechButton.disabled = false;
    elements.speechLanguage.disabled = false;
    elements.screenButton.disabled = false;
    elements.screenTarget.disabled = false;
    elements.historyButton.disabled = false;
    elements.input.focus();
  }
});

elements.stop.addEventListener('click', () => {
  if (!isReplying || stopRequested) return;
  stopRequested = true;
  elements.stop.disabled = true;
  activeWriter?.stop();
  companion.stopChat().catch(() => {});
});

function rowReplaceContent(row, content) {
  row.classList.remove('pending-message');
  const paragraph = row.querySelector('p');
  paragraph.replaceChildren();
  appendFormattedContent(paragraph, content);
  keepMessagesAtEnd();
}

elements.input.addEventListener('input', () => {
  resizeInput();
});
elements.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});

function closeTips() {
  elements.tipsLayer.classList.add('hidden');
  elements.tipsLayer.setAttribute('aria-hidden', 'true');
  elements.tipsButton.focus();
}
elements.tipsButton.addEventListener('click', () => {
  elements.tipsLayer.classList.remove('hidden');
  elements.tipsLayer.setAttribute('aria-hidden', 'false');
  document.querySelector('#tips-close').focus();
});
document.querySelector('#tips-close').addEventListener('click', closeTips);
document.querySelector('#settings-button').addEventListener('click', openSettings);
document.querySelector('#settings-close').addEventListener('click', closeSettings);
elements.historyButton.addEventListener('click', openHistory);
document.querySelector('#history-close').addEventListener('click', closeHistory);
elements.activeChatsTab.addEventListener('click', () => setHistoryTab('active'));
elements.archivedChatsTab.addEventListener('click', () => setHistoryTab('archived'));
elements.newChat.addEventListener('click', async () => {
  await startNewChat();
  closeHistory();
});
elements.speechButton.addEventListener('click', async () => {
  if (speechState === 'recording') {
    speechState = 'finalizing';
    elements.speechButton.disabled = true;
    elements.speechStatus.hidden = false;
    elements.speechStatus.textContent = 'Finishing your draft…';
    try { await companion.stopSpeech(); }
    catch (error) { finishSpeechUI('idle', error.message); }
    return;
  }
  if (speechState !== 'idle') return;
  speechDraftBefore = elements.input.value;
  speechState = 'starting';
  elements.speechButton.disabled = true;
  elements.input.disabled = true;
  elements.speechLanguage.disabled = true;
  elements.send.disabled = true;
  elements.historyButton.disabled = true;
  elements.speechStatus.hidden = false;
  elements.speechStatus.textContent = 'Starting dictation…';
  try {
    await companion.startSpeech(elements.speechLanguage.value);
    if (speechState === 'starting') speechState = 'recording';
  } catch (error) {
    finishSpeechUI('idle', error.message);
  }
});
elements.speechLanguage.addEventListener('change', async () => {
  showSpeechLanguageInfo();
  try {
    const saved = await companion.saveSpeechSettings({
      speechLanguage: elements.speechLanguage.value,
      allowNetworkSpeech: elements.allowNetworkSpeech.checked
    });
    config.speechLanguage = saved.speechLanguage;
    config.allowNetworkSpeech = saved.allowNetworkSpeech;
  } catch (error) {
    elements.speechStatus.textContent = error.message;
  }
});
elements.allowNetworkSpeech.addEventListener('change', showSpeechLanguageInfo);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && speechState === 'recording') companion.cancelSpeech();
  if (event.key === 'Escape' && !elements.tipsLayer.classList.contains('hidden')) closeTips();
  if (event.key === 'Escape') setAttachmentMenu(false);
});
elements.detect.addEventListener('click', () => refreshModels());
elements.endpoint.addEventListener('change', () => {
  elements.modelTokenStatus.textContent = '';
  refreshModels();
});
elements.modelProvider.addEventListener('change', () => {
  showModelProfile();
  refreshModels();
});
elements.configureModelToken.addEventListener('click', async () => {
  const connection = draftModelConnection();
  try {
    if (await companion.configureModelToken(connection)) {
      elements.modelTokenStatus.textContent = 'Token settings updated in this Mac’s Keychain.';
      await refreshModels();
    }
  } catch (error) {
    elements.modelTokenStatus.textContent = error.message;
  }
});
function setAttachmentMenu(open) {
  elements.attachmentMenu.hidden = !open;
  elements.attachmentToggle.setAttribute('aria-expanded', String(open));
}
elements.attachmentToggle.addEventListener('click', () => setAttachmentMenu(elements.attachmentMenu.hidden));
document.addEventListener('click', (event) => {
  if (!event.target.closest('.attachment-wrap')) setAttachmentMenu(false);
});
let localSelection = { file: null, folder: null };
function updateLocalSelection() {
  const items = [];
  if (localSelection.file) items.push(`File: ${localSelection.file}`);
  if (localSelection.folder) items.push(`Folder: ${localSelection.folder}`);
  elements.localContext.hidden = !items.length;
  elements.localContextLabel.textContent = `${items.join(' · ')} · Local excerpts used${localSelection.notice ? ` · ${localSelection.notice}` : ''}`;
  elements.fileButton.classList.toggle('active', !!localSelection.file);
  elements.folderButton.classList.toggle('active', !!localSelection.folder);
}
async function attachFile(file) {
  if (!file || !activeChat || isReplying || isPreparingFile) return;
  if (file.size > 20 * 1024 * 1024) { showPetBubble('Choose a file smaller than 20 MB.', 5000); return; }
  const chatID = activeChat.id;
  isPreparingFile = true;
  elements.send.disabled = true;
  elements.attachmentToggle.disabled = true;
  elements.fileButton.disabled = true;
  elements.localContext.hidden = false;
  elements.localContextLabel.textContent = `Reading ${file.name} locally…`;
  try {
    const dataURL = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.readAsDataURL(file);
    });
    if (activeChat.id !== chatID) return;
    const result = await companion.attachFile(file.name, dataURL.split(',')[1], chatID);
    if (activeChat.id !== chatID) return;
    localSelection.file = result.name;
    localSelection.notice = result.notice || '';
    updateLocalSelection();
    showPetBubble('Ready! Ask me about your file.', 3500);
    elements.input.focus();
  } catch (error) { showPetBubble(error.message, 6000); }
  finally {
    isPreparingFile = false;
    elements.send.disabled = isReplying;
    elements.attachmentToggle.disabled = false;
    elements.fileButton.disabled = false;
    elements.fileInput.value = '';
    updateLocalSelection();
  }
}
elements.fileButton.addEventListener('click', async () => {
  setAttachmentMenu(false);
  if (!activeChat || isReplying || isPreparingFile) return;
  const chatID = activeChat.id;
  isPreparingFile = true;
  elements.send.disabled = true;
  elements.attachmentToggle.disabled = true;
  elements.localContext.hidden = false;
  elements.localContextLabel.textContent = 'Choose a file to read locally…';
  try {
    const result = await companion.chooseFile(chatID);
    if (!result.cancelled && activeChat.id === chatID) {
      localSelection.file = result.name;
      localSelection.notice = result.notice || '';
      showPetBubble('Ready! Ask me about your file.', 3500);
      elements.input.focus();
    }
  } catch (error) { showPetBubble(error.message, 6000); }
  finally {
    isPreparingFile = false;
    elements.send.disabled = isReplying;
    elements.attachmentToggle.disabled = false;
    updateLocalSelection();
  }
});
elements.fileInput.addEventListener('change', () => attachFile(elements.fileInput.files[0]));
document.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); document.body.classList.add('file-dragging'); } });
document.addEventListener('dragleave', (event) => { if (!event.relatedTarget) document.body.classList.remove('file-dragging'); });
document.addEventListener('drop', (event) => { event.preventDefault(); document.body.classList.remove('file-dragging'); attachFile(event.dataTransfer?.files[0]); });
elements.folderButton.addEventListener('click', async () => {
  setAttachmentMenu(false);
  if (!activeChat || isReplying) return;
  const chatID = activeChat.id;
  try {
    const result = await companion.chooseFolder(chatID);
    if (!result.cancelled && activeChat.id === chatID) { localSelection.folder = result.name; updateLocalSelection(); showPetBubble('Ask me about this folder.', 3500); elements.input.focus(); }
  } catch (error) { showPetBubble(error.message, 5000); }
});
elements.localContextClear.addEventListener('click', async () => {
  await Promise.all([companion.clearFile(), companion.clearFolder()]);
  localSelection = { file: null, folder: null }; updateLocalSelection();
});

let clockState = { timers: [], stopwatch: { exists: false, elapsed: 0, runningSince: null } };
const finishedClocks = new Set();
function formatClock(total) {
  const seconds = Math.max(0, Math.floor(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
function setClockPanel(open) {
  elements.clockPanel.hidden = !open;
  elements.timerTool.setAttribute('aria-expanded', String(open));
  renderClocks();
}
function renderClocks() {
  const now = Date.now();
  const timers = clockState.timers || [];
  const watch = clockState.stopwatch || {};
  const existing = new Map([...elements.countdownList.children].map(row => [row.dataset.id, row]));
  for (const timer of timers) {
    let row = existing.get(timer.id);
    if (!row) {
      row = document.createElement('div'); row.className = 'countdown-row'; row.dataset.id = timer.id;
      const name = document.createElement('span'); name.textContent = `Timer · ${formatClock(timer.duration)}`;
      const time = document.createElement('strong'); time.className = 'countdown-clock';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Clear'; cancel.setAttribute('aria-label', 'Cancel this timer');
      cancel.addEventListener('click', async () => { try { window.__companionClockEvent(await companion.cancelCountdown(timer.id)); } catch (error) { showPetBubble(error.message, 5000); } });
      row.append(name, time, cancel); elements.countdownList.append(row);
    }
    existing.delete(timer.id);
    const remaining = Math.max(0, Math.ceil((timer.deadline - now) / 1000));
    row.querySelector('.countdown-clock').textContent = formatClock(remaining);
    row.classList.toggle('finished', remaining === 0);
    if (remaining === 0 && !finishedClocks.has(timer.id)) { finishedClocks.add(timer.id); celebrateTimer(timer.id, 'Your timer is done!'); }
  }
  for (const row of existing.values()) row.remove();
  const watchSeconds = (Number(watch.elapsed) || 0) + (watch.runningSince ? Math.max(0, (now - watch.runningSince) / 1000) : 0);
  elements.stopwatchClock.textContent = formatClock(watchSeconds);
  elements.stopwatchToggle.textContent = watch.runningSince ? 'Pause' : (watch.exists && watch.elapsed > 0 ? 'Resume' : 'Start');
  const active = timers.some(timer => timer.deadline > now) || !!watch.runningSince;
  elements.timerTool.classList.toggle('active', active || !elements.clockPanel.hidden);
  const first = timers.find(timer => timer.deadline > now);
  elements.timerTool.textContent = first ? `◷ ${formatClock(Math.ceil((first.deadline - now) / 1000))}` : (watch.runningSince ? `◷ ${formatClock(watchSeconds)}` : '◷ Timer');
  elements.timerTool.setAttribute('aria-label', first ? `Timer: ${formatClock(Math.ceil((first.deadline - now) / 1000))} remaining` : (watch.runningSince ? `Stopwatch: ${formatClock(watchSeconds)} elapsed` : 'Show timers and stopwatch'));
  elements.clockHint.hidden = timers.length > 0 || !!watch.exists;
}
window.__companionClockEvent = state => {
  const previousTimerCount = (clockState.timers || []).length;
  const hadStopwatch = !!clockState.stopwatch?.exists;
  clockState = state || { timers: [], stopwatch: {} };
  if ((clockState.timers || []).length > previousTimerCount || (!hadStopwatch && clockState.stopwatch?.exists)) setClockPanel(true);
  renderClocks();
};
elements.clockHide.addEventListener('click', () => setClockPanel(false));
elements.stopwatchToggle.addEventListener('click', async () => { try { window.__companionClockEvent(await companion.stopwatch(clockState.stopwatch?.runningSince ? 'pause' : 'start')); } catch (error) { showPetBubble(error.message, 5000); } });
elements.stopwatchReset.addEventListener('click', async () => { try { window.__companionClockEvent(await companion.stopwatch('reset')); } catch (error) { showPetBubble(error.message, 5000); } });
setInterval(renderClocks, 250);

let focus = { phase: 'focus', running: false, remaining: 25 * 60, end: 0, interval: null, scheduleVersion: 0 };
function renderFocus() {
  elements.focusButton.classList.toggle('active', !elements.focusPanel.hidden || focus.running);
  const seconds = Math.max(0, Math.ceil(focus.running ? (focus.end - Date.now()) / 1000 : focus.remaining));
  elements.focusClock.textContent = formatClock(seconds);
  elements.focusButton.textContent = focus.running ? `◷ ${elements.focusClock.textContent}` : '◷ Pomodoro';
  elements.focusTitle.textContent = focus.phase === 'focus' ? (focus.running ? 'Focusing together' : 'Focus time') : (focus.running ? 'Time to recharge' : 'Break time');
  elements.focusStart.textContent = focus.running ? 'Pause' : (focus.phase === 'focus' ? 'Start focus' : 'Start break');
  elements.focusLength.disabled = focus.running || focus.phase !== 'focus';
  elements.breakLength.disabled = focus.running;
  if (focus.running && seconds <= 0) {
    clearInterval(focus.interval); focus.running = false; focus.scheduleVersion++;
    if (focus.phase === 'focus') {
      focus.phase = 'break'; focus.remaining = Number(elements.breakLength.value) * 60;
      elements.focusStatus.textContent = 'Nice work! Start your break when you’re ready.';
      if (!celebrate('timer', 'Nice work! Time for a little break.')) {
        showPetBubble('Nice work! Time for a little break.', 6000);
        if (!isReplying) petEvent('complete', 2800);
      }
    } else {
      focus.phase = 'focus'; focus.remaining = Number(elements.focusLength.value) * 60;
      elements.focusStatus.textContent = 'Break complete. Ready for another round?';
      showPetBubble('Feeling refreshed? I’m here.', 6000); if (!isReplying) petEvent('complete', 2800);
    }
    renderFocus();
  }
}
elements.focusButton.addEventListener('click', () => {
  elements.focusPanel.hidden = !elements.focusPanel.hidden;
  elements.focusButton.setAttribute('aria-expanded', String(!elements.focusPanel.hidden));
  elements.focusButton.classList.toggle('active', !elements.focusPanel.hidden || focus.running);
});
elements.focusLength.addEventListener('change', () => { if (!focus.running && focus.phase === 'focus') { focus.remaining = Number(elements.focusLength.value) * 60; renderFocus(); } });
elements.breakLength.addEventListener('change', () => { if (!focus.running && focus.phase === 'break') { focus.remaining = Number(elements.breakLength.value) * 60; renderFocus(); } });
elements.focusStart.addEventListener('click', async () => {
  if (focus.running) {
    focus.remaining = Math.max(1, Math.ceil((focus.end - Date.now()) / 1000));
    focus.running = false; focus.scheduleVersion++; clearInterval(focus.interval);
    await companion.cancelFocus(); elements.focusStatus.textContent = 'Paused. Pick it up when you’re ready.'; renderFocus(); return;
  }
  focus.running = true; focus.end = Date.now() + focus.remaining * 1000;
  const version = ++focus.scheduleVersion;
  focus.interval = setInterval(renderFocus, 250); renderFocus();
  showPetBubble(focus.phase === 'focus' ? 'Let’s focus together.' : 'Take a gentle break.', 3500);
  petEvent(focus.phase === 'focus' ? 'focus' : 'greet', 2400);
  elements.focusStart.disabled = true; elements.focusReset.disabled = true;
  try {
    const result = await companion.scheduleFocus(focus.remaining, focus.phase === 'break');
    if (version === focus.scheduleVersion) elements.focusStatus.textContent = result.notifications ? 'Pikachu will remind you when this session ends.' : 'Keep Pikachu open for the reminder; Mac notifications are unavailable.';
    else await companion.cancelFocus();
  } catch { if (version === focus.scheduleVersion) elements.focusStatus.textContent = 'Keep Pikachu open for the reminder; Mac notifications are unavailable.'; }
  finally { elements.focusStart.disabled = false; elements.focusReset.disabled = false; }
});
elements.focusReset.addEventListener('click', async () => {
  clearInterval(focus.interval); focus.scheduleVersion++; focus.running = false; focus.phase = 'focus'; focus.remaining = Number(elements.focusLength.value) * 60;
  await companion.cancelFocus(); elements.focusStatus.textContent = 'A little focus, then a little rest.'; renderFocus();
});

window.__companionFocusCommand = async event => {
  if (!event) return;
  if (elements.focusPanel.hidden) elements.focusButton.click();
  if (event.action === 'reset') { elements.focusReset.click(); return; }
  if (event.action === 'pause') { if (focus.running) elements.focusStart.click(); return; }
  if (event.action === 'start') {
    if (focus.running) {
      if (!(event.seconds > 0)) return;
      clearInterval(focus.interval); focus.running = false; focus.scheduleVersion++;
      try { await companion.cancelFocus(); } catch (error) { showPetBubble(error.message, 5000); return; }
    }
    if (focus.phase !== 'focus' && !(event.seconds > 0)) {
      focus.phase = 'focus'; focus.remaining = Number(elements.focusLength.value) * 60;
    }
    if (event.seconds > 0 && event.seconds <= 7200) {
      const minutes = event.seconds / 60;
      if (![...elements.focusLength.options].some(option => Number(option.value) === minutes)) elements.focusLength.add(new Option(`${minutes} min`, String(minutes)));
      elements.focusLength.value = String(minutes); focus.phase = 'focus'; focus.remaining = event.seconds;
    }
    if (event.breakSeconds > 0 && event.breakSeconds <= 7200) {
      const minutes = event.breakSeconds / 60;
      if (![...elements.breakLength.options].some(option => Number(option.value) === minutes)) elements.breakLength.add(new Option(`${minutes} min`, String(minutes)));
      elements.breakLength.value = String(minutes);
    }
    renderFocus(); elements.focusStart.click();
  }
};

elements.screenButton.addEventListener('click', async () => {
  if (!activeChat || isReplying || isPreparingFile) return;
  if (elements.screenButton.getAttribute('aria-pressed') === 'true') {
    elements.screenButton.disabled = true;
    try { await companion.clearScreenContext(); }
    catch (error) { showPetBubble(error.message, 5000); }
    finally { elements.screenButton.disabled = isReplying; }
    return;
  }
  elements.send.disabled = true;
  window.__companionScreenEvent({ state: 'capturing', status: 'Preparing your one-time screen capture…' });
  try {
    const result = await companion.captureScreen(elements.screenTarget.value, activeChat.id);
    if (result?.status) window.__companionScreenEvent({
      state: result.captured ? (result.mode === 'image' ? 'ready-image' : 'ready-text') : (result.settingsRequired ? 'permission' : 'error'),
      status: result.status,
      clearable: result.captured === true,
      settingsRequired: result.settingsRequired === true
    });
  } catch (error) {
    window.__companionScreenEvent({ state: 'error', status: error.message });
  } finally {
    elements.screenButton.disabled = isReplying;
    elements.screenTarget.disabled = isReplying;
    elements.send.disabled = isReplying;
  }
});
elements.screenTarget.addEventListener('change', () => {
  if (elements.screenButton.classList.contains('active')) companion.clearScreenContext();
});
elements.screenClear.addEventListener('click', () => companion.clearScreenContext());
elements.screenSettings.addEventListener('click', () => companion.openScreenSettings());
const toggleTool = (tool) => {
  if (enabledTools.has(tool)) enabledTools.delete(tool);
  else enabledTools.add(tool);
  updateToolControls();
};
elements.timerTool.addEventListener('click', () => setClockPanel(elements.clockPanel.hidden));
elements.searchButton.addEventListener('click', async () => {
  if (!activeChat) return;
  const previous = searchMode;
  searchMode = { auto: 'on', on: 'off', off: 'auto' }[searchMode];
  updateSearchButton();
  try { await companion.setSearchMode(activeChat.id, searchMode); }
  catch (error) {
    searchMode = previous;
    updateSearchButton();
    showPetBubble(error.message, 4000);
  }
});
elements.getSearchKey.addEventListener('click', () => companion.openURL('https://app.tavily.com/'));
elements.configureSearchKey.addEventListener('click', async () => {
  try {
    const result = await companion.configureSearchKey();
    if (result.saved) {
      config.hasSearchKey = true;
      elements.webSearchStatus.textContent = 'Key saved securely in this Mac’s Keychain.';
    }
  } catch (error) { elements.webSearchStatus.textContent = error.message; }
});
elements.save.addEventListener('click', async () => {
  elements.save.disabled = true;
  elements.saveStatus.textContent = 'Saving…';
  try {
    config = await companion.saveConfig({
      ...draftModelConnection(),
      model: elements.model.value,
      petName: elements.petName.value,
      userName: elements.userName.value,
      personality: elements.personality.value,
      routines: routineFormValues(),
      speechLanguage: elements.speechLanguage.value,
      allowNetworkSpeech: elements.allowNetworkSpeech.checked
    });
    updateSearchButton();
    updatePetName(config.petName);
    void refreshModels(true);
    void refreshContextMeter();
    elements.webSearchStatus.textContent = config.hasSearchKey
      ? 'A Tavily key is stored on this Mac. Tavily confirms it when a search runs; free feeds are the fallback.'
      : 'Free web feed fallback is available. Add a Tavily key for more reliable search.';
    elements.saveStatus.textContent = 'Saved on this computer';
    setTimeout(closeSettings, 700);
  } catch (error) {
    elements.saveStatus.textContent = error.message;
  } finally {
    elements.save.disabled = false;
  }
});

let morningCheckPending = false;
async function maybeMorningGreeting() {
  if (!config || config.routines?.morningGreeting === false || isReplying || document.hidden || morningCheckPending) return false;
  morningCheckPending = true;
  try {
    if (!(await companion.morningGreeting())) return false;
    petEvent('greet', 4200);
    showPetBubble(`Good morning${userAddress()}!`, 4200);
    return true;
  } catch { return false; }
  finally { morningCheckPending = false; }
}

(async () => {
  config = await companion.readConfig();
  updatePetName(config.petName);
  // Decode poses before fading them in so the first greeting does not flash blank.
  await Promise.all(petPictures.map((picture) => picture.decode().catch(() => {})));
  elements.speechLanguage.value = config.speechLanguage || 'en-US';
  elements.allowNetworkSpeech.checked = config.allowNetworkSpeech === true;
  await refreshSpeechCapabilities();
  try { renderChat(await companion.restoreChat()); }
  catch (error) { setConnection(false, error.message); return; }
  const greetedThisMorning = await maybeMorningGreeting();
  if (!greetedThisMorning && !isReplying) {
    petEvent('greet', 3800);
    showPetBubble(`Hi${userAddress()}!`, 3800);
  }
  setInterval(() => { void maybeMorningGreeting(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void maybeMorningGreeting(); });
  window.addEventListener('focus', () => { void maybeMorningGreeting(); });
  await refreshScreenDisplays();
  try { window.__companionClockEvent(await companion.clockState()); } catch { /* Chat remains available without saved clocks. */ }
  updateSearchButton();
  updateToolControls();
  lastHoverAt = performance.now();
  await refreshModels(true);
})();
