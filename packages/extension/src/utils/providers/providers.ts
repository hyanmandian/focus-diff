export interface ProviderInfo {
  id: string;
  name: string;
  theme: () => Promise<string>;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "github",
    name: "GitHub",
    theme: () => import("@/components/github-theme/github-theme.css?inline").then((module) => module.default),
  },
];

export const providerNames = (locale?: string): string =>
  new Intl.ListFormat(locale, { type: "conjunction" }).format(PROVIDERS.map((provider) => provider.name));
