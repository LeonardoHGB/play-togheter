import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "./socket";

// Hook que cuida da conta persistente, da lista de amigos, pedidos e convites.
// Toda a identidade vive no servidor (SQLite); o token fica salvo na config
// do Electron (idêntica em Windows e Linux).
export function useFriends({ socketConnected, displayName, onJoinRoom, notify }) {
  const [account, setAccount] = useState(null); // { userId, displayName }
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [invites, setInvites] = useState([]); // convites de sala recebidos

  const credsRef = useRef(null); // { userId, token }
  const displayNameRef = useRef(displayName);
  const loadedRef = useRef(false);

  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

  // Carrega as credenciais salvas uma única vez.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await window.electronAPI?.getAppConfig?.();
        if (!cancelled) credsRef.current = config?.account || null;
      } finally {
        if (!cancelled) loadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyState = useCallback((state) => {
    if (!state) return;
    if (state.self) setAccount(state.self);
    setFriends(state.friends || []);
    setIncoming(state.incoming || []);
    setOutgoing(state.outgoing || []);
  }, []);

  // Autentica (login ou registro) sempre que o socket conecta/reconecta.
  useEffect(() => {
    if (!socketConnected) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;

    const onState = (state) => applyState(state);
    const onPresence = ({ userId, online }) =>
      setFriends((prev) =>
        prev.map((friend) =>
          friend.userId === userId ? { ...friend, online } : friend
        )
      );
    const onInvite = (invite) =>
      setInvites((prev) => [
        ...prev.filter((item) => item.fromId !== invite.fromId),
        invite
      ]);

    socket.on("friend:state", onState);
    socket.on("friend:presence", onPresence);
    socket.on("invite:received", onInvite);

    // socket.timeout(): o callback vira (err, res) — err quando o servidor não
    // responde (ex.: versão antiga sem os handlers de amigos).
    const register = () =>
      socket.timeout(8000).emit(
        "account:register",
        { displayName: displayNameRef.current },
        async (err, res) => {
          if (err) {
            notify?.("Servidor sem suporte a amigos. Atualize o servidor.");
            return;
          }
          if (res?.ok) {
            credsRef.current = { userId: res.account.userId, token: res.account.token };
            await window.electronAPI?.saveAccount?.(res.account);
            applyState(res.state);
          }
        }
      );

    const authenticate = () => {
      const stored = credsRef.current;
      if (stored?.userId && stored?.token) {
        socket.timeout(8000).emit("account:login", stored, (err, res) => {
          if (err) {
            notify?.("Servidor sem suporte a amigos. Atualize o servidor.");
            return;
          }
          if (res?.ok) applyState(res.state);
          else register();
        });
      } else {
        register();
      }
    };

    // Espera as credenciais carregarem da config antes de autenticar.
    if (loadedRef.current) authenticate();
    else {
      const timer = setInterval(() => {
        if (loadedRef.current) {
          clearInterval(timer);
          authenticate();
        }
      }, 60);
      setTimeout(() => clearInterval(timer), 4000);
    }

    return () => {
      socket.off("friend:state", onState);
      socket.off("friend:presence", onPresence);
      socket.off("invite:received", onInvite);
    };
  }, [socketConnected, applyState]);

  const addFriend = useCallback(
    (code) =>
      new Promise((resolve) => {
        const socket = getSocket();
        if (!socket) {
          resolve({ ok: false });
          return;
        }
        socket
          .timeout(8000)
          .emit("friend:request", { code: String(code || "").trim().toUpperCase() }, (err, res) => {
            if (err) {
              notify?.("O servidor não respondeu. Ele foi atualizado?");
              resolve({ ok: false });
              return;
            }
            notify?.(res?.message || (res?.ok ? "Pedido enviado." : "Não foi possível."));
            resolve(res || { ok: false });
          });
      }),
    [notify]
  );

  const acceptFriend = useCallback((userId) => {
    getSocket()?.timeout(8000).emit("friend:accept", { userId }, () => {});
  }, []);

  const declineFriend = useCallback((userId) => {
    getSocket()?.timeout(8000).emit("friend:decline", { userId }, () => {});
  }, []);

  const removeFriend = useCallback((userId) => {
    getSocket()?.timeout(8000).emit("friend:remove", { userId }, () => {});
  }, []);

  const inviteFriend = useCallback(
    (userId, code) => {
      getSocket()
        ?.timeout(8000)
        .emit("invite:send", { userId, code }, (err, res) => {
          if (err) {
            notify?.("O servidor não respondeu ao convite.");
            return;
          }
          notify?.(res?.message || (res?.ok ? "Convite enviado." : "Não foi possível convidar."));
        });
    },
    [notify]
  );

  const acceptInvite = useCallback(
    (invite) => {
      setInvites((prev) => prev.filter((item) => item !== invite));
      onJoinRoom?.(invite.code);
    },
    [onJoinRoom]
  );

  const dismissInvite = useCallback((invite) => {
    setInvites((prev) => prev.filter((item) => item !== invite));
  }, []);

  return {
    account,
    friends,
    incoming,
    outgoing,
    invites,
    addFriend,
    acceptFriend,
    declineFriend,
    removeFriend,
    inviteFriend,
    acceptInvite,
    dismissInvite
  };
}

function Avatar({ name }) {
  return <div className="avatar">{(name || "?").slice(0, 1).toUpperCase()}</div>;
}

export function FriendsPanel({
  open,
  onClose,
  account,
  friends,
  incoming,
  outgoing,
  onAdd,
  onAccept,
  onDecline,
  onRemove,
  onInvite,
  inRoom,
  roomCode,
  notify
}) {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);

  if (!open) return null;

  async function submitAdd() {
    if (!code.trim() || sending) return;
    setSending(true);
    const res = await onAdd(code);
    setSending(false);
    if (res?.ok) setCode("");
  }

  function copyCode() {
    if (!account?.userId) return;
    navigator.clipboard?.writeText(account.userId);
    notify?.("Seu código foi copiado.");
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="settings-modal friends-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>Amigos</h2>
            <p>Adicione por código, gerencie pedidos e convide para a sala.</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="friend-code-card">
          <div>
            <span>Seu código de amigo</span>
            <strong>{account?.userId || "—"}</strong>
          </div>
          <button className="secondary-button" onClick={copyCode} disabled={!account?.userId}>
            Copiar
          </button>
        </div>

        <div className="friend-add-row">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Código do amigo (ex: A1B2C3D4)"
            maxLength={12}
            autoFocus
            spellCheck={false}
            onKeyDown={(event) => event.key === "Enter" && submitAdd()}
          />
          <button className="primary-button" onClick={submitAdd} disabled={sending || !code.trim()}>
            Adicionar
          </button>
        </div>

        {incoming.length > 0 && (
          <section className="friend-block">
            <div className="section-title">
              <span>Pedidos recebidos</span>
              <small>{incoming.length}</small>
            </div>
            {incoming.map((person) => (
              <div className="friend-row" key={person.userId}>
                <Avatar name={person.displayName} />
                <div className="friend-info">
                  <strong>{person.displayName}</strong>
                  <span>{person.userId}</span>
                </div>
                <div className="friend-actions">
                  <button className="mini-button accept" onClick={() => onAccept(person.userId)}>
                    Aceitar
                  </button>
                  <button className="mini-button" onClick={() => onDecline(person.userId)}>
                    Recusar
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="friend-block">
          <div className="section-title">
            <span>Amigos</span>
            <small>{friends.length}</small>
          </div>
          {friends.length === 0 ? (
            <p className="friend-empty">Nenhum amigo ainda. Compartilhe seu código acima.</p>
          ) : (
            friends.map((person) => (
              <div className="friend-row" key={person.userId}>
                <div className="avatar-wrap">
                  <Avatar name={person.displayName} />
                  <span className={`presence-dot ${person.online ? "online" : ""}`} />
                </div>
                <div className="friend-info">
                  <strong>{person.displayName}</strong>
                  <span>{person.online ? "Online" : "Offline"}</span>
                </div>
                <div className="friend-actions">
                  <button
                    className="mini-button accept"
                    disabled={!inRoom || !person.online}
                    title={
                      !inRoom
                        ? "Entre em uma sala para convidar"
                        : !person.online
                          ? "Amigo offline"
                          : "Convidar para a sala"
                    }
                    onClick={() => onInvite(person.userId, roomCode)}
                  >
                    Convidar
                  </button>
                  <button className="mini-button danger" onClick={() => onRemove(person.userId)}>
                    Remover
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        {outgoing.length > 0 && (
          <section className="friend-block">
            <div className="section-title">
              <span>Pedidos enviados</span>
              <small>{outgoing.length}</small>
            </div>
            {outgoing.map((person) => (
              <div className="friend-row" key={person.userId}>
                <Avatar name={person.displayName} />
                <div className="friend-info">
                  <strong>{person.displayName}</strong>
                  <span>Aguardando resposta</span>
                </div>
                <div className="friend-actions">
                  <button className="mini-button" onClick={() => onDecline(person.userId)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
      </section>
    </div>
  );
}

export function InviteToasts({ invites, onAccept, onDismiss }) {
  if (!invites?.length) return null;

  return (
    <div className="invite-toasts">
      {invites.map((invite) => (
        <div className="invite-toast" key={`${invite.fromId}-${invite.code}`}>
          <div className="invite-toast-body">
            <strong>{invite.fromName}</strong>
            <span>convidou você para a sala {invite.code}</span>
          </div>
          <div className="invite-toast-actions">
            <button className="mini-button accept" onClick={() => onAccept(invite)}>
              Entrar
            </button>
            <button className="mini-button" onClick={() => onDismiss(invite)}>
              Depois
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
