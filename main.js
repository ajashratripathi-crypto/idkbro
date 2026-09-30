const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

let mainWindow;
let serverProcess;
const downloads = new Map();
const DEFAULT_MODEL = 'NexusEco-3B-Q4_K_M.gguf';
const SERVER_PORT = 11435;

function configPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function defaultModelDir() { return path.join(app.getPath('userData'), 'models'); }
async function readConfig() {
  try { return JSON.parse(await fsp.readFile(configPath(), 'utf8')); }
  catch { return { modelUrl: '', modelDir: defaultModelDir(), modelFile: DEFAULT_MODEL, contextSize: 4096, deviceWatts: 25 }; }
}
async function writeConfig(next) {
  const current = await readConfig();
  const safe = { ...current, ...next };
  await fsp.mkdir(path.dirname(configPath()), { recursive: true });
  await fsp.writeFile(configPath(), JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function safeFilename(url) {
  let name = DEFAULT_MODEL;
  try { name = decodeURIComponent(path.posix.basename(new URL(url).pathname)); } catch {}
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(-160);
  if (!name.toLowerCase().endsWith('.gguf')) name = DEFAULT_MODEL;
  return name || DEFAULT_MODEL;
}
function getServerExecutable() {
  const root = app.isPackaged ? process.resourcesPath : __dirname;
  return path.join(root, 'llama', 'llama-server.exe');
}
async function modelPath() {
  const config = await readConfig();
  return path.join(config.modelDir || defaultModelDir(), config.modelFile || DEFAULT_MODEL);
}

function makeWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: '#202123',
    title: 'NexusEco AI',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await fsp.mkdir(defaultModelDir(), { recursive: true });
  makeWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
});

app.on('before-quit', () => {
  for (const job of downloads.values()) job.controller.abort();
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('get-app-state', async () => {
  const config = await readConfig();
  const file = await modelPath();
  return {
    config,
    modelExists: fs.existsSync(file),
    modelPath: file,
    serverAvailable: fs.existsSync(getServerExecutable()),
    serverRunning: Boolean(serverProcess && !serverProcess.killed)
  };
});

ipcMain.handle('save-settings', async (_event, settings) => {
  const optionalEstimate = value => {
    if (value === '' || value === null) return value === null ? '' : '';
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
  };
  const allowed = {
    modelUrl: typeof settings.modelUrl === 'string' ? settings.modelUrl.trim() : undefined,
    modelDir: typeof settings.modelDir === 'string' ? settings.modelDir : undefined,
    contextSize: [2048, 4096, 8192].includes(Number(settings.contextSize)) ? Number(settings.contextSize) : undefined,
    deviceWatts: Number.isFinite(Number(settings.deviceWatts)) ? Math.max(1, Math.min(1000, Number(settings.deviceWatts))) : undefined,
    cloudWaterMlPer1k: optionalEstimate(settings.cloudWaterMlPer1k),
    cloudCarbonGPer1k: optionalEstimate(settings.cloudCarbonGPer1k),
    gridCarbonGPerKwh: optionalEstimate(settings.gridCarbonGPerKwh)
  };
  return writeConfig(Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined)));
});

ipcMain.handle('choose-model-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose model storage folder', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const modelDir = result.filePaths[0];
  await fsp.mkdir(modelDir, { recursive: true });
  await writeConfig({ modelDir });
  return modelDir;
});

ipcMain.handle('download-model', async (event, { url }) => {
  if (typeof url !== 'string' || !url.trim()) throw new Error('Enter a direct HTTPS link to a public .gguf file.');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('That download link is not a valid URL.'); }
  if (parsed.protocol !== 'https:') throw new Error('For safety, model downloads must use HTTPS.');

  const config = await readConfig();
  const folder = config.modelDir || defaultModelDir();
  await fsp.mkdir(folder, { recursive: true });
  const filename = safeFilename(url);
  const target = path.join(folder, filename);
  const partial = `${target}.part`;
  const controller = new AbortController();
  const jobId = String(event.sender.id);
  downloads.set(jobId, { controller, partial });
  try {
    let offset = 0;
    try { offset = (await fsp.stat(partial)).size; } catch {}
    const headers = offset ? { Range: `bytes=${offset}-` } : {};
    let response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (new URL(response.url).protocol !== 'https:') throw new Error('The model host redirected to an insecure HTTP address. Download canceled.');
    if (response.status === 416 && offset) {
      await fsp.rm(partial, { force: true });
      offset = 0;
      response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (new URL(response.url).protocol !== 'https:') throw new Error('The model host redirected to an insecure HTTP address. Download canceled.');
    }
    if (!response.ok || !response.body) throw new Error(`Model host returned HTTP ${response.status}. Check that the link points to a public GGUF file.`);
    const append = offset > 0 && response.status === 206;
    if (!append && offset) offset = 0;
    const contentLength = Number(response.headers.get('content-length') || 0);
    const total = append ? offset + contentLength : contentLength;
    let received = offset;
    const source = Readable.fromWeb(response.body);
    source.on('data', chunk => {
      received += chunk.length;
      send('download-progress', { received, total, percent: total ? Math.min(100, received / total * 100) : null, filename });
    });
    await pipeline(source, fs.createWriteStream(partial, { flags: append ? 'a' : 'w' }), { signal: controller.signal });
    const stats = await fsp.stat(partial);
    if (total && stats.size !== total) throw new Error('Download ended early. Press Resume to continue it.');
    await fsp.rename(partial, target);
    await writeConfig({ modelFile: filename, modelUrl: url.trim() });
    send('download-complete', { path: target, filename, size: stats.size });
    return { path: target, filename, size: stats.size };
  } catch (error) {
    if (error.name === 'AbortError') return { canceled: true };
    throw error;
  } finally { downloads.delete(jobId); }
});

ipcMain.handle('cancel-download', event => {
  const job = downloads.get(String(event.sender.id));
  if (job) job.controller.abort();
  return Boolean(job);
});

async function waitForServer(timeoutMs = 180000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    if (!serverProcess || serverProcess.killed || serverProcess.exitCode !== null) throw new Error('llama-server stopped while loading the model. Check model compatibility and available memory.');
    try {
      const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`);
      if (response.ok) return true;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new Error(`Timed out waiting for the local model. ${lastError?.message || ''}`);
}

ipcMain.handle('start-chat', async () => {
  const config = await readConfig();
  const file = await modelPath();
  if (!fs.existsSync(file)) throw new Error('Download NexusEco-3B first.');
  const server = getServerExecutable();
  if (!fs.existsSync(server)) throw new Error('The bundled llama-server.exe is missing. Build the Windows installer with the runtime step, or use the development setup in README.md.');
  if (serverProcess && !serverProcess.killed) {
    try { await waitForServer(5000); return { ready: true }; } catch { serverProcess.kill(); serverProcess = null; }
  }
  const logPath = path.join(app.getPath('userData'), 'llama-server.log');
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  serverProcess = spawn(server, [
    '--model', file,
    '--host', '127.0.0.1',
    '--port', String(SERVER_PORT),
    '--ctx-size', String(config.contextSize || 4096),
    '--n-gpu-layers', '0',
    '--alias', 'nexuseco-3b',
    '--no-webui'
  ], { cwd: path.dirname(server), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProcess.stdout.pipe(log, { end: false });
  serverProcess.stderr.pipe(log, { end: false });
  serverProcess.on('error', error => { serverProcess = null; send('server-error', error.message); });
  serverProcess.on('exit', code => {
    log.end();
    send('server-state', { running: false, code });
    serverProcess = null;
  });
  try {
    await waitForServer();
    send('server-state', { running: true });
    return { ready: true };
  } catch (error) {
    if (serverProcess && !serverProcess.killed) serverProcess.kill();
    throw error;
  }
});

ipcMain.handle('stop-chat', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  serverProcess = null;
  return true;
});

ipcMain.handle('send-chat', async (event, { requestId, messages, maxTokens = 1024 }) => {
  if (!serverProcess || serverProcess.killed) throw new Error('Start the local model before sending a message.');
  const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nexuseco-3b', messages, temperature: 0.7, top_p: 0.9, max_tokens: Math.min(2048, Math.max(1, Number(maxTokens) || 1024)), stream: true })
  });
  if (!response.ok || !response.body) throw new Error(`Local model request failed (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const item of events) {
      for (const line of item.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) event.sender.send('chat-token', { requestId, token });
        } catch {}
      }
    }
  }
  event.sender.send('chat-finished', { requestId });
  return { done: true };
});

ipcMain.handle('open-external', async (_event, url) => {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return false;
    await shell.openExternal(parsed.toString());
    return true;
  } catch { return false; }
});
