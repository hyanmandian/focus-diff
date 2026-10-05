# Store listing

What to paste and upload for the Chrome Web Store and Firefox Add-ons (AMO) listings, in English and Brazilian Portuguese. Each text block below is ready to copy as it is.

## Images

Every image is a 24-bit PNG with no alpha, the format the Chrome Web Store asks for. The English set goes in the global assets and the Portuguese set in the `pt_BR` localized assets:

| Field                                 | File                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Store icon                            | `store/icon-128-store.png`                                                  |
| Screenshots (1280×800, in this order) | `store/images/<locale>/screenshot-1-filter.png` to `screenshot-5-theme.png` |
| Small promo tile (440×280)            | `store/images/<locale>/small-tile-440x280.png`                              |
| Marquee promo tile (1400×560)         | `store/images/<locale>/marquee-1400x560.png`                                |
| Promo video                           | the YouTube upload of `site/focus-diff.mp4`                                 |

AMO takes the same screenshots. Each one is a real capture of the extension on a public pull request ([withastro/astro#16488](https://github.com/withastro/astro/pull/16488) and [#16366](https://github.com/withastro/astro/pull/16366)), framed with a headline in the look of focus-diff.com.

## Shared fields

| Field          | Value                                                          |
| -------------- | -------------------------------------------------------------- |
| Name           | Focus Diff                                                     |
| Category       | Chrome: Developer Tools · AMO: Web Development                 |
| Homepage       | https://focus-diff.com                                         |
| Support        | https://github.com/hyanmandian/focus-diff/issues               |
| Privacy policy | https://github.com/hyanmandian/focus-diff/blob/main/PRIVACY.md |
| License (AMO)  | MIT                                                            |
| Contact        | focus-diff@hyan.com.br                                         |

## English

### Summary

Chrome allows 132 characters and AMO 250. This one fits both and matches the manifest:

```text
Filter GitHub pull request diffs with your own filters and see how much is left to review.
```

### Description

```text
Big pull requests mix the code you own with tests, docs, lock files and generated files. Focus Diff adds a small bar to the Files changed page so you can review one part at a time.

Filter the diff
• Make filters from file patterns: Frontend, Backend, Tests, Docs, or anything your repository needs.
• Start from ready-made examples, then keep filters for every repository or only one.
• Pick a filter and the diff shows only its files. Files changed and the +/− lines count only what you review.
• Share your filters with your team: copy them in settings, and a teammate imports them in theirs.

See what’s left
• Files left to review, lines added and removed, and an estimate of the review time, for the filter you’re on.
• A breakdown of every filter side by side.
• A Done badge when a filter is fully reviewed.

Move faster
• Jump to the next file you haven’t viewed (Alt+Shift+J).
• Step through every conversation on the pull request without scrolling for it.
• Switch filters from the keyboard: Alt+Shift+. and Alt+Shift+, to cycle, Alt+Shift+0 for all files. You can change every shortcut in your browser’s shortcut settings.

Private by design
• No account, no tracking, no network requests. Focus Diff reads the file paths and line counts already on the page, and nothing leaves your browser.
• Your filters and themes stay in your browser’s storage.

Works with the keyboard and screen readers, follows GitHub’s light and dark themes, and comes in English and Brazilian Portuguese. You can also make a theme of your own: pick the bar’s colours in settings with a live preview, and share it with your team.

Free and open source under the MIT license: https://github.com/hyanmandian/focus-diff
```

## Português (Brasil)

### Resumo

```text
Filtre os diffs de pull requests do GitHub com seus próprios filtros e veja quanto falta revisar.
```

### Descrição

```text
Pull requests grandes misturam o código que é seu com testes, docs, lock files e arquivos gerados. O Focus Diff adiciona uma barrinha à página Files changed para você revisar uma parte de cada vez.

Filtre o diff
• Crie filtros a partir de padrões de arquivo: Frontend, Backend, Testes, Docs ou o que o seu repositório precisar.
• Comece pelos exemplos prontos e mantenha os filtros para todos os repositórios ou só para um.
• Escolha um filtro e o diff mostra só os arquivos dele. Files changed e as linhas +/− contam só o que você revisa.
• Compartilhe seus filtros com o time: copie nas configurações, e quem recebe importa nas dele.

Veja o que falta
• Arquivos para revisar, linhas adicionadas e removidas e uma estimativa do tempo de revisão, para o filtro em que você está.
• Um resumo de todos os filtros lado a lado.
• Um selo de Pronto quando um filtro está todo revisado.

Vá mais rápido
• Pule para o próximo arquivo que você ainda não viu (Alt+Shift+J).
• Passe por todas as conversas do pull request sem precisar procurar.
• Troque de filtro pelo teclado: Alt+Shift+. e Alt+Shift+, para alternar, Alt+Shift+0 para todos os arquivos. Você pode mudar qualquer atalho nas configurações de atalhos do navegador.

Privado de propósito
• Sem conta, sem rastreamento, sem requisições de rede. O Focus Diff lê os caminhos e a contagem de linhas que já estão na página, e nada sai do seu navegador.
• Seus filtros e temas ficam no armazenamento do navegador.

Funciona com teclado e leitor de tela, acompanha os temas claro e escuro do GitHub e está em inglês e português. Você também pode criar seu próprio tema: escolha as cores da barra nas configurações, com prévia ao vivo, e compartilhe com o time.

Gratuito e de código aberto, sob a licença MIT: https://github.com/hyanmandian/focus-diff
```

## Chrome Web Store: privacy practices tab

The Privacy practices tab has one field per heading below. Chrome asks for these in English.

### Single purpose

```text
Focus Diff filters the files shown on the “Files changed” page of GitHub pull requests by file patterns the user writes, and shows how much of the matching files is left to review.
```

### Storage justification

```text
Keeps what the user sets up, so it’s there on the next pull request: their filters and their themes for the bar (synced across their browsers), the filters last picked on each repository, and whether the notes of a new version are still to be shown. Nothing else is stored, and nothing is sent anywhere.
```

### Host permission justification

```text
The content script runs on https://github.com/* because the extension works on GitHub pull request pages: it reads the file paths and line counts already on the “Files changed” page to hide the files outside the chosen filter and to count what is left to review. It matches all of github.com, not only pull request URLs, because GitHub moves between pages without reloading them, so the script has to be on the page before the reader opens a pull request. It makes no network requests.
```

### Remote code

Pick **No, I am not using remote code**. Every script ships in the package, and the extension loads nothing from the network.

### Data usage

Check none of the data types. Then certify all three statements: the data isn’t sold or transferred to third parties outside the approved use cases, isn’t used for purposes unrelated to the single purpose, and isn’t used to determine creditworthiness or for lending.

### Privacy policy URL

```text
https://github.com/hyanmandian/focus-diff/blob/main/PRIVACY.md
```

## Firefox Add-ons: notes for the reviewer

AMO asks for the source code because the package is bundled. Upload `focus-diff-sources.zip` from the release, and paste this:

```text
Built with WXT (https://wxt.dev). To reproduce the Firefox package from the sources zip:

1. Install Node.js 22 or later.
2. npm ci
3. npx wxt zip -b firefox

The package is written to .output/focus-diff-<version>-firefox.zip. The extension makes no network requests and collects no data. It runs only on https://github.com/* and uses the storage permission to keep the user’s filters and themes.
```
