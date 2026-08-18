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
  getProviderMeters: force => ipcRenderer.invoke('models:meters:get', Boolean(force)),
  getMobileSyncState: () => ipcRenderer.invoke('mobileSync:getState'),
  setMobileSyncEnabled: enabled => ipcRenderer.invoke('mobileSync:setEnabled', enabled),
  setMobileSyncRemoteEnabled: enabled => ipcRenderer.invoke('mobileSync:setRemoteEnabled', enabled),
  setMobileSyncTransportPreference: preference => ipcRenderer.invoke('mobileSync:setTransportPreference', preference),
  beginMobilePairing: () => ipcRenderer.invoke('mobileSync:beginPairing'),
  revokeMobileDevice: id => ipcRenderer.invoke('mobileSync:revokeDevice', id),
  sendMobileControlCommand: (deviceId, command) => ipcRenderer.invoke('mobileControl:send', deviceId, command),
  cancelMobileControlCommand: commandId => ipcRenderer.invoke('mobileControl:cancel', commandId),
  stopMobileControl: deviceId => ipcRenderer.invoke('mobileControl:stop', deviceId),
  copyMobileSyncText: value => ipcRenderer.invoke('mobileSync:copy', value),
  openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
  openLocal: (target, options) => ipcRenderer.invoke('shell:openLocal', target, options),
  onRuntimeState: listener => subscribe('runtime:state', listener),
  onMobileSyncState: listener => subscribe('mobileSync:state', listener),
  onPetState: listener => subscribe('pet:state', listener),
  onUpdateResult: listener => subscribe('updates:result', listener),
  onUpdateInstallProgress: listener => subscribe('updates:install-progress', listener)
})
