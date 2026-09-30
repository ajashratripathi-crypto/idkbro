(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const state = { config: {}, modelExists: false, serverAvailable: false, running: false, chats: [], currentId: null, page: 'chat', busy: false, cancelPending: false, requestId: null, startAt: 0, timer: null };
  const storageKey = 'nexuseco.chats.v1';
  const consentKey = 'nexuseco.terms.v1';
  const articles = [
    { title: 'What makes our AI different', tag: 'ON-DEVICE AI', body: `<h2>What makes our AI different</h2><p>NexusEco is a desktop chat app that runs an open-weight language model on your computer. Once the model has been downloaded and the local runtime is available, your prompts are sent to that runtime on your own device—not to an online AI inference service.</p><h3>Local does not mean impact-free</h3><p>Your computer still uses electricity and produces heat. The size of the model, how long it generates, your hardware, and the electricity supply all affect the footprint. Downloading the model also uses network data and storage.</p><h3>Why show estimates?</h3><p>The Eco checker measures response time and can estimate device energy from a wattage assumption you set. Optional cloud comparisons are explicitly based on values you provide. They are estimates, not audited savings.</p>` },
    { title: 'AI, water and data centers', tag: 'WATER', body: `<h2>AI, water and data centers</h2><p>Water can be involved in AI infrastructure in several ways: cooling equipment at some data centers, generating electricity, and manufacturing computer hardware. The amount varies widely by facility, cooling design, location, weather, power source, and workload.</p><h3>Why one universal number is misleading</h3><p>A figure per prompt cannot describe every data center or model. Different studies may use different boundaries—direct cooling water, water used to generate electricity, or both. A local model avoids sending each prompt to a remote inference service, but it does not prove a specific quantity of water has been saved.</p><p>NexusEco therefore does not invent a bottle counter. If you enter a baseline in Settings, the app will label its comparison as your estimate and show the assumption used.</p><h3>Further reading</h3><p><button class="source-link" data-url="https://arxiv.org/abs/2304.03271">Making AI Less “Thirsty” — research paper ↗</button></p><p><button class="source-link" data-url="https://www.nature.com/articles/s41545-021-00101-w">Data centre water consumption — npj Clean Water ↗</button></p>` },
    { title: 'Air, electricity and climate', tag: 'ENERGY', body: `<h2>Air, electricity and climate</h2><p>AI computation uses electricity. Climate impact depends on how much electricity is used and how that electricity is generated. On-device inference moves computation to your hardware; it does not make the energy use disappear.</p><h3>What the Eco checker estimates</h3><p>It times local generation and multiplies that time by an optional device-wattage estimate. It can compare that rough estimate to a cloud climate baseline you enter. It is not a power meter, lifecycle assessment, or verified emissions calculation.</p><p>Air pollution is not directly measured by this app. Its climate estimate is expressed as carbon-dioxide equivalent (CO₂e), which is not the same as a measurement of local air quality.</p><h3>Further reading</h3><p><button class="source-link" data-url="https://www.iea.org/reports/energy-and-ai">Energy and AI — International Energy Agency ↗</button></p><p><button class="source-link" data-url="https://arxiv.org/abs/2508.15734">Measuring AI inference impact at Google scale — research paper ↗</button></p>` },
    { title: 'Land and hardware', tag: 'LAND', body: `<h2>Land and hardware</h2><p>Land impacts are associated with electricity infrastructure, data centers, mining and processing materials, and manufacturing devices. Those effects happen across long supply chains and cannot be reliably assigned to one chat response with the information this app has.</p><p>For that reason, NexusEco does not claim to save a certain area of land per message. The land card says “not measurable per chat” instead of turning an unknown into a made-up number.</p><h3>Use devices longer</h3><p>Extending the useful life of existing electronics can avoid some new manufacturing demand. Local inference may be useful for privacy and offline access, but the most environmentally responsible choice depends on your hardware, energy source, model, and use pattern.</p>` },
    { title: 'What a small language model can do', tag: 'MODELS', body: `<h2>What a small language model can do</h2><p>A 3-billion-parameter model can help with everyday explanations, drafts, simple coding tasks, and study questions. It is much smaller than frontier hosted systems, so it may be less reliable at complex reasoning, long documents, current facts, or difficult coding tasks.</p><p>This app does not browse the web. Its answers come from its learned parameters and the conversation you provide. Treat outputs as suggestions, verify factual claims, and review code before running it.</p>` }
  ];

  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function renderText(text) {
    const blocks = [];
    let source = String(text || '').replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
      const index = blocks.length; blocks.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.replace(/\n$/, ''))}</code><button class="copy-code" data-copy="${index}">Copy</button></pre>`); return `\u0000${index}\u0000`;
    });
    source = escapeHtml(source).replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/^[-*] (.+)$/gm, '<li>$1</li>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    source = source.replace(/(?:<br>)?(<li>[\s\S]*?<\/li>)(?:<br>)?/g, '$1').replace(/(<li>[\s\S]*?<\/li>)+/g, '<ul>$&</ul>');
    return source.replace(/\u0000(\d+)\u0000/g, (_m, n) => blocks[Number(n)]);
  }
  function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600); }
  function saveChats() { localStorage.setItem(storageKey, JSON.stringify(state.chats)); }
  function loadChats() { try { const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
  function newChat() {
    state.currentId = null; state.page = 'chat'; showPage('chat'); state.chats.unshift({ id: crypto.randomUUID(), title: 'New chat', created: Date.now(), messages: [], stats: { seconds: 0, tokens: 0, responses: 0 } }); state.currentId = state.chats[0].id; saveChats(); renderHistory(); renderChat(); $('#messageInput').focus();
  }
  function currentChat() { return state.chats.find(chat => chat.id === state.currentId); }
  function openChat(id) { state.currentId = id; showPage('chat'); renderChat(); renderHistory(); }
  function renderHistory() {
    $('#historyList').replaceChildren();
    state.chats.forEach(chat => {
      const button = document.createElement('button'); button.className = `history-item${chat.id === state.currentId ? ' selected' : ''}`; button.title = chat.title;
      button.innerHTML = `<span class="history-chat-icon">◌</span><span class="history-name">${escapeHtml(chat.title)}</span><span class="history-delete" title="Delete chat" aria-label="Delete chat">×</span>`;
      button.addEventListener('click', event => { if (event.target.closest('.history-delete')) { state.chats = state.chats.filter(item => item.id !== chat.id); if (state.currentId === chat.id) state.currentId = null; saveChats(); renderHistory(); renderChat(); updateEco(); } else openChat(chat.id); });
      $('#historyList').append(button);
    });
  }
  function renderChat() {
    const chat = currentChat(); const messages = $('#messages'); messages.replaceChildren();
    const empty = !chat || chat.messages.length === 0;
    $('#welcome').classList.toggle('hidden', !empty); messages.classList.toggle('hidden', empty);
    $('#topbarTitle').textContent = chat?.title || 'New chat';
    if (chat) for (const item of chat.messages) appendMessage(item.role, item.content);
    messages.scrollTop = messages.scrollHeight;
  }
  function appendMessage(role, content) {
    const row = document.createElement('article'); row.className = `message ${role}`;
    const label = role === 'assistant' ? 'NexusEco' : 'You';
    row.innerHTML = `<div class="message-avatar">${role === 'assistant' ? 'N' : 'Y'}</div><div class="message-main"><div class="message-label">${label}</div><div class="message-body">${renderText(content)}</div></div>`;
    $('#messages').append(row); return row.querySelector('.message-body');
  }
  function showPage(page) {
    state.page = page; document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    const view = $(`#${page}View`); if (view) view.classList.add('active');
    document.querySelectorAll('.side-link[data-page]').forEach(link => link.classList.toggle('active', link.dataset.page === page));
    const names = { chat: currentChat()?.title || 'New chat', eco: 'Eco checker', learn: 'Read & learn', about: 'About the AI', settings: 'Settings', terms: 'Terms & privacy' };
    $('#topbarTitle').textContent = names[page] || 'NexusEco AI'; $('#sidebar').classList.remove('open');
    if (page === 'eco') updateEco(); if (page === 'settings') populateSettings();
  }
  function estimatedTokens(chat) { return (chat?.stats?.tokens || 0); }
  function updateEco() {
    const chat = currentChat(); const stats = chat?.stats || { seconds: 0, tokens: 0, responses: 0 };
    $('#ecoResponses').textContent = String(stats.responses || 0); $('#ecoSeconds').textContent = `${(stats.seconds || 0).toFixed(1)} sec`;
    const watts = Number(state.config.deviceWatts || 25); const kwh = watts * (stats.seconds || 0) / 3600000;
    $('#ecoEnergy').textContent = kwh ? `${(kwh * 1000).toFixed(3)} Wh` : '0 Wh';
    const tokens = estimatedTokens(chat), water = Number(state.config.cloudWaterMlPer1k), cloudCO2 = Number(state.config.cloudCarbonGPer1k), grid = Number(state.config.gridCarbonGPerKwh);
    $('#ecoWater').textContent = Number.isFinite(water) && state.config.cloudWaterMlPer1k !== '' && state.config.cloudWaterMlPer1k != null ? `~${(water * tokens / 1000).toFixed(2)} ml` : 'Not set';
    if (Number.isFinite(cloudCO2) && state.config.cloudCarbonGPer1k !== '' && state.config.cloudCarbonGPer1k != null && Number.isFinite(grid) && state.config.gridCarbonGPerKwh !== '' && state.config.gridCarbonGPerKwh != null) {
      const diff = cloudCO2 * tokens / 1000 - grid * kwh; $('#ecoCarbon').textContent = `${diff >= 0 ? '~' : '≈'}${Math.abs(diff).toFixed(2)} g CO₂e ${diff >= 0 ? 'lower' : 'higher'}`;
    } else $('#ecoCarbon').textContent = 'Not set';
  }
  function populateSettings() {
    const c = state.config; $('#modelUrl').value = c.modelUrl || ''; $('#contextSize').value = String(c.contextSize || 4096); $('#deviceWatts').value = c.deviceWatts || 25;
    $('#cloudWater').value = c.cloudWaterMlPer1k ?? ''; $('#cloudCarbon').value = c.cloudCarbonGPer1k ?? ''; $('#gridCarbon').value = c.gridCarbonGPerKwh ?? '';
    $('#modelFolderPath').textContent = c.modelDir ? `Model folder: ${c.modelDir}` : '';
    $('#modelStateText').textContent = state.modelExists ? 'Model downloaded' : 'No model downloaded yet'; $('#modelStatePath').textContent = state.modelExists ? state.appState?.modelPath || '' : 'Add a public direct .gguf link above to install it.';
    $('#modelStateDot').classList.toggle('installed', state.modelExists);
    const action = $('#downloadOrChat'); action.textContent = state.modelExists ? (state.running ? 'Ready' : 'Load model') : 'Download'; action.disabled = state.busy;
  }
  function validNumberOrNull(value) { if (value.trim() === '') return ''; const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
  async function saveSettings() {
    const assumptions = [validNumberOrNull($('#cloudWater').value), validNumberOrNull($('#cloudCarbon').value), validNumberOrNull($('#gridCarbon').value)];
    if (assumptions.includes(null)) { toast('Enter a non-negative number, or leave that assumption blank.'); return; }
    const config = await window.nexus.saveSettings({ contextSize: Number($('#contextSize').value), deviceWatts: Number($('#deviceWatts').value), cloudWaterMlPer1k: assumptions[0], cloudCarbonGPer1k: assumptions[1], gridCarbonGPerKwh: assumptions[2] });
    state.config = config; updateEco(); toast('Settings saved on this device.');
  }
  async function saveModelUrl() {
    const url = $('#modelUrl').value.trim();
    if (url) {
      let parsed;
      try { parsed = new URL(url); } catch { toast('Enter a valid direct HTTPS link to a .gguf file.'); return; }
      if (parsed.protocol !== 'https:' || !/\.gguf$/i.test(parsed.pathname)) { toast('Use a direct HTTPS link to a .gguf file.'); return; }
    }
    state.config = await window.nexus.saveSettings({ modelUrl: url }); populateSettings(); $('#welcomeModel').innerHTML = '';
    if (url) toast('Download link saved. You can install the model from Settings.'); else toast('Download link cleared.');
  }
  async function refreshState() {
    state.appState = await window.nexus.getState(); state.config = state.appState.config; state.modelExists = state.appState.modelExists; state.serverAvailable = state.appState.serverAvailable; state.running = state.appState.serverRunning;
    const pill = $('#runtimeState'); pill.innerHTML = `<span class="state-dot${state.running ? ' online' : ''}"></span>${state.running ? 'Model ready' : state.modelExists ? 'Model downloaded' : 'Model not loaded'}`;
    $('#offlinePill').textContent = state.running ? 'ready' : 'offline'; populateSettings(); updateWelcomeModel(); updateEco();
  }
  function updateWelcomeModel() {
    const box = $('#welcomeModel');
    if (state.running) { box.innerHTML = '<span class="welcome-ready">NexusEco-3B is ready on this device.</span>'; return; }
    if (state.modelExists) { box.innerHTML = '<span class="welcome-ready">Your model is downloaded.</span> <button class="small-action" id="welcomeLoad">Load model</button>'; $('#welcomeLoad').onclick = startModel; }
    else box.innerHTML = `<span class="welcome-ready">To begin, add your public model file link in Settings.</span> <button class="small-action" id="welcomeSettings">Open settings</button>`;
    $('#welcomeSettings')?.addEventListener('click', () => showPage('settings'));
  }
  function renderArticles() {
    $('#articleGrid').innerHTML = articles.map((article, index) => `<button class="article-card" data-article="${index}"><span class="article-art"></span><small>${article.tag}</small><strong>${article.title}</strong></button>`).join('');
    $('#articleGrid').addEventListener('click', event => { const card = event.target.closest('[data-article]'); if (!card) return; const article = articles[Number(card.dataset.article)]; $('#articleReader').classList.remove('hidden'); $('#articleGrid').classList.add('hidden'); $('#articleBody').innerHTML = article.body; });
  }
  async function startModel() {
    if (!state.modelExists) { showPage('settings'); toast('Download your GGUF model first.'); return; }
    if (!state.serverAvailable) { toast('The llama.cpp runtime is missing. Rebuild with npm run dist:win.'); return; }
    state.busy = true; $('#runtimeState').innerHTML = '<span class="state-dot"></span>Loading model…'; populateSettings();
    try { await window.nexus.startChat(); state.running = true; await refreshState(); toast('Model is ready. Your chats run locally.'); }
    catch (error) { toast(error.message || 'Could not load the model.'); }
    finally { state.busy = false; populateSettings(); }
  }
  async function beginDownload() {
    const url = $('#modelUrl').value.trim(); if (!url) { toast('Paste your public GGUF download link first.'); $('#modelUrl').focus(); return; }
    try {
      state.busy = true; populateSettings(); $('#downloadProgress').classList.remove('hidden'); $('#progressText').textContent = 'Starting or resuming download…'; $('#progressFill').style.width = '0%';
      const result = await window.nexus.downloadModel(url);
      if (result.canceled) { $('#progressText').textContent = 'Paused. Select Download to resume.'; toast('Download paused; partial file kept for resuming.'); }
      else { await refreshState(); $('#progressText').textContent = `Saved ${result.filename} (${(result.size / 1024 ** 3).toFixed(2)} GB)`; toast('Model downloaded. Load it when you are ready.'); }
    } catch (error) { $('#progressText').textContent = error.message || 'Download failed.'; toast(error.message || 'Download failed.'); }
    finally { state.busy = false; populateSettings(); }
  }
  function setBusy(busy) { state.busy = busy; $('#sendButton').hidden = busy; $('#stopButton').hidden = !busy; $('#messageInput').disabled = busy; }
  async function submitMessage(text) {
    const value = text.trim(); if (!value || state.busy) return;
    if (!state.modelExists) { $('#messageInput').value = value; toast('Download the model in Settings before chatting.'); showPage('settings'); return; }
    if (!state.running) await startModel(); if (!state.running) return;
    if (!currentChat()) { const chat = { id: crypto.randomUUID(), title: value.slice(0, 42), created: Date.now(), messages: [], stats: { seconds: 0, tokens: 0, responses: 0 } }; state.chats.unshift(chat); state.currentId = chat.id; }
    const chat = currentChat(); if (!chat.messages.length) chat.title = value.length > 42 ? `${value.slice(0, 39)}…` : value;
    chat.messages.push({ role: 'user', content: value }); appendMessage('user', value); $('#welcome').classList.add('hidden'); $('#messages').classList.remove('hidden'); $('#messageInput').value = ''; $('#messageInput').style.height = 'auto'; renderHistory(); saveChats();
    const requestMessages = [{ role: 'system', content: 'You are NexusEco AI, a helpful, honest assistant. You run locally and have no web access. Do not claim to browse or know current facts. Explain uncertainty, show clear reasoning for math and code, and warn users to review code before running it.' }, ...chat.messages];
    const output = appendMessage('assistant', ''); const requestId = crypto.randomUUID(); state.requestId = requestId; state.startAt = performance.now(); state.cancelPending = false; setBusy(true);
    const assistantMessage = { role: 'assistant', content: '' }; chat.messages.push(assistantMessage);
    const onToken = data => { if (data.requestId !== requestId) return; assistantMessage.content += data.token; output.innerHTML = renderText(assistantMessage.content); $('#messages').scrollTop = $('#messages').scrollHeight; };
    window.nexus.onChatToken(onToken);
    const onFinish = data => { if (data.requestId !== requestId) return; window.nexus.offChatFinished?.(onFinish); window.nexus.offChatToken?.(onToken); completeResponse(chat, assistantMessage, output); };
    window.nexus.onChatFinished(onFinish);
    try { await window.nexus.sendChat(requestId, requestMessages, 1024); }
    catch (error) { window.nexus.offChatFinished?.(onFinish); window.nexus.offChatToken?.(onToken); if (!assistantMessage.content) { assistantMessage.content = `I couldn't complete that response: ${error.message || 'local model error'}`; output.textContent = assistantMessage.content; } completeResponse(chat, assistantMessage, output); }
  }
  function completeResponse(chat, message, output) {
    if (!state.busy) return;
    const seconds = Math.max(0, (performance.now() - state.startAt) / 1000); chat.stats ||= { seconds: 0, tokens: 0, responses: 0 }; chat.stats.seconds += seconds; chat.stats.tokens += Math.max(1, Math.ceil(message.content.length / 4)); chat.stats.responses += 1;
    output.innerHTML = renderText(message.content); setBusy(false); state.requestId = null; renderHistory(); saveChats(); updateEco();
  }
  async function init() {
    state.chats = loadChats(); state.currentId = state.chats[0]?.id || null; document.body.classList.toggle('light', localStorage.getItem('nexuseco.theme') === 'light');
    renderArticles(); renderHistory(); renderChat(); await refreshState();
    if (localStorage.getItem(consentKey) !== 'accepted-v1') $('#consentModal').classList.remove('hidden');
    if (!state.currentId && !state.chats.length) renderChat();
    window.nexus.onDownloadProgress(data => { $('#downloadProgress').classList.remove('hidden'); $('#progressFill').style.width = data.percent == null ? '25%' : `${data.percent}%`; $('#progressText').textContent = data.total ? `${data.filename} · ${(data.received / 1024 ** 3).toFixed(2)} / ${(data.total / 1024 ** 3).toFixed(2)} GB` : `${data.filename} · ${(data.received / 1024 ** 3).toFixed(2)} GB`; });
    window.nexus.onServerState(data => { state.running = data.running; refreshState(); });
  }
  $('#newChat').addEventListener('click', newChat);
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
  $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#themeToggle').addEventListener('click', () => { document.body.classList.toggle('light'); localStorage.setItem('nexuseco.theme', document.body.classList.contains('light') ? 'light' : 'dark'); });
  $('#chatForm').addEventListener('submit', event => { event.preventDefault(); submitMessage($('#messageInput').value); });
  $('#messageInput').addEventListener('input', event => { const input = event.currentTarget; input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; });
  $('#messageInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#chatForm').requestSubmit(); } });
  document.querySelectorAll('.prompt-card').forEach(button => button.addEventListener('click', () => { $('#messageInput').value = button.dataset.prompt; submitMessage(button.dataset.prompt); }));
  $('#saveSettings').addEventListener('click', saveSettings); $('#saveUrl').addEventListener('click', saveModelUrl);
  $('#chooseFolder').addEventListener('click', async () => { const folder = await window.nexus.chooseModelFolder(); if (folder) { await refreshState(); toast('Model folder updated.'); } });
  $('#downloadOrChat').addEventListener('click', () => state.modelExists ? startModel() : beginDownload());
  $('#cancelDownload').addEventListener('click', () => window.nexus.cancelDownload());
  $('#clearHistory').addEventListener('click', () => { if (!confirm('Delete all local chat history? This cannot be undone.')) return; state.chats = []; state.currentId = null; saveChats(); renderHistory(); renderChat(); updateEco(); toast('Chat history deleted.'); });
  $('#backToArticles').addEventListener('click', () => { $('#articleReader').classList.add('hidden'); $('#articleGrid').classList.remove('hidden'); });
  $('#articleBody').addEventListener('click', event => { const source = event.target.closest('.source-link'); if (source) window.nexus.openExternal(source.dataset.url); });
  $('#agreeCheck').addEventListener('change', event => { $('#acceptTerms').disabled = !event.target.checked; });
  $('#acceptTerms').addEventListener('click', () => { localStorage.setItem(consentKey, 'accepted-v1'); $('#consentModal').classList.add('hidden'); });
  $('#messages').addEventListener('click', async event => { const btn = event.target.closest('.copy-code'); if (!btn) return; const pre = btn.parentElement; try { await navigator.clipboard.writeText(pre.querySelector('code').textContent); toast('Code copied.'); } catch { toast('Could not copy code.'); } });
  $('#stopButton').addEventListener('click', async () => { await window.nexus.stopChat(); state.running = false; setBusy(false); toast('Local model stopped.'); });
  init().catch(error => toast(error.message || 'Could not initialize NexusEco.'));
})();
