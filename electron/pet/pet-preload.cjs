const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('maidWhale', {
  getState: () => ipcRenderer.invoke('pet:getState'),
  feed: kind => ipcRenderer.invoke('pet:feed', kind),
  interact: kind => ipcRenderer.invoke('pet:interact', kind),
  setAwake: awake => ipcRenderer.invoke('pet:setPreferences', { awake }),
  focusMain: sessionId => ipcRenderer.invoke('pet:focusMain', sessionId),
  getEnvironment: () => ipcRenderer.invoke('pet:getEnvironment'),
  moveTo: (x, y) => ipcRenderer.invoke('pet:moveTo', { x, y }),
  setInteractive: interactive => ipcRenderer.send('pet:setInteractive', Boolean(interactive)),
  setHitProfile: profile => ipcRenderer.send('pet:setHitProfile', profile),
  onStateChanged: listener => {
    const wrapped = (_event, state) => listener(state)
    ipcRenderer.on('pet:state', wrapped)
    return () => ipcRenderer.removeListener('pet:state', wrapped)
  }
})
