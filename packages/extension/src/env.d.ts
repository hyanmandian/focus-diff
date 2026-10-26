// What the build adds to import.meta.env (wxt.config.ts).
interface ImportMetaEnv {
  /** The GitHub OAuth app's client id for signing in with a code; empty without one. */
  readonly FOCUS_DIFF_GITHUB_CLIENT_ID?: string;
}
