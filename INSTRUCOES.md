# Instruções rápidas — Listen Together

## Parte 1 — subir o servidor no Portainer

### Sem domínio, para primeiro teste

1. Coloque este projeto em um repositório Git.
2. No Portainer, acesse **Stacks → Add stack → Git Repository**.
3. Informe a URL do repositório.
4. Use como Compose path:

```text
portainer-stack.yml
```

5. Adicione as variáveis:

```env
SERVER_NAME=Listen Together
PUBLIC_PORT=3333
ALLOWED_ORIGINS=*
MAX_ROOMS=500
MAX_MEMBERS_PER_ROOM=30
ROOM_IDLE_TTL_MS=21600000
```

6. Faça o deploy.
7. Libere a porta `3333/TCP` no firewall.
8. Teste:

```bash
curl http://IP_DO_SERVIDOR:3333/health
```

A URL usada no Electron será:

```text
http://IP_DO_SERVIDOR:3333
```

### Com domínio e HTTPS automático

1. Aponte o domínio para o IP do servidor.
2. Libere as portas `80/TCP`, `443/TCP` e `443/UDP`.
3. No Portainer, use:

```text
portainer-stack-caddy.yml
```

4. Configure:

```env
DOMAIN=listen-api.seudominio.com
SERVER_NAME=Listen Together
ALLOWED_ORIGINS=*
MAX_ROOMS=500
MAX_MEMBERS_PER_ROOM=30
ROOM_IDLE_TTL_MS=21600000
```

5. No Electron, use:

```text
https://listen-api.seudominio.com
```

## Parte 2 — configurar o Spotify

No Spotify Developer Dashboard:

1. Crie um aplicativo.
2. Copie o Client ID.
3. Cadastre exatamente:

```text
http://127.0.0.1:43821/callback
```

4. Adicione as contas dos amigos em **Users and Access**, enquanto o aplicativo estiver em Development Mode.

## Parte 3 — gerar o Electron

```bash
cd client
cp .env.example .env
```

Edite `.env`:

```env
VITE_SPOTIFY_CLIENT_ID=SEU_CLIENT_ID
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:43821/callback
VITE_DEFAULT_SERVER_URL=https://listen-api.seudominio.com
```

Instale e gere:

```bash
npm install
npm run build:linux
```

Os arquivos serão criados em:

```text
client/release/
```

## Parte 4 — instalar e conectar os amigos

1. Envie o `.AppImage` ou `.deb` para cada amigo.
2. A pessoa abre o aplicativo.
3. Clica em **Configurar servidor**.
4. Digita a mesma URL pública.
5. Clica em **Testar conexão**.
6. Clica em **Salvar e conectar**.
7. Vincula a própria conta Spotify.
8. Digita o código da sala criado pelo host.
9. Ativa **Sincronizar meu Spotify com o host**.

## Testar o AppImage

```bash
chmod +x Listen-Together-3.0.0-x86_64.AppImage
./Listen-Together-3.0.0-x86_64.AppImage
```

O nome pode variar conforme arquitetura e versão.

## Onde fica a configuração do Electron

```text
~/.config/Listen Together/config.json
```

Não é necessário gerar um instalador diferente para cada servidor. A URL pode ser alterada dentro do aplicativo.
