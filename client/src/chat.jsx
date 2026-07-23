import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";
import { AttachButton, ChatAttachment, uploadFile } from "./media";

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Gerencia as conversas privadas: histórico por amigo, não-lidas e a conversa
// aberta. As mensagens chegam por "dm:message" (tanto as recebidas quanto o eco
// das que eu enviei em outros dispositivos) e são deduplicadas por id.
export function usePrivateChat({ socketConnected, account, notify }) {
  const [conversations, setConversations] = useState({}); // userId -> messages[]
  const [unread, setUnread] = useState({}); // userId -> count
  const [openWith, setOpenWith] = useState(null); // userId | null
  const [loadingHistory, setLoadingHistory] = useState(false);

  const myId = account?.userId || null;
  const myIdRef = useRef(myId);
  const openWithRef = useRef(openWith);
  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);
  useEffect(() => {
    openWithRef.current = openWith;
  }, [openWith]);

  // Troca de conta (login/logout): zera tudo.
  useEffect(() => {
    setConversations({});
    setUnread({});
    setOpenWith(null);
  }, [myId]);

  const appendMessage = useCallback((other, message) => {
    setConversations((prev) => {
      const list = prev[other] || [];
      if (list.some((item) => item.id === message.id)) return prev;
      return { ...prev, [other]: [...list, message] };
    });
  }, []);

  useEffect(() => {
    if (!socketConnected) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;

    const onMessage = ({ message, fromName }) => {
      if (!message?.id) return;
      const mine = message.fromId === myIdRef.current;
      const other = mine ? message.toId : message.fromId;
      appendMessage(other, message);
      if (mine) return;
      if (openWithRef.current === other) {
        socket.emit("dm:read", { userId: other });
      } else {
        setUnread((prev) => ({ ...prev, [other]: (prev[other] || 0) + 1 }));
        notify?.(`Nova mensagem de ${fromName || "um amigo"}.`);
      }
    };

    // Semente de não-lidas vinda do banco (inclui mensagens recebidas enquanto
    // eu estava offline). É a fonte autoritativa; substitui o mapa local.
    const onState = (state) => {
      if (!Array.isArray(state?.dmUnread)) return;
      const map = {};
      for (const row of state.dmUnread) map[row.userId] = row.count;
      setUnread(map);
    };

    socket.on("dm:message", onMessage);
    socket.on("friend:state", onState);
    return () => {
      socket.off("dm:message", onMessage);
      socket.off("friend:state", onState);
    };
  }, [socketConnected, appendMessage, notify]);

  // Semente inicial de não-lidas no login/reconexão: o estado inicial chega pelo
  // ACK do login (não pelo evento friend:state), então buscamos via friend:list.
  useEffect(() => {
    if (!socketConnected || !myId) return;
    const socket = getSocket();
    if (!socket) return;
    socket.timeout(8000).emit("friend:list", {}, (err, res) => {
      if (err || !res?.ok || !Array.isArray(res.state?.dmUnread)) return;
      const map = {};
      for (const row of res.state.dmUnread) map[row.userId] = row.count;
      setUnread(map);
    });
  }, [socketConnected, myId]);

  const openConversation = useCallback(
    (userId) => {
      const other = String(userId || "").toUpperCase();
      setOpenWith(other);
      setUnread((prev) => (prev[other] ? { ...prev, [other]: 0 } : prev));

      const socket = getSocket();
      if (!socket) return;
      setLoadingHistory(true);
      socket.timeout(8000).emit("dm:history", { userId: other }, (err, res) => {
        setLoadingHistory(false);
        if (err) {
          notify?.("Não foi possível carregar a conversa.");
          return;
        }
        if (res?.ok) {
          setConversations((prev) => ({ ...prev, [other]: res.messages || [] }));
        } else {
          notify?.(res?.message || "Não foi possível abrir a conversa.");
        }
      });
    },
    [notify]
  );

  const closeConversation = useCallback(() => setOpenWith(null), []);

  const sendMessage = useCallback(
    (toUserId, payload) =>
      new Promise((resolve) => {
        const socket = getSocket();
        if (!socket) {
          resolve({ ok: false });
          return;
        }
        socket.timeout(10000).emit(
          "dm:send",
          { toUserId, body: payload.body, attachment: payload.attachment },
          (err, res) => {
            if (err) {
              notify?.("O servidor não respondeu.");
              resolve({ ok: false });
              return;
            }
            if (!res?.ok) notify?.(res?.message || "Não foi possível enviar.");
            resolve(res || { ok: false });
          }
        );
      }),
    [notify]
  );

  const totalUnread = Object.values(unread).reduce((sum, n) => sum + n, 0);

  return {
    conversations,
    unread,
    totalUnread,
    openWith,
    loadingHistory,
    openConversation,
    closeConversation,
    sendMessage
  };
}

// Visão de conversa 1-a-1 (bolhas), com envio de texto e anexos.
export function PrivateChat({ friend, messages, myId, loading, onBack, onSend, creds, notify }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    const box = endRef.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages?.length, loading]);

  async function submit(event) {
    event?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const res = await onSend({ body });
    setBusy(false);
    if (res?.ok) setText("");
  }

  async function pickFile(file) {
    setBusy(true);
    try {
      const attachment = await uploadFile(file, creds);
      await onSend({ attachment });
    } catch (error) {
      notify?.(error.message || "Falha ao enviar o arquivo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="private-chat">
      <div className="private-chat-head">
        <button type="button" className="pc-back" onClick={onBack} aria-label="Voltar">
          ‹
        </button>
        <div className="avatar-wrap">
          {friend.avatarUrl ? (
            <img className="avatar" src={friend.avatarUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <div className="avatar">{(friend.displayName || "?").slice(0, 1).toUpperCase()}</div>
          )}
          <span className={`presence-dot ${friend.online ? "online" : ""}`} />
        </div>
        <div className="pc-head-info">
          <strong>{friend.displayName}</strong>
          <span>{friend.online ? "Online" : "Offline"}</span>
        </div>
      </div>

      <div className="pc-messages">
        {loading && <div className="empty-chat">Carregando conversa...</div>}
        {!loading && (!messages || messages.length === 0) && (
          <div className="empty-chat">Nenhuma mensagem ainda. Diga oi! 👋</div>
        )}
        {(messages || []).map((message) => (
          <div
            key={message.id}
            className={`pc-bubble ${message.fromId === myId ? "mine" : ""}`}
          >
            {message.attachment && <ChatAttachment attachment={message.attachment} />}
            {message.body && <p>{message.body}</p>}
            <time>{formatTime(message.createdAt)}</time>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="pc-form" onSubmit={submit}>
        <AttachButton onPick={pickFile} busy={busy} />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`Mensagem para ${friend.displayName}...`}
          maxLength={2000}
        />
        <button disabled={busy}>➤</button>
      </form>
    </div>
  );
}
