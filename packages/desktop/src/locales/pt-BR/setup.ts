import type { Dictionary } from "@/utils/i18n/i18n";

export const setup: Dictionary["setup"] = {
  "step.github": "GitHub",
  "step.queues": "Filas",
  "step.notifications": "Notificações",
  "step.ai": "IA",
  "step.ready": "Pronto",
  steps: "Etapas",
  repoError: "Use dono/nome, ou dono/* para todos de um dono",
  loading: "Carregando",
  githubTitle: "Suas revisões, sem abrir o GitHub",
  githubBodyBrowser:
    "O Focus Diff fica na barra de ferramentas do navegador, avisa quando um pull request precisa de você e deixa você ler, revisar e fazer merge ali mesmo. Primeiro, conecte o GitHub.",
  githubBody:
    "O Focus Diff fica na barra de menus, avisa quando um pull request precisa de você e deixa você ler, revisar e fazer merge ali mesmo. Primeiro, conecte o GitHub.",
  connectedAs: "Conectado como {login}",
  checkingGitHub: "Consultando o GitHub",
  tokenNoteBrowser: "Seu token fica neste navegador e só vai para o GitHub. O Focus Diff não tem servidor.",
  tokenNote:
    "Seu token fica nas chaves do sistema (ou com o GitHub CLI) e só vai para o GitHub. O Focus Diff não tem servidor.",
  queuesTitle: "O que acompanhar?",
  queuesBody:
    "Cada uma vira uma fila no painel. Depois, nos Ajustes, dá para filtrar melhor (times, labels, arquivos) ou adicionar suas próprias buscas.",
  onlyRepos: "Só nestes repositórios (opcional)",
  repositories: "Repositórios",
  repoPlaceholder: "acme/web ou acme/*",
  reposEmpty: "Vazio: todos os repositórios que você vê.",
  notifyTitle: "Como avisar você?",
  notifyBodyBrowser:
    "Uma notificação e um número no botão da barra de ferramentas quando algo novo precisa de você: um pedido de revisão, novos commits ou respostas no que você revisou, aprovações e CI falhando nos seus. O que cada fila avisa pode ser mudado nos Ajustes.",
  notifyBody:
    "Uma notificação e a animação do ícone na barra de menus quando algo novo precisa de você: um pedido de revisão, commits ou respostas novas no que você revisou, aprovações e CI falhando nos seus. O que cada fila avisa pode ser mudado nos Ajustes.",
  sound: "Tocar um som",
  checkEvery: "Consultar o GitHub a cada",
  checkEveryHint: "Só o que mudou é baixado de novo.",
  aiTitle: "Quer um segundo par de olhos?",
  aiBody:
    "Opcional. Resumos, problemas que merecem uma olhada e respostas sobre um pull request, do agente de código que você já usa, no seu próprio plano. Roda neste computador e não muda nada.",
  ai: "IA",
  noAi: "Sem IA",
  noAiHint: "Tudo funciona sem ela.",
  lookingForAgents: "Procurando agentes de código",
  signedOutRun: "não conectado: rode",
  notInstalled: "não instalado",
  getIt: "Instalar",
  readyVersion: "Pronto · {version}",
  doneTitle: "Tudo pronto",
  doneBodyBrowser:
    "O Focus Diff fica na barra de ferramentas do navegador. Clique no botão para ver suas filas; o número nele mostra o que precisa de você. Seus filtros, review time e botões ficam nos Ajustes.",
  doneBodyMac:
    "O Focus Diff fica na barra de menus. Clique no ícone para ver suas filas; ele se acende quando algo precisa de você. Modelo, esforço, seus prompts e botões ficam nos Ajustes.",
  doneBodyTray:
    "O Focus Diff fica na barra de menus (a bandeja do sistema). Clique no ícone para ver suas filas; ele se acende quando algo precisa de você. Modelo, esforço, seus prompts e botões ficam nos Ajustes.",
  laterAi: "Dá para ativar depois.",
  back: "Voltar",
  continue: "Continuar",
  open: "Abrir o Focus Diff",
};
