const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('licenseApi', {
  generate: (deviceCode) => ipcRenderer.invoke('license:generate', deviceCode),
  copy: (text) => ipcRenderer.invoke('clipboard:copy', text)
});