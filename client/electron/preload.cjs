const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  getAppConfig: () => ipcRenderer.invoke("app-config:get"),
  saveServerUrl: (serverUrl) => ipcRenderer.invoke("app-config:save-server", serverUrl),
  testServerUrl: (serverUrl) => ipcRenderer.invoke("app-config:test-server", serverUrl),
  saveAccount: (account) => ipcRenderer.invoke("app-account:save", account),
  clearAccount: () => ipcRenderer.invoke("app-account:clear"),
  setMiniWindow: (size) => ipcRenderer.invoke("window:mini", size),
  restoreWindow: () => ipcRenderer.invoke("window:restore"),
  focusWindow: () => ipcRenderer.invoke("window:focus"),
  notify: (payload) => ipcRenderer.invoke("app:notify", payload),
  getVersion: () => ipcRenderer.invoke("app:version"),
  onNotificationClick: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("notification-clicked", listener);
    return () => ipcRenderer.removeListener("notification-clicked", listener);
  },
  platform: process.platform,
  onSpotifyCallback: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("spotify-oauth-callback", listener);
    return () => ipcRenderer.removeListener("spotify-oauth-callback", listener);
  }
});
