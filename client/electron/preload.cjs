const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  getAppConfig: () => ipcRenderer.invoke("app-config:get"),
  saveServerUrl: (serverUrl) => ipcRenderer.invoke("app-config:save-server", serverUrl),
  testServerUrl: (serverUrl) => ipcRenderer.invoke("app-config:test-server", serverUrl),
  platform: process.platform,
  onSpotifyCallback: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("spotify-oauth-callback", listener);
    return () => ipcRenderer.removeListener("spotify-oauth-callback", listener);
  }
});
