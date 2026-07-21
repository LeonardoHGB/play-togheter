# Spotgino v3 — Electron + Spotify + Docker

Salas sincronizadas usando Spotify Connect. O host toca; os amigos ouvem juntos, cada um na própria conta Spotify.

## O que esta versão faz

- Backend Node.js + Socket.IO separado do Electron, pronto para Docker.
- URL do servidor configurável dentro do aplicativo instalado (sem recompilar).
- OAuth Spotify PKCE com callback local e renovação automática de token.
- Leitura automática do que o host está ouvindo e sincronização de play, pause, faixa e posição.
- Busca de músicas, chat, fila e modo demonstração.
- **Contas persistentes com código de amigo** (SQLite no servidor).
- **Aba de Amigos**: adicionar por código, aceitar/recusar pedidos, ver quem está online.
- **Convites de sala**: convide um amigo online e ele entra com um clique.
- **Mini player**: janela compacta sempre visível, com chat lateral e notificações de mensagens.
- Builds para **Windows** (instalador + portátil) e **Linux** (AppImage + deb).

## Arquitetura

```text
┌─────────────────────────────┐
│ Electron instalado          │
│                             │
│ React                       │
│ OAuth Spotify local         │
│ Token individual do usuário │
│ Controle Spotify Connect    │
└──────────────┬──────────────┘
               │ HTTP + Socket.IO (IP:porta)
               ▼
┌─────────────────────────────┐
│ Docker (servidor Linux)     │
│                             │
│ Node.js + Express           │
│ Socket.IO                   │
│ Salas, fila e chat (memória)│
│ Contas e amigos (SQLite)    │
└─────────────────────────────┘
```

O servidor não recebe nem retransmite áudio. Cada usuário reproduz diretamente pelo Spotify.

## Estrutura

```text
play-togheter/
├── client/                    # Electron + React
│   ├── electron/              #   main.cjs, preload.cjs
│   ├── src/                   #   App.jsx, friends.jsx, spotify.js, socket.js
│   ├── .env.example
│   └── package.json
├── server/                    # Node.js + Socket.IO
│   ├── src/index.cjs          #   API, salas, contas, amigos, convites
│   ├── src/db.cjs             #   SQLite (better-sqlite3)
│   ├── Dockerfile             #   node:22-slim
│   └── package.json
├── portainer-stack.yml        # Stack única de produção (com volume do banco)
└── package.json               # Scripts de desenvolvimento
```

## Subir o servidor (produção)

No servidor Linux (com Docker + Compose V2):

```bash
cd /opt
git clone <URL_DO_REPOSITORIO> play-togheter
cd play-togheter
docker compose -f portainer-stack.yml up -d --build
```

Teste:

```bash
curl http://127.0.0.1:3333/health
```

Libere a porta `3333/TCP` no firewall. A URL usada nos aplicativos será `http://IP_DO_SERVIDOR:3333`.

> Também funciona pelo Portainer: **Stacks → Add stack → Git Repository**, Compose path `portainer-stack.yml`.

### Atualizar o servidor

```bash
cd /opt/play-togheter
git pull
docker compose -f portainer-stack.yml up -d --build --remove-orphans
```

(O `--remove-orphans` limpa o container antigo `listen-together-server`, substituído pelo `spotgino-server` no rebrand.)

### Persistência

Contas e amizades ficam no volume Docker `listen_together_data` (SQLite). **Não apague esse volume** — ele sobrevive a rebuilds e reinícios. Salas, filas e chats são em memória e zeram quando o container reinicia. Use uma única réplica.

### Variáveis do servidor

| Variável | Padrão | Descrição |
|---|---:|---|
| `PORT` | `3333` | Porta interna do Node.js. |
| `HOST` | `0.0.0.0` | Interface de rede. |
| `PUBLIC_PORT` | `3333` | Porta publicada no host. |
| `SERVER_NAME` | `Spotgino` | Nome mostrado no health check. |
| `ALLOWED_ORIGINS` | `*` | Lista separada por vírgulas. |
| `MAX_ROOMS` | `500` | Limite de salas simultâneas. |
| `MAX_MEMBERS_PER_ROOM` | `30` | Limite de participantes por sala. |
| `ROOM_IDLE_TTL_MS` | `21600000` | Tempo máximo de sala ociosa (ms). |
| `DB_FILE` | `/app/data/listen-together.db` | Caminho do banco SQLite. |

## Testar localmente

```bash
npm run install:all
npm run dev:server    # servidor em http://127.0.0.1:3333
npm run dev:client    # Electron em outro terminal
```

Rodando o servidor fora do Docker, o banco é criado em `server/data/` (ignorado pelo Git).

## Configurar o Spotify

No [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):

1. Crie um aplicativo e copie o **Client ID**.
2. Cadastre o Redirect URI **exatamente**: `http://127.0.0.1:43821/callback`
   (é o loopback local do app em cada máquina — **não** é o IP do servidor).
3. Em **Settings → User Management**, adicione o e-mail da conta Spotify de **cada** pessoa (obrigatório em Development Mode; não existe curinga).
4. Todos precisam de **Spotify Premium** para os comandos de reprodução.

## Gerar os aplicativos

Configure antes:

```bash
cd client
cp .env.example .env   # preencha o VITE_SPOTIFY_CLIENT_ID
npm install
```

**Windows** (nesta máquina Windows):

```bash
npm run build:win
```

**Linux** (no servidor, via Docker — não precisa de Node no host):

```bash
docker run --rm -v /opt/play-togheter/client:/project -w /project \
  electronuserland/builder:latest \
  bash -c "npm install --no-audit --no-fund && npm run build:linux"
```

Os arquivos saem em `client/release/`: `Spotgino-Setup-<versão>-x64.exe` (instalador), `Spotgino-Portable-<versão>-x64.exe` (portátil), `Spotgino-<versão>-x86_64.AppImage` e `Spotgino-<versão>-amd64.deb`.

O mesmo executável serve para todos: cada pessoa configura a URL do servidor dentro do app (fica salva em `%APPDATA%\Spotgino\config.json` no Windows e `~/.config/Spotgino/config.json` no Linux — mesmo formato nos dois).

## Fluxo do usuário

1. Instala o aplicativo e configura a URL do servidor (**Configurar servidor → Testar → Salvar**).
2. Vincula a própria conta Spotify.
3. Abre **Amigos**, copia seu código e adiciona os amigos pelo código deles.
4. O host cria a sala e **convida os amigos online** (ou compartilha o código da sala).
5. Cada convidado ativa **Sincronizar meu Spotify com o host**.

## Produção e segurança

- O tráfego é HTTP em rede local. Para expor na internet, adicione HTTPS (proxy reverso) e restrinja `ALLOWED_ORIGINS`.
- Não exponha Client Secret no Electron (o fluxo PKCE não usa secret).
- Para múltiplas réplicas seriam necessários Redis + adapter do Socket.IO.

## Limitações conhecidas

- Quem tinha o app antigo **Listen Together** instalado deve desinstalá-lo — o Spotgino instala em paralelo (identidade nova) e a config é migrada automaticamente no primeiro uso.
- No Linux sob **Wayland** (GNOME padrão), o compositor ignora "sempre visível": o mini player funciona, mas pode ficar atrás de outras janelas. Em X11 funciona normalmente.
- No Linux, as **notificações** são mais confiáveis pelo pacote **`.deb`** (registra o atalho `.desktop`, dando nome e ícone). No **AppImage** elas ainda aparecem, mas o clique para focar pode não funcionar em alguns ambientes — o contador de mensagens não lidas cobre esse caso.
- No build **portátil** do Windows, as notificações toast podem não aparecer (limitação do Windows para apps sem instalação); o contador de mensagens não lidas cobre esse caso. O instalador não tem essa limitação.

## Comandos úteis

```bash
npm run check          # sintaxe do servidor + build do cliente
npm run dev:server     # servidor em desenvolvimento
npm run dev:client     # Electron em desenvolvimento
npm run build:win      # instalador + portátil Windows
npm run build:linux    # AppImage + deb Linux
```
