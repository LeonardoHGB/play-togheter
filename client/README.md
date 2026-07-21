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
VITE_DEFAULT_SERVER_URL=http://127.0.0.1:3333
```

No Spotify Developer Dashboard, cadastre exatamente:

```text
http://127.0.0.1:43821/callback
```

O Client ID é público e será incluído no build. Não coloque Client Secret no Electron.

## Desenvolvimento

Inicie o servidor local na raiz do projeto:

```bash
docker compose up --build
```

Em outro terminal:

```bash
cd client
npm install
npm run dev
```

## Gerar AppImage e DEB

```bash
cd client
npm install
npm run build:linux
```

Arquivos gerados:

```text
client/release/
```

## Configuração do servidor após instalar

O usuário abre o Electron e clica em **Configurar servidor**. O endereço fica salvo em:

```text
~/.config/Listen Together/config.json
```

Exemplo:

```json
{
  "serverUrl": "https://listen-api.seudominio.com"
}
```

O mesmo instalador pode ser enviado para todos. Cada usuário informa a mesma URL pública e entra pelo código da sala.
