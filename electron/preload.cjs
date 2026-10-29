const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('islands', {
  openSource: (level, page) => ipcRenderer.invoke('sources:open', level, page),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  openDictionary: (word, reading) => ipcRenderer.invoke('dictionary:open', word, reading),
});
