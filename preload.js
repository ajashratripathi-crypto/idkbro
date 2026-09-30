const { contextBridge, ipcRenderer } = require('electron');
const wrappedListeners = new Map();
function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  const callbacks = wrappedListeners.get(callback) || [];
  callbacks.push([channel, listener]); wrappedListeners.set(callback, callbacks);
  ipcRenderer.on(channel, listener);
}
function unsubscribe(channel, callback) {
  const callbacks = wrappedListeners.get(callback) || [];
  for (const [registeredChannel, listener] of callbacks) if (!channel || channel === registeredChannel) ipcRenderer.removeListener(registeredChannel, listener);
  wrappedListeners.delete(callback);
}

contextBridge.exposeInMainWorld('nexus', {
  getState: () => ipcRenderer.invoke('get-app-state'),
  saveSettings: settings => ipcRenderer.invoke('save-settings', settings),
  chooseModelFolder: () => ipcRenderer.invoke('choose-model-folder'),
  downloadModel: url => ipcRenderer.invoke('download-model', { url }),
  cancelDownload: () => ipcRenderer.invoke('cancel-download'),
  startChat: () => ipcRenderer.invoke('start-chat'),
  stopChat: () => ipcRenderer.invoke('stop-chat'),
  sendChat: (requestId, messages, maxTokens) => ipcRenderer.invoke('send-chat', { requestId, messages, maxTokens }),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  onDownloadProgress: callback => ipcRenderer.on('download-progress', (_event, data) => callback(data)),
  onDownloadComplete: callback => ipcRenderer.on('download-complete', (_event, data) => callback(data)),
  onChatToken: callback => subscribe('chat-token', callback),
  onChatFinished: callback => subscribe('chat-finished', callback),
  offChatToken: callback => unsubscribe('chat-token', callback),
  offChatFinished: callback => unsubscribe('chat-finished', callback),
  onServerState: callback => ipcRenderer.on('server-state', (_event, data) => callback(data)),
  onServerError: callback => ipcRenderer.on('server-error', (_event, message) => callback(message))
});
