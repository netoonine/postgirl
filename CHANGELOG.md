# Changelog

Mudanças relevantes de cada versão. O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [0.2.1] - 2026-10-20

### Alterado
- O projeto mudou de nome: **Postgirl agora é Postwoman**. O repositório passou para `netoonine/postwoman` (o endereço antigo redireciona), o comando da CLI agora é `postwoman` e o app instala como `Postwoman.app`.

### Migração
- Coleções salvas pela versão anterior abrem normalmente (a extensão `postgirl` dos itens é convertida para `postwoman`).
- Configurações e a pasta de trabalho `~/Postgirl` continuam sendo usadas se existirem. Valores **secretos** guardados no Keychain pela versão anterior precisam ser preenchidos de novo (a chave do Keychain é por nome de app).
- Variáveis de ambiente dos testes: `POSTGIRL_*` agora é `POSTWOMAN_*`.

## [0.2.0] - 2026-10-20

### Adicionado
- CLI `postwoman` (`run`, `mock`, `list`) para rodar coleções no terminal e no CI, com relatórios JUnit e JSON.
- Mock server local que responde com os exemplos salvos de uma coleção (no app e na CLI).
- Busca rápida (⌘K / Ctrl+K) em requisições, coleções, ambientes e comandos.
- Proxy manual (HTTP/SOCKS, com autenticação e exceções), proxy do sistema, CA própria e certificados de cliente (mTLS).
- Valores secretos de ambientes e globais guardados no Keychain do sistema, fora dos arquivos da pasta de trabalho.
- Recarga automática quando arquivos da pasta de trabalho mudam por fora (git pull, editor).
- Builds para macOS (arm64/x64), Windows e Linux.
- Testes unitários e E2E, CI no GitHub Actions.

### Corrigido
- Proxy não era aplicado em URLs com porta explícita.

## [0.1.0] - 2026-10-14

Primeira versão: HTTP, GraphQL, coleções e ambientes no formato Postman v2.1, scripts `pm.*`, Runner, codegen, importação (Postman, OpenAPI, cURL), WebSocket, Socket.IO, MQTT e gRPC.
