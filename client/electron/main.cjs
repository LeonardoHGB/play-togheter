const { app, BrowserWindow, Menu, ipcMain, shell, Notification, nativeImage } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 43821;
const DEFAULT_SERVER_URL =
  process.env.SPOTGINO_SERVER_URL ||
  process.env.LISTEN_TOGETHER_SERVER_URL ||
  "http://192.168.230.217:3333";
const NORMAL_MIN_WIDTH = 980;
const NORMAL_MIN_HEIGHT = 680;

// Hosts que o app pode abrir no navegador externo (SG-06): login do Spotify
// (accounts.spotify.com), link de faixa (open.spotify.com) e releases no GitHub.
const EXTERNAL_HOST_ALLOWLIST = ["github.com", "spotify.com"];
function isAllowedExternalUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return EXTERNAL_HOST_ALLOWLIST.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

// Escapa valores interpolados no HTML da página de callback OAuth (SG-07).
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Define o nome do app (e portanto a pasta de userData: %APPDATA%\Spotgino no
// Windows, ~/.config/Spotgino no Linux). Sem isso o Electron usaria o campo
// "name" do package.json ("spotgino-client").
app.setName("Spotgino");

// Necessário para notificações (toasts) funcionarem no Windows.
app.setAppUserModelId("com.joaovitor.spotgino");

let mainWindow;
let spotifyCallbackServer;
let savedNormalBounds = null;
let savedWasMaximized = false;

function normalizeServerUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  const parsed = new URL(raw);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("A URL deve usar HTTP ou HTTPS.");
  }

  return parsed.toString().replace(/\/$/, "");
}

const CONFIG_VERSION = 2;

// Config única e idêntica em Windows (%APPDATA%) e Linux (~/.config),
// abstraída por app.getPath("userData").
function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}

// Migra a config salva por versões anteriores ao rebrand, para não perder a
// conta de amigo nem a URL do servidor. O nome da pasta antiga era derivado do
// "name" do package.json ("listen-together-client"); "Listen Together" fica
// como candidato extra por segurança.
const LEGACY_CONFIG_DIRS = ["listen-together-client", "Listen Together"];

function migrateLegacyConfig() {
  try {
    const newPath = getConfigPath();
    if (fs.existsSync(newPath)) return;
    for (const dir of LEGACY_CONFIG_DIRS) {
      const legacyPath = path.join(app.getPath("appData"), dir, "config.json");
      if (!fs.existsSync(legacyPath)) continue;
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.copyFileSync(legacyPath, newPath);
      return;
    }
  } catch (error) {
    console.error("Falha ao migrar config antiga:", error);
  }
}

function readRawConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistRawConfig(config) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
}

function sanitizeAccount(account) {
  if (!account || typeof account !== "object") return null;
  const userId = typeof account.userId === "string" ? account.userId : "";
  const token = typeof account.token === "string" ? account.token : "";
  if (!userId || !token) return null;
  return {
    userId,
    token,
    displayName:
      typeof account.displayName === "string" ? account.displayName : ""
  };
}

function readConfig() {
  const raw = readRawConfig();
  let serverUrl;
  try {
    serverUrl = normalizeServerUrl(raw.serverUrl || DEFAULT_SERVER_URL);
  } catch {
    serverUrl = normalizeServerUrl(DEFAULT_SERVER_URL);
  }
  return {
    version: CONFIG_VERSION,
    serverUrl,
    account: sanitizeAccount(raw.account)
  };
}

function writeConfig(nextConfig) {
  const raw = readRawConfig();
  raw.version = CONFIG_VERSION;
  raw.serverUrl = normalizeServerUrl(nextConfig.serverUrl);
  persistRawConfig(raw);
  return { serverUrl: raw.serverUrl };
}

function writeAccount(account) {
  const raw = readRawConfig();
  raw.version = CONFIG_VERSION;
  raw.account = sanitizeAccount(account);
  persistRawConfig(raw);
  return raw.account;
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
  <title>Spotgino</title>
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
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
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
      // Rejeita requisições cujo Host não seja o loopback esperado (SG-07):
      // impede DNS-rebinding a partir de uma página web maliciosa.
      const host = request.headers.host;
      const allowedHosts = [
        `${CALLBACK_HOST}:${CALLBACK_PORT}`,
        `127.0.0.1:${CALLBACK_PORT}`,
        `localhost:${CALLBACK_PORT}`
      ];
      if (!allowedHosts.includes(host)) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Host inválido.");
        return;
      }

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
        message: "O Spotgino recebeu a autorização com sucesso."
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
    minWidth: NORMAL_MIN_WIDTH,
    minHeight: NORMAL_MIN_HEIGHT,
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
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Bloqueia navegação do renderer para outra origem (SG-11); se for um host
  // permitido, abre no navegador externo em vez de navegar dentro do app.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(url).origin === new URL(mainWindow.webContents.getURL()).origin;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) shell.openExternal(url);
    }
  });

  // Reload do renderer (Ctrl+R/crash) zera o estado do React: se a janela
  // ficou no formato mini, restaura o formato normal.
  mainWindow.webContents.on("did-finish-load", () => {
    if (savedNormalBounds) restoreNormalWindow();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    savedNormalBounds = null;
    savedWasMaximized = false;
  });
}

ipcMain.handle("open-external", async (_event, url) => {
  if (!isAllowedExternalUrl(url)) {
    throw new Error("URL externa não permitida.");
  }
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("app-config:get", () => readConfig());
ipcMain.handle("app-config:save-server", (_event, serverUrl) => writeConfig({ serverUrl }));
ipcMain.handle("app-config:test-server", (_event, serverUrl) => testServer(serverUrl));
ipcMain.handle("app-account:save", (_event, account) => writeAccount(account));
ipcMain.handle("app-account:clear", () => writeAccount(null));

// --- Modo mini player ---------------------------------------------------

function windowAlive() {
  return Boolean(mainWindow && !mainWindow.isDestroyed());
}

function restoreNormalWindow() {
  if (!windowAlive()) return false;
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT);
  if (savedNormalBounds) {
    mainWindow.setBounds(savedNormalBounds);
    savedNormalBounds = null;
  }
  if (savedWasMaximized) {
    mainWindow.maximize();
    savedWasMaximized = false;
  }
  return true;
}

ipcMain.handle("window:mini", (_event, size) => {
  if (!windowAlive()) return false;
  const width = Math.max(320, Math.round(Number(size?.width) || 400));
  const height = Math.max(140, Math.round(Number(size?.height) || 190));

  // Sai de fullscreen/maximizado antes de medir e redimensionar.
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  if (mainWindow.isMaximized()) {
    if (!savedNormalBounds) {
      savedNormalBounds = mainWindow.getNormalBounds();
      savedWasMaximized = true;
    }
    mainWindow.unmaximize();
  } else if (!savedNormalBounds) {
    savedNormalBounds = mainWindow.getBounds();
    savedWasMaximized = false;
  }

  // Ordem importa no Windows: setResizable(false) fixa min=max no tamanho
  // atual, então o resize precisa vir antes. setContentSize garante que a
  // área útil (CSS) é idêntica em Windows e Linux, independente do frame.
  mainWindow.setMinimumSize(320, 140);
  mainWindow.setResizable(true);
  mainWindow.setContentSize(width, height);
  mainWindow.setResizable(false);
  mainWindow.setAlwaysOnTop(true, "floating");
  return true;
});

ipcMain.handle("window:restore", () => restoreNormalWindow());

ipcMain.handle("window:focus", () => {
  if (!windowAlive()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
});

// --- Notificações -------------------------------------------------------

const NOTIFICATION_ICON = nativeImage.createFromPath(path.join(__dirname, "icon.png"));

// Notificação disparada pelo processo main (Electron Notification) — confiável
// no Linux (libnotify), ao contrário da API Notification do renderer.
ipcMain.handle("app:notify", (_event, payload = {}) => {
  if (!Notification.isSupported()) return false;

  const notification = new Notification({
    title: String(payload.title || "Spotgino").slice(0, 120),
    body: String(payload.body || "").slice(0, 240),
    icon: NOTIFICATION_ICON.isEmpty() ? undefined : NOTIFICATION_ICON,
    silent: false
  });

  notification.on("click", () => {
    if (windowAlive()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("notification-clicked");
    }
  });

  notification.show();
  return true;
});

ipcMain.handle("app:version", () => app.getVersion());

app.whenReady().then(() => {
  // Remove a barra de menu padrão do Electron (File/Edit/View/Window/Help).
  Menu.setApplicationMenu(null);
  migrateLegacyConfig();
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
