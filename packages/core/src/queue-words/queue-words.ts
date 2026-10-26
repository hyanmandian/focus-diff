/**
 * What the queue engine says (notifications, errors), in English and Brazilian Portuguese: the desktop app's words
 * (`tr!` in src-tauri/src/watch.rs, engine.rs and github.rs), which are the extension's own `notify*` messages. Pass
 * either set, or one of your own, to the engine.
 */

export interface Words {
  someone: string;
  // A notification's title, by the kind of event.
  askedTeam: (who: string) => string;
  asked: (who: string) => string;
  newInQueue: string;
  askedAgain: (who: string) => string;
  readyForYou: (who: string) => string;
  markedReady: (who: string) => string;
  pushed: (who: string) => string;
  replied: (who: string) => string;
  mentioned: (who: string) => string;
  commentedOnYours: (who: string) => string;
  commentedOnReviewing: (who: string) => string;
  commented: (who: string) => string;
  approved: (who: string) => string;
  changes: (who: string) => string;
  ciFailed: string;
  ciPassed: string;
  conflict: string;
  somethingHappened: string;
  // Its body.
  forTeam: (team: string) => string;
  byAuthor: (title: string, place: string, author: string) => string;
  // Several at once.
  moreUpdates: (n: number) => string;
  openToSee: string;
  cameIn: (n: number) => string;
  waitedForReview: (n: number) => string;
  cameInWhileReviewing: (n: number) => string;
  andMore: (n: number) => string;
  // Errors.
  signedOut: string;
  slowDown: (minutes: number) => string;
  githubReturned: (status: number) => string;
  noData: string;
  unsupportedPattern: (queue: string, pattern: string) => string;
}

export const ENGLISH: Words = {
  someone: "Someone",
  askedTeam: (who) => `${who} asked your team for a review`,
  asked: (who) => `${who} asked for your review`,
  newInQueue: "New in your queue",
  askedAgain: (who) => `${who} asked you to review again`,
  readyForYou: (who) => `${who}'s pull request is ready for your review`,
  markedReady: (who) => `${who} marked it ready for review`,
  pushed: (who) => `${who} pushed changes`,
  replied: (who) => `${who} replied to you`,
  mentioned: (who) => `${who} mentioned you`,
  commentedOnYours: (who) => `${who} commented on your pull request`,
  commentedOnReviewing: (who) => `${who} commented on a pull request you review`,
  commented: (who) => `${who} commented`,
  approved: (who) => `${who} approved your pull request`,
  changes: (who) => `${who} requested changes on your pull request`,
  ciFailed: "CI failed",
  ciPassed: "CI passed",
  conflict: "Merge conflict",
  somethingHappened: "Something happened",
  forTeam: (team) => ` · for ${team}`,
  byAuthor: (title, place, author) => `${title}\n${place} · by ${author}`,
  moreUpdates: (n) => `${n} more pull request updates`,
  openToSee: "Open Focus Diff to see them",
  cameIn: (n) => `${n} updates came in`,
  waitedForReview: (n) => `${n} updates waited for review time`,
  cameInWhileReviewing: (n) => `${n} updates came in while you reviewed`,
  andMore: (n) => `\nand ${n} more`,
  signedOut: "GitHub signed you out",
  slowDown: (minutes) => `GitHub asked Focus Diff to slow down: trying again in ${minutes} minutes`,
  githubReturned: (status) => `GitHub returned ${status}`,
  noData: "GitHub returned no data",
  unsupportedPattern: (queue, pattern) => `${queue}: the file pattern "${pattern}" isn't supported`,
};

export const PORTUGUESE: Words = {
  someone: "Alguém",
  askedTeam: (who) => `${who} pediu revisão ao seu time`,
  asked: (who) => `${who} pediu sua revisão`,
  newInQueue: "Novo na sua fila",
  askedAgain: (who) => `${who} pediu para você revisar de novo`,
  readyForYou: (who) => `O pull request de ${who} está pronto para sua revisão`,
  markedReady: (who) => `${who} marcou como pronto para revisão`,
  pushed: (who) => `${who} enviou mudanças`,
  replied: (who) => `${who} respondeu você`,
  mentioned: (who) => `${who} mencionou você`,
  commentedOnYours: (who) => `${who} comentou no seu pull request`,
  commentedOnReviewing: (who) => `${who} comentou num pull request que você revisa`,
  commented: (who) => `${who} comentou`,
  approved: (who) => `${who} aprovou seu pull request`,
  changes: (who) => `${who} pediu mudanças no seu pull request`,
  ciFailed: "O CI falhou",
  ciPassed: "O CI passou",
  conflict: "Conflito de merge",
  somethingHappened: "Aconteceu algo",
  forTeam: (team) => ` · para ${team}`,
  byAuthor: (title, place, author) => `${title}\n${place} · de ${author}`,
  moreUpdates: (n) => `Mais ${n} atualizações nos seus pull requests`,
  openToSee: "Abra o Focus Diff para ver",
  cameIn: (n) => `${n} atualizações chegaram`,
  waitedForReview: (n) => `${n} atualizações guardadas para o review time`,
  cameInWhileReviewing: (n) => `${n} atualizações chegaram enquanto você revisava`,
  andMore: (n) => `\ne mais ${n}`,
  signedOut: "O GitHub desconectou você",
  slowDown: (minutes) => `O GitHub pediu para o Focus Diff ir mais devagar: tentando de novo em ${minutes} minutos`,
  githubReturned: (status) => `O GitHub respondeu ${status}`,
  noData: "O GitHub não mandou nenhum dado",
  unsupportedPattern: (queue, pattern) => `${queue}: o padrão de arquivos "${pattern}" não é suportado`,
};
