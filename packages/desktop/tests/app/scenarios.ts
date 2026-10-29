import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

type Gh = "missing" | "signed-out" | "token";
type Run = { child: ChildProcess; err: string; exited: number | null };

const [binary, ghArgument = "signed-out"] = process.argv.slice(2);
const isGh = (value: string): value is Gh => ["missing", "signed-out", "token"].includes(value);
if (!binary || !isGh(ghArgument)) {
  process.stderr.write("usage: node scenarios.ts <app binary or .app> [missing|signed-out|token]\n");
  process.exit(2);
}
const gh: Gh = ghArgument;

const os = process.platform;
const bundle = binary.endsWith(".app") ? binary : null;
const executable = bundle ? path.join(bundle, "Contents", "MacOS", "focus-diff") : binary;
const home = mkdtempSync(path.join(tmpdir(), "focus-diff-home-"));
const control = path.join(home, "devctl");
const FAKE_TOKEN = `ghp_${"Z".repeat(36)}`;
const ID = "com.focusdiff.app";
const appData = process.env.APPDATA ?? "";
const localAppData = process.env.LOCALAPPDATA ?? "";

const configFile =
  os === "darwin"
    ? path.join(home, "Library", "Application Support", ID, "config.json")
    : os === "win32"
      ? path.join(appData, ID, "config.json")
      : path.join(home, ".config", ID, "config.json");
const logFile =
  os === "darwin"
    ? path.join(home, "Library", "Logs", ID, "focus-diff.log")
    : os === "win32"
      ? path.join(localAppData, ID, "logs", "focus-diff.log")
      : path.join(home, ".local", "share", ID, "logs", "focus-diff.log");

if (os === "win32") {
  if (!process.env.CI) {
    process.stderr.write("On Windows this runs only in CI: it starts from an empty %APPDATA%\\com.focusdiff.app.\n");
    process.exit(2);
  }
  rmSync(path.join(appData, ID), { recursive: true, force: true });
  rmSync(path.join(localAppData, ID), { recursive: true, force: true });
}

const env: NodeJS.ProcessEnv = { ...process.env, FOCUS_DIFF_DEVCTL: control };
if (os !== "win32") {
  env.HOME = home;
  delete env.XDG_CONFIG_HOME;
  delete env.XDG_DATA_HOME;
  delete env.XDG_CACHE_HOME;
  delete env.XDG_STATE_HOME;
}
if (gh === "token") env.GH_TOKEN = FAKE_TOKEN;
else {
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
}

const WORDS = {
  later: /Sign in later|Entrar depois/u,
  report: /Having trouble\? Report a problem|Algo deu errado\? Relatar um problema/u,
  token: /Personal access token|Token de acesso pessoal/u,
  useGh: /Use the GitHub CLI's login|Usar o login do GitHub CLI/u,
  ghSignedOut: /installed but not signed in|instalado, mas não está conectado/u,
  createToken: /Create a token on GitHub|Criar um token no GitHub/u,
};
const signIn = (text: string) => WORDS.token.test(text) || WORDS.useGh.test(text);
const shown = (run: Run) => run.err.split("[panel] shown").length - 1;
const visible = (list: string, label: string) => list.split(", ").includes(label);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${detail}`}\n`);
  if (!ok) failures += 1;
};

function launch(): Run {
  const child = spawn(executable, [], { env, stdio: ["ignore", "ignore", "pipe"] });
  const run: Run = { child, err: "", exited: null };
  child.stderr?.on("data", (chunk: Buffer) => {
    run.err += chunk.toString();
  });
  child.on("exit", (code) => {
    run.exited = code ?? -1;
  });
  return run;
}

async function until<T>(test: () => T | null | undefined | false, ms = 30_000): Promise<T | null> {
  const value = test();
  if (value) return value;
  if (ms <= 0) return null;
  await sleep(250);
  return until(test, ms - 250);
}

async function send(command: string) {
  appendFileSync(control, `${command}\n`);
  await sleep(450);
}

async function windows(run: Run, tries = 6): Promise<string> {
  const before = run.err.length;
  await send("windows");
  const said = await until(() => /\[devctl\] windows: (.*)/u.exec(run.err.slice(before))?.[1], 5000);
  return said ?? (tries > 1 ? windows(run, tries - 1) : "");
}

let probes = 0;
async function probe(run: Run, label: string): Promise<string> {
  probes += 1;
  const tag = `PROBE${probes}`;
  await send(
    `eval ${label} window.__TAURI_INTERNALS__.invoke("log",{message:"${tag} "+JSON.stringify(document.body.innerText)})`,
  );
  const said = await until(() => new RegExp(`${tag} (".*")`, "u").exec(run.err)?.[1], 10_000);
  const parsed: unknown = said ? JSON.parse(said) : "";
  return typeof parsed === "string" ? parsed : "";
}

async function settled(run: Run, label: string, done: (text: string) => boolean, ms = 30_000): Promise<string> {
  const text = await probe(run, label);
  if (done(text) || ms <= 0) return text;
  await sleep(500);
  return settled(run, label, done, ms - 1500);
}

async function props(run: Run, label: string): Promise<string> {
  const before = run.err.length;
  await send(`props ${label}`);
  return (
    (await until(() => new RegExp(`\\[devctl\\] props ${label}: (.*)`, "u").exec(run.err.slice(before))?.[1], 5000)) ??
    ""
  );
}

async function stop(run: Run) {
  if (run.exited !== null) return;
  run.child.kill();
  await until(() => run.exited !== null, 10_000);
  await sleep(500);
}

async function started(run: Run) {
  return Boolean(await until(() => run.err.includes("[start] Focus Diff")));
}

const CLICK_THROUGH = `(async()=>{for(let i=0;i<10;i++){const b=document.querySelector("footer .ml-auto button:last-of-type");if(!b)break;b.click();await new Promise(r=>setTimeout(r,600));}})()`;
const SIGN_IN_LATER = `document.querySelector("footer .ml-auto button:last-of-type").click()`;

async function scenarios() {
  writeFileSync(control, "");
  let run = launch();
  const up = await started(run);
  check("starts", up, run.err.slice(-2000));
  if (!up) return;
  await sleep(1500);
  check("shows setup on a first launch", visible(await windows(run), "setup"));
  check("says why in its log", run.err.includes("no settings yet: showing setup"));

  const setup = await settled(run, "setup", signIn);
  check("offers to sign in later", WORDS.later.test(setup), setup);
  check("offers to report a problem", WORDS.report.test(setup), setup);
  if (gh === "missing") {
    check("without the GitHub CLI, asks for a token", WORDS.token.test(setup) && !WORDS.useGh.test(setup), setup);
    check("links to creating a token", WORDS.createToken.test(setup), setup);
  } else if (gh === "signed-out") {
    check(
      "says the GitHub CLI isn't signed in",
      WORDS.ghSignedOut.test(setup) && setup.includes("gh auth login"),
      setup,
    );
  } else {
    check(
      "with the GitHub CLI signed in, offers it without a warning",
      WORDS.useGh.test(setup) && !WORDS.ghSignedOut.test(setup),
      setup,
    );
  }

  await send(`eval setup ${SIGN_IN_LATER}`);
  await sleep(800);
  await stop(run);
  check("quitting halfway leaves no settings behind", !existsSync(configFile), configFile);

  run = launch();
  await started(run);
  await sleep(1500);
  check("brings setup back after quitting halfway", visible(await windows(run), "setup"));
  await settled(run, "setup", (text) => WORDS.later.test(text));
  const shownBefore = shown(run);
  await send(`eval setup ${CLICK_THROUGH}`);
  check("finishing saves the settings", Boolean(await until(() => existsSync(configFile), 20_000)), configFile);
  await until(() => shown(run) > shownBefore, 15_000);
  const after = await windows(run);
  check("finishing closes setup and opens the panel", shown(run) > shownBefore && !visible(after, "setup"), after);
  await stop(run);

  run = launch();
  await started(run);
  check("opening it again shows the panel", Boolean(await until(() => shown(run) > 0, 15_000)), run.err.slice(-1500));
  const panel = await settled(run, "panel", signIn);
  check("the panel asks to sign in when nobody is", signIn(panel), panel);
  await send(
    `eval panel window.__TAURI_INTERNALS__.invoke("open_review",{id:"PR_x",repo:"acme/web",number:1,title:"#1",teams:[],queue:null,from:null}).then(()=>window.__TAURI_INTERNALS__.invoke("log",{message:"REVIEW OPENED"}))`,
  );
  check(
    "opens a pull request from the panel without freezing",
    Boolean(await until(() => run.err.includes("REVIEW OPENED"), 15_000)) && /review-\d/u.test(await windows(run)),
    run.err.slice(-1500),
  );
  const review =
    (await windows(run)).split(", ").find((w) => w.startsWith("review-") && !w.includes("hidden")) ?? "review-0";
  const normal = await props(run, review);
  check(
    "the pull request window is a normal window: resizes, maximizes, minimizes, stays behind others",
    normal.includes("resizable=true maximizable=true minimizable=true decorated=true on_top=false"),
    normal,
  );

  if (bundle) execFileSync("open", [bundle]);
  else {
    const second = launch();
    check(
      "a second copy hands over and quits",
      Boolean(await until(() => second.exited !== null, 15_000)),
      second.err.slice(-1000),
    );
  }
  check(
    "opening it while it runs shows the panel",
    Boolean(await until(() => run.err.includes("opened again while running"), 15_000)),
    run.err.slice(-1500),
  );
  check("the first copy keeps running", run.exited === null);
  const popup = await props(run, "panel");
  check("the panel is a popup: no resizing or maximizing", popup.includes("resizable=false maximizable=false"), popup);
  await stop(run);

  const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  check("keeps a log where Show Logs looks", log.includes("[start] Focus Diff"), logFile);
  check("the log hides tokens", !log.includes(FAKE_TOKEN) && !run.err.includes(FAKE_TOKEN));
  check("the log shows no home folder", !log.includes(home) && !/\/Users\/|\/home\/|\\Users\\/u.test(log));
  check("the log keeps what the pages said out", !log.includes("PROBE") || !/PROBE\d+ "[^…]/u.test(log));
}

try {
  await scenarios();
} finally {
  if (os !== "win32") rmSync(home, { recursive: true, force: true });
}

process.stdout.write(failures ? `\n${failures} failed\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
