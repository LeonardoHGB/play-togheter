# Deploy do servidor no Portainer

O Electron é instalado nos computadores dos usuários. O Portainer executa apenas o backend Node.js/Socket.IO.

## Arquitetura

```text
Electron do usuário 1 ─┐
Electron do usuário 2 ─┼── HTTPS / Socket.IO ── servidor no Portainer
Electron do usuário 3 ─┘
```

O áudio não passa pelo servidor. Cada pessoa reproduz diretamente na própria conta Spotify.

## Opção A — Portainer usando repositório Git

Essa opção faz o próprio servidor Docker construir a imagem.

1. Publique este projeto em um repositório Git.
2. No Portainer, abra **Stacks → Add stack**.
3. Escolha **Git Repository**.
4. Informe a URL do repositório.
5. Em **Compose path**, informe:

```text
portainer-stack.yml
```

6. Adicione as variáveis:

```env
SERVER_NAME=Listen Together
PUBLIC_PORT=3333
ALLOWED_ORIGINS=*
MAX_ROOMS=500
MAX_MEMBERS_PER_ROOM=30
ROOM_IDLE_TTL_MS=21600000
```

7. Clique em **Deploy the stack**.

Teste:

```bash
curl http://IP_DO_SERVIDOR:3333/health
```

## Opção B — GHCR + Portainer

O projeto inclui o workflow:

```text
.github/workflows/publish-server-image.yml
```

Ao enviar a branch `main` para o GitHub, ele publica:

```text
ghcr.io/SEU_USUARIO/listen-together-server:latest
```

Antes de usar a stack, edite:

```text
deploy/stack-portainer-image.yml
```

Troque:

```yaml
image: ghcr.io/SEU_USUARIO/listen-together-server:latest
```

Depois crie uma Stack no Portainer usando esse arquivo.

Caso o pacote esteja privado, cadastre o GHCR em **Registries** no Portainer.

## Opção C — domínio e HTTPS automático com Caddy

Requisitos:

- domínio apontando para o IP público do servidor;
- portas TCP 80 e 443 liberadas;
- porta UDP 443 recomendada;
- nenhuma outra aplicação usando essas portas.

No Portainer, use:

```text
portainer-stack-caddy.yml
```

Adicione:

```env
DOMAIN=listen-api.seudominio.com
SERVER_NAME=Listen Together
ALLOWED_ORIGINS=*
MAX_ROOMS=500
MAX_MEMBERS_PER_ROOM=30
ROOM_IDLE_TTL_MS=21600000
```

O endereço configurado no Electron será:

```text
https://listen-api.seudominio.com
```

O Caddy encaminha WebSocket automaticamente para o container Node.js.

## Nginx Proxy Manager

Caso já use Nginx Proxy Manager:

1. Publique o container na porta `3333`.
2. Crie um Proxy Host para o domínio.
3. Encaminhe para o IP ou nome do container e porta `3333`.
4. Ative **Websockets Support**.
5. Gere o certificado SSL.
6. Use no Electron `https://seu-dominio`.

## Variáveis do servidor

| Variável | Padrão | Descrição |
|---|---:|---|
| `PORT` | `3333` | Porta interna do Node.js. |
| `HOST` | `0.0.0.0` | Interface de rede. |
| `SERVER_NAME` | `Listen Together` | Nome mostrado no health check. |
| `ALLOWED_ORIGINS` | `*` | Lista separada por vírgulas. |
| `MAX_ROOMS` | `500` | Limite de salas simultâneas. |
| `MAX_MEMBERS_PER_ROOM` | `30` | Limite de participantes por sala. |
| `ROOM_IDLE_TTL_MS` | `21600000` | Tempo máximo de sala ociosa, em milissegundos. |

Para o Electron empacotado, requisições podem chegar sem origem HTTP tradicional. O servidor permite origem ausente e `null`. Para o primeiro teste, mantenha `ALLOWED_ORIGINS=*`.

## Atualizar o servidor

Com Stack baseada em Git:

1. Envie as alterações para o repositório.
2. Abra a Stack no Portainer.
3. Clique em **Pull and redeploy**.

Com imagem GHCR:

1. Publique a nova imagem.
2. No Portainer, ative **Re-pull image**.
3. Faça o redeploy.

## Limitação atual

As salas ficam em memória. Ao reiniciar o container, salas, filas e chats ativos são apagados. Uma única réplica deve ser usada nesta versão. Para escalar horizontalmente, adicione Redis e um adapter do Socket.IO.
