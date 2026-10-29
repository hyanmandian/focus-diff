import { forwardErrors } from "@/utils/error-log/error-log";
import { followLanguage } from "@/utils/language/language";
import { setPlatform } from "@/utils/platform/platform";
import { tauriPlatform } from "@/utils/tauri-platform/tauri-platform";

export async function boot() {
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window))
    setPlatform((await import("@/utils/mock/mock")).mockPlatform);
  else {
    setPlatform(tauriPlatform);
    forwardErrors();
  }
  followLanguage();
}
