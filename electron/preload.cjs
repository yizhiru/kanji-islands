const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('islands', {
  voicevoxStatus: () => ipcRenderer.invoke('voicevox:status'),
  synthesizeVoicevox: (text) => ipcRenderer.invoke('voicevox:synthesize', text),
  localSpeechStatus: () => ipcRenderer.invoke('speech:status'),
  synthesizeLocal: (engine, text) => ipcRenderer.invoke('speech:synthesize', engine, text),
  onLocalSpeechStatus: (callback) => {
    const listener = (_event, engine, state) => callback(engine, state);
    ipcRenderer.on('speech:changed', listener);
    return () => ipcRenderer.removeListener('speech:changed', listener);
  },
  openSource: (level, page) => ipcRenderer.invoke('sources:open', level, page),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  openDictionary: (word, reading) => ipcRenderer.invoke('dictionary:open', word, reading),
});
