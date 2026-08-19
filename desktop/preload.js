const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  dragWindow: (dx, dy) => ipcRenderer.send('drag-window', { dx, dy }),
  resize: (w, h, mode) => ipcRenderer.send('resize-window', { w, h, mode }),
  getWeather: () => ipcRenderer.invoke('get-weather'),
  quit: () => ipcRenderer.send('quit-app')
});
