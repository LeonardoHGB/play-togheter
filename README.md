# Listen Together v3 — Electron + Spotify + Portainer

Projeto completo para criar salas sincronizadas usando Spotify Connect.

## O que esta versão resolve

- Backend separado do Electron.
- Servidor pronto para Docker e Portainer.
- URL do servidor configurável dentro do aplicativo instalado.
- Configuração persistente sem recompilar o Electron.
- Teste do endpoint `/health` pela tela de configuração.
- Suporte a domínio HTTPS e WebSocket.
- Stack para build pelo Git, Stack com imagem GHCR e Stack com Caddy.
- OAuth Spotify PKCE com callback local.
- Renovação automática do access token.
- Busca de músicas.
- Leitura automática do que o host está ouvindo no Spotify.
- Sincronização de play, pause, faixa e posição com os convidados.
- Chat, fila e modo demonstração.

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
               │ HTTPS + Socket.IO
               ▼
┌─────────────────────────────┐
│ Docker / Portainer          │
│                             │
│ Node.js + Express           │
│ Socket.IO                   │
│ Salas, fila e chat          │
└─────────────────────────────┘
```

O servidor não recebe nem retransmite áudio. Cada usuário reproduz diretamente pelo Spotify.

## Estrutura

```text
listen-together-portainer/
├── client/                         # Electron + React
│   ├── electron/
│   ├── src/
│   ├── .env.example
│   ├── package.json
│   └── README.md
├── server/                         # Node.js + Socket.IO
│   ├── src/index.cjs
│   ├── Dockerfile
│   └── package.json
├── deploy/
│   ├── stack-portainer-build.yml
│   ├── stack-portainer-image.yml
│   ├── stack-portainer-caddy.yml
│   ├── Caddyfile
│   ├── .env.server.example
│   └── PORTAINER.md
├── .github/workflows/
│   └── publish-server-image.yml
├── docker-compose.yml
└── package.json
```

## Testar localmente

### 1. Configurar o cliente

```bash
cd client
cp .env.example .env
```

Edite o `.env` e informe seu Spotify Client ID.

### 2. Instalar dependências

Na raiz:

```bash
npm install
```

### 3. Iniciar o servidor

Com Node.js:

```bash
npm run dev:server
```

Ou com Docker:

```bash
docker compose up --build
```

Health check:

```bash
curl http://127.0.0.1:3333/health
```

### 4. Iniciar Electron

Em outro terminal:

```bash
npm run dev:client
```

Na tela inicial, a URL padrão será:

```text
http://127.0.0.1:3333
```

## Subir no Portainer

As instruções completas estão em:

```text
deploy/PORTAINER.md
```

Caminho recomendado para começar:

1. Suba o projeto em um GitHub ou GitLab.
2. No Portainer, crie uma Stack por Git Repository.
3. Informe o Compose path `portainer-stack.yml`.
4. Publique a porta `3333` ou configure proxy reverso.
5. No Electron, abra **Configurar servidor**.
6. Informe `https://listen-api.seudominio.com`.
7. Clique em **Testar conexão** e depois **Salvar e conectar**.

## Gerar o Electron para distribuir

```bash
cd client
cp .env.example .env
# Edite o Spotify Client ID
npm install
npm run build:linux
```

Os instaladores serão criados em:

```text
client/release/
```

Você poderá enviar o mesmo `.AppImage` ou `.deb` para seus amigos. Eles não precisam editar `.env`: basta abrir o aplicativo e configurar a URL pública do servidor.

## Fluxo do usuário

1. Instala ou executa o Electron.
2. Configura a URL pública do servidor.
3. Vincula a própria conta Spotify.
4. O host cria a sala.
5. Compartilha o código.
6. Os convidados entram usando o mesmo servidor.
7. Cada convidado ativa **Sincronizar meu Spotify com o host**.

## Spotify Dashboard

Configure:

```text
Redirect URI: http://127.0.0.1:43821/callback
```

Todas as contas usadas nos testes precisam estar liberadas no aplicativo do Spotify quando ele estiver em modo de desenvolvimento.

Cada participante precisa:

- vincular a própria conta;
- ter um dispositivo Spotify disponível;
- ter Premium para comandos de reprodução pela Web API.

## Produção e segurança

Antes de abrir o serviço ao público:

- use domínio com HTTPS;
- não exponha Client Secret no Electron;
- limite `ALLOWED_ORIGINS` quando possível;
- coloque autenticação e limites por IP no backend;
- use Redis ao executar múltiplas réplicas;
- adicione PostgreSQL caso queira usuários, histórico e persistência de salas;
- valide as políticas do Spotify antes de monetizar.

## Comandos úteis

```bash
# Verificar sintaxe e build
npm run check

# Servidor em desenvolvimento
npm run dev:server

# Electron em desenvolvimento
npm run dev:client

# Build do frontend
npm run build:client

# Build dos instaladores Linux
cd client && npm run build:linux
```
