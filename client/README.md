# Cliente Electron

## Configurar Spotify

Copie:

```bash
cp .env.example .env
```

Edite:

```env
VITE_SPOTIFY_CLIENT_ID=SEU_CLIENT_ID
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:43821/callback
VITE_DEFAULT_SERVER_URL=http://IP_DO_SERVIDOR:3333
```

No Spotify Developer Dashboard, cadastre exatamente:

```text
http://127.0.0.1:43821/callback
```

O Client ID é público e será incluído no build. Não coloque Client Secret no Electron.

## Desenvolvimento

Inicie o servidor na raiz do projeto:

```bash
npm run dev:server
# ou com Docker:
docker compose -f portainer-stack.yml up -d --build
```

Em outro terminal:

```bash
cd client
npm install
npm run dev
```

## Gerar executáveis

```bash
cd client
npm install
npm run build:win     # Windows: instalador NSIS + portátil
npm run build:linux   # Linux: AppImage + deb
```

Arquivos gerados em:

```text
client/release/
```

## Configuração após instalar

O usuário abre o aplicativo e clica em **Configurar servidor**. A configuração fica salva em:

```text
Windows: %APPDATA%\Spotgino\config.json
Linux:   ~/.config/Spotgino/config.json
```

Exemplo:

```json
{
  "version": 2,
  "serverUrl": "http://192.168.230.217:3333",
  "account": { "userId": "A1B2C3D4", "token": "...", "displayName": "João" }
}
```

O mesmo instalador pode ser enviado para todos. Cada usuário informa a mesma URL do servidor; a conta de amigo é criada automaticamente no primeiro uso.
