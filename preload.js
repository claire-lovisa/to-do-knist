'use strict';

// preload.js — minimal, explicit IPC bridge. No Node integration in renderer.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('TodoKnist', {
  // configuration
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  setMuted: (muted) => ipcRenderer.invoke('cfg:setMuted', !!muted),

  // plan import / storage
  openDropped: (filePath) => ipcRenderer.invoke('plan:openDropped', filePath),
  openPasted: (content) => ipcRenderer.invoke('plan:openPasted', { content }),
  toggle: (fileName, index, done) => ipcRenderer.invoke('plan:toggle', { fileName, index, done }),
  setActive: (fileName) => ipcRenderer.invoke('plan:setActive', fileName),
  loadActive: () => ipcRenderer.invoke('plan:loadActive'),
  deletePlan: (fileName) => ipcRenderer.invoke('plan:delete', fileName),

  // obsidian daily note (append only)
  appendNote: (body) => ipcRenderer.invoke('vault:appendNote', body),

  // window
  resize: (width, height) => ipcRenderer.invoke('win:resize', { width, height }),
  quit: () => ipcRenderer.invoke('app:quit'),

  // dropped-file path resolution (Electron 22+ replacement for File.path)
  pathForFile: (file) => webUtils.getPathForFile(file),
});
