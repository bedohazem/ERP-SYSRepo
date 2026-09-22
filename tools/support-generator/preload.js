const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('supportApi', {
  choosePrivateKey: () => ipcRenderer.invoke('support:choose-private-key'),

  generateActivation: (input) =>
    ipcRenderer.invoke('support:generate-activation', input),

  generateRecovery: (input) =>
    ipcRenderer.invoke('support:generate-recovery', input),
})
