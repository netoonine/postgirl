# Como contribuir

Obrigado por querer ajudar! Este guia explica como montar o ambiente, como mandar uma mudança e como o código está organizado. Se travar em qualquer passo, abra uma issue ou pergunte nas [Discussions](https://github.com/netoonine/postgirl/discussions).

## Primeiros passos

1. Faça um **fork** do repositório no GitHub (botão _Fork_) e clone o seu fork:
   ```bash
   git clone https://github.com/SEU-USUARIO/postgirl.git
   cd postgirl
   git remote add upstream https://github.com/netoonine/postgirl.git
   ```
2. Instale e rode:
   ```bash
   npm install
   npm run dev
   ```
   Precisa de Node 22+. O `npm install` baixa o binário do Electron; se o app não abrir, rode `npx install-electron`.
3. Crie um branch para a sua mudança:
   ```bash
   git switch -c corrige-importacao-curl
   ```

## Escolhendo o que fazer

- Issues com [`good first issue`](https://github.com/netoonine/postgirl/labels/good%20first%20issue) são pequenas e boas para começar.
- [`help wanted`](https://github.com/netoonine/postgirl/labels/help%20wanted) são maiores e ainda sem dono.
- Para algo grande (feature nova, mudança de formato de arquivo, dependência nova), **abra uma issue antes** e combine a abordagem. Isso evita trabalho jogado fora.
- Comente na issue que você vai pegar, para ninguém duplicar.

## Antes de abrir o PR

```bash
npm run typecheck
npm test
npm run format
npm run build && npm run test:e2e   # se mexeu na interface
```

O CI roda tudo isso em todo PR. Checklist:

- [ ] A mudança tem teste (unitário em `test/unit` ou E2E em `test/e2e`) quando dá para testar.
- [ ] Textos da interface em **português do Brasil**, no mesmo tom do resto (direto, sem jargão).
- [ ] Nada de copiar código, textos, ícones ou layout do app do Postman. Bibliotecas open source do ecossistema Postman publicadas no npm podem ser usadas.
- [ ] Coleções e ambientes continuam compatíveis com o schema Postman v2.1 (o Postman precisa conseguir abrir o arquivo).
- [ ] Se mudou comportamento visível, atualize o README e adicione uma linha em `CHANGELOG.md` na seção _Não lançado_.

## Mandando o PR

1. Commits pequenos e com mensagem que explique o porquê. Pode ser em português ou inglês. Sugestão de formato: `tipo: descrição` (`feat: mock server responde HEAD`, `fix: proxy ignora porta`, `docs: …`, `test: …`, `refactor: …`).
2. `git push origin seu-branch` e abra o PR contra `main` do repositório principal.
3. Preencha o template do PR. Prints ou GIFs ajudam muito em mudanças de interface.
4. Alguém revisa; ajustes pedidos são normais. Quando aprovado, o PR entra com _squash merge_.

Para manter o fork atualizado: `git fetch upstream && git rebase upstream/main`.

## Como o código está organizado

| Pasta | O que tem | Pode usar Electron? |
| --- | --- | --- |
| `src/core` | motor de execução (`engine.ts`, sobre o `postman-runtime`), mock server, importador, codegen, utilitários de coleção | **não**: roda no app e na CLI |
| `src/cli` | CLI `postgirl` (`run`, `mock`, `list`) e relatórios JUnit/JSON | não |
| `src/main` | processo principal: janela, menu, IPC (`index.ts`), pasta de trabalho (`storage.ts`), cofre de segredos (`secrets.ts`), observador de arquivos (`watcher.ts`), WebSocket/Socket.IO/MQTT/gRPC (`realtime.ts`), OAuth 2 | sim |
| `src/preload` | ponte IPC exposta como `window.api` | sim (só `contextBridge`) |
| `src/renderer` | interface React; estado global em `store.ts` (zustand); componentes em `components/` | não (só via `window.api`) |
| `src/shared` | tipos e funções puras usados em todo lugar | não |
| `test/unit` | testes vitest do core e da CLI | |
| `test/e2e` | testes Playwright que abrem o app de verdade | |
| `test/server.mjs` | servidor HTTP/WebSocket local usado pelos testes | |

Fluxo de uma requisição: a interface (`store.ts › sendTab`) monta uma coleção com o rascunho da aba e chama `window.api.send`. O processo principal (`main/http.ts`) monta o contexto (configurações de rede, cookies, proxy do sistema) e chama `core/engine.ts › sendRequest`, que roda o `postman-runtime` e devolve resposta, testes, console e variáveis alteradas pelos scripts.

Para adicionar uma chamada nova entre interface e processo principal:

1. registre o `ipcMain.handle('area:acao', …)` em `src/main/index.ts`;
2. exponha em `src/preload/index.ts`;
3. tipe em `src/renderer/src/api.ts`.

### Formato dos arquivos

O formato salvo é o **Postman Collection v2.1**. Protocolos que o schema não cobre (WebSocket, MQTT, gRPC, Socket.IO) usam o campo extra `postgirl: { protocol, config }` no item; o Postman ignora esse campo. "Herdar autenticação do pai" é gravado como ausência do campo `auth`, igual ao Postman.

## Testes

- `npm test`: unitários. Rápidos, rodam um servidor de teste local, sem internet.
- `npm run test:e2e`: abre o Electron com uma pasta de dados temporária (`POSTGIRL_USER_DATA`) e o Keychain desligado (`POSTGIRL_DISABLE_KEYCHAIN=1`). Precisa de `npm run build` antes. Para guardar screenshots: `E2E_SCREENSHOTS=./shots npm run test:e2e`.
- `npm run test:server`: sobe o servidor de teste na porta 4555 para testar na mão (`/get`, `/post`, `/status/404`, `/delay/1000`, `/cookies/set?a=1`, `/bearer`, `/users/:id`, WebSocket em `/ws`).

## Gerando o instalador

`npm run dist` gera o instalador do seu sistema em `dist/`. As releases oficiais são geradas pelo GitHub Actions quando uma tag `v*` é publicada (veja `.github/workflows/release.yml`).

## Reportando bugs e segurança

- Bugs: abra uma [issue](https://github.com/netoonine/postgirl/issues/new/choose) com passos para reproduzir.
- Vulnerabilidades: **não** abra issue pública; veja [SECURITY.md](SECURITY.md).

## Licença das contribuições

O projeto é [MIT](LICENSE). Ao mandar um PR, você concorda que a sua contribuição seja distribuída sob a mesma licença. Você continua sendo autor do que escreveu; o histórico do git registra isso.

## Código de conduta

Seja gentil e construtivo. Leia o [código de conduta](CODE_OF_CONDUCT.md).
