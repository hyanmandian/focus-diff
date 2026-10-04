# Store listing

The text for the Chrome Web Store and Firefox Add-ons (AMO) listings, in English and Brazilian Portuguese. Images are in `store/`: `icon-128-store.png` for the Chrome icon, `screenshots/store-1280x800-{light,dark}.png` for the screenshots.

## Shared fields

| Field | Value |
| --- | --- |
| Name | Focus Diff |
| Category | Chrome: Developer Tools · AMO: Web Development |
| Homepage | https://focus-diff.com |
| Support | https://github.com/hyanmandian/focus-diff/issues |
| Privacy policy | https://github.com/hyanmandian/focus-diff/blob/main/PRIVACY.md |
| License (AMO) | MIT |
| Contact | focus-diff@hyan.com.br |

## English

### Summary

Chrome allows 132 characters, AMO 250. This one fits both and matches the manifest:

> Filter GitHub pull request diffs with your own filters and see how much is left to review.

### Description

```text
Big pull requests mix the code you own with tests, docs, lock files and generated files. Focus Diff adds a small bar to the Files changed page so you can review one part at a time.

Filter the diff
• Make filters from file patterns: Frontend, Backend, Tests, Docs, or anything your repository needs.
• Start from ready-made examples, then keep filters for every repository or just one.
• Pick a filter and the diff shows only its files. Files changed and the +/− lines are counted again for what you actually review.

See what's left
• Files left to review, lines added and removed, and an estimate of the review time, for the filter you're on.
• A breakdown of every filter side by side.
• A Done badge when a filter is fully reviewed.

Move faster
• Jump to the next file you haven't viewed (Alt+Shift+J).
• Step through every conversation on the pull request without scrolling for it.
• Switch filters from the keyboard: Alt+Shift+. and Alt+Shift+, to cycle, Alt+Shift+0 for all files. Every shortcut can be changed in the browser's shortcut settings.

Private by design
• No account, no tracking, no network requests. Focus Diff reads the file paths and line counts already on the page, and nothing leaves your browser.
• Your filters are kept in your browser's storage.

Built to be used by everyone: keyboard and screen reader friendly, follows GitHub's light and dark themes, in English and Brazilian Portuguese.

Free and open source under the MIT license: https://github.com/hyanmandian/focus-diff
```

## Português (Brasil)

### Resumo

> Filtre os diffs de pull requests do GitHub com seus próprios filtros e veja quanto falta revisar.

### Descrição

```text
Pull requests grandes misturam o código que é seu com testes, docs, lock files e arquivos gerados. O Focus Diff adiciona uma barrinha à página Files changed para você revisar uma parte de cada vez.

Filtre o diff
• Crie filtros a partir de padrões de arquivo: Frontend, Backend, Testes, Docs ou o que o seu repositório precisar.
• Comece pelos exemplos prontos e mantenha os filtros para todos os repositórios ou só para um.
• Escolha um filtro e o diff mostra só os arquivos dele. Files changed e as linhas +/− são recontados para o que você realmente revisa.

Veja o que falta
• Arquivos para revisar, linhas adicionadas e removidas e uma estimativa do tempo de revisão, para o filtro em que você está.
• Um resumo de todos os filtros lado a lado.
• Um selo de Pronto quando um filtro está todo revisado.

Vá mais rápido
• Pule para o próximo arquivo que você ainda não viu (Alt+Shift+J).
• Passe por todas as conversas do pull request sem precisar procurar.
• Troque de filtro pelo teclado: Alt+Shift+. e Alt+Shift+, para alternar, Alt+Shift+0 para todos os arquivos. Todos os atalhos podem ser alterados nas configurações de atalhos do navegador.

Privado de propósito
• Sem conta, sem rastreamento, sem requisições de rede. O Focus Diff lê os caminhos e a contagem de linhas que já estão na página, e nada sai do seu navegador.
• Seus filtros ficam guardados no armazenamento do navegador.

Feito para todo mundo usar: funciona com teclado e leitor de tela, acompanha os temas claro e escuro do GitHub, em inglês e português.

Gratuito e de código aberto, sob a licença MIT: https://github.com/hyanmandian/focus-diff
```

## Chrome Web Store: Privacy practices tab

Chrome asks for these in English.

**Single purpose**

> Focus Diff filters the files shown on GitHub pull request "Files changed" pages by user-defined file patterns and shows review progress for the files that match.

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the filters the user creates and the filter last picked on each repository, so they are there the next time a pull request opens. |
| Host permission (`https://github.com/*`, through the content script) | The extension only works on GitHub pull request pages: it reads the file paths and line counts shown there to hide files outside the chosen filter and to count what is left to review. |

**Remote code:** No, I am not using remote code. All code ships in the package.

**Data usage:** check none of the data types. Then certify all three statements: the data is not sold or transferred to third parties outside the approved use cases, it is not used for purposes unrelated to the single purpose, and it is not used to determine creditworthiness or for lending.

## Firefox Add-ons: notes for the reviewer

AMO asks for the source code because the package is bundled. Upload `focus-diff-sources.zip` from the release, and paste this:

```text
Built with WXT (https://wxt.dev). To reproduce the Firefox package from the sources zip:

1. Install Node.js 22 or later.
2. npm ci
3. npx wxt zip -b firefox

The package is written to .output/focus-diff-<version>-firefox.zip. The extension makes no network requests and collects no data. It runs only on https://github.com/* and uses the storage permission to keep the user's filters.
```
