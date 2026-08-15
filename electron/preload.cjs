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
  launchReadyUpdate: () => ipcRenderer.invoke('updates:launchReady'),
  getDistribution: () => ipcRenderer.invoke('distribution:get'),
  getAppearance: () => ipcRenderer.invoke('appearance:get'),
  setTheme: themeId => ipcRenderer.invoke('appearance:setTheme', themeId),
  getThemeAssets: () => ipcRenderer.invoke('appearance:assets'),
  saveCustomTheme: customTheme => ipcRenderer.invoke('appearance:saveCustom', customTheme),
  chooseThemeBackground: () => ipcRenderer.invoke('appearance:chooseBackground'),
  getPetState: () => ipcRenderer.invoke('pet:getState'),
  setPetPreferences: patch => ipcRenderer.invoke('pet:setPreferences', patch),
  feedPet: kind => ipcRenderer.invoke('pet:feed', kind),
  focusPetActivity: sessionId => ipcRenderer.invoke('pet:focusMain', sessionId),
  openHarnessSettings: () => ipcRenderer.invoke('settings:openDocument'),
  getModelRouting: () => ipcRenderer.invoke('models:routing:get'),
  saveModelRouting: routing => ipcRenderer.invoke('models:routing:save', routing),
  openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
  onRuntimeState: listener => subscribe('runtime:state', listener),
  onPetState: listener => subscribe('pet:state', listener),
  onUpdateResult: listener => subscribe('updates:result', listener),
  onUpdateInstallProgress: listener => subscribe('updates:install-progress', listener)
})
