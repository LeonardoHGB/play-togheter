// Atualização automática via electron-updater, lendo as releases do GitHub.
//
// Formatos que se auto-atualizam: instalador NSIS (Windows), .deb e AppImage
// (Linux). O portable do Windows não entra — não existe instalador para rodar
// — e por isso deixou de ser publicado.
//
// O download acontece em segundo plano; a instalação só é aplicada quando o
// usuário aceita reiniciar, ou sozinha ao fechar o app. Nunca reiniciamos no
// meio de uma música por conta própria.

const { app, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");

// Recheca de tempos em tempos para quem deixa o app aberto por dias.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let mainWindowRef = null;
let manualCheck = false;
let lastState = { state: "idle" };

function publish(state) {
  lastState = state;
  const contents = mainWindowRef?.().webContents;
  if (contents && !contents.isDestroyed()) {
    contents.send("updater:state", state);
  }
}

// Em desenvolvimento não existe app-update.yml e o electron-updater lança erro.
// Também cobre o caso de rodar a partir de um diretório descompactado.
function canUpdate() {
  return app.isPackaged;
}

function initUpdater(getWindow) {
  mainWindowRef = getWindow;

  ipcMain.handle("updater:state", () => lastState);

  ipcMain.handle("updater:check", async () => {
    if (!canUpdate()) {
      publish({ state: "unsupported" });
      return lastState;
    }
    manualCheck = true;
    publish({ state: "checking" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      publish({ state: "error", message: error?.message || "Falha ao verificar." });
    }
    return lastState;
  });

  ipcMain.handle("updater:install", () => {
    if (lastState.state !== "ready") return false;
    // isSilent = false (mostra o instalador no Windows),
    // isForceRunAfter = true (reabre o app depois).
    autoUpdater.quitAndInstall(false, true);
    return true;
  });

  if (!canUpdate()) {
    publish({ state: "unsupported" });
    return;
  }

  // Baixa sozinho assim que encontra algo; instalar continua sendo escolha do
  // usuário (ou acontece ao fechar o app).
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => publish({ state: "checking" }));

  autoUpdater.on("update-available", (info) =>
    publish({ state: "downloading", version: info?.version, percent: 0 })
  );

  autoUpdater.on("update-not-available", () => {
    // Silencioso na checagem automática: só avisa se o usuário pediu.
    publish(
      manualCheck
        ? { state: "none", version: app.getVersion() }
        : { state: "idle" }
    );
    manualCheck = false;
  });

  autoUpdater.on("download-progress", (progress) =>
    publish({
      state: "downloading",
      version: lastState.version,
      percent: Math.round(progress?.percent || 0)
    })
  );

  autoUpdater.on("update-downloaded", (info) => {
    manualCheck = false;
    publish({ state: "ready", version: info?.version });
  });

  autoUpdater.on("error", (error) => {
    // Falha de rede na checagem automática não vira ruído na tela.
    if (manualCheck) {
      publish({ state: "error", message: error?.message || "Falha ao atualizar." });
    } else {
      publish({ state: "idle" });
    }
    manualCheck = false;
  });

  // Primeira checagem alguns segundos após abrir, para não competir com o
  // carregamento da janela e da sessão do Spotify.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Sem rede na abertura: a próxima checagem periódica tenta de novo.
    });
  }, 8000);

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, RECHECK_INTERVAL_MS);
}

module.exports = { initUpdater };
