const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_URL = "https://api.spotify.com/v1";

const STORAGE_KEYS = {
  accessToken: "spotify_access_token",
  refreshToken: "spotify_refresh_token",
  expiresAt: "spotify_expires_at",
  scope: "spotify_scope",
  verifier: "spotify_pkce_verifier",
  state: "spotify_oauth_state"
};

const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state"
];

let refreshPromise = null;

function requireSpotifyConfig() {
  const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI;

  if (!clientId || clientId === "COLOQUE_SEU_CLIENT_ID") {
    throw new Error("Configure VITE_SPOTIFY_CLIENT_ID no arquivo .env.");
  }

  if (!redirectUri) {
    throw new Error("Configure VITE_SPOTIFY_REDIRECT_URI no arquivo .env.");
  }

  return { clientId, redirectUri };
}

function randomString(length = 96) {
  const allowed =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const randomValues = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(
    randomValues,
    (value) => allowed[value % allowed.length]
  ).join("");
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

function readJsonSafely(text) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function spotifyErrorMessage(status, payload) {
  const apiMessage =
    payload?.error?.message ||
    payload?.error_description ||
    (typeof payload?.error === "string" ? payload.error : null);

  if (status === 401) {
    return apiMessage || "A sessão do Spotify expirou ou é inválida.";
  }

  if (status === 403) {
    return (
      apiMessage ||
      "O Spotify recusou a operação. Confira Premium, scopes e a lista de usuários permitidos do aplicativo."
    );
  }

  if (status === 404) {
    return (
      apiMessage ||
      "Nenhum dispositivo Spotify ativo foi encontrado. Abra o Spotify e inicie uma música primeiro."
    );
  }

  if (status === 429) {
    return "Limite temporário da API do Spotify atingido. Aguarde alguns segundos.";
  }

  return apiMessage || `Spotify API ${status}`;
}

export function saveTokens(tokens) {
  if (!tokens?.access_token) {
    throw new Error("O Spotify não retornou um access token.");
  }

  localStorage.setItem(STORAGE_KEYS.accessToken, tokens.access_token);
  localStorage.setItem(
    STORAGE_KEYS.expiresAt,
    String(Date.now() + Number(tokens.expires_in || 3600) * 1000)
  );

  if (tokens.refresh_token) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, tokens.refresh_token);
  }

  if (tokens.scope) {
    localStorage.setItem(STORAGE_KEYS.scope, tokens.scope);
  }
}

export function clearSpotifySession() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
}

export function hasSpotifySession() {
  return Boolean(
    localStorage.getItem(STORAGE_KEYS.accessToken) ||
      localStorage.getItem(STORAGE_KEYS.refreshToken)
  );
}

export function getOAuthState() {
  return localStorage.getItem(STORAGE_KEYS.state);
}

export function clearOAuthTemporaryData() {
  localStorage.removeItem(STORAGE_KEYS.state);
  localStorage.removeItem(STORAGE_KEYS.verifier);
}

export async function createSpotifyAuthorizationUrl() {
  const { clientId, redirectUri } = requireSpotifyConfig();
  const verifier = randomString(96);
  const state = randomString(32);
  const challenge = base64UrlEncode(await sha256(verifier));

  localStorage.setItem(STORAGE_KEYS.verifier, verifier);
  localStorage.setItem(STORAGE_KEYS.state, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SCOPES.join(" "),
    show_dialog: "true"
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode(code) {
  const { clientId, redirectUri } = requireSpotifyConfig();
  const verifier = localStorage.getItem(STORAGE_KEYS.verifier);

  if (!code) throw new Error("Código OAuth do Spotify ausente.");
  if (!verifier) throw new Error("Verificador PKCE não encontrado.");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  });

  const payload = readJsonSafely(await response.text());

  if (!response.ok) {
    throw new Error(spotifyErrorMessage(response.status, payload));
  }

  saveTokens(payload);
  return payload;
}

export async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const { clientId } = requireSpotifyConfig();
    const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);

    if (!refreshToken) {
      throw new Error("Refresh token ausente. Conecte o Spotify novamente.");
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    });

    const payload = readJsonSafely(await response.text());

    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        clearSpotifySession();
      }
      throw new Error(spotifyErrorMessage(response.status, payload));
    }

    saveTokens(payload);
    return payload.access_token;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function getValidAccessToken({ forceRefresh = false } = {}) {
  const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
  const expiresAt = Number(localStorage.getItem(STORAGE_KEYS.expiresAt) || 0);
  const expiresSoon = !expiresAt || Date.now() >= expiresAt - 60_000;

  if (!forceRefresh && accessToken && !expiresSoon) {
    return accessToken;
  }

  if (localStorage.getItem(STORAGE_KEYS.refreshToken)) {
    return refreshAccessToken();
  }

  if (accessToken && !forceRefresh) return accessToken;
  throw new Error("Spotify não conectado.");
}

// Espera o Retry-After antes de tentar de novo, uma vez. Antes o 429 era só
// propagado como erro na tela; com a quota do Spotify contada por conta de
// desenvolvedor (mudança de fev/2026), vale absorver o soluço curto.
// Acima desse teto não retentamos: tentar antes do prazo que o Spotify pediu
// só rende outro 429 e gasta quota à toa — melhor devolver o erro.
const MAX_RATE_LIMIT_WAIT_SECONDS = 8;

async function spotifyFetch(
  path,
  options = {},
  retryOnUnauthorized = true,
  retryOnRateLimit = true
) {
  const token = await getValidAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  if (response.status === 204) return null;

  const payload = readJsonSafely(await response.text());

  if (response.status === 401 && retryOnUnauthorized) {
    try {
      await getValidAccessToken({ forceRefresh: true });
      return spotifyFetch(path, options, false);
    } catch {
      clearSpotifySession();
      throw new Error("A sessão do Spotify expirou. Vincule sua conta novamente.");
    }
  }

  const retryAfter = Number(response.headers.get("Retry-After") || 0);

  if (
    response.status === 429 &&
    retryOnRateLimit &&
    retryAfter <= MAX_RATE_LIMIT_WAIT_SECONDS
  ) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter, 1) * 1000));
    return spotifyFetch(path, options, retryOnUnauthorized, false);
  }

  if (!response.ok) {
    const error = new Error(spotifyErrorMessage(response.status, payload));
    error.status = response.status;
    error.retryAfter = retryAfter;
    throw error;
  }

  return payload;
}

export function normalizeTrack(item) {
  if (!item) return null;

  if (item.type === "episode") {
    return {
      id: item.id,
      uri: item.uri,
      title: item.name || "Episódio",
      artist: item.show?.name || "Podcast",
      album: item.show?.publisher || "",
      durationMs: item.duration_ms || 0,
      cover: item.images?.[0]?.url || item.show?.images?.[0]?.url || null,
      externalUrl: item.external_urls?.spotify || null,
      type: "episode"
    };
  }

  return {
    id: item.id,
    uri: item.uri,
    title: item.name || "Faixa",
    artist: (item.artists || []).map((artist) => artist.name).join(", "),
    album: item.album?.name || "",
    durationMs: item.duration_ms || 0,
    cover: item.album?.images?.[0]?.url || null,
    externalUrl: item.external_urls?.spotify || null,
    type: "track"
  };
}

export function normalizePlayback(payload) {
  if (!payload?.item) return null;

  const track = normalizeTrack(payload.item);
  if (!track) return null;

  return {
    track,
    isPlaying: Boolean(payload.is_playing),
    positionMs: Math.max(0, Number(payload.progress_ms) || 0),
    durationMs: track.durationMs,
    changedAt: Date.now(),
    spotifyTimestamp: Number(payload.timestamp) || null,
    deviceName: payload.device?.name || "Spotify",
    deviceId: payload.device?.id || null,
    source: "spotify"
  };
}

function deviceQuery(deviceId) {
  return deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
}

// Cache curto do estado de reprodução.
//
// O host consulta a cada 2.5s (poll da sala) e a cada 20s (relatório de
// presença); o convidado consulta na correção de drift (15s) e também no
// relatório de presença. Esses timers se cruzam periodicamente e disparavam
// duas requisições idênticas com milissegundos de diferença. O dedupe de
// in-flight resolve o cruzamento e a janela de 1s resolve a repetição.
const PLAYBACK_CACHE_MS = 1000;
let playbackCache = { at: 0, value: null };
let playbackInFlight = null;

function invalidatePlaybackCache() {
  playbackCache = { at: 0, value: null };
}

// Toda escrita passa por aqui: depois de um play/pause/seek o estado anterior
// mente. Invalida antes e depois, porque uma leitura concorrente durante a
// requisição repopularia o cache com o estado pré-escrita.
function playbackWrite(path, options) {
  invalidatePlaybackCache();
  return spotifyFetch(path, options).finally(invalidatePlaybackCache);
}

async function readCurrentPlayback() {
  if (playbackInFlight) return playbackInFlight;
  if (Date.now() - playbackCache.at < PLAYBACK_CACHE_MS) return playbackCache.value;

  playbackInFlight = spotifyFetch("/me/player?additional_types=track,episode")
    .then((payload) => {
      const value = normalizePlayback(payload);
      playbackCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      playbackInFlight = null;
    });

  return playbackInFlight;
}

export const spotifyApi = {
  profile: () => spotifyFetch("/me"),

  devices: () => spotifyFetch("/me/player/devices"),

  currentPlayback: readCurrentPlayback,

  searchTracks: async (query, limit = 15) => {
    const params = new URLSearchParams({
      q: query,
      type: "track",
      limit: String(Math.min(Math.max(limit, 1), 10))
    });

    const payload = await spotifyFetch(`/search?${params.toString()}`);
    return (payload?.tracks?.items || []).map(normalizeTrack).filter(Boolean);
  },

  playTrack: ({ uri, positionMs = 0, deviceId }) =>
    playbackWrite(`/me/player/play${deviceQuery(deviceId)}`, {
      method: "PUT",
      body: JSON.stringify({
        uris: [uri],
        position_ms: Math.max(0, Math.floor(positionMs))
      })
    }),

  resume: ({ deviceId }) =>
    playbackWrite(`/me/player/play${deviceQuery(deviceId)}`, {
      method: "PUT",
      body: JSON.stringify({})
    }),

  pause: ({ deviceId }) =>
    playbackWrite(`/me/player/pause${deviceQuery(deviceId)}`, {
      method: "PUT"
    }),

  seek: ({ positionMs, deviceId }) => {
    const params = new URLSearchParams({
      position_ms: String(Math.max(0, Math.floor(positionMs)))
    });
    if (deviceId) params.set("device_id", deviceId);

    return playbackWrite(`/me/player/seek?${params.toString()}`, {
      method: "PUT"
    });
  },

  next: ({ deviceId }) =>
    playbackWrite(`/me/player/next${deviceQuery(deviceId)}`, {
      method: "POST"
    }),

  previous: ({ deviceId }) =>
    playbackWrite(`/me/player/previous${deviceQuery(deviceId)}`, {
      method: "POST"
    }),

  transfer: ({ deviceId, play = false }) =>
    playbackWrite("/me/player", {
      method: "PUT",
      body: JSON.stringify({
        device_ids: [deviceId],
        play
      })
    })
};
