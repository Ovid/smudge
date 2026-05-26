import { describe, it, expect, vi } from "vitest";
import { applyMappedError, STOP } from "./applyMappedError";
import type { MappedError } from "./apiErrorMapper";

// Test helper pins to `chapter.load` (a scope with no extrasFrom →
// ScopeExtras = never). The shape under test is structural, not
// scope-specific; the explicit generic is needed because MappedError
// has no default after S4 (agentic-review 2026-05-26). Tests that
// exercise extras shapes construct MappedError<"image.delete"> inline.
const ok = (
  overrides: Partial<MappedError<"chapter.load">> = {},
): MappedError<"chapter.load"> => ({
  message: "boom",
  possiblyCommitted: false,
  transient: false,
  terminal: false,
  ...overrides,
});

describe("applyMappedError", () => {
  it("silent bail when message is null (ABORTED)", () => {
    const onMessage = vi.fn();
    const onCommitted = vi.fn();
    const onTransient = vi.fn();
    const onExtras = vi.fn();
    applyMappedError(
      { message: null, possiblyCommitted: false, transient: false, terminal: false },
      {
        onMessage,
        onCommitted,
        onTransient,
        onExtras,
      },
    );
    expect(onMessage).not.toHaveBeenCalled();
    expect(onCommitted).not.toHaveBeenCalled();
    expect(onTransient).not.toHaveBeenCalled();
    expect(onExtras).not.toHaveBeenCalled();
  });

  it("onMessage fires with the mapped string", () => {
    const onMessage = vi.fn();
    applyMappedError(ok({ message: "hello" }), { onMessage });
    expect(onMessage).toHaveBeenCalledWith("hello");
  });

  it("onCommitted fires before onMessage when possiblyCommitted", () => {
    const order: string[] = [];
    applyMappedError(ok({ possiblyCommitted: true }), {
      onCommitted: () => {
        order.push("committed");
      },
      onMessage: () => {
        order.push("message");
      },
    });
    expect(order).toEqual(["committed", "message"]);
  });

  it("onTransient fires before onMessage when transient", () => {
    const order: string[] = [];
    applyMappedError(ok({ transient: true }), {
      onTransient: () => {
        order.push("transient");
      },
      onMessage: () => {
        order.push("message");
      },
    });
    expect(order).toEqual(["transient", "message"]);
  });

  it("onExtras fires before onMessage when extras present", () => {
    const order: string[] = [];
    applyMappedError(ok({ extras: { chapters: [] } }), {
      onExtras: () => {
        order.push("extras");
      },
      onMessage: () => {
        order.push("message");
      },
    });
    expect(order).toEqual(["extras", "message"]);
  });

  it("missing callbacks are no-ops", () => {
    expect(() => applyMappedError(ok(), {})).not.toThrow();
  });

  it("extras===undefined does not fire onExtras", () => {
    const onExtras = vi.fn();
    applyMappedError(ok({ extras: undefined }), { onExtras, onMessage: vi.fn() });
    expect(onExtras).not.toHaveBeenCalled();
  });

  it("STOP from onCommitted skips onTransient, onExtras, and onMessage", () => {
    const onTransient = vi.fn();
    const onExtras = vi.fn();
    const onMessage = vi.fn();
    applyMappedError(ok({ possiblyCommitted: true, transient: true, extras: { x: 1 } }), {
      onCommitted: () => STOP,
      onTransient,
      onExtras,
      onMessage,
    });
    expect(onTransient).not.toHaveBeenCalled();
    expect(onExtras).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("STOP from onTransient skips onExtras and onMessage", () => {
    const onExtras = vi.fn();
    const onMessage = vi.fn();
    applyMappedError(ok({ transient: true, extras: { x: 1 } }), {
      onTransient: () => STOP,
      onExtras,
      onMessage,
    });
    expect(onExtras).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("STOP from onExtras skips onMessage", () => {
    const onMessage = vi.fn();
    applyMappedError(ok({ extras: { x: 1 } }), { onExtras: () => STOP, onMessage });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("returning undefined (default void) continues to next callback", () => {
    const onMessage = vi.fn();
    applyMappedError(ok({ possiblyCommitted: true }), { onCommitted: () => undefined, onMessage });
    expect(onMessage).toHaveBeenCalledWith("boom");
  });
});
