# Postgirl

Cliente de APIs desktop (macOS, Electron) compatível com coleções do Postman.

## Rodar

```bash
npm install
npx install-electron   # baixa o binário do Electron (o npm bloqueia install scripts)
npm run dev            # modo desenvolvimento
npm run dist           # gera dist/mac-arm64/Postgirl.app
```

## O que tem

- HTTP: params, path variables (`/users/:id`), headers, corpo (raw JSON/XML/HTML/texto, form-data com arquivos, urlencoded, binário, GraphQL)
- Autenticação: Basic, Bearer, API Key, JWT, Digest, OAuth 1.0, OAuth 2.0 (com "Obter token": authorization code, PKCE, implicit, password, client credentials), Hawk, AWS Signature, NTLM, Akamai EdgeGrid, com herança de pasta/coleção
- Scripts pré-requisição e pós-resposta com a API `pm.*` do Postman (testes, variáveis, `pm.sendRequest`, visualizer)
- Coleções, pastas, ambientes, variáveis globais e de coleção, `{{variaveis}}` destacadas e com autocompletar
- Runner com iterações, intervalo, arquivo de dados CSV/JSON e exportação dos resultados
- Geração de código (cURL, fetch, axios, Python, Go, Java, C#, PHP, Ruby, Swift e outros)
- Importação de coleções Postman v1/v2.0/v2.1, ambientes, backup completo do Postman, OpenAPI 3 / Swagger 2 e cURL (também colando cURL na barra de URL)
- WebSocket, Socket.IO, MQTT e gRPC (server reflection ou arquivo `.proto`, unário e streaming)
- Cookies persistentes, histórico, console, tema claro/escuro

## Onde ficam os dados

Tudo em arquivos na pasta de trabalho (padrão `~/Postgirl`, trocável em Configurações):

```
collections/<nome>-<id>.postman_collection.json   # formato Postman v2.1, abre no Postman
environments/<nome>-<id>.postman_environment.json
globals.postman_globals.json
cookies.json
history.json
```

A pasta pode ser versionada com git. Cuidado: valores de ambiente marcados como secretos são só mascarados na tela e ficam gravados nos arquivos.

## Arquitetura

- `src/main`: processo principal. `http.ts` executa requisições e o Runner com o `postman-runtime` (Apache-2.0), `realtime.ts` cuida de WebSocket/Socket.IO/MQTT/gRPC, `storage.ts` lê e grava a pasta de trabalho.
- `src/preload`: ponte IPC exposta como `window.api`.
- `src/renderer`: interface React. O estado fica em `store.ts` (zustand).
- `src/shared/types.ts`: tipos compartilhados (schema Postman Collection v2.1 + extensão `postgirl` para protocolos em tempo real).

A interface é código próprio. Do ecossistema Postman só são usadas as bibliotecas open source publicadas no npm (`postman-runtime`, `postman-collection`, `postman-code-generators`, `openapi-to-postmanv2`, `curl-to-postmanv2`, `postman-collection-transformer`).
