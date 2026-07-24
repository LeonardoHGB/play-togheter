import { useEffect, useRef } from "react";
import * as clock from "./playback-position";
import logo from "./assets/logo.png";

// Dimensões da janela em modo mini (a janela é redimensionada pelo processo
// main via IPC — mesmos valores para Windows e Linux).
export const MINI_SIZE = { width: 420, height: 196 };
export const MINI_CHAT_SIZE = { width: 760, height: 420 };

function formatTime(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

// Isolada do MiniPlayer para que o tick de 250ms não re-renderize o mini chat
// junto com a barra (mesmo motivo do ProgressRow no App).
function MiniProgress({ durationMs }) {
  const position = clock.usePosition();
  const progress = durationMs > 0 ? Math.min(1, position / durationMs) : 0;

  return (
    <div className="mini-progress">
      <span>{formatTime(position)}</span>
      <div className="mini-progress-bar">
        <div className="mini-progress-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>
      <span>{formatTime(durationMs)}</span>
    </div>
  );
}

export default function MiniPlayer({
  room,
  track,
  isHost,
  spotifyBusy,
  chatOpen,
  unread,
  chatMessage,
  onChatMessageChange,
  onToggleChat,
  onTogglePlay,
  onNext,
  onSendMessage,
  onExpand
}) {
  const playback = room?.playback;
  const durationMs = playback?.durationMs || track?.durationMs || 0;
  const messages = room?.messages || [];
  const chatEndRef = useRef(null);
  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;

  useEffect(() => {
    if (!chatOpen) return;
    const box = chatEndRef.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [chatOpen, lastMessageId]);

  return (
    <main className={`mini-shell ${chatOpen ? "with-chat" : ""}`}>
      <section className="mini-player">
        <div className="mini-top">
          <img className="mini-cover" src={track?.cover || logo} alt="" />
          <div className="mini-track">
            <strong title={track?.title}>{track?.title || "Nada tocando"}</strong>
            <span title={track?.artist}>{track?.artist || "Spotgino"}</span>
            <small>Sala {room?.code} · {room?.members?.length || 1} ouvindo</small>
          </div>
          <div className="mini-actions">
            <button
              className="mini-icon-button"
              title={chatOpen ? "Fechar chat" : "Abrir chat"}
              onClick={onToggleChat}
            >
              💬
              {unread > 0 && <span className="mini-badge">{unread > 9 ? "9+" : unread}</span>}
            </button>
            <button className="mini-icon-button" title="Voltar ao tamanho normal" onClick={onExpand}>
              ⤢
            </button>
          </div>
        </div>

        <MiniProgress durationMs={durationMs} />

        {isHost ? (
          <div className="mini-controls">
            <button
              className="mini-play-button"
              onClick={onTogglePlay}
              disabled={spotifyBusy}
              title={playback?.isPlaying ? "Pausar" : "Tocar"}
            >
              {playback?.isPlaying ? "⏸" : "▶"}
            </button>
            <button
              className="mini-icon-button"
              onClick={onNext}
              disabled={spotifyBusy}
              title="Próxima"
            >
              ⏭
            </button>
          </div>
        ) : (
          <div className="mini-follow">
            <span className={`status-dot ${playback?.isPlaying ? "online" : ""}`} />
            {playback?.isPlaying ? "Tocando com o host" : "Pausado pelo host"}
          </div>
        )}
      </section>

      {chatOpen && (
        <section className="mini-chat">
          <div className="mini-chat-messages">
            {messages.length === 0 ? (
              <p className="mini-chat-empty">Nenhuma mensagem ainda.</p>
            ) : (
              messages.map((message) => (
                <div className="mini-chat-message" key={message.id}>
                  <strong>{message.author}</strong>
                  <span>{message.message}</span>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <form className="chat-form mini-chat-form" onSubmit={onSendMessage}>
            <input
              value={chatMessage}
              onChange={(event) => onChatMessageChange(event.target.value)}
              placeholder="Digite uma mensagem..."
              autoFocus
            />
            <button>➤</button>
          </form>
        </section>
      )}
    </main>
  );
}
