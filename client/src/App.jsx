import { useCallback, useEffect, useRef, useState } from "react";
import {
  configureSocket,
  disconnectSocket,
  getSocket,
  normalizeServerUrl
} from "./socket";
import {
  clearOAuthTemporaryData,
  clearSpotifySession,
  createSpotifyAuthorizationUrl,
  exchangeCode,
  getOAuthState,
  getValidAccessToken,
  hasSpotifySession,
  spotifyApi
} from "./spotify";
import { useFriends, FriendsPanel, InviteToasts } from "./friends";
import MiniPlayer, { MINI_SIZE, MINI_CHAT_SIZE } from "./miniplayer";
import logo from "./assets/logo.png";

// Arte circular com glow verde e o logo ao centro (hero da tela inicial).
function HeroVisual() {
  return (
    <div className="hero-visual" aria-hidden="true">
      <div className="hero-rings" />
      <div className="hero-glow" />
      <img className="hero-logo" src={logo} alt="" draggable={false} />
    </div>
  );
}

// Ícones SVG inline (stroke = currentColor, herdam a cor do contexto).
const IconGrid = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const IconUsers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9.5" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconGear = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const IconInfo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);
const IconRadio = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48 0a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
  </svg>
);
const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// Logo da marca com easter egg: duplo clique gira o logo. A classe `spin` é
// removida no fim da animação para poder disparar de novo.
function BrandLogo({ className = "logo" }) {
  const [spinning, setSpinning] = useState(false);
  return (
    <img
      className={`${className}${spinning ? " spin" : ""}`}
      src={logo}
      alt="Spotgino"
      draggable={false}
      onDoubleClick={() => setSpinning(true)}
      onAnimationEnd={() => setSpinning(false)}
    />
  );
}

const HOST_POLL_INTERVAL = 2500;
const GUEST_DRIFT_INTERVAL = 15000;
const FOLLOWER_DRIFT_TOLERANCE = 2200;

const REPO_RELEASES_URL = "https://github.com/LeonardoHGB/Spotgino/releases";
const RELEASES_API =
  "https://api.github.com/repos/LeonardoHGB/Spotgino/releases/latest";

function parseVersion(value) {
  const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function openExternalUrl(url) {
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

function formatTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function expectedPosition(playback) {
  if (!playback) return 0;
  if (!playback.isPlaying) return playback.positionMs || 0;

  return Math.min(
    playback.durationMs || Number.MAX_SAFE_INTEGER,
    (playback.positionMs || 0) + Math.max(0, Date.now() - playback.changedAt)
  );
}

function playbackFromTrack(track, options = {}) {
  return {
    track,
    isPlaying: options.isPlaying ?? true,
    positionMs: options.positionMs ?? 0,
    durationMs: track?.durationMs || 0,
    changedAt: Date.now(),
    spotifyTimestamp: Date.now(),
    deviceName: options.deviceName || "Spotify",
    source: options.source || "spotify"
  };
}

// Dispositivo de reprodução padrão: preferimos o computador (Spotify Desktop),
// caindo para o dispositivo ativo ou o primeiro disponível.
function pickComputerDevice(devices) {
  return devices.find((device) => device.type === "Computer") || null;
}

function callbackEmit(event, payload = {}) {
  return new Promise((resolve, reject) => {
    const activeSocket = getSocket();

    if (!activeSocket?.connected) {
      reject(new Error("O servidor não está conectado."));
      return;
    }

    activeSocket.emit(event, payload, (result) => {
      if (!result?.ok) {
        reject(new Error(result?.message || "Não foi possível concluir a operação."));
        return;
      }
      resolve(result);
    });
  });
}

function Cover({ track, large = false }) {
  if (track?.cover) {
    return (
      <img
        className={large ? "cover-image cover-image-large" : "cover-image"}
        src={track.cover}
        alt={`Capa de ${track.title}`}
      />
    );
  }

  return (
    <div className={large ? "cover-placeholder cover-large" : "cover-placeholder"}>
      ♫
    </div>
  );
}

function ServerSettingsModal({
  open,
  value,
  onChange,
  onClose,
  onTest,
  onSave,
  testStatus,
  saving
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-modal-header">
          <div>
            <span className="eyebrow">CONEXÃO REMOTA</span>
            <h2>Configurar servidor</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <p className="settings-description">
          Informe o endereço do servidor Spotgino. Exemplo:
          <code>http://192.168.230.217:3333</code>
        </p>

        <label>
          URL da API e Socket.IO
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="http://192.168.230.217:3333"
            autoFocus
          />
        </label>

        {testStatus.message && (
          <div className={testStatus.ok ? "server-test success" : "server-test failure"}>
            {testStatus.message}
          </div>
        )}

        <div className="settings-modal-actions">
          <button className="secondary-button" onClick={onTest} disabled={saving}>
            Testar conexão
          </button>
          <button className="primary-button modal-primary" onClick={onSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar e conectar"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [runtimeReady, setRuntimeReady] = useState(false);
  // Splash de abertura: a logo gira por um tempo mínimo antes de abrir o app.
  const [splashReady, setSplashReady] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [serverDraft, setServerDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [homeView, setHomeView] = useState("inicio"); // "inicio" | "amigos"
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [miniMode, setMiniMode] = useState(false);
  const [miniChatOpen, setMiniChatOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [appVersion, setAppVersion] = useState("3.1.0");
  const [updateStatus, setUpdateStatus] = useState(null); // null | "checking" | {version,url}
  // undefined = ainda sem snapshot da sala; null = snapshot visto, sala vazia.
  const seenMessagesRef = useRef(undefined);
  const miniModeRef = useRef(false);
  const [serverTestStatus, setServerTestStatus] = useState({ ok: false, message: "" });
  const [savingServer, setSavingServer] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [displayName, setDisplayName] = useState(
    localStorage.getItem("display_name") || "João"
  );
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [notice, setNotice] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [demoTracks, setDemoTracks] = useState([]);
  const [position, setPosition] = useState(0);
  const [seeking, setSeeking] = useState(false);

  const [spotifyConnected, setSpotifyConnected] = useState(hasSpotifySession());
  const [spotifyProfile, setSpotifyProfile] = useState(null);
  const [spotifyDevices, setSpotifyDevices] = useState([]);
  const [spotifyDeviceId, setSpotifyDeviceId] = useState("");
  const [spotifyLocalPlayback, setSpotifyLocalPlayback] = useState(null);
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [spotifyError, setSpotifyError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const roomRef = useRef(room);
  const spotifyDeviceIdRef = useRef(spotifyDeviceId);
  const hostPollingRef = useRef(false);
  const followerSyncRef = useRef(false);
  const followerPendingRef = useRef(null);
  const autoAdvancedFromRef = useRef(null);
  const nextTrackRef = useRef(null);
  const chatEndRef = useRef(null);
  const mountedRef = useRef(true);

  const isHost = Boolean(room && room.hostId === getSocket()?.id);
  const currentTrack = room?.playback?.track || null;

  // Mantém a referência do nextTrack atual: o ticker do auto-avanço captura
  // uma closure antiga (deps [seeking]) e chamaria um nextTrack com isHost/room
  // do mount. Chamando via ref, sempre usamos a versão do render corrente.
  nextTrackRef.current = nextTrack;

  // Fornece o access token do Spotify para o login de conta no servidor.
  // Retorna null quando não há sessão válida (o servidor cai no fluxo padrão).
  const getSpotifyToken = useCallback(async () => {
    try {
      return await getValidAccessToken();
    } catch {
      return null;
    }
  }, []);

  const friendsHub = useFriends({
    socketConnected,
    displayName,
    spotifyConnected,
    getSpotifyToken,
    onJoinRoom: (code) => joinRoomByCode(code),
    notify: setNotice
  });

  // A identidade (nome) passa a vir da conta logada — normalmente o Spotify.
  // Sincroniza o displayName usado ao criar/entrar em salas.
  const accountName = friendsHub.account?.displayName;
  const accountId = friendsHub.account?.userId;
  useEffect(() => {
    if (accountName && accountName !== displayName) {
      setDisplayName(accountName);
      localStorage.setItem("display_name", accountName);
    }
  }, [accountName]);

  // "Ouvir junto" com um amigo, sem sala. listeningTo = { userId, name } | null.
  const [listeningTo, setListeningTo] = useState(null);
  const [listeningTrack, setListeningTrack] = useState(null);
  const listeningToRef = useRef(null);
  useEffect(() => {
    listeningToRef.current = listeningTo?.userId || null;
  }, [listeningTo]);


  // Redimensiona a janela do Electron conforme o modo mini/chat (Win e Linux).
  // Dep booleana: `room` muda de identidade a cada room:state e re-invocaria
  // o IPC de resize a cada mensagem de chat/poll do host.
  const inRoom = Boolean(room);
  useEffect(() => {
    if (!window.electronAPI?.setMiniWindow) return;
    if (miniMode && inRoom) {
      window.electronAPI.setMiniWindow(miniChatOpen ? MINI_CHAT_SIZE : MINI_SIZE);
    }
  }, [miniMode, miniChatOpen, inRoom]);

  // Saiu da sala: garante que a janela volta ao tamanho normal.
  useEffect(() => {
    if (!room && miniMode) {
      setMiniMode(false);
      setMiniChatOpen(false);
      window.electronAPI?.restoreWindow?.();
    }
  }, [room, miniMode]);

  // Notificações de chat: mensagens novas de outras pessoas quando o chat não
  // está visível (modo mini com chat fechado, ou janela sem foco).
  // Rastreadas pelo id da última mensagem vista: o servidor envia só as últimas
  // 80, então contagem por tamanho deixaria de detectar novidades no cap.
  useEffect(() => {
    miniModeRef.current = miniMode;
  }, [miniMode]);

  useEffect(() => {
    const messages = room?.messages || [];

    if (!room) {
      seenMessagesRef.current = undefined;
      setUnreadMessages(0);
      return;
    }

    const lastId = messages[messages.length - 1]?.id ?? null;

    // Primeiro snapshot da sala: histórico não conta como novidade.
    if (seenMessagesRef.current === undefined) {
      seenMessagesRef.current = lastId;
      return;
    }

    if (lastId === null || lastId === seenMessagesRef.current) return;

    const seenIndex = messages.findIndex(
      (message) => message.id === seenMessagesRef.current
    );
    const fresh = messages
      .slice(seenIndex + 1)
      .filter((message) => message.memberId !== getSocket()?.id);
    seenMessagesRef.current = lastId;
    if (!fresh.length) return;

    const chatVisible = miniMode ? miniChatOpen : document.hasFocus();
    if (chatVisible) return;

    setUnreadMessages((count) => count + fresh.length);

    const last = fresh[fresh.length - 1];
    if (window.electronAPI?.notify) {
      // Processo main (libnotify) — confiável no Linux.
      window.electronAPI.notify({
        title: `Spotgino · ${last.author}`,
        body: last.message
      });
    } else {
      try {
        new Notification(`Spotgino · ${last.author}`, {
          body: last.message,
          icon: logo
        });
      } catch {
        // Sem suporte a notificações: o contador de não lidas já cobre.
      }
    }
  }, [room?.messages?.length, room, miniMode, miniChatOpen]);

  // Clique na notificação (vindo do processo main): foca e abre o chat.
  useEffect(() => {
    if (!window.electronAPI?.onNotificationClick) return undefined;
    return window.electronAPI.onNotificationClick(() => {
      if (miniModeRef.current) setMiniChatOpen(true);
      setUnreadMessages(0);
    });
  }, []);

  useEffect(() => {
    window.electronAPI?.getVersion?.().then((version) => {
      if (version) setAppVersion(version);
    });
  }, []);

  async function checkForUpdates() {
    try {
      setUpdateStatus("checking");
      const response = await fetch(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" }
      });

      if (response.status === 404) {
        setUpdateStatus(null);
        setNotice("Nenhuma release publicada ainda no GitHub.");
        return;
      }
      if (!response.ok) throw new Error(`GitHub respondeu ${response.status}.`);

      const data = await response.json();
      const latest = String(data.tag_name || "").replace(/^v/i, "").trim();

      if (latest && isNewerVersion(latest, appVersion)) {
        setUpdateStatus({ version: latest, url: data.html_url || REPO_RELEASES_URL });
      } else {
        setUpdateStatus(null);
        setNotice(`Você está na versão mais recente (${appVersion}).`);
      }
    } catch (error) {
      setUpdateStatus(null);
      setNotice(`Falha ao verificar atualização: ${error.message}`);
    }
  }

  // Em modo normal o chat é sempre visível: recuperar o foco marca como lido.
  useEffect(() => {
    function onFocus() {
      if (!miniModeRef.current) setUnreadMessages(0);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function enterMiniMode() {
    setUnreadMessages(0);
    setMiniMode(true);
  }

  function exitMiniMode() {
    setMiniMode(false);
    setMiniChatOpen(false);
    setUnreadMessages(0);
    window.electronAPI?.restoreWindow?.();
  }

  function toggleMiniChat() {
    setMiniChatOpen((open) => {
      if (!open) setUnreadMessages(0);
      return !open;
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function initializeRuntime() {
      try {
        const fallback =
          localStorage.getItem("spotgino_server_url") ||
          localStorage.getItem("listen_together_server_url") ||
          import.meta.env.VITE_DEFAULT_SERVER_URL ||
          "http://127.0.0.1:3333";

        const config = window.electronAPI?.getAppConfig
          ? await window.electronAPI.getAppConfig()
          : { serverUrl: fallback };

        if (cancelled) return;

        const normalized = normalizeServerUrl(config.serverUrl || fallback);
        configureSocket(normalized);
        setServerUrl(normalized);
        setServerDraft(normalized);
        setRuntimeReady(true);
      } catch (error) {
        if (cancelled) return;
        setConnectionError(`Configuração: ${error.message}`);
        setServerDraft(import.meta.env.VITE_DEFAULT_SERVER_URL || "http://127.0.0.1:3333");
        setSettingsOpen(true);
        setRuntimeReady(true);
      }
    }

    initializeRuntime();

    return () => {
      cancelled = true;
      disconnectSocket();
    };
  }, []);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    spotifyDeviceIdRef.current = spotifyDeviceId;
  }, [spotifyDeviceId]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSplashReady(true), 1800);
    return () => clearTimeout(timer);
  }, []);

  // A barra verde de aviso some sozinha após 5s (reinicia a cada novo aviso).
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Reporta ao servidor o que estou ouvindo, para os amigos verem e poderem
  // ouvir junto. Roda enquanto o Spotify e a conta estiverem ativos.
  useEffect(() => {
    if (!spotifyConnected || !socketConnected || !accountId) return undefined;

    let cancelled = false;
    const report = async () => {
      try {
        const playback = await spotifyApi.currentPlayback();
        if (!cancelled) getSocket()?.emit("presence:playback", { playback });
      } catch {
        // Ignora falhas pontuais do Spotify.
      }
    };

    report();
    const timer = setInterval(report, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [spotifyConnected, socketConnected, accountId]);

  // Recebe o playback de quem estou seguindo e sincroniza meu Spotify.
  useEffect(() => {
    if (!socketConnected) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;

    const onListenPlayback = ({ userId, playback }) => {
      if (listeningToRef.current !== userId) return;
      if (!playback?.track) return;
      setListeningTrack(playback.track);
      if (spotifyConnected) syncFollowerToRoom(playback);
    };
    const onListenEnded = ({ userId }) => {
      if (listeningToRef.current !== userId) return;
      setListeningTo(null);
      setListeningTrack(null);
      setNotice("A transmissão do seu amigo terminou.");
    };

    socket.on("listen:playback", onListenPlayback);
    socket.on("listen:ended", onListenEnded);
    return () => {
      socket.off("listen:playback", onListenPlayback);
      socket.off("listen:ended", onListenEnded);
    };
  }, [socketConnected, spotifyConnected]);

  useEffect(() => {
    if (!runtimeReady || !serverUrl) return undefined;

    const activeSocket = getSocket() || configureSocket(serverUrl);
    const onConnect = () => {
      setSocketConnected(true);
      setConnectionError("");

      // Reconexão com sala ativa: o socket ganhou um id novo e o servidor já
      // nos removeu da sala. Tenta reentrar; se a sala morreu, volta ao lobby
      // (o que também restaura a janela se estiver em modo mini).
      const activeRoom = roomRef.current;
      if (activeRoom?.code) {
        // A reautenticação (account:spotify) roda em paralelo ao reconnect, então
        // o rejoin pode chegar antes da conta existir. Tenta de novo algumas vezes
        // antes de desistir e voltar ao lobby.
        const attemptRejoin = (retriesLeft) => {
          activeSocket.emit(
            "room:join",
            {
              code: activeRoom.code,
              displayName: localStorage.getItem("display_name") || "Convidado"
            },
            (result) => {
              if (result?.ok) return;
              if (retriesLeft > 0) {
                setTimeout(() => attemptRejoin(retriesLeft - 1), 1200);
                return;
              }
              setRoom(null);
              setNotice("A conexão caiu e a sala não existe mais.");
            }
          );
        };
        attemptRejoin(2);
      }
    };
    const onDisconnect = () => setSocketConnected(false);
    const onConnectError = (error) => {
      setSocketConnected(false);
      if (error?.data?.code === "VERSION_MISMATCH") {
        setConnectionError(
          `Versão incompatível com o servidor (ele exige a ${error.data.serverVersion}). ` +
            "Baixe a versão mais recente do Spotgino."
        );
        return;
      }
      setConnectionError(`Socket.IO: ${error.message}`);
    };
    const onRoomState = (nextRoom) => setRoom(nextRoom);
    const onRoomClosed = () => {
      exitMiniMode();
      setRoom(null);
      setNotice("O host encerrou a sala.");
    };

    activeSocket.on("connect", onConnect);
    activeSocket.on("disconnect", onDisconnect);
    activeSocket.on("connect_error", onConnectError);
    activeSocket.on("room:state", onRoomState);
    activeSocket.on("room:closed", onRoomClosed);

    if (!activeSocket.connected) activeSocket.connect();
    else onConnect();

    return () => {
      activeSocket.off("connect", onConnect);
      activeSocket.off("disconnect", onDisconnect);
      activeSocket.off("connect_error", onConnectError);
      activeSocket.off("room:state", onRoomState);
      activeSocket.off("room:closed", onRoomClosed);
    };
  }, [runtimeReady, serverUrl]);

  useEffect(() => {
    if (!runtimeReady || !serverUrl) return undefined;

    const controller = new AbortController();
    fetch(`${serverUrl}/demo-tracks`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Falha ao carregar faixas demo.");
        return response.json();
      })
      .then(setDemoTracks)
      .catch((error) => {
        if (error.name !== "AbortError") setConnectionError(error.message);
      });

    return () => controller.abort();
  }, [runtimeReady, serverUrl]);

  useEffect(() => {
    if (!window.electronAPI?.onSpotifyCallback) return undefined;

    return window.electronAPI.onSpotifyCallback(async (payload) => {
      try {
        setSpotifyBusy(true);
        setSpotifyError("");

        if (payload.error) {
          throw new Error(`Autorização recusada: ${payload.error}`);
        }

        const expectedState = getOAuthState();
        if (!payload.state || payload.state !== expectedState) {
          throw new Error("O state do OAuth não corresponde à solicitação original.");
        }

        await exchangeCode(payload.code);
        clearOAuthTemporaryData();
        setSpotifyConnected(true);
        setNotice("Spotify conectado com sucesso.");
      } catch (error) {
        setSpotifyError(error.message);
      } finally {
        setSpotifyBusy(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!spotifyConnected) return;
    loadSpotifyConnection();
  }, [spotifyConnected]);

  useEffect(() => {
    if (!room?.playback || seeking) return;
    setPosition(expectedPosition(room.playback));
  }, [room?.playback?.version, seeking]);

  useEffect(() => {
    const timer = setInterval(() => {
      const playback = roomRef.current?.playback;
      if (!playback || seeking) return;
      const pos = expectedPosition(playback);
      setPosition(pos);
      maybeAutoAdvance(playback, pos);
    }, 250);

    return () => clearInterval(timer);
  }, [seeking]);

  // Chat sempre acompanha a última mensagem. Depende do id da última mensagem
  // (o length trava no cap de 80 do servidor) e rola só o container do chat,
  // não a página inteira.
  const lastMessageId = room?.messages?.length
    ? room.messages[room.messages.length - 1].id
    : null;
  useEffect(() => {
    const box = chatEndRef.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lastMessageId]);

  useEffect(() => {
    if (!spotifyConnected || !room?.code || !isHost) return undefined;

    let cancelled = false;

    const poll = async () => {
      if (cancelled || hostPollingRef.current) return;
      hostPollingRef.current = true;

      try {
        const playback = await spotifyApi.currentPlayback();
        if (!playback || cancelled) return;

        setSpotifyLocalPlayback(playback);

        if (playback.deviceId) {
          setSpotifyDeviceId((current) => current || playback.deviceId);
        }

        getSocket()?.emit("playback:host-sync", { playback }, (result) => {
          if (result && !result.ok) setSpotifyError(result.message);
        });
      } catch (error) {
        if (!cancelled) setSpotifyError(error.message);
      } finally {
        hostPollingRef.current = false;
      }
    };

    poll();
    const timer = setInterval(poll, HOST_POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [spotifyConnected, room?.code, isHost]);

  useEffect(() => {
    if (
      !spotifyConnected ||
      !room?.playback ||
      isHost ||
      room.playback.source !== "spotify"
    ) {
      return;
    }

    syncFollowerToRoom(room.playback);
  }, [room?.playback?.version, spotifyConnected, isHost]);

  useEffect(() => {
    if (!spotifyConnected || !room?.code || isHost) {
      return undefined;
    }

    const timer = setInterval(() => {
      const playback = roomRef.current?.playback;
      if (playback?.source === "spotify") syncFollowerToRoom(playback);
    }, GUEST_DRIFT_INTERVAL);

    return () => clearInterval(timer);
  }, [spotifyConnected, room?.code, isHost]);

  async function loadSpotifyConnection() {
    try {
      setSpotifyError("");

      const [profile, devicesPayload, playback] = await Promise.all([
        spotifyApi.profile(),
        spotifyApi.devices(),
        spotifyApi.currentPlayback()
      ]);

      if (!mountedRef.current) return;

      const devices = (devicesPayload?.devices || []).filter(
        (device) => device.id && !device.is_restricted
      );
      const activeDevice = devices.find((device) => device.is_active);

      setSpotifyProfile(profile);
      setSpotifyDevices(devices);
      setSpotifyLocalPlayback(playback);
      setSpotifyDeviceId((current) =>
        current && devices.some((device) => device.id === current)
          ? current
          : pickComputerDevice(devices)?.id ||
            playback?.deviceId ||
            activeDevice?.id ||
            devices[0]?.id ||
            ""
      );
    } catch (error) {
      setSpotifyError(error.message);
      if (!hasSpotifySession()) setSpotifyConnected(false);
    }
  }

  async function refreshDevices() {
    try {
      setSpotifyBusy(true);
      setSpotifyError("");
      const payload = await spotifyApi.devices();
      const devices = (payload?.devices || []).filter(
        (device) => device.id && !device.is_restricted
      );
      const active = devices.find((device) => device.is_active);

      setSpotifyDevices(devices);
      setSpotifyDeviceId((current) =>
        devices.some((device) => device.id === current)
          ? current
          : pickComputerDevice(devices)?.id || active?.id || devices[0]?.id || ""
      );
    } catch (error) {
      setSpotifyError(error.message);
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function ensureSpotifyDevice(forceRefresh = false) {
    if (!forceRefresh && spotifyDeviceIdRef.current) {
      return spotifyDeviceIdRef.current;
    }

    const payload = await spotifyApi.devices();
    const devices = (payload?.devices || []).filter(
      (device) => device.id && !device.is_restricted
    );
    const cached = spotifyDeviceIdRef.current;
    const selected =
      (cached && devices.find((device) => device.id === cached)) ||
      pickComputerDevice(devices) ||
      devices.find((device) => device.is_active) ||
      devices[0];

    setSpotifyDevices(devices);

    if (!selected?.id) {
      throw new Error(
        "Nenhum dispositivo disponível. Abra o Spotify Desktop ou celular e reproduza qualquer faixa."
      );
    }

    setSpotifyDeviceId(selected.id);
    spotifyDeviceIdRef.current = selected.id;
    return selected.id;
  }

  function isDeviceError(error) {
    // A mensagem de 404 do Spotify inclui "Device"/"dispositivo" quando o
    // device sumiu; assim não confundimos com 404 de URI/faixa inexistente.
    return /device|dispositivo|no active|no_active/i.test(error?.message || "");
  }

  // Executa um comando do Spotify garantindo um device válido. Se o device
  // sumiu (comum quando o convidado fica ocioso), revalida e tenta de novo —
  // era isso que exigia desconectar/reconectar o Spotify manualmente.
  async function runWithDevice(action) {
    const deviceId = await ensureSpotifyDevice();
    try {
      return await action(deviceId);
    } catch (error) {
      if (!isDeviceError(error)) throw error;
      spotifyDeviceIdRef.current = "";
      const freshDevice = await ensureSpotifyDevice(true);
      return action(freshDevice);
    }
  }

  async function syncFollowerToRoom(playback) {
    if (!playback?.track?.uri) return;

    // Coalescing: se já há uma sincronização rodando, guarda apenas o estado
    // mais recente e aplica quando a atual terminar — assim um pause/troca que
    // chega no meio nunca é perdido (antes eram descartados até 15s depois).
    if (followerSyncRef.current) {
      followerPendingRef.current = playback;
      return;
    }
    followerSyncRef.current = true;

    try {
      await applyFollowerPlayback(playback);
      setSpotifyError("");
    } catch (error) {
      setSpotifyError(`Sincronização do convidado: ${error.message}`);
    } finally {
      followerSyncRef.current = false;
      const pending = followerPendingRef.current;
      if (pending) {
        followerPendingRef.current = null;
        syncFollowerToRoom(pending);
      }
    }
  }

  async function applyFollowerPlayback(playback) {
    const targetPosition = expectedPosition(playback);

    // Pause é aplicado direto, sem consultar o estado atual: menos latência.
    if (!playback.isPlaying) {
      try {
        await runWithDevice((deviceId) => spotifyApi.pause({ deviceId }));
      } catch (error) {
        // 403 "Restriction violated" = já estava pausado: ignora. Outros 403
        // (Premium, anúncio, device restrito) são falhas reais e sobem, para
        // a UI não mentir que pausou enquanto o áudio continua.
        const alreadyPaused =
          error?.status === 403 && /restriction/i.test(error?.message || "");
        if (!alreadyPaused) throw error;
      }
      setSpotifyLocalPlayback(
        playbackFromTrack(playback.track, {
          isPlaying: false,
          positionMs: targetPosition,
          deviceName: playback.deviceName
        })
      );
      return;
    }

    const local = await spotifyApi.currentPlayback();
    const trackChanged = local?.track?.id !== playback.track.id;
    const drift = Math.abs((local?.positionMs || 0) - targetPosition);

    if (trackChanged || !local?.isPlaying) {
      await runWithDevice((deviceId) =>
        spotifyApi.playTrack({
          uri: playback.track.uri,
          positionMs: targetPosition,
          deviceId
        })
      );
    } else if (drift > FOLLOWER_DRIFT_TOLERANCE) {
      await runWithDevice((deviceId) =>
        spotifyApi.seek({ positionMs: targetPosition, deviceId })
      );
    }

    setSpotifyLocalPlayback(
      playbackFromTrack(playback.track, {
        isPlaying: true,
        positionMs: targetPosition,
        deviceName: playback.deviceName
      })
    );
  }

  // Host: avança a fila quando a faixa está terminando. Lê tudo fresco (evita
  // usar o `position` do state, que fica um render atrás e pularia faixas) e
  // dispara no máximo uma vez por faixa (não drena a fila se o play falhar).
  function maybeAutoAdvance(playback, pos) {
    const activeRoom = roomRef.current;
    const amHost = activeRoom?.hostId === getSocket()?.id;

    if (!amHost || playback.source !== "spotify") return;
    if (!playback.isPlaying || !playback.durationMs) return;
    if ((activeRoom?.queue?.length || 0) === 0) return;
    if (pos < playback.durationMs - 1500) return;

    // Chave por changedAt (instância da reprodução), não por track.id: assim a
    // MESMA faixa tocada de novo (duplicata na fila / replay) recebe uma chave
    // nova e volta a auto-avançar; e se o play falhar, a reprodução não muda,
    // a chave continua igual e não drenamos a fila.
    const key = playback.changedAt || null;
    if (autoAdvancedFromRef.current === key) return;
    autoAdvancedFromRef.current = key;
    nextTrackRef.current?.();
  }

  async function connectSpotify() {
    try {
      setSpotifyBusy(true);
      setSpotifyError("");
      const url = await createSpotifyAuthorizationUrl();

      if (window.electronAPI) {
        await window.electronAPI.openExternal(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }

      setNotice("Conclua a autorização no navegador.");
    } catch (error) {
      setSpotifyError(error.message);
    } finally {
      setSpotifyBusy(false);
    }
  }

  function disconnectSpotify() {
    clearSpotifySession();
    setSpotifyConnected(false);
    setSpotifyProfile(null);
    setSpotifyDevices([]);
    setSpotifyDeviceId("");
    setSpotifyLocalPlayback(null);
    setSearchResults([]);
    setSpotifyError("");
  }

  function persistName() {
    const cleanName = displayName.trim() || "Convidado";
    localStorage.setItem("display_name", cleanName);
    setDisplayName(cleanName);
    return cleanName;
  }

  function createRoom() {
    getSocket()?.emit("room:create", { displayName: persistName() }, (result) => {
      if (!result?.ok) {
        setNotice(result?.message || "Não foi possível criar a sala.");
        return;
      }

      setRoomCode(result.room.code);
      setNotice("Sala criada. Compartilhe o código com seus amigos.");
    });
  }

  function joinRoom() {
    joinRoomByCode(roomCode);
  }

  function joinRoomByCode(code) {
    const target = String(code || "").trim().toUpperCase();
    if (!target) return;
    setRoomCode(target);
    getSocket()?.emit(
      "room:join",
      { code: target, displayName: persistName() },
      (result) => {
        if (!result?.ok) {
          setNotice(result?.message || "Não foi possível entrar na sala.");
          return;
        }

        setNotice("Você entrou na sala.");
      }
    );
  }

  function leaveRoom() {
    // Avisa o servidor (se for host, ele encerra a sala e avisa todos). Depois
    // volta ao menu localmente — funciona mesmo que o servidor ainda não tenha
    // o handler room:leave.
    getSocket()?.emit("room:leave", {}, () => {});
    setConfirmLeave(false);
    exitMiniMode();
    setRoom(null);
    setNotice("Você saiu da sala.");
  }

  function listenAlong(userId, name) {
    if (room) {
      setNotice("Saia da sala para ouvir junto com um amigo.");
      return;
    }
    if (!spotifyConnected) {
      setNotice("Conecte o Spotify para ouvir junto.");
      return;
    }
    getSocket()
      ?.timeout(8000)
      .emit("listen:follow", { userId }, (err, res) => {
        if (err || !res?.ok) {
          setNotice(res?.message || "Não foi possível ouvir junto agora.");
          return;
        }
        setListeningTo({ userId, name });
        setListeningTrack(res.playback?.track || null);
        if (res.playback?.track) syncFollowerToRoom(res.playback);
        setNotice(`Ouvindo junto com ${name}.`);
      });
  }

  function stopListening() {
    getSocket()?.emit("listen:stop", {}, () => {});
    setListeningTo(null);
    setListeningTrack(null);
  }

  function emitHostPlayback(playback) {
    getSocket()?.emit("playback:host-sync", { playback }, (result) => {
      if (result && !result.ok) setSpotifyError(result.message);
    });
  }

  async function playSpotifyTrack(track, startPosition = 0) {
    if (!isHost) return;

    try {
      setSpotifyBusy(true);
      setSpotifyError("");
      const deviceId = await ensureSpotifyDevice();

      await spotifyApi.playTrack({
        uri: track.uri,
        positionMs: startPosition,
        deviceId
      });

      const optimistic = playbackFromTrack(track, {
        isPlaying: true,
        positionMs: startPosition,
        deviceName:
          spotifyDevices.find((device) => device.id === deviceId)?.name ||
          "Spotify"
      });

      setSpotifyLocalPlayback(optimistic);
      emitHostPlayback(optimistic);
      window.setTimeout(refreshHostPlayback, 900);
    } catch (error) {
      setSpotifyError(error.message);
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function refreshHostPlayback() {
    if (!spotifyConnected || !isHost) return;

    try {
      const playback = await spotifyApi.currentPlayback();
      if (!playback) return;
      setSpotifyLocalPlayback(playback);
      emitHostPlayback(playback);
    } catch (error) {
      setSpotifyError(error.message);
    }
  }

  async function togglePlayback() {
    if (!isHost || !room?.playback) return;

    if (room.playback.source === "demo") {
      getSocket()?.emit("playback:demo-command", {
        action: room.playback.isPlaying ? "pause" : "play",
        positionMs: position
      });
      return;
    }

    try {
      setSpotifyBusy(true);
      const deviceId = await ensureSpotifyDevice();
      const shouldPlay = !room.playback.isPlaying;

      if (shouldPlay) {
        await spotifyApi.playTrack({
          uri: room.playback.track.uri,
          positionMs: position,
          deviceId
        });
      } else {
        await spotifyApi.pause({ deviceId });
      }

      emitHostPlayback(
        playbackFromTrack(room.playback.track, {
          isPlaying: shouldPlay,
          positionMs: position,
          deviceName: room.playback.deviceName
        })
      );
    } catch (error) {
      setSpotifyError(error.message);
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function seekPlayback(nextPosition) {
    if (!isHost || !room?.playback) return;
    const numericPosition = Math.max(0, Number(nextPosition) || 0);
    setPosition(numericPosition);

    if (room.playback.source === "demo") {
      getSocket()?.emit("playback:demo-command", {
        action: "seek",
        positionMs: numericPosition
      });
      return;
    }

    try {
      const deviceId = await ensureSpotifyDevice();
      await spotifyApi.seek({ positionMs: numericPosition, deviceId });
      emitHostPlayback(
        playbackFromTrack(room.playback.track, {
          isPlaying: room.playback.isPlaying,
          positionMs: numericPosition,
          deviceName: room.playback.deviceName
        })
      );
    } catch (error) {
      setSpotifyError(error.message);
    }
  }

  async function previousTrack() {
    if (!isHost || room?.playback?.source !== "spotify") return;

    try {
      setSpotifyBusy(true);
      const deviceId = await ensureSpotifyDevice();
      await spotifyApi.previous({ deviceId });
      window.setTimeout(refreshHostPlayback, 800);
    } catch (error) {
      setSpotifyError(error.message);
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function nextTrack() {
    if (!isHost) return;

    try {
      setSpotifyBusy(true);

      if (room?.queue?.length) {
        const result = await callbackEmit("queue:shift");
        if (result.track) await playSpotifyTrack(result.track);
        return;
      }

      if (room?.playback?.source === "spotify") {
        const deviceId = await ensureSpotifyDevice();
        await spotifyApi.next({ deviceId });
        window.setTimeout(refreshHostPlayback, 800);
      }
    } catch (error) {
      setSpotifyError(error.message);
    } finally {
      setSpotifyBusy(false);
    }
  }

  function playDemoTrack(track) {
    if (!isHost) return;
    getSocket()?.emit("playback:demo-command", { action: "track", track });
  }

  async function searchSpotify(event) {
    event.preventDefault();
    const query = searchText.trim();

    if (query.length < 2) {
      setSpotifyError("Digite pelo menos dois caracteres para pesquisar.");
      return;
    }

    try {
      setSearching(true);
      setSpotifyError("");
      const tracks = await spotifyApi.searchTracks(query, 10);
      setSearchResults(tracks);

      if (!tracks.length) setNotice("Nenhuma faixa encontrada para essa busca.");
    } catch (error) {
      setSpotifyError(`Busca: ${error.message}`);
    } finally {
      setSearching(false);
    }
  }

  async function addToQueue(track) {
    try {
      await callbackEmit("queue:add", { track });
      setNotice(`${track.title} foi adicionada à fila.`);
    } catch (error) {
      setNotice(error.message);
    }
  }

  function sendMessage(event) {
    event.preventDefault();
    const message = chatMessage.trim();
    if (!message) return;
    getSocket()?.emit("chat:send", { message });
    setChatMessage("");
  }

  async function transferPlayback() {
    try {
      setSpotifyBusy(true);
      const deviceId = await ensureSpotifyDevice();
      await spotifyApi.transfer({ deviceId, play: false });
      await refreshDevices();
      setNotice("Reprodução transferida para o dispositivo selecionado.");
    } catch (error) {
      setSpotifyError(error.message);
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function testServerConnection() {
    try {
      setSavingServer(true);
      setServerTestStatus({ ok: false, message: "Testando conexão..." });
      const normalized = normalizeServerUrl(serverDraft);

      if (window.electronAPI?.testServerUrl) {
        const result = await window.electronAPI.testServerUrl(normalized);
        setServerTestStatus({
          ok: true,
          message: `Servidor online: ${result.health?.name || normalized}`
        });
      } else {
        const response = await fetch(`${normalized}/health`);
        const payload = await response.json();
        if (!response.ok || payload.status !== "ok") throw new Error("Health check inválido.");
        setServerTestStatus({ ok: true, message: `Servidor online: ${payload.name || normalized}` });
      }
    } catch (error) {
      setServerTestStatus({ ok: false, message: `Falha: ${error.message}` });
    } finally {
      setSavingServer(false);
    }
  }

  async function saveServerSettings() {
    try {
      setSavingServer(true);
      const normalized = normalizeServerUrl(serverDraft);

      if (window.electronAPI?.saveServerUrl) {
        await window.electronAPI.saveServerUrl(normalized);
      } else {
        localStorage.setItem("spotgino_server_url", normalized);
      }

      setRoom(null);
      setSocketConnected(false);
      setConnectionError("");
      setNotice("Servidor atualizado. Conectando...");
      disconnectSocket();
      configureSocket(normalized);
      setServerUrl(normalized);
      setServerDraft(normalized);
      setServerTestStatus({ ok: false, message: "" });
      setSettingsOpen(false);
    } catch (error) {
      setServerTestStatus({ ok: false, message: `Falha: ${error.message}` });
    } finally {
      setSavingServer(false);
    }
  }

  function openServerSettings() {
    setServerDraft(serverUrl || serverDraft);
    setServerTestStatus({ ok: false, message: "" });
    setSettingsOpen(true);
  }

  function openSpotifyUrl(url) {
    if (!url) return;
    if (window.electronAPI) window.electronAPI.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  const [joinOpen, setJoinOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  if (!runtimeReady || !splashReady) {
    return (
      <main className="splash">
        <img className="splash-logo" src={logo} alt="Spotgino" draggable={false} />
      </main>
    );
  }

  if (!room) {
    const accountName =
      friendsHub.account?.displayName ||
      spotifyProfile?.display_name ||
      "Conta Spotify";
    const accountAvatar =
      friendsHub.account?.avatarUrl ||
      spotifyProfile?.images?.[0]?.url ||
      null;
    const sortedFriends = [...friendsHub.friends].sort((a, b) => {
      const rank = (f) => (f.online ? (f.nowPlaying ? 0 : 1) : 2);
      return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
    });
    const listeningFriends = friendsHub.friends.filter(
      (f) => f.online && f.nowPlaying
    );
    // "Logado" = tem sessão do Spotify OU já tem conta no servidor. Sem isso, o
    // gate de login aparecia mesmo com a conta ativa (só a sessão Spotify caindo).
    const loggedIn = spotifyConnected || Boolean(friendsHub.account);

    return (
      <>
      <main className="home-shell">
        <aside className="nav-sidebar">
          <div className="nav-brand">
            <BrandLogo />
            <div>
              <strong>Spotgino</strong>
              <span>v{appVersion}</span>
            </div>
          </div>

          <nav className="nav-list">
            <button
              type="button"
              className={`nav-item ${homeView === "inicio" ? "active" : ""}`}
              onClick={() => setHomeView("inicio")}
            >
              <span className="nav-ico"><IconGrid /></span> Início
            </button>
            <button
              type="button"
              className={`nav-item ${homeView === "amigos" ? "active" : ""}`}
              onClick={() => setHomeView("amigos")}
            >
              <span className="nav-ico"><IconUsers /></span> Amigos
              {friendsHub.incoming.length > 0 && (
                <span className="nav-badge">{friendsHub.incoming.length}</span>
              )}
            </button>
            <button type="button" className="nav-item" onClick={openServerSettings}>
              <span className="nav-ico"><IconGear /></span> Configurações
            </button>
            <button type="button" className="nav-item" onClick={() => setAboutOpen(true)}>
              <span className="nav-ico"><IconInfo /></span> Sobre
            </button>
          </nav>

          {friendsHub.account && (
            <button
              type="button"
              className="nav-account"
              onClick={() => setHomeView("amigos")}
              title="Ver amigos"
            >
              {accountAvatar ? (
                <img className="avatar" src={accountAvatar} alt="" referrerPolicy="no-referrer" />
              ) : (
                <div className="avatar">{accountName.slice(0, 1).toUpperCase()}</div>
              )}
              <div className="nav-account-info">
                <span>Conectado como</span>
                <strong>{accountName}</strong>
              </div>
              <span className="nav-account-chevron">›</span>
            </button>
          )}
        </aside>

        <div className="home-main">
          <header className="home-topbar">
            <button className="server-pill" onClick={openServerSettings} title={serverUrl}>
              <span className={`status-dot ${socketConnected ? "online" : ""}`} />
              {socketConnected ? "Servidor conectado" : "Conectando ao servidor..."}
            </button>
          </header>

          {!loggedIn ? (
            <section className="home-hero login">
              <div className="hero-text">
                <span className="eyebrow">SINCRONIZAÇÃO EM TEMPO REAL</span>
                <h1>Música juntos.<br />Sincronizado.</h1>
                <p>
                  Entre com sua conta Spotify para criar salas, ver seus amigos e
                  ouvir junto em tempo real. Seu nome e sua foto vêm da conta.
                </p>
                <div className="hero-actions">
                  <button
                    className="btn-primary"
                    onClick={connectSpotify}
                    disabled={spotifyBusy}
                  >
                    {spotifyBusy ? "Abrindo o Spotify..." : "Entrar com Spotify"}
                  </button>
                </div>
                {spotifyError && <div className="error-box">{spotifyError}</div>}
              </div>
              <HeroVisual />
            </section>
          ) : homeView === "amigos" ? (
            <FriendsPanel
              inline
              account={friendsHub.account}
              friends={friendsHub.friends}
              incoming={friendsHub.incoming}
              outgoing={friendsHub.outgoing}
              onAdd={friendsHub.addFriend}
              onAccept={friendsHub.acceptFriend}
              onDecline={friendsHub.declineFriend}
              onRemove={friendsHub.removeFriend}
              onInvite={friendsHub.inviteFriend}
              onListenAlong={listenAlong}
              onStopListening={stopListening}
              listeningTo={listeningTo?.userId}
              inRoom={false}
              roomCode={undefined}
              notify={setNotice}
            />
          ) : (
            <>
              <div className="home-grid">
                <section className="home-hero">
                  <div className="hero-text">
                    <span className="eyebrow">SINCRONIZAÇÃO EM TEMPO REAL</span>
                    <h1>Música juntos.<br />Sincronizado.</h1>
                    <p>
                      Crie salas musicais e sincronize o que você está ouvindo
                      com seus amigos em tempo real.
                    </p>
                    <div className="hero-actions">
                      <button
                        className="btn-primary"
                        onClick={createRoom}
                        disabled={!socketConnected || !friendsHub.account}
                      >
                        <IconPlus /> Criar nova sala
                      </button>
                      <button
                        className="btn-ghost"
                        onClick={() => setJoinOpen((v) => !v)}
                      >
                        Entrar com código
                      </button>
                      {!spotifyConnected && (
                        <button
                          className="btn-ghost"
                          onClick={connectSpotify}
                          disabled={spotifyBusy}
                        >
                          {spotifyBusy ? "Abrindo..." : "Conectar Spotify"}
                        </button>
                      )}
                    </div>

                    {joinOpen && (
                      <form
                        className="code-join"
                        onSubmit={(event) => {
                          event.preventDefault();
                          joinRoom();
                        }}
                      >
                        <input
                          value={roomCode}
                          onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                          placeholder="CÓDIGO DA SALA"
                          maxLength={12}
                          autoFocus
                        />
                        <button
                          className="btn-primary sm"
                          type="submit"
                          disabled={!socketConnected || !roomCode.trim()}
                        >
                          Entrar
                        </button>
                      </form>
                    )}

                    <div className="hero-chips">
                      <div className="hero-chip">
                        <span className="chip-ico"><IconRadio /></span>
                        <div>
                          <strong>Tempo real</strong>
                          <small>Sincronização instantânea da reprodução.</small>
                        </div>
                      </div>
                      <div className="hero-chip">
                        <span className="chip-ico"><IconUsers /></span>
                        <div>
                          <strong>Com amigos</strong>
                          <small>Convide e curta com quem você gosta.</small>
                        </div>
                      </div>
                      <div className="hero-chip">
                        <span className="chip-ico"><IconShield /></span>
                        <div>
                          <strong>Seguro</strong>
                          <small>Suas salas são privadas e protegidas.</small>
                        </div>
                      </div>
                    </div>
                  </div>
                  <HeroVisual />
                </section>

                <aside className="activity-rail">
                  <div className="rail-head">
                    <span>Amigos</span>
                    <button className="rail-manage" onClick={() => setHomeView("amigos")}>
                      Gerenciar ›
                    </button>
                  </div>

                  {sortedFriends.length === 0 ? (
                    <div className="rail-empty">
                      <p>Você ainda não adicionou amigos.</p>
                      <button className="btn-ghost sm" onClick={() => setHomeView("amigos")}>
                        Adicionar amigos
                      </button>
                    </div>
                  ) : (
                    <div className="rail-list">
                      {sortedFriends.map((friend) => (
                        <div className="rail-friend" key={friend.userId}>
                          <div className="avatar-wrap">
                            {friend.avatarUrl ? (
                              <img className="avatar small" src={friend.avatarUrl} alt="" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="avatar small">{friend.displayName.slice(0, 1).toUpperCase()}</div>
                            )}
                            <span className={`presence-dot ${friend.online ? "online" : ""}`} />
                          </div>
                          <div className="rail-friend-info">
                            <strong>{friend.displayName}</strong>
                            <span className={friend.nowPlaying ? "playing" : ""}>
                              {friend.nowPlaying
                                ? `♪ ${friend.nowPlaying.title}${friend.nowPlaying.artist ? " · " + friend.nowPlaying.artist : ""}`
                                : friend.online
                                  ? "Online"
                                  : "Offline"}
                            </span>
                          </div>
                          {friend.online && friend.nowPlaying && (
                            <button
                              className="rail-join"
                              onClick={() => listenAlong(friend.userId, friend.displayName)}
                              disabled={listeningTo?.userId === friend.userId}
                            >
                              {listeningTo?.userId === friend.userId ? "Ouvindo" : "Ouvir junto"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              </div>

              <section className="listen-strip">
                <div className="strip-head">
                  <span>Ouvir junto</span>
                </div>
                {listeningFriends.length === 0 ? (
                  <div className="strip-empty">
                    Nenhum amigo ouvindo agora. Quando alguém estiver tocando,
                    aparece aqui para você entrar junto com um clique.
                  </div>
                ) : (
                  <div className="strip-cards">
                    {listeningFriends.map((friend) => (
                      <button
                        className="strip-card"
                        key={friend.userId}
                        onClick={() => listenAlong(friend.userId, friend.displayName)}
                      >
                        <div className="avatar-wrap">
                          {friend.avatarUrl ? (
                            <img className="avatar small" src={friend.avatarUrl} alt="" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="avatar small">{friend.displayName.slice(0, 1).toUpperCase()}</div>
                          )}
                          <span className="presence-dot online" />
                        </div>
                        <div className="strip-card-info">
                          <strong>{friend.displayName}</strong>
                          <small>{friend.nowPlaying?.title}</small>
                          <small className="strip-card-artist">{friend.nowPlaying?.artist}</small>
                        </div>
                        <span className="strip-live">● Ao vivo</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {(notice || connectionError) && (
            <div className={connectionError ? "error-box page-message" : "notice page-message"}>
              {connectionError || notice}
            </div>
          )}

          <footer className="home-footer">
            <button
              className="footer-update"
              onClick={() =>
                updateStatus && updateStatus !== "checking"
                  ? openExternalUrl(updateStatus.url)
                  : checkForUpdates()
              }
              disabled={updateStatus === "checking"}
            >
              {updateStatus === "checking"
                ? "Verificando atualizações..."
                : updateStatus
                  ? `⬆ Versão ${updateStatus.version} disponível`
                  : "⟳ Verificar atualizações"}
            </button>
          </footer>
        </div>
      </main>
      <ServerSettingsModal
        open={settingsOpen}
        value={serverDraft}
        onChange={setServerDraft}
        onClose={() => setSettingsOpen(false)}
        onTest={testServerConnection}
        onSave={saveServerSettings}
        testStatus={serverTestStatus}
        saving={savingServer}
      />
      <FriendsPanel
        open={friendsOpen}
        onClose={() => setFriendsOpen(false)}
        account={friendsHub.account}
        friends={friendsHub.friends}
        incoming={friendsHub.incoming}
        outgoing={friendsHub.outgoing}
        onAdd={friendsHub.addFriend}
        onAccept={friendsHub.acceptFriend}
        onDecline={friendsHub.declineFriend}
        onRemove={friendsHub.removeFriend}
        onInvite={friendsHub.inviteFriend}
        onListenAlong={listenAlong}
        onStopListening={stopListening}
        listeningTo={listeningTo?.userId}
        inRoom={false}
        roomCode={undefined}
        notify={setNotice}
      />
      {listeningTo && (
        <div className="bottom-player">
          {listeningTrack?.cover ? (
            <img
              className="bottom-player-cover"
              src={listeningTrack.cover}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="bottom-player-cover placeholder">♫</div>
          )}
          <div className="bottom-player-info">
            <span className="bottom-player-eyebrow">
              Ouvindo junto com {listeningTo.name}
            </span>
            <strong>{listeningTrack?.title || "Sincronizando..."}</strong>
            {listeningTrack?.artist && <small>{listeningTrack.artist}</small>}
          </div>
          <button className="bottom-player-stop" onClick={stopListening}>
            Parar
          </button>
        </div>
      )}
      <InviteToasts
        invites={friendsHub.invites}
        onAccept={friendsHub.acceptInvite}
        onDismiss={friendsHub.dismissInvite}
      />
      {aboutOpen && (
        <div className="modal-backdrop" onClick={() => setAboutOpen(false)}>
          <div
            className="settings-modal about-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-modal-header">
              <div className="about-brand">
                <img className="about-logo" src={logo} alt="" />
                <div>
                  <h2>Spotgino</h2>
                  <span>versão {appVersion}</span>
                </div>
              </div>
              <button className="modal-close" onClick={() => setAboutOpen(false)}>
                ×
              </button>
            </div>
            <p className="settings-description">
              Salas de música sincronizadas com o Spotify. O host toca e seus
              amigos ouvem junto, cada um na própria conta, em tempo real.
            </p>
            <button
              className="btn-ghost"
              onClick={() => openExternalUrl("https://github.com/LeonardoHGB/Spotgino")}
            >
              Ver no GitHub
            </button>
          </div>
        </div>
      )}
      </>
    );
  }

  if (miniMode) {
    return (
      <>
        <MiniPlayer
          room={room}
          track={currentTrack}
          position={position}
          isHost={isHost}
          spotifyBusy={spotifyBusy}
          chatOpen={miniChatOpen}
          unread={unreadMessages}
          chatMessage={chatMessage}
          onChatMessageChange={setChatMessage}
          onToggleChat={toggleMiniChat}
          onTogglePlay={togglePlayback}
          onNext={nextTrack}
          onSendMessage={sendMessage}
          onExpand={exitMiniMode}
        />
        <InviteToasts
          invites={friendsHub.invites}
          onAccept={friendsHub.acceptInvite}
          onDismiss={friendsHub.dismissInvite}
        />
      </>
    );
  }

  return (
    <>
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand compact">
          <BrandLogo />
          <div>
            <strong>Spotgino</strong>
            <span>Sala {room.code}</span>
          </div>
        </div>

        <button
          className="invite-card"
          onClick={() => {
            navigator.clipboard?.writeText(room.code);
            setNotice("Código copiado.");
          }}
        >
          <span>Código da sala</span>
          <strong>{room.code}</strong>
          <small>Clique para copiar</small>
        </button>

        <button className="friends-button sidebar-friends" onClick={() => setFriendsOpen(true)}>
          <span>Amigos</span>
          {friendsHub.incoming.length > 0 && (
            <span className="friends-badge">{friendsHub.incoming.length}</span>
          )}
        </button>

        <section className="panel-section">
          <div className="section-title">
            <span>Participantes</span>
            <small>{room.members.length}</small>
          </div>

          <div className="member-list">
            {room.members.map((member) => (
              <div className="member" key={member.id}>
                {member.avatar ? (
                  <img
                    className="avatar"
                    src={member.avatar}
                    alt={member.name}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="avatar">
                    {member.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <strong>{member.name}</strong>
                  <span>{member.isHost ? "Host da sala" : "Ouvindo junto"}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="spotify-card">
          <div className="spotify-heading">
            <div className="spotify-icon">●</div>
            <div>
              <strong>Spotify</strong>
              <span>{spotifyConnected ? "Conta vinculada" : "Não conectado"}</span>
            </div>
          </div>

          {!spotifyConnected ? (
            <button onClick={connectSpotify} disabled={spotifyBusy}>
              {spotifyBusy ? "Abrindo..." : "Vincular Spotify"}
            </button>
          ) : (
            <>
              <div className="spotify-account">
                {(friendsHub.account?.avatarUrl || spotifyProfile?.images?.[0]?.url) && (
                  <img
                    className="avatar"
                    src={friendsHub.account?.avatarUrl || spotifyProfile?.images?.[0]?.url}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                )}
                <p className="spotify-user">
                  {friendsHub.account?.displayName ||
                    spotifyProfile?.display_name ||
                    spotifyProfile?.id ||
                    "Conta Spotify"}
                </p>
              </div>

              {!isHost && (
                <p className="sync-auto-note">
                  Seu Spotify sincroniza automaticamente com o host.
                </p>
              )}

              <button className="danger-button" onClick={disconnectSpotify}>
                Desconectar
              </button>
            </>
          )}

          {spotifyLocalPlayback?.track && (
            <div className="local-status">
              <span>No seu Spotify</span>
              <strong>{spotifyLocalPlayback.track.title}</strong>
              <small>{spotifyLocalPlayback.track.artist}</small>
            </div>
          )}

          {spotifyError && <small className="error">{spotifyError}</small>}
        </section>

        {friendsHub.account && (
          <div className="nav-account inroom">
            {(friendsHub.account?.avatarUrl || spotifyProfile?.images?.[0]?.url) ? (
              <img
                className="avatar"
                src={friendsHub.account?.avatarUrl || spotifyProfile?.images?.[0]?.url}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="avatar">
                {(friendsHub.account?.displayName || "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="nav-account-info">
              <span>Conectado como</span>
              <strong>
                {friendsHub.account?.displayName ||
                  spotifyProfile?.display_name ||
                  "Você"}
              </strong>
            </div>
          </div>
        )}
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {isHost ? "VOCÊ É O HOST" : "VOCÊ É CONVIDADO"}
            </span>
            <h2>Sessão sincronizada</h2>
          </div>

          <div className="topbar-actions">
            <span className="server-pill" title={serverUrl}>
              <span className={`status-dot ${socketConnected ? "online" : ""}`} />
              {socketConnected ? "Conectado" : "Reconectando..."}
            </span>
            <button
              className="leave-room-button"
              onClick={() => setConfirmLeave(true)}
              title="Voltar ao menu inicial"
            >
              ⤶ Sair da sala
            </button>
            {updateStatus && updateStatus !== "checking" && (
              <button
                className="update-pill"
                onClick={() => openExternalUrl(updateStatus.url)}
                title="Abrir a página de download"
              >
                ⬆ v{updateStatus.version} disponível
              </button>
            )}
            <button
              className="sync-now-button"
              onClick={checkForUpdates}
              disabled={updateStatus === "checking"}
              title="Verificar atualizações no GitHub"
            >
              {updateStatus === "checking" ? "⟳ ..." : "⟳ Atualizar"}
            </button>
            <button className="sync-now-button" onClick={enterMiniMode}>
              ▣ Mini player
            </button>
            {isHost && spotifyConnected && (
              <button className="sync-now-button" onClick={refreshHostPlayback}>
                ↻ Ler Spotify agora
              </button>
            )}
          </div>
        </header>

        <section className="now-playing">
          <div className="cover-wrap">
            {currentTrack?.cover && (
              <img
                key={currentTrack.cover}
                className="cover-glow"
                src={currentTrack.cover}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
              />
            )}
            <Cover track={currentTrack} large />
          </div>

          <div className="track-info">
            <span className="eyebrow">
              {room.playback.source === "spotify" ? "TOCANDO NO SPOTIFY" : "MODO DEMONSTRAÇÃO"}
            </span>
            <h1>{currentTrack?.title || "Aguardando uma música"}</h1>
            <p>
              {currentTrack
                ? `${currentTrack.artist}${currentTrack.album ? ` · ${currentTrack.album}` : ""}`
                : "O host ainda não iniciou uma reprodução."}
            </p>

            {currentTrack && (
              <>
                <div className="progress-row">
                  <span>{formatTime(position)}</span>
                  <input
                    type="range"
                    min="0"
                    max={room.playback.durationMs || 1}
                    value={Math.min(position, room.playback.durationMs || 1)}
                    onPointerDown={() => setSeeking(true)}
                    onChange={(event) => setPosition(Number(event.target.value))}
                    onPointerUp={(event) => {
                      setSeeking(false);
                      seekPlayback(event.currentTarget.value);
                    }}
                    disabled={!isHost || spotifyBusy}
                  />
                  <span>{formatTime(room.playback.durationMs)}</span>
                </div>

                <div className="controls">
                  <button
                    className="control-button"
                    onClick={previousTrack}
                    disabled={!isHost || room.playback.source !== "spotify" || spotifyBusy}
                  >
                    ⏮
                  </button>
                  <button
                    className="play-button"
                    onClick={togglePlayback}
                    disabled={!isHost || spotifyBusy}
                  >
                    {room.playback.isPlaying ? "Ⅱ" : "▶"}
                  </button>
                  <button
                    className="control-button"
                    onClick={nextTrack}
                    disabled={!isHost || spotifyBusy}
                  >
                    ⏭
                  </button>
                </div>
              </>
            )}

            <div className="playback-meta">
              <span>Fonte: {room.playback.source === "spotify" ? "Spotify Connect" : "Demonstração"}</span>
              {room.playback.deviceName && <span>Dispositivo: {room.playback.deviceName}</span>}
            </div>

            {currentTrack?.externalUrl && (
              <button
                className="open-spotify-button"
                onClick={() => openSpotifyUrl(currentTrack.externalUrl)}
              >
                Abrir esta faixa no Spotify
              </button>
            )}
          </div>
        </section>

        {(notice || connectionError) && (
          <div className={connectionError ? "error-box page-message" : "notice page-message"}>
            {connectionError || notice}
          </div>
        )}

        <section className="content-grid">
          <div className="queue-panel">
            <div className="section-title">
              <div>
                <span>Buscar e organizar</span>
                <p>Pesquise faixas reais e envie para o Spotify do host.</p>
              </div>
            </div>

            {spotifyConnected && isHost ? (
              <form className="spotify-search" onSubmit={searchSpotify}>
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Música, artista ou álbum"
                />
                <button disabled={searching}>
                  {searching ? "Buscando..." : "Pesquisar"}
                </button>
              </form>
            ) : (
              <div className="search-hint">
                {!spotifyConnected
                  ? "Vincule o Spotify para pesquisar músicas reais."
                  : "Somente o host escolhe as músicas da sala."}
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="search-results-inline">
                {searchResults.map((track) => (
                  <div className="search-result" key={track.id}>
                    <Cover track={track} />
                    <div className="track-text">
                      <strong>{track.title}</strong>
                      <small>{track.artist} · {track.album}</small>
                    </div>
                    <button onClick={() => addToQueue(track)}>+ Fila</button>
                    <button className="play-now" onClick={() => playSpotifyTrack(track)}>
                      Tocar
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="subsection-heading">
              <div>
                <strong>Fila da sala</strong>
                <span>{room.queue.length} faixa(s)</span>
              </div>
            </div>

            <div className="track-list">
              {room.queue.length === 0 && (
                <div className="empty-state">A fila ainda está vazia.</div>
              )}

              {room.queue.map((track, index) => (
                <div className="track-row" key={`${track.id}-${index}`}>
                  <span className="track-index">{index + 1}</span>
                  <Cover track={track} />
                  <span className="track-text">
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                  <span className="track-duration">{formatTime(track.durationMs)}</span>
                  {isHost && (
                    <button
                      className="row-icon-button"
                      onClick={() => getSocket()?.emit("queue:remove", { index })}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isHost && (
              <div className="demo-library">
                <h3>Teste sem Spotify</h3>
                <div className="demo-buttons">
                  {demoTracks.map((track) => (
                    <button key={track.id} onClick={() => playDemoTrack(track)}>
                      {track.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="chat-panel">
            <div className="section-title">
              <div>
                <span>Chat da sala</span>
                <p>Mensagens em tempo real.</p>
              </div>
            </div>

            <div className="messages">
              {room.messages.length === 0 && (
                <div className="empty-chat">Envie a primeira mensagem.</div>
              )}

              {room.messages.map((message) => (
                <div className="message" key={message.id}>
                  {message.avatar ? (
                    <img
                      className="avatar small"
                      src={message.avatar}
                      alt={message.author}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="avatar small">
                      {message.author.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <strong>{message.author}</strong>
                    <p>{message.message}</p>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <form className="chat-form" onSubmit={sendMessage}>
              <input
                value={chatMessage}
                onChange={(event) => setChatMessage(event.target.value)}
                placeholder="Digite uma mensagem..."
              />
              <button>➤</button>
            </form>
          </div>
        </section>
      </section>
    </main>
    <ServerSettingsModal
      open={settingsOpen}
      value={serverDraft}
      onChange={setServerDraft}
      onClose={() => setSettingsOpen(false)}
      onTest={testServerConnection}
      onSave={saveServerSettings}
      testStatus={serverTestStatus}
      saving={savingServer}
    />
    <FriendsPanel
      open={friendsOpen}
      onClose={() => setFriendsOpen(false)}
      account={friendsHub.account}
      friends={friendsHub.friends}
      incoming={friendsHub.incoming}
      outgoing={friendsHub.outgoing}
      onAdd={friendsHub.addFriend}
      onAccept={friendsHub.acceptFriend}
      onDecline={friendsHub.declineFriend}
      onRemove={friendsHub.removeFriend}
      onInvite={friendsHub.inviteFriend}
      onListenAlong={listenAlong}
      onStopListening={stopListening}
      listeningTo={listeningTo?.userId}
      inRoom={Boolean(room)}
      roomCode={room?.code}
      notify={setNotice}
    />
    <InviteToasts
      invites={friendsHub.invites}
      onAccept={friendsHub.acceptInvite}
      onDismiss={friendsHub.dismissInvite}
    />
    {confirmLeave && (
      <div className="modal-backdrop" onMouseDown={() => setConfirmLeave(false)}>
        <div
          className="settings-modal confirm-modal"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <h2>Sair da sala?</h2>
          <p className="settings-description">
            {isHost
              ? "Você é o host. Ao sair, a sala será encerrada e todos os participantes serão avisados de que você saiu."
              : "Você vai voltar ao menu inicial e sair desta sala."}
          </p>
          <div className="settings-modal-actions">
            <button className="secondary-button" onClick={() => setConfirmLeave(false)}>
              Cancelar
            </button>
            <button className="confirm-leave-button" onClick={leaveRoom}>
              {isHost ? "Encerrar sala" : "Sair"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
