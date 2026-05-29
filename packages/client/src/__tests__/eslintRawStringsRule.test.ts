import { beforeAll, describe, it, expect } from "vitest";
import { lintCode, FIXTURE_PATH_TSX } from "./eslintRuleHarness";

// Wrap a JSX expression in a valid TSX module with every identifier
// predeclared, so only no-restricted-syntax can fire on the JSX itself.
// Assertions filter by ruleId, so incidental react-hooks / unused-vars
// messages are irrelevant.
function mod(jsx: string): string {
  return `
    const STRINGS: any = {};
    const label = "";
    const x = "";
    const count = 0;
    const a = "";
    const b = "";
    export const C = () => (${jsx});
  `;
}

// Match a raw-UI-string violation specifically, not merely any
// no-restricted-syntax violation: the sequence-ref selector shares the same
// ruleId, so filtering on ruleId alone would let a positive case pass on the
// wrong selector. Every raw-string message opens with "Raw UI string"; the
// seq-ref message does not.
async function rawStringMessages(code: string) {
  const results = await lintCode(code, FIXTURE_PATH_TSX);
  return results[0]!.messages.filter(
    (m) => m.ruleId === "no-restricted-syntax" && /Raw UI string/.test(m.message),
  );
}

beforeAll(async () => {
  await lintCode("export {};", FIXTURE_PATH_TSX);
}, 30_000);

describe("no-restricted-syntax raw-UI-string rule (letters-only)", () => {
  describe("positive cases (rule fires)", () => {
    const positives: Array<[string, string]> = [
      ["JSX text child", `<button>Save</button>`],
      ["string literal in JSX-child container", `<button>{"Save"}</button>`],
      ["template literal child", "<button>{`Save`}</button>"],
      ["aria-label string literal", `<button aria-label="Save">{label}</button>`],
      ["aria-label literal-in-container", `<button aria-label={"Save"}>{label}</button>`],
      ["aria-label template literal", "<button aria-label={`Save ${x}`}>{label}</button>"],
      ["alt attribute", `<img alt="Logo" />`],
      ["placeholder attribute", `<input placeholder="Search" />`],
      ["title attribute", `<span title="Tooltip">{label}</span>`],
      [
        "aria-description attribute",
        `<button aria-description="Removes the chapter">{label}</button>`,
      ],
      [
        "aria-roledescription attribute",
        `<div aria-roledescription="slide carousel">{label}</div>`,
      ],
    ];
    for (const [name, jsx] of positives) {
      it(`fires on ${name}`, async () => {
        const msgs = await rawStringMessages(mod(jsx));
        expect(msgs.length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe("negative cases (rule does not fire)", () => {
    const negatives: Array<[string, string]> = [
      ["STRINGS member child", `<button>{STRINGS.foo.save}</button>`],
      ["identifier child", `<button>{label}</button>`],
      ["whitespace-only literal child", `<button>{"\\n  "}{label}</button>`],
      ["className attribute", `<button className="px-2">{label}</button>`],
      ["role attribute", `<button role="alert">{label}</button>`],
      ["type attribute", `<input type="text" />`],
      ["aria-labelledby attribute", `<button aria-labelledby="some-id">{label}</button>`],
      ["aria-label STRINGS member", `<button aria-label={STRINGS.dismiss}>{label}</button>`],
      ["glyph-only JSX text (letters-only)", `<button>✕</button>`],
      ["separator glyph (letters-only)", `<span aria-hidden="true">·</span>`],
      ["punctuation glue (letters-only)", `<span>{count}: {label}</span>`],
      ["template with no static letter (letters-only)", "<span title={`${a}: ${b}`} />"],
    ];
    for (const [name, jsx] of negatives) {
      it(`does not fire on ${name}`, async () => {
        const msgs = await rawStringMessages(mod(jsx));
        expect(msgs).toHaveLength(0);
      });
    }
    // #22: not JSX at all — a string comparison in a key handler.
    it("does not fire on a non-JSX string comparison", async () => {
      const code = `export function f(e: any) { if (e.key === "Escape") {} }`;
      const msgs = await rawStringMessages(code);
      expect(msgs).toHaveLength(0);
    });
  });

  // rawStringMessages must count a positive case as a raw-string violation only
  // when the raw-UI-string rule fired — not merely any no-restricted-syntax
  // rule. The sequence-ref selector shares ruleId "no-restricted-syntax"; a
  // ruleId-only filter would let a positive case pass on the wrong selector and
  // mask a raw-string-selector regression. This pins the helper's precision.
  describe("helper precision", () => {
    it("excludes a non-raw-string no-restricted-syntax violation (seq-ref)", async () => {
      const code = `export function f(seq: number, ref: { current: number }) {
        if (seq !== ref.current) return seq;
        return 0;
      }`;
      const msgs = await rawStringMessages(code);
      expect(msgs).toHaveLength(0);
    });
  });
});
