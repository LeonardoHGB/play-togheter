# Instruções rápidas — Spotgino

## Parte 1 — subir o servidor

No servidor Linux (SSH), com Docker + Compose V2:

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

Libere a porta `3333/TCP` no firewall. A URL dos aplicativos será:

```text
http://IP_DO_SERVIDOR:3333
```

Para atualizar depois:

```bash
cd /opt/play-togheter
git pull
docker compose -f portainer-stack.yml up -d --build --remove-orphans
```

> O `--remove-orphans` remove o container antigo `listen-together-server` (o serviço foi renomeado para `spotgino-server` no rebrand). Sem ele, o container velho continua ocupando a porta 3333.

> As contas e amizades ficam no volume Docker `listen_together_data` — não apague esse volume.

## Parte 2 — configurar o Spotify

No Spotify Developer Dashboard:

1. Crie um aplicativo.
2. Copie o Client ID.
3. Cadastre exatamente este Redirect URI (é o loopback local do app, igual para todo mundo — não é o IP do servidor):

```text
http://127.0.0.1:43821/callback
```

4. Em **Settings → User Management**, adicione o e-mail da conta Spotify de cada amigo (obrigatório em Development Mode — não existe curinga `*`).
5. Todos precisam de **Spotify Premium**.

## Parte 3 — gerar os aplicativos

```bash
cd client
cp .env.example .env
```

Edite o `.env`:

```env
VITE_SPOTIFY_CLIENT_ID=SEU_CLIENT_ID
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:43821/callback
VITE_DEFAULT_SERVER_URL=http://IP_DO_SERVIDOR:3333
```

Instale e gere:

```bash
npm install
npm run build:win     # no Windows: instalador + portátil
npm run build:linux   # no Linux: AppImage + deb
```

Para gerar o Linux no próprio servidor (sem Node instalado no host):

```bash
docker run --rm -v /opt/play-togheter/client:/project -w /project \
  electronuserland/builder:latest \
  bash -c "npm install --no-audit --no-fund && npm run build:linux"
```

Os arquivos ficam em `client/release/`.

## Parte 4 — instalar e conectar os amigos

1. Envie o executável para cada amigo (`.exe` no Windows, `.AppImage`/`.deb` no Linux).
2. A pessoa abre o aplicativo, clica em **Configurar servidor**, digita a URL, testa e salva.
3. Vincula a própria conta Spotify.
4. Abre **Amigos**, copia o próprio código e troca com os amigos para se adicionarem.
5. O host cria a sala e clica em **Convidar** nos amigos online (ou compartilha o código da sala).
6. Cada convidado ativa **Sincronizar meu Spotify com o host**.

## Onde fica a configuração do aplicativo

```text
Windows: %APPDATA%\Spotgino\config.json
Linux:   ~/.config/Spotgino/config.json
```

O mesmo arquivo (mesmo formato) guarda a URL do servidor e a conta de amigo. Não é necessário gerar um instalador diferente para cada servidor — a URL pode ser trocada dentro do aplicativo.
