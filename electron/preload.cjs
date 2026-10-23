const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('islands', {
  openSource: (level, page) => ipcRenderer.invoke('sources:open', level, page),
});
