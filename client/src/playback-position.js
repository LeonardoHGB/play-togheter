import { useSyncExternalStore } from "react";

// Store externo para a posição da faixa.
//
// Antes isso era um `useState` dentro do App(), atualizado a cada 250ms pelo
// tick da barra de progresso. Como o App() concentra a árvore inteira (painel
// de amigos, chat, fila, modais), cada tick re-renderizava tudo 4x por segundo.
// Agora o tick escreve aqui e só os componentes que assinam o store
// re-renderizam — o App() fica fora do caminho.

let positionMs = 0;
let seeking = false;
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Snapshot é um número (primitivo): o useSyncExternalStore compara por
// identidade, então devolver objeto aqui causaria re-render infinito.
function getSnapshot() {
  return positionMs;
}

export function set(next) {
  const value = Math.max(0, Math.floor(Number(next) || 0));
  if (value === positionMs) return;
  positionMs = value;
  for (const listener of listeners) listener();
}

export function read() {
  return positionMs;
}

// Enquanto o usuário arrasta o slider, o tick não pode sobrescrever a posição.
export function setSeeking(value) {
  seeking = Boolean(value);
}

export function isSeeking() {
  return seeking;
}

export function usePosition() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
