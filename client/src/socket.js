import { io } from "socket.io-client";

// Injetada pelo Vite (define). Fallback vazio evita ReferenceError fora do build.
const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

let activeSocket = null;
let activeServerUrl = "";

export function normalizeServerUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");

  if (!raw) {
    throw new Error("Informe a URL do servidor.");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL inválida. Exemplo: http://192.168.230.217:3333");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("A URL deve começar com http:// ou https://.");
  }

  return parsed.toString().replace(/\/$/, "");
}

export function configureSocket(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl);

  if (activeSocket && activeServerUrl === normalized) {
    return activeSocket;
  }

  activeSocket?.removeAllListeners();
  activeSocket?.disconnect();

  activeServerUrl = normalized;
  activeSocket = io(normalized, {
    autoConnect: false,
    auth: { version: APP_VERSION },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 10000
  });

  return activeSocket;
}

export function getSocket() {
  return activeSocket;
}

export function getServerUrl() {
  return activeServerUrl;
}

export function disconnectSocket() {
  activeSocket?.removeAllListeners();
  activeSocket?.disconnect();
  activeSocket = null;
  activeServerUrl = "";
}
