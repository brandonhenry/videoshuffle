const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  processVideos: (files, options) => ipcRenderer.invoke('videos:process', files, options),
  onProgress: (callback) => ipcRenderer.on('videos:progress', (event, progress) => callback(progress)),
  getHistory: () => ipcRenderer.invoke('history:get'),
  saveHistory: (files) => ipcRenderer.invoke('history:save', files),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  openVideo: (filePath) => ipcRenderer.invoke('video:open', filePath),
  revealVideo: (filePath) => ipcRenderer.invoke('video:reveal'),
  installFFmpeg: () => ipcRenderer.invoke('install-ffmpeg')
});