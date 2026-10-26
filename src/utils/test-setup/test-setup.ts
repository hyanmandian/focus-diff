// Run before every unit test file (vite.config.ts, test.setupFiles): a clean page between tests,
// Tauri's own IPC mock instead of the app (each test answers the commands it needs with mockIPC),
// and what WebKit has that happy-dom doesn't.

import { clearMocks } from "@tauri-apps/api/mocks";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vite-plus/test";

afterEach(() => {
  cleanup();
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
