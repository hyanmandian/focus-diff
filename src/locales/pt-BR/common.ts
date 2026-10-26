import type { Dictionary } from "@/lib/i18n";

export const common: Dictionary["common"] = {
  someone: "Alguém",
  now: "agora",
  underMinute: "<1 min",
  aboutMinutes: "~{minutes} min",
  aboutHours: "~{hours} h",
  aboutHoursMinutes: "~{hours} h {minutes} min",
  minutesShort: "{minutes} min",
  sinceMinutes: { one: "{count} min", other: "{count} min" },
  sinceHours: { one: "{count} h", other: "{count} h" },
  sinceDays: { one: "{count} d", other: "{count} d" },
  sinceMonths: { one: "{count} mês", other: "{count} meses" },
  seconds: { one: "{count} segundo", other: "{count} segundos" },
  minutes: { one: "{count} minuto", other: "{count} minutos" },
  files: { one: "{count} arquivo", other: "{count} arquivos" },
  pullRequests: { one: "{count} pull request", other: "{count} pull requests" },
  comments: { one: "{count} comentário", other: "{count} comentários" },
  githubReturned: "O GitHub respondeu {status}",
  githubNoData: "O GitHub não mandou nenhum dado",
  somethingWentWrong: "Algo deu errado",
  cancel: "Cancelar",
};
