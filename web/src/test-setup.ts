import '@testing-library/jest-dom';

// Node 26 defines localStorage/sessionStorage as experimental globals whose getter
// returns undefined unless --localstorage-file is provided.  Vitest's jsdom
// environment only overrides globals that are NOT already in globalThis (or that
// are in its explicit KEYS allowlist) — localStorage is absent from that list.
// Forward the descriptors from jsdom's internal Window before tests run.
declare const jsdom: { window: Window & typeof globalThis } | undefined;
if (typeof jsdom !== 'undefined' && jsdom?.window) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    const desc = Object.getOwnPropertyDescriptor(jsdom.window, key);
    if (desc) {
      Object.defineProperty(globalThis, key, {
        ...desc,
        configurable: true,
      });
    }
  }
}
