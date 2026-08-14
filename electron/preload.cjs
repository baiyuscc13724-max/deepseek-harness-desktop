const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('desktopHarness', {
  startRuntime: options => ipcRenderer.invoke('runtime:start', options),
  getRuntimeState: () => ipcRenderer.invoke('runtime:state'),
  getUpdatePreferences: () => ipcRenderer.invoke('updates:preferences'),
  setUpdatePreferences: patch => ipcRenderer.invoke('updates:setPreferences', patch),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
  onRuntimeState: listener => subscribe('runtime:state', listener),
  onUpdateResult: listener => subscribe('updates:result', listener),
  onUpdateInstallProgress: listener => subscribe('updates:install-progress', listener)
})
