const CHROME_ID = "nnocnopcbjipboglgbnmocfaplhlkfil";
const FIREFOX_ID = "focus-diff@hyan.com.br";
const repository = process.env.GITHUB_REPOSITORY || "hyanmandian/focus-diff";
const INSTALLERS = /\.(zip|dmg|deb|rpm)$/u;
const SITE_ONLY = /\.(exe|AppImage)$/u;

const json = async (url: string, headers: Record<string, string> = {}): Promise<unknown> => {
  const response = await fetch(url, { headers: { "user-agent": "focus-diff-installs", ...headers } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
};

type Release = { tag_name: string; assets: { name: string; download_count: number }[] };

const counted = (release: Release) =>
  release.assets
    .filter(
      (asset) =>
        (INSTALLERS.test(asset.name) || (release.tag_name === "desktop-latest" && SITE_ONLY.test(asset.name))) &&
        !asset.name.includes("sources"),
    )
    .reduce((sum, asset) => sum + asset.download_count, 0);

const releaseDownloads = async (page = 1): Promise<number> => {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const releases = (await json(
    `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
    headers,
  )) as Release[];
  const total = releases.reduce((sum, release) => sum + counted(release), 0);
  return releases.length < 100 ? total : total + (await releaseDownloads(page + 1));
};

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

const chromeUsers = async (): Promise<number> => {
  try {
    const badge = (await json(`https://img.shields.io/chrome-web-store/users/${CHROME_ID}.json`)) as { value?: string };
    const [, number, unit] = /^([\d.]+)([kKMB]?)/u.exec(badge.value ?? "") ?? [];
    const scale = { "": 1, k: 1e3, K: 1e3, M: 1e6, B: 1e9 }[unit ?? ""] ?? 1;
    return number ? Math.round(Number(number) * scale) : 0;
  } catch {
    return 0;
  }
};

const [downloads, firefox, chrome] = await Promise.all([releaseDownloads(), firefoxUsers(), chromeUsers()]);
const total = downloads + firefox + chrome;
const message = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(total);
console.error(`installs: ${total} (release downloads ${downloads}, Firefox ${firefox}, Chrome ${chrome})`);
console.log(JSON.stringify({ schemaVersion: 1, label: "installs", message, color: "2ea043" }));
