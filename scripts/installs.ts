/**
 * How many people have Focus Diff, as a shields.io endpoint badge: the Chrome Web Store's users, Firefox Add-ons'
 * average daily users, and every download of a release's browser zips (the sources zip is for store reviewers, so it
 * doesn't count). A store the extension isn't listed on yet adds nothing. The site's deploy runs it daily:
 *
 *   node scripts/installs.ts > .output/site/badges/installs.json
 *
 * Env: GITHUB_REPOSITORY (owner/name), GITHUB_TOKEN (optional, for the rate limit).
 */

const CHROME_ID = 'nnocnopcbjipboglgbnmocfaplhlkfil';
const FIREFOX_ID = 'focus-diff@hyan.com.br';
const repository = process.env.GITHUB_REPOSITORY || 'hyanmandian/focus-diff';

const json = async (url: string, headers: Record<string, string> = {}): Promise<unknown> => {
  const response = await fetch(url, { headers: { 'user-agent': 'focus-diff-installs', ...headers } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
};

/** Every download of the release zips people install from, across all releases. */
const releaseDownloads = async (): Promise<number> => {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  let total = 0;
  for (let page = 1; ; page++) {
    const releases = (await json(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, headers)) as {
      assets: { name: string; download_count: number }[];
    }[];
    for (const release of releases)
      for (const asset of release.assets) if (asset.name.endsWith('.zip') && !asset.name.includes('sources')) total += asset.download_count;
    if (releases.length < 100) return total;
  }
};

/** Firefox Add-ons' average daily users; 0 until the listing exists. */
const firefoxUsers = async (): Promise<number> => {
  try {
    const addon = (await json(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(FIREFOX_ID)}/`)) as {
      average_daily_users?: number;
    };
    return addon.average_daily_users ?? 0;
  } catch {
    return 0;
  }
};

/** The Chrome Web Store's users, which it only shows rounded (like 1.2K), as shields.io reads them; 0 if it can't tell. */
const chromeUsers = async (): Promise<number> => {
  try {
    const badge = (await json(`https://img.shields.io/chrome-web-store/users/${CHROME_ID}.json`)) as { value?: string };
    const [, number, unit] = /^([\d.]+)([kKMB]?)/.exec(badge.value ?? '') ?? [];
    const scale = { '': 1, k: 1e3, K: 1e3, M: 1e6, B: 1e9 }[unit ?? ''] ?? 1;
    return number ? Math.round(Number(number) * scale) : 0;
  } catch {
    return 0;
  }
};

const [downloads, firefox, chrome] = await Promise.all([releaseDownloads(), firefoxUsers(), chromeUsers()]);
const total = downloads + firefox + chrome;
const message = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(total);
console.error(`installs: ${total} (release downloads ${downloads}, Firefox ${firefox}, Chrome ${chrome})`);
console.log(JSON.stringify({ schemaVersion: 1, label: 'installs', message, color: '2ea043' }));
