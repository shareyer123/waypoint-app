"use strict";
// The only bridge between the page and the computer. Keep it narrow.
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld("waypoint", {
  getVault: () => ipcRenderer.invoke("vault:get"),
  openVault: () => ipcRenderer.invoke("vault:choose"),
  openRecent: (p) => ipcRenderer.invoke("vault:openRecent", p),
  openSample: () => ipcRenderer.invoke("vault:sample"),
  readNote: (rel) => ipcRenderer.invoke("note:read", rel),
  writeNote: (rel, text) => ipcRenderer.invoke("note:write", rel, text),
  createNote: (rel, text) => ipcRenderer.invoke("note:create", rel, text),
  openExternal: (url) => ipcRenderer.invoke("link:external", url),
  setDirty: (d) => ipcRenderer.send("state:dirty", !!d),
  closeWindow: () => ipcRenderer.send("app:close"),
  onChanges: on("vault:changes"),
  onReset: on("vault:reset"),
  onOpened: on("vault:opened"),
  onMenu: on("menu"),
});
