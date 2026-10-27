// Run before every unit test file (vite.config.ts, test.setupFiles): a clean page between tests,
// a fake platform instead of the app (each test answers the commands it needs with mockCommands),
// and what WebKit has that happy-dom doesn't.

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vite-plus/test";

import { clearMocks, fakePlatform } from "@/utils/fake-platform/fake-platform";
import { setPlatform } from "@/utils/platform/platform";

setPlatform(fakePlatform);

afterEach(async () => {
  cleanup();
  // Unmounting removes event listeners asynchronously: let that finish before the mock goes.
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  clearMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

if (!("matchMedia" in window) || typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(window, "ResizeObserver", { configurable: true, value: ResizeObserverStub });
}
