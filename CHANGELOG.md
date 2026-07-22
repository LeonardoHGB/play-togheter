# Changelog

Todas as mudanças relevantes do Spotgino são registradas aqui. O formato segue
o Keep a Changelog e o projeto usa versionamento semântico.

## [3.1.0] - 2026-07-21

### Adicionado

- Login por identidade do Spotify: ao vincular a conta, o nome e a foto do
  perfil passam a identificar o usuário no app.
- Vínculo da conta ao `spotify_id` no servidor, de forma que o mesmo usuário
  sempre recai na mesma conta, preservando o código de amigo e as amizades
  salvas entre sessões.
- Novo evento de socket `account:spotify`, que valida o access token direto no
  endpoint `/me` do Spotify antes de criar ou atualizar a conta.
- Foto e nome da conta na lista de amigos, nos pedidos e na lista de
  participantes da sala.
- Deploy no Railway: `server/railway.json`, `server/.env.example` e o guia
  `RAILWAY.md` com o passo a passo (Root Directory, volume e domínio).
- Easter egg no logo: duplo clique faz o logo girar com um leve pop de escala, e
  o hover aplica um destaque suave. Respeita `prefers-reduced-motion`.
- README renovado com banner animado, resumo com efeito de digitação e badges da
  stack.
- Login obrigatório: a tela inicial exige entrar com o Spotify (botão) no lugar
  do nome digitado. Sem estar logado não é possível criar nem entrar em salas.
- Bloqueio por versão: o servidor recusa clientes cuja versão seja diferente da
  dele (a versão vai no handshake do socket).

### Alterado

- O dispositivo de reprodução padrão do Spotify passa a preferir o computador
  (Spotify Desktop) quando disponível, e o seletor manual de dispositivo foi
  removido da interface.
- Sem Spotify e sem sessão salva, o app não cria mais conta anônima automática;
  o servidor também passa a exigir conta autenticada para criar ou entrar em salas.
- O nome usado ao criar ou entrar em salas passa a vir da conta logada.
- Migração automática do banco: colunas `spotify_id` e `avatar_url` são
  adicionadas à tabela `accounts` sem quebrar contas antigas.

### Removido

- Instrução `VOLUME` do `Dockerfile`, incompatível com o Railway. A persistência
  continua pelo volume do Docker (Portainer) ou pelo Railway Volume em produção.

## [3.0.0]

- Rebrand para Spotgino: logo novo, mini player com chat lateral e notificações.
- Backend Node.js e Socket.IO separado do Electron, pronto para Docker.
- Contas persistentes com código de amigo, aba de amigos e convites de sala.
- Builds para Windows (instalador e portátil) e Linux (AppImage e deb).
