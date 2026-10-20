# Segurança

## Versões com correções

Só a versão mais recente recebe correções de segurança.

## Como reportar uma vulnerabilidade

**Não abra issue pública.** Use o aviso de segurança privado do GitHub:
[Report a vulnerability](https://github.com/netoonine/postwoman/security/advisories/new).

Inclua o que acontece, como reproduzir e o impacto que você enxerga. A resposta inicial vem em até 7 dias; a correção é combinada com você antes de qualquer divulgação.

## O que é relevante

- Execução de código fora do sandbox de scripts (`pm.*`) ou acesso do renderer a APIs do Node além de `window.api`.
- Vazamento de valores secretos (cofre em `secrets.json` / Keychain) para arquivos da pasta de trabalho, logs ou rede.
- Requisições enviadas sem ação do usuário, ou para hosts diferentes do configurado.
- Problemas no mock server que exponham a máquina na rede (ele escuta só em `127.0.0.1` por padrão).
