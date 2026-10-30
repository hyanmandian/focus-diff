const repository = process.env.GITHUB_REPOSITORY || "hyanmandian/focus-diff";
const token = process.env.GITHUB_TOKEN;

const response = await fetch(`https://api.github.com/repos/${repository}`, {
  headers: { "user-agent": "focus-diff-stars", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
if (!response.ok) throw new Error(`stars: ${response.status}`);
const { stargazers_count: stars } = (await response.json()) as { stargazers_count: number };
const message = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(stars);
console.error(`stars: ${stars}`);
console.log(JSON.stringify({ schemaVersion: 1, label: "stars", message, color: "e3b341" }));
