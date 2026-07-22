const cors = require("cors");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const db = require("./db.cjs");

const APP_VERSION = "3.1.1";
const PORT = Number(process.env.PORT || 3333);
const HOST = process.env.HOST || "0.0.0.0";
const SERVER_NAME = process.env.SERVER_NAME || "Spotgino";
const MAX_ROOMS = Math.max(1, Number(process.env.MAX_ROOMS || 500));
const MAX_MEMBERS_PER_ROOM = Math.max(2, Number(process.env.MAX_MEMBERS_PER_ROOM || 30));
const ROOM_IDLE_TTL_MS = Math.max(60_000, Number(process.env.ROOM_IDLE_TTL_MS || 21_600_000));
// Limites de memória e rate limiting (SG-02).
const MAX_MESSAGES = 200;
const MAX_QUEUE = 200;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_EVENTS = 150;

const configuredOrigins = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (configuredOrigins.includes("*")) return true;
  if (!origin || origin === "null") return true;
  return configuredOrigins.includes(origin);
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origem não permitida pelo servidor."));
  },
  methods: ["GET", "POST"]
};

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(cors(corsOptions));
app.use(express.json({ limit: "32kb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  transports: ["websocket", "polling"],
  pingTimeout: 60_000,
  maxHttpBufferSize: 100_000
});

const DB_FILE = process.env.DB_FILE || "./data/listen-together.db";
db.init(DB_FILE);

// Bloqueia clientes cuja versão não seja exatamente a do servidor. A versão vem
// no handshake (auth.version); clientes antigos, sem esse campo, também caem.
io.use((socket, next) => {
  const clientVersion = socket.handshake.auth?.version;
  if (clientVersion === APP_VERSION) {
    next();
    return;
  }
  const error = new Error(
    `Versão incompatível. Atualize o Spotgino para a versão ${APP_VERSION}.`
  );
  error.data = {
    code: "VERSION_MISMATCH",
    serverVersion: APP_VERSION,
    clientVersion: clientVersion || null
  };
  next(error);
});

const rooms = new Map();

// Presença de contas autenticadas: userId -> Set<socketId>
const presence = new Map();

// O que cada usuário está ouvindo agora: userId -> { track, playback, updatedAt }
const userPlayback = new Map();
const NOW_PLAYING_TTL_MS = 90_000;

// "Ouvir junto" sem sala: broadcasterUserId -> Set<socketId> de seguidores.
const listeners = new Map();

function isOnline(userId) {
  const set = presence.get(userId);
  return Boolean(set && set.size > 0);
}

function emitToUser(userId, event, payload) {
  const set = presence.get(userId);
  if (!set) return;
  for (const socketId of set) io.to(socketId).emit(event, payload);
}

function nowPlayingOf(userId) {
  const entry = userPlayback.get(userId);
  if (!entry || Date.now() - entry.updatedAt > NOW_PLAYING_TTL_MS) return null;
  return entry.track || null;
}

function removeSocketFromListeners(socketId) {
  for (const [uid, set] of listeners) {
    if (set.delete(socketId) && set.size === 0) listeners.delete(uid);
  }
}

// Encerra qualquer "ouvir junto" ativo entre dois usuários (nas duas direções).
// Usado ao desfazer amizade para não deixar uma inscrição sobreviver à
// autorização que a permitiu (SG-08).
function stopFollowingBetween(a, b) {
  for (const [broadcaster, ex] of [[a, b], [b, a]]) {
    const set = listeners.get(broadcaster);
    if (!set) continue;
    for (const socketId of set) {
      const s = io.sockets.sockets.get(socketId);
      if (s && s.data.userId === ex) {
        set.delete(socketId);
        s.emit("listen:ended", { userId: broadcaster });
      }
    }
    if (set.size === 0) listeners.delete(broadcaster);
  }
}

function friendState(userId) {
  return {
    self: db.getAccount(userId),
    friends: db.listFriends(userId).map((friend) => ({
      ...friend,
      online: isOnline(friend.userId),
      nowPlaying: nowPlayingOf(friend.userId)
    })),
    incoming: db.listIncomingRequests(userId),
    outgoing: db.listOutgoingRequests(userId)
  };
}

function pushFriendState(userId) {
  emitToUser(userId, "friend:state", friendState(userId));
}

function setPresence(userId, socketId, online) {
  if (online) {
    if (!presence.has(userId)) presence.set(userId, new Set());
    presence.get(userId).add(socketId);
    return;
  }
  const set = presence.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) presence.delete(userId);
}

function notifyFriendsPresence(userId, online) {
  for (const friend of db.listFriends(userId)) {
    if (isOnline(friend.userId)) {
      emitToUser(friend.userId, "friend:presence", { userId, online });
    }
  }
}

function authenticate(socket, account) {
  // Se o socket já estava autenticado com outra identidade, remove a presença
  // anterior antes de setar a nova (SG-09) — senão a conta antiga fica "online"
  // para sempre e o presence map cresce sem limite.
  const previousUserId = socket.data.userId;
  if (previousUserId && previousUserId !== account.userId) {
    setPresence(previousUserId, socket.id, false);
    if (!isOnline(previousUserId)) notifyFriendsPresence(previousUserId, false);
  }
  socket.data.userId = account.userId;
  const wasOnline = isOnline(account.userId);
  setPresence(account.userId, socket.id, true);
  if (!wasOnline) notifyFriendsPresence(account.userId, true);
}

function requireAuth(socket, callback) {
  const userId = socket.data.userId;
  if (!userId) {
    callback?.({ ok: false, message: "Faça login na sua conta primeiro." });
    return null;
  }
  return userId;
}

// Valida o access token do Spotify direto na fonte e devolve a identidade
// canônica (id, nome, foto). Assim o cliente não consegue se passar por outro
// usuário só mandando um spotifyId qualquer.
async function fetchSpotifyProfile(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) return null;

  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (!data?.id) return null;

  return {
    spotifyId: String(data.id),
    displayName: data.display_name || data.id,
    avatarUrl: Array.isArray(data.images) && data.images[0]?.url ? data.images[0].url : null
  };
}

const demoTracks = [
  {
    id: "demo-midnight-interface",
    uri: "demo:track:midnight-interface",
    title: "Midnight Interface",
    artist: "Demo Waves",
    album: "Synchronized",
    durationMs: 214000,
    cover: null,
    externalUrl: null,
    type: "track"
  },
  {
    id: "demo-neon-connections",
    uri: "demo:track:neon-connections",
    title: "Neon Connections",
    artist: "Socket Friends",
    album: "Realtime Sessions",
    durationMs: 188000,
    cover: null,
    externalUrl: null,
    type: "track"
  },
  {
    id: "demo-linux-after-dark",
    uri: "demo:track:linux-after-dark",
    title: "Linux After Dark",
    artist: "Electron Club",
    album: "Desktop Dreams",
    durationMs: 241000,
    cover: null,
    externalUrl: null,
    type: "track"
  }
];

function roomCode() {
  // 5 bytes = 40 bits (SG-05): força-bruta de código de sala inviável.
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}

function expectedPosition(playback) {
  if (!playback) return 0;
  if (!playback.isPlaying) return playback.positionMs || 0;

  return Math.min(
    playback.durationMs || Number.MAX_SAFE_INTEGER,
    (playback.positionMs || 0) + Math.max(0, Date.now() - playback.changedAt)
  );
}

// Só aceita URLs https de hosts permitidos (SG-06). Evita que a capa/link de uma
// faixa aponte para um servidor do atacante (tracking pixel de IP / open-redirect).
function safeMediaUrl(value, allowedHosts) {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value.slice(0, 1000));
    if (parsed.protocol !== "https:") return null;
    const ok = allowedHosts.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );
    return ok ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function cleanTrack(track) {
  if (!track || typeof track !== "object") return null;

  return {
    id: String(track.id || "").slice(0, 180),
    uri: String(track.uri || "").slice(0, 300),
    title: String(track.title || "Conteúdo sem título").slice(0, 240),
    artist: String(track.artist || "Spotify").slice(0, 240),
    album: String(track.album || "").slice(0, 240),
    durationMs: Math.max(0, Number(track.durationMs) || 0),
    cover: safeMediaUrl(track.cover, ["scdn.co", "spotifycdn.com"]),
    externalUrl: safeMediaUrl(track.externalUrl, ["open.spotify.com"]),
    type: track.type === "episode" ? "episode" : "track"
  };
}

function serializeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    members: [...room.members.values()],
    playback: room.playback,
    queue: room.queue.slice(0, MAX_QUEUE),
    messages: room.messages.slice(-80)
  };
}

function emitRoom(room) {
  room.lastActivityAt = Date.now();
  io.to(room.code).emit("room:state", serializeRoom(room));
}

function isMaterialPlaybackChange(previous, incoming) {
  if (!previous?.track && incoming?.track) return true;
  if (previous?.track && !incoming?.track) return true;
  if (!previous && incoming) return true;

  if (previous?.track?.id !== incoming?.track?.id) return true;
  if (previous?.isPlaying !== incoming?.isPlaying) return true;
  if (previous?.source !== incoming?.source) return true;

  const previousExpected = expectedPosition(previous);
  const incomingPosition = Number(incoming?.positionMs) || 0;
  return Math.abs(previousExpected - incomingPosition) >= 1500;
}

function buildPlayback(incoming, previousVersion = 0, source = "spotify") {
  const track = cleanTrack(incoming.track);

  return {
    track,
    isPlaying: Boolean(incoming.isPlaying),
    positionMs: Math.max(0, Number(incoming.positionMs) || 0),
    durationMs: track?.durationMs || Math.max(0, Number(incoming.durationMs) || 0),
    changedAt: Date.now(),
    spotifyTimestamp: Number(incoming.spotifyTimestamp) || null,
    deviceName: String(incoming.deviceName || "").slice(0, 180),
    source,
    version: previousVersion + 1
  };
}

app.get("/", (_request, response) => {
  response.json({
    name: SERVER_NAME,
    status: "online",
    service: "spotgino-server"
  });
});

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    name: SERVER_NAME,
    rooms: rooms.size,
    connections: io.engine.clientsCount,
    uptimeSeconds: Math.floor(process.uptime()),
    version: APP_VERSION
  });
});

app.get("/demo-tracks", (_request, response) => {
  response.json(demoTracks);
});

function rateLimited(socket) {
  const now = Date.now();
  const bucket = socket.data.rate || (socket.data.rate = { start: now, count: 0 });
  if (now - bucket.start > RATE_WINDOW_MS) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX_EVENTS;
}

io.on("connection", (socket) => {
  // Throttle por socket (SG-02): pacotes acima do limite são descartados com
  // erro (o socket NÃO é desconectado). O uso normal — polls de sync do host,
  // drift dos convidados, chat — fica bem abaixo de RATE_MAX_EVENTS por janela.
  socket.use((packet, next) => {
    if (rateLimited(socket)) {
      next(new Error("Você está enviando eventos rápido demais."));
      return;
    }
    next();
  });

  socket.on("room:create", ({ displayName }, callback) => {
    if (!requireAuth(socket, callback)) return;
    if (rooms.size >= MAX_ROOMS) {
      callback?.({ ok: false, message: "O servidor atingiu o limite de salas." });
      return;
    }

    let code = roomCode();
    while (rooms.has(code)) code = roomCode();
    const room = {
      code,
      hostId: socket.id,
      members: new Map(),
      playback: buildPlayback(
        {
          track: demoTracks[0],
          isPlaying: false,
          positionMs: 0,
          deviceName: "Modo demonstração"
        },
        0,
        "demo"
      ),
      queue: [],
      messages: [],
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };

    const hostAccount = socket.data.userId ? db.getAccount(socket.data.userId) : null;
    room.members.set(socket.id, {
      id: socket.id,
      name:
        hostAccount?.displayName ||
        String(displayName || "Host").trim().slice(0, 60) ||
        "Host",
      avatar: hostAccount?.avatarUrl || null,
      accountId: socket.data.userId || null,
      isHost: true,
      joinedAt: Date.now()
    });

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    emitRoom(room);
    callback?.({ ok: true, room: serializeRoom(room) });
  });

  socket.on("room:join", ({ code, displayName }, callback) => {
    if (!requireAuth(socket, callback)) return;
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = rooms.get(normalizedCode);

    if (!room) {
      callback?.({ ok: false, message: "Sala não encontrada." });
      return;
    }

    if (room.members.size >= MAX_MEMBERS_PER_ROOM) {
      callback?.({ ok: false, message: "A sala atingiu o limite de participantes." });
      return;
    }

    const guestAccount = socket.data.userId ? db.getAccount(socket.data.userId) : null;
    room.members.set(socket.id, {
      id: socket.id,
      name:
        guestAccount?.displayName ||
        String(displayName || "Convidado").trim().slice(0, 60) ||
        "Convidado",
      avatar: guestAccount?.avatarUrl || null,
      accountId: socket.data.userId || null,
      isHost: false,
      joinedAt: Date.now()
    });

    // Sai da sala anterior antes de entrar na nova (SG-09) — evita membros-fantasma
    // e recebimento simultâneo do estado de várias salas (o socket só rastreia a
    // última roomCode, então o disconnect só limparia uma).
    const prevCode = socket.data.roomCode;
    if (prevCode && prevCode !== normalizedCode) {
      const prev = rooms.get(prevCode);
      if (prev) {
        prev.members.delete(socket.id);
        socket.leave(prevCode);
        if (prev.members.size === 0) {
          rooms.delete(prevCode);
        } else {
          if (prev.hostId === socket.id) {
            const [newHostId, newHost] = prev.members.entries().next().value;
            prev.hostId = newHostId;
            prev.members.set(newHostId, { ...newHost, isHost: true });
          }
          emitRoom(prev);
        }
      }
    }

    socket.join(normalizedCode);
    socket.data.roomCode = normalizedCode;
    emitRoom(room);
    callback?.({ ok: true, room: serializeRoom(room) });
  });

  socket.on("room:leave", (_payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    socket.data.roomCode = null;
    if (!room) {
      callback?.({ ok: true });
      return;
    }
    const code = room.code;
    const wasHost = room.hostId === socket.id;
    socket.leave(code);

    if (wasHost) {
      // Host saiu: encerra a sala e avisa todos os participantes.
      io.to(code).emit("room:closed", { reason: "host-left" });
      for (const socketId of room.members.keys()) {
        const other = io.sockets.sockets.get(socketId);
        if (other) {
          other.data.roomCode = null;
          other.leave(code);
        }
      }
      rooms.delete(code);
    } else {
      room.members.delete(socket.id);
      if (room.members.size === 0) rooms.delete(code);
      else emitRoom(room);
    }
    callback?.({ ok: true });
  });

  socket.on("playback:host-sync", ({ playback }, callback) => {
    const room = rooms.get(socket.data.roomCode);
    const member = room?.members.get(socket.id);

    if (!room || !member?.isHost) {
      callback?.({ ok: false, message: "Somente o host pode sincronizar a sala." });
      return;
    }

    if (!playback?.track) {
      callback?.({ ok: false, message: "Estado de reprodução inválido." });
      return;
    }

    const candidate = buildPlayback(
      playback,
      room.playback?.version || 0,
      playback.source === "demo" ? "demo" : "spotify"
    );

    if (!isMaterialPlaybackChange(room.playback, candidate)) {
      callback?.({ ok: true, updated: false });
      return;
    }

    room.playback = candidate;
    emitRoom(room);
    callback?.({ ok: true, updated: true });
  });

  socket.on("playback:demo-command", ({ action, positionMs, track }, callback) => {
    const room = rooms.get(socket.data.roomCode);
    const member = room?.members.get(socket.id);

    if (!room || !member?.isHost) {
      callback?.({ ok: false, message: "Somente o host controla a reprodução." });
      return;
    }

    const current = room.playback;
    const nextTrack = track ? cleanTrack(track) : current.track;
    let nextPosition = expectedPosition(current);
    let nextPlaying = current.isPlaying;

    if (action === "play") nextPlaying = true;
    if (action === "pause") nextPlaying = false;
    if (action === "seek") nextPosition = Math.max(0, Number(positionMs) || 0);
    if (action === "track") {
      nextPosition = 0;
      nextPlaying = true;
    }

    room.playback = buildPlayback(
      {
        track: nextTrack,
        isPlaying: nextPlaying,
        positionMs: nextPosition,
        deviceName: "Modo demonstração"
      },
      current.version,
      "demo"
    );

    emitRoom(room);
    callback?.({ ok: true });
  });

  socket.on("queue:add", ({ track }, callback) => {
    const room = rooms.get(socket.data.roomCode);
    const member = room?.members.get(socket.id);
    const cleaned = cleanTrack(track);

    if (!room || !member || !cleaned) {
      callback?.({ ok: false, message: "Faixa inválida." });
      return;
    }

    if (room.queue.length >= MAX_QUEUE) {
      callback?.({ ok: false, message: "A fila está cheia." });
      return;
    }

    room.queue.push(cleaned);
    emitRoom(room);
    callback?.({ ok: true });
  });

  socket.on("queue:shift", (_payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    const member = room?.members.get(socket.id);

    if (!room || !member?.isHost) {
      callback?.({ ok: false, message: "Somente o host altera a fila." });
      return;
    }

    const track = room.queue.shift() || null;
    emitRoom(room);
    callback?.({ ok: true, track });
  });

  socket.on("queue:remove", ({ index }, callback) => {
    const room = rooms.get(socket.data.roomCode);
    const member = room?.members.get(socket.id);
    const numericIndex = Number(index);

    if (!room || !member?.isHost || !Number.isInteger(numericIndex)) {
      callback?.({ ok: false, message: "Não foi possível remover a faixa." });
      return;
    }

    room.queue.splice(numericIndex, 1);
    emitRoom(room);
    callback?.({ ok: true });
  });

  socket.on("chat:send", ({ message }) => {
    const room = rooms.get(socket.data.roomCode);
    const member = room?.members.get(socket.id);
    const cleanMessage = String(message || "").trim().slice(0, 500);

    if (!room || !member || !cleanMessage) return;

    room.messages.push({
      id: crypto.randomUUID(),
      memberId: socket.id,
      author: member.name,
      avatar: member.avatar || null,
      message: cleanMessage,
      createdAt: Date.now()
    });
    if (room.messages.length > MAX_MESSAGES) {
      room.messages.splice(0, room.messages.length - MAX_MESSAGES);
    }

    emitRoom(room);
  });

  // --- Conta ------------------------------------------------------------

  // account:register removido (SG-03): criava conta anônima autenticada sem
  // verificação de identidade (Sybil / exaustão de disco no SQLite). O cliente
  // sempre entra via Spotify (account:spotify) ou por credenciais salvas
  // (account:login), então o handler não tinha uso legítimo.

  socket.on("account:spotify", async ({ token } = {}, callback) => {
    try {
      const profile = await fetchSpotifyProfile(token);
      if (!profile) {
        callback?.({ ok: false, message: "Não foi possível validar sua conta Spotify." });
        return;
      }

      const account = db.upsertSpotifyAccount(profile);
      authenticate(socket, account);
      callback?.({
        ok: true,
        account: {
          userId: account.userId,
          token: account.token,
          displayName: account.displayName,
          avatarUrl: account.avatarUrl
        },
        state: friendState(account.userId)
      });
    } catch (error) {
      console.error("Falha no login via Spotify:", error);
      callback?.({ ok: false, message: "Falha ao entrar com o Spotify." });
    }
  });

  socket.on("account:login", ({ userId, token } = {}, callback) => {
    const account = db.verifyAccount(userId, token);
    if (!account) {
      callback?.({ ok: false, message: "Credenciais inválidas." });
      return;
    }
    authenticate(socket, account);
    callback?.({
      ok: true,
      account: { userId: account.userId, displayName: account.displayName },
      state: friendState(account.userId)
    });
  });

  socket.on("account:update", ({ displayName } = {}, callback) => {
    const userId = requireAuth(socket, callback);
    if (!userId) return;
    const name = db.updateDisplayName(userId, displayName);
    callback?.({ ok: true, displayName: name });
    for (const friend of db.listFriends(userId)) {
      if (isOnline(friend.userId)) pushFriendState(friend.userId);
    }
  });

  // --- Amigos -----------------------------------------------------------

  socket.on("friend:request", ({ code } = {}, callback) => {
    const userId = requireAuth(socket, callback);
    if (!userId) return;

    const target = String(code || "").trim().toUpperCase();
    if (!target) {
      callback?.({ ok: false, message: "Informe o código do amigo." });
      return;
    }
    if (target === userId) {
      callback?.({ ok: false, message: "Esse é o seu próprio código." });
      return;
    }
    if (!db.getAccount(target)) {
      callback?.({ ok: false, message: "Código não encontrado." });
      return;
    }
    if (db.areFriends(userId, target)) {
      callback?.({ ok: false, message: "Vocês já são amigos." });
      return;
    }

    // Se o alvo já havia te enviado um pedido, aceita automaticamente.
    if (db.hasRequest(target, userId)) {
      db.acceptRequest(target, userId);
      callback?.({ ok: true, message: "Agora vocês são amigos." });
    } else {
      db.createRequest(userId, target);
      callback?.({ ok: true, message: "Pedido enviado." });
    }

    pushFriendState(userId);
    if (isOnline(target)) pushFriendState(target);
  });

  socket.on("friend:accept", ({ userId: fromId } = {}, callback) => {
    const userId = requireAuth(socket, callback);
    if (!userId) return;

    const from = String(fromId || "").trim().toUpperCase();
    if (!db.hasRequest(from, userId)) {
      callback?.({ ok: false, message: "Pedido não encontrado." });
      return;
    }
    db.acceptRequest(from, userId);
    callback?.({ ok: true });
    pushFriendState(userId);
    if (isOnline(from)) pushFriendState(from);
  });

  socket.on("friend:decline", ({ userId: otherId } = {}, callback) => {
    const userId = requireAuth(socket, callback);
    if (!userId) return;

    const other = String(otherId || "").trim().toUpperCase();
    db.deleteRequest(other, userId); // recusa pedido recebido
    db.deleteRequest(userId, other); // ou cancela pedido enviado
    callback?.({ ok: true });
    pushFriendState(userId);
    if (isOnline(other)) pushFriendState(other);
  });

  socket.on("friend:remove", ({ userId: friendId } = {}, callback) => {
    const userId = requireAuth(socket, callback);
    if (!userId) return;

    const other = String(friendId || "").trim().toUpperCase();
    db.removeFriendship(userId, other);
    stopFollowingBetween(userId, other);
    callback?.({ ok: true });
    pushFriendState(userId);
    if (isOnline(other)) pushFriendState(other);
  });

  socket.on("friend:list", (_payload, callback) => {
    const userId = requireAuth(socket, callback);
    if (!userId) return;
    callback?.({ ok: true, state: friendState(userId) });
  });

  // --- Convites ---------------------------------------------------------

  socket.on("invite:send", ({ userId: toId, code } = {}, callback) => {
    const userId = requireAuth(socket, callback);
    if (!userId) return;

    const target = String(toId || "").trim().toUpperCase();
    const roomCodeValue = String(code || socket.data.roomCode || "")
      .trim()
      .toUpperCase();

    if (!roomCodeValue) {
      callback?.({ ok: false, message: "Você precisa estar em uma sala válida." });
      return;
    }
    // Exige que o remetente seja membro da sala que está convidando (SG-05) —
    // sem isso dava para forjar convite para qualquer sala existente / usar como
    // oráculo de existência de sala.
    const inviteRoom = rooms.get(roomCodeValue);
    if (!inviteRoom || !inviteRoom.members.get(socket.id)) {
      callback?.({ ok: false, message: "Você precisa estar na sala para convidar." });
      return;
    }
    if (!db.areFriends(userId, target)) {
      callback?.({ ok: false, message: "Vocês não são amigos." });
      return;
    }
    if (!isOnline(target)) {
      callback?.({ ok: false, message: "Seu amigo está offline." });
      return;
    }

    const me = db.getAccount(userId);
    emitToUser(target, "invite:received", {
      fromId: userId,
      fromName: me?.displayName || "Amigo",
      code: roomCodeValue
    });
    callback?.({ ok: true, message: "Convite enviado." });
  });

  // --- Ouvir junto (sem sala) -------------------------------------------

  // Cada cliente reporta o que está tocando; o servidor guarda, avisa os amigos
  // online e repassa para quem estiver "ouvindo junto" com ele.
  socket.on("presence:playback", ({ playback } = {}) => {
    const userId = socket.data.userId;
    if (!userId) return;

    const track = playback?.track ? cleanTrack(playback.track) : null;
    userPlayback.set(userId, { track, playback: track ? playback : null, updatedAt: Date.now() });

    for (const friend of db.listFriends(userId)) {
      if (isOnline(friend.userId)) {
        emitToUser(friend.userId, "friend:playback", { userId, track });
      }
    }

    const set = listeners.get(userId);
    if (set && track) {
      for (const socketId of set) io.to(socketId).emit("listen:playback", { userId, playback });
    }
  });

  socket.on("listen:follow", ({ userId: targetId } = {}, callback) => {
    const me = requireAuth(socket, callback);
    if (!me) return;

    const target = String(targetId || "").trim().toUpperCase();
    if (!db.areFriends(me, target)) {
      callback?.({ ok: false, message: "Vocês não são amigos." });
      return;
    }
    if (!isOnline(target)) {
      callback?.({ ok: false, message: "Seu amigo está offline." });
      return;
    }

    removeSocketFromListeners(socket.id); // só segue um amigo por vez
    if (!listeners.has(target)) listeners.set(target, new Set());
    listeners.get(target).add(socket.id);
    socket.data.followingUserId = target;

    const entry = userPlayback.get(target);
    callback?.({
      ok: true,
      host: db.getAccount(target),
      playback: entry?.playback || null
    });
  });

  socket.on("listen:stop", (_payload, callback) => {
    removeSocketFromListeners(socket.id);
    socket.data.followingUserId = null;
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId;

    // Sai de qualquer sessão de "ouvir junto" que estava seguindo.
    removeSocketFromListeners(socket.id);

    if (userId) {
      setPresence(userId, socket.id, false);
      if (!isOnline(userId)) {
        notifyFriendsPresence(userId, false);
        // Ficou offline: encerra a transmissão para quem ouvia junto.
        const set = listeners.get(userId);
        if (set) {
          for (const socketId of set) io.to(socketId).emit("listen:ended", { userId });
          listeners.delete(userId);
        }
        userPlayback.delete(userId);
      }
    }

    const room = rooms.get(socket.data.roomCode);
    if (!room) return;

    room.members.delete(socket.id);

    if (room.members.size === 0) {
      rooms.delete(room.code);
      return;
    }

    if (room.hostId === socket.id) {
      const [newHostId, newHost] = room.members.entries().next().value;
      room.hostId = newHostId;
      room.members.set(newHostId, { ...newHost, isHost: true });
    }

    emitRoom(room);
  });
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.members.size === 0 || now - room.lastActivityAt > ROOM_IDLE_TTL_MS) {
      io.in(code).disconnectSockets(true);
      rooms.delete(code);
    }
  }
}, 60_000);
cleanupTimer.unref();

server.listen(PORT, HOST, () => {
  console.log(`${SERVER_NAME}: http://${HOST}:${PORT}`);
  console.log(`Origens permitidas: ${configuredOrigins.join(", ")}`);
});

function shutdown(signal) {
  console.log(`Recebido ${signal}. Encerrando servidor...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
