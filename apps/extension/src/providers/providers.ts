/** A supported review site, as the extension's pages know it. Its page reading lives in its own content script. */
export interface ProviderInfo {
  id: string;
  /** As the site spells it. */
  name: string;
  /** The bar in the site's colours: its `--fd-*` properties. Loaded the first time it's needed. */
  theme: () => Promise<string>;
}

/** The review sites Focus Diff supports, in the order the extension's pages list them. */
export const PROVIDERS: ProviderInfo[] = [
  { id: 'github', name: 'GitHub', theme: () => import('@/providers/github/theme.css?inline').then((module) => module.default) },
];

/** The supported sites by name, as a list in a sentence of the reader's language, like "GitHub and GitLab". */
export const providerNames = (locale?: string): string =>
  new Intl.ListFormat(locale, { type: 'conjunction' }).format(PROVIDERS.map((provider) => provider.name));
