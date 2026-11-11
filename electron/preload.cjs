const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('islands', {
  voicevoxStatus: () => ipcRenderer.invoke('voicevox:status'),
  synthesizeVoicevox: (text) => ipcRenderer.invoke('voicevox:synthesize', text),
  openSource: (level, page) => ipcRenderer.invoke('sources:open', level, page),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  openDictionary: (word, reading) => ipcRenderer.invoke('dictionary:open', word, reading),
});
