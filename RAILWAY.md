# Deploy do servidor no Railway

Guia para subir o `server/` do Spotgino no [Railway](https://railway.app).
O build usa o `server/Dockerfile` (já pronto). A config está em `server/railway.json`.

## 1. Criar o projeto

1. No Railway: **New Project → Deploy from GitHub repo** e selecione este repositório.
2. Após criar o serviço, abra **Settings → Source** e defina:
   - **Root Directory**: `server`
   O Railway vai achar o `railway.json` e o `Dockerfile` dentro dessa pasta.

O `railway.json` já configura:
- Build via Dockerfile.
- Healthcheck em `GET /health`.
- Restart automático em falha.

## 2. Volume persistente (obrigatório)

Contas e amizades ficam num SQLite em disco. Sem volume, **tudo é apagado a cada deploy**.

1. No serviço: **Settings → Volumes → New Volume** (ou botão direito no serviço → *Attach Volume*).
2. **Mount path**: `/app/data`
   (bate com o `DB_FILE` padrão `/app/data/listen-together.db`).

## 3. Variáveis de ambiente

Em **Variables**, defina (veja `server/.env.example` para a lista completa):

| Variável | Valor | Observação |
|---|---|---|
| `HOST` | `0.0.0.0` | necessário para o proxy do Railway |
| `DB_FILE` | `/app/data/listen-together.db` | dentro do volume |
| `SERVER_NAME` | `Spotgino` | opcional |
| `ALLOWED_ORIGINS` | `*` | ou lista separada por vírgula |
| `MAX_ROOMS` | `500` | opcional |
| `MAX_MEMBERS_PER_ROOM` | `30` | opcional |
| `ROOM_IDLE_TTL_MS` | `21600000` | opcional (6h) |

> ⚠️ **NÃO** defina `PORT` no Railway. O Railway injeta o `PORT` sozinho e o app
> já lê `process.env.PORT`. Definir manualmente quebra o roteamento.

> ℹ️ **Permissão do volume:** o container roda como root, então grava no volume do
> Railway (montado como root) sem precisar de config extra. Se por algum motivo
> aparecer erro de permissão (`SQLITE_CANTOPEN`/`EACCES`), confirme que o volume
> está montado em `/app/data` e que o `DB_FILE` aponta pra dentro dele.

## 4. Domínio público

Em **Settings → Networking → Public Networking → Generate Domain**.
Vai gerar algo como `https://spotgino-server-production.up.railway.app`.

O Railway já serve por HTTPS e faz upgrade de WebSocket, então o Socket.IO
(`websocket` + `polling`) funciona sem config extra.

Confira: abra `https://SEU-DOMINIO/health` — deve retornar `{"status":"ok",...}`.

## 5. Apontar o client para o servidor

O app desktop conecta numa URL configurável. Duas formas:

- **No app**: tela de conexão → cole `https://SEU-DOMINIO` (sem `/health`, sem porta).
- **No build**: em `client/.env`, ajuste
  `VITE_DEFAULT_SERVER_URL=https://SEU-DOMINIO` antes de gerar o instalador.

## 6. Deploys seguintes

Cada push na branch conectada dispara um novo deploy. O volume persiste entre
deploys, então contas e amizades continuam.
