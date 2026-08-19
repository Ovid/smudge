import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorBanner } from "./EditorBanner";
import { STRINGS } from "../strings";

// S5 (review 2026-08-19): before the F-18 consolidation, ActionErrorBanner
// declared `onDismiss` as REQUIRED, so an action error with no way to clear it
// did not compile. EditorBanner made the prop optional — and the lock banner
// two lines above the action-error call site in EditorMainContent is now a
// same-shaped `<EditorBanner tone="error">` that legitimately omits exactly
// that prop, which makes dropping it a plausible mechanical edit rather than
// an obvious one. Nothing asserted the action-error banner had a dismiss
// control; STRINGS.a11y.dismissError's only other reference is the assertion
// that the LOCK banner has none.
describe("EditorBanner", () => {
  afterEach(() => cleanup());

  it("renders a dismiss control for a dismissible error banner", async () => {
    const onDismiss = vi.fn();
    render(<EditorBanner tone="error" message="Boom" onDismiss={onDismiss} />);

    const region = screen.getByRole("alert");
    expect(region).toHaveTextContent("Boom");
    await userEvent.click(within(region).getByRole("button", { name: STRINGS.a11y.dismissError }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders a polite status region with its own dismiss label for info", async () => {
    const onDismiss = vi.fn();
    render(<EditorBanner tone="info" message="Heads up" onDismiss={onDismiss} />);

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    await userEvent.click(within(region).getByRole("button", { name: STRINGS.a11y.dismissInfo }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders a trailing control instead of a dismiss when given children", () => {
    render(
      <EditorBanner tone="error" message="Locked">
        {/* eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing) */}
        <button type="button">Refresh</button>
      </EditorBanner>,
    );

    const region = screen.getByRole("alert");
    expect(within(region).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: STRINGS.a11y.dismissError })).toBeNull();
  });

  it("does not type-check a banner with neither a dismiss nor a trailing control", () => {
    // The compile-time half of the guarantee ActionErrorBanner used to give by
    // declaring onDismiss required. A banner with no dismiss AND no trailing
    // control is a role="alert" the user cannot clear or act on.
    // @ts-expect-error - exactly one of onDismiss / children is required
    const orphan = <EditorBanner tone="error" message="Unclearable" />;
    expect(orphan).toBeTruthy();
  });

  it("does not type-check a trailing control that can render nothing", () => {
    // S1 (review round 3, 2026-08-19): `children: ReactNode` admitted
    // null/undefined/false, so the union enforced prop PRESENCE, not control
    // presence — a conditional control that evaluates false type-checks and
    // renders an assertive role="alert" with nothing to act on, which is the
    // exact state the union exists to outlaw. `ReactElement` closes it.
    const showRefresh = false as boolean;
    const orphan = (
      <EditorBanner tone="error" message="Unclearable">
        {/* @ts-expect-error - children must be an element, not a possibly-absent node */}
        {showRefresh && <button type="button" />}
      </EditorBanner>
    );
    expect(orphan).toBeTruthy();
  });
});
