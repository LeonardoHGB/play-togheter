const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 43821;
const DEFAULT_SERVER_URL = process.env.LISTEN_TOGETHER_SERVER_URL || "http://127.0.0.1:3333";

let mainWindow;
let spotifyCallbackServer;

function normalizeServerUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  const parsed = new URL(raw);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("A URL deve usar HTTP ou HTTPS.");
  }

  return parsed.toString().replace(/\/$/, "");
}

function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig() {
  try {
    const content = fs.readFileSync(getConfigPath(), "utf8");
    const parsed = JSON.parse(content);
    return {
      serverUrl: normalizeServerUrl(parsed.serverUrl || DEFAULT_SERVER_URL)
    };
  } catch {
    return { serverUrl: normalizeServerUrl(DEFAULT_SERVER_URL) };
  }
}

function writeConfig(nextConfig) {
  const config = {
    serverUrl: normalizeServerUrl(nextConfig.serverUrl)
  };

  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
  return config;
}

async function testServer(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(`${normalized}/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });

    const body = await response.text();
    let payload = null;
    try {
      payload = body ? JSON.parse(body) : null;
    } catch {
      payload = body;
    }

    if (!response.ok || payload?.status !== "ok") {
      throw new Error(`Servidor respondeu com status ${response.status}.`);
    }

    return {
      ok: true,
      serverUrl: normalized,
      health: payload
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("O servidor não respondeu em até 7 segundos.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function callbackHtml({ success, title, message }) {
  const accent = success ? "#4ade80" : "#f87171";

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Listen Together</title>
  <style>
    * { box-sizing: border-box; }
    body { min-height:100vh; margin:0; display:grid; place-items:center; padding:24px; background:#09090b; color:#fafafa; font-family:Inter,system-ui,sans-serif; }
    main { width:min(100%,480px); padding:34px; border:1px solid #27272a; border-radius:24px; background:#18181b; text-align:center; box-shadow:0 30px 80px rgba(0,0,0,.45); }
    .icon { width:62px; height:62px; display:grid; place-items:center; margin:0 auto 18px; border-radius:50%; color:#052e16; background:${accent}; font-size:28px; font-weight:900; }
    h1 { margin:0 0 12px; color:${accent}; }
    p { margin:0; color:#a1a1aa; line-height:1.6; }
  </style>
</head>
<body>
  <main>
    <div class="icon">${success ? "✓" : "!"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p style="margin-top:14px">Você já pode voltar ao aplicativo.</p>
  </main>
  <script>setTimeout(() => window.close(), 1800);</script>
</body>
</html>`;
}

function sendCallbackResponse(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(callbackHtml(data));
}

function startSpotifyCallbackServer() {
  if (spotifyCallbackServer) return;

  spotifyCallbackServer = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${CALLBACK_HOST}:${CALLBACK_PORT}`);

      if (requestUrl.pathname !== "/callback") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Rota não encontrada.");
        return;
      }

      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");

      if (error) {
        mainWindow?.webContents.send("spotify-oauth-callback", { error, state });
        sendCallbackResponse(response, 400, {
          success: false,
          title: "Autorização recusada",
          message: `O Spotify retornou: ${error}`
        });
        return;
      }

      if (!code) {
        sendCallbackResponse(response, 400, {
          success: false,
          title: "Código ausente",
          message: "O Spotify não enviou o código de autorização."
        });
        return;
      }

      mainWindow?.webContents.send("spotify-oauth-callback", { code, state });
      mainWindow?.show();
      mainWindow?.focus();

      sendCallbackResponse(response, 200, {
        success: true,
        title: "Spotify conectado",
        message: "O Listen Together recebeu a autorização com sucesso."
      });
    } catch (error) {
      console.error("Erro ao processar callback do Spotify:", error);
      sendCallbackResponse(response, 500, {
        success: false,
        title: "Erro no callback",
        message: "O aplicativo não conseguiu processar o retorno do Spotify."
      });
    }
  });

  spotifyCallbackServer.on("error", (error) => {
    console.error(`Falha ao abrir a porta ${CALLBACK_PORT}:`, error);
  });

  spotifyCallbackServer.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
    console.log(`Callback Spotify: http://${CALLBACK_HOST}:${CALLBACK_PORT}/callback`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#09090b",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("open-external", async (_event, url) => {
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new Error("URL externa inválida.");
  }
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("app-config:get", () => readConfig());
ipcMain.handle("app-config:save-server", (_event, serverUrl) => writeConfig({ serverUrl }));
ipcMain.handle("app-config:test-server", (_event, serverUrl) => testServer(serverUrl));

app.whenReady().then(() => {
  startSpotifyCallbackServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  spotifyCallbackServer?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
