<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:1DB954,100:191414&height=210&section=header&text=Spotgino&fontSize=80&fontColor=ffffff&fontAlignY=34&desc=Salas%20sincronizadas%20com%20Spotify%20Connect&descAlignY=56&descSize=20&animation=fadeIn" width="100%" alt="Spotgino" />

<img src="https://readme-typing-svg.demolab.com?font=Poppins&weight=600&size=22&pause=1000&color=1DB954&center=true&vCenter=true&width=640&lines=O+host+toca%2C+os+amigos+ouvem+juntos;Cada+um+na+sua+pr%C3%B3pria+conta+Spotify;Electron+%2B+React+%2B+Socket.IO+%2B+SQLite;Windows%2C+Linux%2C+Docker+e+Railway" alt="Resumo animado" />

<br />
<br />

![Electron](https://img.shields.io/badge/Electron-2B2E3A?style=for-the-badge&logo=electron&logoColor=9FEAF9)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Spotify](https://img.shields.io/badge/Spotify-1DB954?style=for-the-badge&logo=spotify&logoColor=white)

<br />

<a href="#o-que-esta-versao-faz">Funcionalidades</a>
&nbsp;&bull;&nbsp;
<a href="#arquitetura">Arquitetura</a>
&nbsp;&bull;&nbsp;
<a href="#subir-o-servidor">Servidor</a>
&nbsp;&bull;&nbsp;
<a href="#configurar-o-spotify">Spotify</a>
&nbsp;&bull;&nbsp;
<a href="#gerar-os-aplicativos">Builds</a>

</div>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:1DB954,100:191414&height=3&width=100%25&section=header" width="100%" alt="" />

Salas sincronizadas usando Spotify Connect. O host toca; os amigos ouvem juntos, cada um na própria conta Spotify. O servidor nunca recebe nem retransmite áudio: ele apenas coordena as salas, e cada pessoa reproduz direto pelo Spotify.

<h2 id="o-que-esta-versao-faz">O que esta versão faz</h2>

- Backend Node.js e Socket.IO separado do Electron, pronto para Docker e Railway.
- URL do servidor configurável dentro do aplicativo instalado, sem recompilar.
- OAuth Spotify PKCE com callback local e renovação automática de token.
- Leitura automática do que o host está ouvindo e sincronização de play, pause, faixa e posição.
- Busca de músicas, chat, fila e modo demonstração.
- **Contas persistentes com código de amigo** guardadas em SQLite no servidor.
- **Aba de amigos**: adicionar por código, aceitar ou recusar pedidos, ver quem está online.
- **Convites de sala**: convide um amigo online e ele entra com um clique.
- **Mini player**: janela compacta sempre visível, com chat lateral e notificações de mensagens.
- Builds para **Windows** (instalador e portátil) e **Linux** (AppImage e deb).

<h2 id="arquitetura">Arquitetura</h2>

```text
┌─────────────────────────────┐
│ Electron instalado          │
│                             │
│ React                       │
│ OAuth Spotify local         │
│ Token individual do usuario │
│ Controle Spotify Connect    │
└──────────────┬──────────────┘
               │ HTTP + Socket.IO (IP:porta)
               ▼
┌─────────────────────────────┐
│ Servidor (Docker / Railway) │
│                             │
│ Node.js + Express           │
│ Socket.IO                   │
│ Salas, fila e chat (memoria)│
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
│   ├── railway.json           #   deploy no Railway
│   └── package.json
├── portainer-stack.yml        # Stack unica de producao (com volume do banco)
├── RAILWAY.md                 # Guia de deploy no Railway
└── package.json               # Scripts de desenvolvimento
```

<h2 id="subir-o-servidor">Subir o servidor</h2>

### Opção 1: Railway (recomendado)

Deploy gerenciado com HTTPS e WebSocket prontos. O passo a passo completo está em [RAILWAY.md](RAILWAY.md). Em resumo: crie o projeto a partir deste repositório, defina a Root Directory como `server`, anexe um volume em `/app/data` e gere o domínio público.

### Opção 2: Docker no seu servidor

No servidor Linux (com Docker e Compose V2):

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

> Também funciona pelo Portainer: **Stacks, Add stack, Git Repository**, com Compose path `portainer-stack.yml`.

### Atualizar o servidor (Docker)

```bash
cd /opt/play-togheter
git pull
docker compose -f portainer-stack.yml up -d --build --remove-orphans
```

O `--remove-orphans` limpa o container antigo `listen-together-server`, substituído pelo `spotgino-server` no rebrand.

### Persistência

Contas e amizades ficam no volume `listen_together_data` (SQLite). Não apague esse volume: ele sobrevive a rebuilds e reinícios. Salas, filas e chats são em memória e zeram quando o container reinicia. Use uma única réplica.

### Variáveis do servidor

| Variável | Padrão | Descrição |
|---|---:|---|
| `PORT` | `3333` | Porta interna do Node.js. No Railway é injetada automaticamente. |
| `HOST` | `0.0.0.0` | Interface de rede. |
| `PUBLIC_PORT` | `3333` | Porta publicada no host (Docker). |
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

<h2 id="configurar-o-spotify">Configurar o Spotify</h2>

No [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):

1. Crie um aplicativo e copie o **Client ID**.
2. Cadastre o Redirect URI **exatamente** assim: `http://127.0.0.1:43821/callback` (é o loopback local do app em cada máquina, não é o IP do servidor).
3. Em **Settings, User Management**, adicione o e-mail da conta Spotify de **cada** pessoa (obrigatório em Development Mode; não existe curinga).
4. Todos precisam de **Spotify Premium** para os comandos de reprodução.

<h2 id="gerar-os-aplicativos">Gerar os aplicativos</h2>

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

**Linux** (no servidor, via Docker, sem precisar de Node no host):

```bash
docker run --rm -v /opt/play-togheter/client:/project -w /project \
  electronuserland/builder:latest \
  bash -c "npm install --no-audit --no-fund && npm run build:linux"
```

Os arquivos saem em `client/release/`: `Spotgino-Setup-<versao>-x64.exe` (instalador), `Spotgino-<versao>-x86_64.AppImage` e `Spotgino-<versao>-amd64.deb`.

### Publicando uma release (atenção ao auto-update)

A partir da 3.4.0 o app se atualiza sozinho pelo `electron-updater`, e ele lê os **metadados** da release para descobrir que existe versão nova. Publicar só os binários faz o auto-update parar de funcionar **em silêncio** — ninguém recebe erro, simplesmente nada acontece.

A release precisa ter **6 arquivos**:

| Arquivo | Para quê |
| --- | --- |
| `Spotgino-Setup-<versao>-x64.exe` | instalador Windows |
| `Spotgino-Setup-<versao>-x64.exe.blockmap` | permite baixar só a diferença entre versões |
| `latest.yml` | **metadados do updater no Windows** |
| `Spotgino-<versao>-amd64.deb` | pacote Debian/Ubuntu |
| `Spotgino-<versao>-x86_64.AppImage` | AppImage |
| `latest-linux.yml` | **metadados do updater no Linux** |

Os alvos de build ficam em `build.win.target` / `build.linux.target` no `package.json`. **Não** passe alvos na linha de comando (`electron-builder --win nsis portable`): o argumento sobrescreve a config e volta a gerar o portátil, que não tem como se auto-atualizar.

O mesmo executável serve para todos: cada pessoa configura a URL do servidor dentro do app (fica salva em `%APPDATA%\Spotgino\config.json` no Windows e `~/.config/Spotgino/config.json` no Linux, mesmo formato nos dois).

## Fluxo do usuário

1. Instala o aplicativo e configura a URL do servidor (**Configurar servidor, Testar, Salvar**).
2. Vincula a própria conta Spotify.
3. Abre **Amigos**, copia seu código e adiciona os amigos pelo código deles.
4. O host cria a sala e **convida os amigos online** (ou compartilha o código da sala).
5. Cada convidado ativa **Sincronizar meu Spotify com o host**.

## Produção e segurança

- No Railway o tráfego já é HTTPS. Em rede local via Docker o tráfego é HTTP; para expor na internet, adicione HTTPS (proxy reverso) e restrinja `ALLOWED_ORIGINS`.
- Não exponha Client Secret no Electron (o fluxo PKCE não usa secret).
- Para múltiplas réplicas seriam necessários Redis e o adapter do Socket.IO.

## Limitações conhecidas

- Quem tinha o app antigo **Listen Together** instalado deve desinstalá-lo. O Spotgino instala em paralelo (identidade nova) e a config é migrada automaticamente no primeiro uso.
- No Linux sob **Wayland** (GNOME padrão), o compositor ignora "sempre visível": o mini player funciona, mas pode ficar atrás de outras janelas. Em X11 funciona normalmente.
- No Linux, as **notificações** são mais confiáveis pelo pacote **`.deb`** (registra o atalho `.desktop`, dando nome e ícone). No **AppImage** elas ainda aparecem, mas o clique para focar pode não funcionar em alguns ambientes; o contador de mensagens não lidas cobre esse caso.
- No build **portátil** do Windows, as notificações toast podem não aparecer (limitação do Windows para apps sem instalação); o contador de mensagens não lidas cobre esse caso. O instalador não tem essa limitação.

## Comandos úteis

```bash
npm run check          # sintaxe do servidor + build do cliente
npm run dev:server     # servidor em desenvolvimento
npm run dev:client     # Electron em desenvolvimento
npm run build:win      # instalador + portatil Windows
npm run build:linux    # AppImage + deb Linux
```

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:191414,100:1DB954&height=120&section=footer" width="100%" alt="" />
