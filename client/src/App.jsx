import { useEffect, useRef, useState } from "react";
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
  hasSpotifySession,
  spotifyApi
} from "./spotify";
import { useFriends, FriendsPanel, InviteToasts } from "./friends";
import MiniPlayer, { MINI_SIZE, MINI_CHAT_SIZE } from "./miniplayer";
import logo from "./assets/logo.png";

const HOST_POLL_INTERVAL = 4500;
const GUEST_DRIFT_INTERVAL = 15000;
const FOLLOWER_DRIFT_TOLERANCE = 2200;

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
  const [serverUrl, setServerUrl] = useState("");
  const [serverDraft, setServerDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [miniMode, setMiniMode] = useState(false);
  const [miniChatOpen, setMiniChatOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
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
  const [followerSyncEnabled, setFollowerSyncEnabled] = useState(true);

  const roomRef = useRef(room);
  const spotifyDeviceIdRef = useRef(spotifyDeviceId);
  const hostPollingRef = useRef(false);
  const followerSyncRef = useRef(false);
  const mountedRef = useRef(true);

  const isHost = Boolean(room && room.hostId === getSocket()?.id);
  const currentTrack = room?.playback?.track || null;

  const friendsHub = useFriends({
    socketConnected,
    displayName,
    onJoinRoom: (code) => joinRoomByCode(code),
    notify: setNotice
  });

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
    try {
      const notification = new Notification(`Spotgino — ${last.author}`, {
        body: last.message,
        icon: logo,
        silent: false
      });
      notification.onclick = () => {
        window.electronAPI?.focusWindow?.();
        if (miniModeRef.current) setMiniChatOpen(true);
        setUnreadMessages(0);
      };
    } catch {
      // Notificações indisponíveis: o contador de não lidas já cobre.
    }
  }, [room?.messages?.length, room, miniMode, miniChatOpen]);

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
        activeSocket.emit(
          "room:join",
          {
            code: activeRoom.code,
            displayName: localStorage.getItem("display_name") || "Convidado"
          },
          (result) => {
            if (!result?.ok) {
              setRoom(null);
              setNotice("A conexão caiu e a sala não existe mais.");
            }
          }
        );
      }
    };
    const onDisconnect = () => setSocketConnected(false);
    const onConnectError = (error) => {
      setSocketConnected(false);
      setConnectionError(`Socket.IO: ${error.message}`);
    };
    const onRoomState = (nextRoom) => setRoom(nextRoom);

    activeSocket.on("connect", onConnect);
    activeSocket.on("disconnect", onDisconnect);
    activeSocket.on("connect_error", onConnectError);
    activeSocket.on("room:state", onRoomState);

    if (!activeSocket.connected) activeSocket.connect();
    else onConnect();

    return () => {
      activeSocket.off("connect", onConnect);
      activeSocket.off("disconnect", onDisconnect);
      activeSocket.off("connect_error", onConnectError);
      activeSocket.off("room:state", onRoomState);
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
      if (playback && !seeking) setPosition(expectedPosition(playback));
    }, 250);

    return () => clearInterval(timer);
  }, [seeking]);

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
      !followerSyncEnabled ||
      room.playback.source !== "spotify"
    ) {
      return;
    }

    syncFollowerToRoom(room.playback);
  }, [room?.playback?.version, spotifyConnected, isHost, followerSyncEnabled]);

  useEffect(() => {
    if (
      !spotifyConnected ||
      !room?.code ||
      isHost ||
      !followerSyncEnabled
    ) {
      return undefined;
    }

    const timer = setInterval(() => {
      const playback = roomRef.current?.playback;
      if (playback?.source === "spotify") syncFollowerToRoom(playback);
    }, GUEST_DRIFT_INTERVAL);

    return () => clearInterval(timer);
  }, [spotifyConnected, room?.code, isHost, followerSyncEnabled]);

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
          : playback?.deviceId || activeDevice?.id || devices[0]?.id || ""
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
          : active?.id || devices[0]?.id || ""
      );
    } catch (error) {
      setSpotifyError(error.message);
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function ensureSpotifyDevice() {
    if (spotifyDeviceIdRef.current) return spotifyDeviceIdRef.current;

    const payload = await spotifyApi.devices();
    const devices = (payload?.devices || []).filter(
      (device) => device.id && !device.is_restricted
    );
    const selected = devices.find((device) => device.is_active) || devices[0];

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

  async function syncFollowerToRoom(playback) {
    if (followerSyncRef.current || !playback?.track?.uri) return;
    followerSyncRef.current = true;

    try {
      const deviceId = await ensureSpotifyDevice();
      const local = await spotifyApi.currentPlayback();
      const targetPosition = expectedPosition(playback);
      const trackChanged = local?.track?.id !== playback.track.id;
      const playbackStateChanged = local?.isPlaying !== playback.isPlaying;
      const drift = Math.abs((local?.positionMs || 0) - targetPosition);

      if (trackChanged) {
        await spotifyApi.playTrack({
          uri: playback.track.uri,
          positionMs: targetPosition,
          deviceId
        });

        if (!playback.isPlaying) {
          await spotifyApi.pause({ deviceId });
        }
      } else if (playbackStateChanged) {
        if (playback.isPlaying) {
          await spotifyApi.playTrack({
            uri: playback.track.uri,
            positionMs: targetPosition,
            deviceId
          });
        } else {
          await spotifyApi.pause({ deviceId });
        }
      } else if (drift > FOLLOWER_DRIFT_TOLERANCE) {
        await spotifyApi.seek({ positionMs: targetPosition, deviceId });
      }

      setSpotifyLocalPlayback(
        playbackFromTrack(playback.track, {
          isPlaying: playback.isPlaying,
          positionMs: targetPosition,
          deviceName: playback.deviceName
        })
      );
      setSpotifyError("");
    } catch (error) {
      setSpotifyError(`Sincronização do convidado: ${error.message}`);
    } finally {
      window.setTimeout(() => {
        followerSyncRef.current = false;
      }, 900);
    }
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

  if (!runtimeReady) {
    return (
      <main className="landing">
        <section className="hero-card loading-card">
          <div className="brand">
            <img className="logo" src={logo} alt="Spotgino" />
            <div>
              <strong>Spotgino</strong>
              <span>Carregando configuração...</span>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!room) {
    return (
      <>
      <main className="landing">
        <section className="hero-card">
          <div className="brand">
            <img className="logo" src={logo} alt="Spotgino" />
            <div>
              <strong>Spotgino</strong>
              <span>Electron + Spotify Connect</span>
            </div>
          </div>

          <div className="hero-copy">
            <span className="eyebrow">SINCRONIZAÇÃO EM TEMPO REAL</span>
            <h1>Uma sala musical para seus amigos.</h1>
            <p>
              O host pode controlar pelo aplicativo ou diretamente pelo Spotify.
              As mudanças aparecem na sala automaticamente.
            </p>
          </div>

          <div className="server-connection-card">
            <div className="connection-line">
              <span className={`status-dot ${socketConnected ? "online" : ""}`} />
              {socketConnected ? "Servidor conectado" : "Conectando ao servidor..."}
            </div>
            <code>{serverUrl}</code>
            <button className="server-settings-button" onClick={openServerSettings}>
              Configurar servidor
            </button>
          </div>

          <label>
            Seu nome
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Como seus amigos verão você"
            />
          </label>

          <button
            className="primary-button"
            onClick={createRoom}
            disabled={!socketConnected}
          >
            Criar nova sala
          </button>

          <div className="divider"><span>ou entrar com código</span></div>

          <div className="join-row">
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              placeholder="EX: A1B2C3"
              maxLength={6}
            />
            <button
              className="secondary-button"
              onClick={joinRoom}
              disabled={!socketConnected}
            >
              Entrar
            </button>
          </div>

          <button className="friends-button" onClick={() => setFriendsOpen(true)}>
            <span>Amigos</span>
            {friendsHub.incoming.length > 0 && (
              <span className="friends-badge">{friendsHub.incoming.length}</span>
            )}
          </button>

          {notice && <div className="notice">{notice}</div>}
          {connectionError && <div className="error-box">{connectionError}</div>}
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
        inRoom={false}
        roomCode={undefined}
        notify={setNotice}
      />
      <InviteToasts
        invites={friendsHub.invites}
        onAccept={friendsHub.acceptInvite}
        onDismiss={friendsHub.dismissInvite}
      />
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
          <img className="logo" src={logo} alt="Spotgino" />
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
                <div className="avatar">
                  {member.name.slice(0, 1).toUpperCase()}
                </div>
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
              <p className="spotify-user">
                {spotifyProfile?.display_name || spotifyProfile?.id || "Conta Spotify"}
              </p>

              <label className="small-label">
                Dispositivo de reprodução
                <select
                  value={spotifyDeviceId}
                  onChange={(event) => setSpotifyDeviceId(event.target.value)}
                >
                  <option value="">Selecione um dispositivo</option>
                  {spotifyDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name} {device.is_active ? "(ativo)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="spotify-actions">
                <button className="ghost-button" onClick={refreshDevices}>
                  Atualizar
                </button>
                <button className="ghost-button" onClick={transferPlayback}>
                  Usar dispositivo
                </button>
              </div>

              {!isHost && (
                <label className="sync-toggle">
                  <input
                    type="checkbox"
                    checked={followerSyncEnabled}
                    onChange={(event) => setFollowerSyncEnabled(event.target.checked)}
                  />
                  Sincronizar meu Spotify com o host
                </label>
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
            <button className="sync-now-button" onClick={enterMiniMode}>
              ▣ Mini player
            </button>
            <button className="sync-now-button" onClick={openServerSettings}>
              ⚙ Servidor
            </button>
            {isHost && spotifyConnected && (
              <button className="sync-now-button" onClick={refreshHostPlayback}>
                ↻ Ler Spotify agora
              </button>
            )}
            <div className="live-pill"><span /> AO VIVO</div>
          </div>
        </header>

        <section className="now-playing">
          <div className="cover-wrap">
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
                  <div className="avatar small">
                    {message.author.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <strong>{message.author}</strong>
                    <p>{message.message}</p>
                  </div>
                </div>
              ))}
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
      inRoom={Boolean(room)}
      roomCode={room?.code}
      notify={setNotice}
    />
    <InviteToasts
      invites={friendsHub.invites}
      onAccept={friendsHub.acceptInvite}
      onDismiss={friendsHub.dismissInvite}
    />
    </>
  );
}
