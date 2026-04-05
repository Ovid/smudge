import "@testing-library/jest-dom/vitest";

// Suppress Node 22+ --localstorage-file warning from jsdom worker threads
const originalProcessEmitWarning = process.emitWarning;
process.emitWarning = function (warning: string | Error, ...args: unknown[]) {
  const msg = typeof warning === "string" ? warning : warning.message;
  if (msg.includes("--localstorage-file")) return;
  return (originalProcessEmitWarning as (...a: unknown[]) => void).call(this, warning, ...args);
};

// Polyfill HTMLDialogElement.showModal/close for happy-dom
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
}

// Mock window.matchMedia for tests (happy-dom doesn't implement it)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
