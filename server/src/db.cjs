const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

// Alfabeto sem caracteres ambíguos (0/O, 1/I/L) para o código de amigo.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

let db = null;

function init(dbFile) {
  const resolved = path.resolve(dbFile);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      user_id      TEXT PRIMARY KEY,
      token_hash   TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friendships (
      owner_id   TEXT NOT NULL,
      friend_id  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      from_id    TEXT NOT NULL,
      to_id      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (from_id, to_id)
    );

    CREATE TABLE IF NOT EXISTS private_messages (
      id         TEXT PRIMARY KEY,
      from_id    TEXT NOT NULL,
      to_id      TEXT NOT NULL,
      body       TEXT,
      attachment TEXT,
      created_at INTEGER NOT NULL,
      read_at    INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_friendships_owner ON friendships(owner_id);
    CREATE INDEX IF NOT EXISTS idx_requests_to ON friend_requests(to_id);
    CREATE INDEX IF NOT EXISTS idx_requests_from ON friend_requests(from_id);
    CREATE INDEX IF NOT EXISTS idx_pm_pair ON private_messages(from_id, to_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pm_unread ON private_messages(to_id, read_at);
  `);

  // Migração: identidade vinda do Spotify (contas antigas ficam com NULL).
  const columns = db.prepare("PRAGMA table_info(accounts)").all().map((c) => c.name);
  if (!columns.includes("spotify_id")) {
    db.exec("ALTER TABLE accounts ADD COLUMN spotify_id TEXT");
  }
  if (!columns.includes("avatar_url")) {
    db.exec("ALTER TABLE accounts ADD COLUMN avatar_url TEXT");
  }
  // NULLs são distintos no índice UNIQUE do SQLite, então contas anônimas
  // (spotify_id NULL) convivem; só bloqueia dois spotify_id iguais.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_spotify ON accounts(spotify_id)"
  );

  return db;
}

function requireDb() {
  if (!db) throw new Error("Banco não inicializado. Chame init() antes.");
  return db;
}

// --- Contas -------------------------------------------------------------

function createAccount(displayName) {
  const database = requireDb();
  const name = String(displayName || "").trim().slice(0, 60) || "Usuário";
  const token = crypto.randomBytes(24).toString("hex");
  const tokenHash = hashToken(token);

  let userId = generateCode();
  const exists = database.prepare("SELECT 1 FROM accounts WHERE user_id = ?");
  while (exists.get(userId)) userId = generateCode();

  database
    .prepare(
      "INSERT INTO accounts (user_id, token_hash, display_name, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(userId, tokenHash, name, Date.now());

  return { userId, token, displayName: name };
}

// Cria ou atualiza a conta ligada a um usuário do Spotify. A identidade
// (spotify_id) é a chave estável: o mesmo usuário sempre recai na mesma conta,
// preservando código de amigo e amizades. Emite um novo token de sessão.
function upsertSpotifyAccount({ spotifyId, displayName, avatarUrl }) {
  const database = requireDb();
  const id = String(spotifyId || "").trim();
  if (!id) throw new Error("spotifyId ausente.");

  const name = String(displayName || "").trim().slice(0, 60) || "Usuário";
  const avatar = typeof avatarUrl === "string" ? avatarUrl.slice(0, 1000) : null;
  const token = crypto.randomBytes(24).toString("hex");
  const tokenHash = hashToken(token);

  const existing = database
    .prepare("SELECT user_id FROM accounts WHERE spotify_id = ?")
    .get(id);

  if (existing) {
    database
      .prepare(
        "UPDATE accounts SET token_hash = ?, display_name = ?, avatar_url = ? WHERE user_id = ?"
      )
      .run(tokenHash, name, avatar, existing.user_id);
    return { userId: existing.user_id, token, displayName: name, avatarUrl: avatar };
  }

  let userId = generateCode();
  const exists = database.prepare("SELECT 1 FROM accounts WHERE user_id = ?");
  while (exists.get(userId)) userId = generateCode();

  database
    .prepare(
      "INSERT INTO accounts (user_id, token_hash, display_name, created_at, spotify_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(userId, tokenHash, name, Date.now(), id, avatar);

  return { userId, token, displayName: name, avatarUrl: avatar };
}

function verifyAccount(userId, token) {
  if (!userId || !token) return null;
  const account = requireDb()
    .prepare("SELECT user_id, token_hash, display_name FROM accounts WHERE user_id = ?")
    .get(String(userId).toUpperCase());
  if (!account) return null;

  const provided = Buffer.from(hashToken(token));
  const stored = Buffer.from(account.token_hash);
  if (provided.length !== stored.length || !crypto.timingSafeEqual(provided, stored)) {
    return null;
  }

  return { userId: account.user_id, displayName: account.display_name };
}

function getAccount(userId) {
  if (!userId) return null;
  const account = requireDb()
    .prepare("SELECT user_id, display_name, avatar_url FROM accounts WHERE user_id = ?")
    .get(String(userId).toUpperCase());
  return account
    ? {
        userId: account.user_id,
        displayName: account.display_name,
        avatarUrl: account.avatar_url || null
      }
    : null;
}

function updateDisplayName(userId, displayName) {
  const name = String(displayName || "").trim().slice(0, 60) || "Usuário";
  requireDb()
    .prepare("UPDATE accounts SET display_name = ? WHERE user_id = ?")
    .run(name, userId);
  return name;
}

// --- Amizades -----------------------------------------------------------

function areFriends(a, b) {
  return Boolean(
    requireDb()
      .prepare("SELECT 1 FROM friendships WHERE owner_id = ? AND friend_id = ?")
      .get(a, b)
  );
}

function hasRequest(fromId, toId) {
  return Boolean(
    requireDb()
      .prepare("SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?")
      .get(fromId, toId)
  );
}

function createRequest(fromId, toId) {
  requireDb()
    .prepare(
      "INSERT OR IGNORE INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)"
    )
    .run(fromId, toId, Date.now());
}

function deleteRequest(fromId, toId) {
  requireDb()
    .prepare("DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?")
    .run(fromId, toId);
}

function acceptRequest(fromId, toId) {
  const database = requireDb();
  const run = database.transaction((from, to) => {
    const now = Date.now();
    database
      .prepare("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)")
      .run(from, to, to, from);
    const insert = database.prepare(
      "INSERT OR IGNORE INTO friendships (owner_id, friend_id, created_at) VALUES (?, ?, ?)"
    );
    insert.run(from, to, now);
    insert.run(to, from, now);
  });
  run(fromId, toId);
}

function removeFriendship(a, b) {
  const database = requireDb();
  const run = database.transaction(() => {
    database
      .prepare("DELETE FROM friendships WHERE (owner_id = ? AND friend_id = ?) OR (owner_id = ? AND friend_id = ?)")
      .run(a, b, b, a);
    database
      .prepare("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)")
      .run(a, b, b, a);
  });
  run();
}

function listFriends(userId) {
  return requireDb()
    .prepare(
      `SELECT a.user_id AS userId, a.display_name AS displayName, a.avatar_url AS avatarUrl
       FROM friendships f
       JOIN accounts a ON a.user_id = f.friend_id
       WHERE f.owner_id = ?
       ORDER BY a.display_name COLLATE NOCASE`
    )
    .all(userId);
}

function listIncomingRequests(userId) {
  return requireDb()
    .prepare(
      `SELECT a.user_id AS userId, a.display_name AS displayName, a.avatar_url AS avatarUrl, r.created_at AS createdAt
       FROM friend_requests r
       JOIN accounts a ON a.user_id = r.from_id
       WHERE r.to_id = ?
       ORDER BY r.created_at DESC`
    )
    .all(userId);
}

function listOutgoingRequests(userId) {
  return requireDb()
    .prepare(
      `SELECT a.user_id AS userId, a.display_name AS displayName, a.avatar_url AS avatarUrl, r.created_at AS createdAt
       FROM friend_requests r
       JOIN accounts a ON a.user_id = r.to_id
       WHERE r.from_id = ?
       ORDER BY r.created_at DESC`
    )
    .all(userId);
}

// --- Mensagens privadas -------------------------------------------------

function rowToMessage(row) {
  if (!row) return null;
  let attachment = null;
  if (row.attachment) {
    try {
      attachment = JSON.parse(row.attachment);
    } catch {
      attachment = null;
    }
  }
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    body: row.body || "",
    attachment,
    createdAt: row.created_at,
    readAt: row.read_at || null
  };
}

function insertPrivateMessage({ id, fromId, toId, body, attachment }) {
  requireDb()
    .prepare(
      "INSERT INTO private_messages (id, from_id, to_id, body, attachment, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, NULL)"
    )
    .run(
      id,
      fromId,
      toId,
      body || null,
      attachment ? JSON.stringify(attachment) : null,
      Date.now()
    );
  return rowToMessage({
    id,
    from_id: fromId,
    to_id: toId,
    body,
    attachment: attachment ? JSON.stringify(attachment) : null,
    created_at: Date.now(),
    read_at: null
  });
}

// Últimas `limit` mensagens trocadas entre dois usuários (ordem cronológica).
function listConversation(a, b, limit = 100) {
  const rows = requireDb()
    .prepare(
      `SELECT * FROM private_messages
       WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(a, b, b, a, Math.max(1, Math.min(500, limit)));
  return rows.reverse().map(rowToMessage);
}

// Marca como lidas as mensagens que `userId` recebeu de `otherId`.
function markConversationRead(userId, otherId) {
  return requireDb()
    .prepare(
      "UPDATE private_messages SET read_at = ? WHERE to_id = ? AND from_id = ? AND read_at IS NULL"
    )
    .run(Date.now(), userId, otherId).changes;
}

// Não-lidas por remetente: [{ userId, count }].
function unreadCounts(userId) {
  return requireDb()
    .prepare(
      `SELECT from_id AS userId, COUNT(*) AS count
       FROM private_messages
       WHERE to_id = ? AND read_at IS NULL
       GROUP BY from_id`
    )
    .all(userId);
}

module.exports = {
  init,
  createAccount,
  upsertSpotifyAccount,
  verifyAccount,
  getAccount,
  updateDisplayName,
  areFriends,
  hasRequest,
  createRequest,
  deleteRequest,
  acceptRequest,
  removeFriendship,
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
  insertPrivateMessage,
  listConversation,
  markConversationRead,
  unreadCounts
};
