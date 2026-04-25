import { test, expect, type APIRequestContext } from "@playwright/test";

interface TestProject {
  id: string;
  title: string;
  slug: string;
}

interface ChapterSummary {
  id: string;
}

interface ProjectWithChapters extends TestProject {
  chapters: ChapterSummary[];
}

async function createTestProject(request: APIRequestContext): Promise<TestProject> {
  // S6 (review 2026-04-25): Date.now() millisecond resolution can collide
  // under Playwright sharding/parallel workers. Append crypto.randomUUID()
  // for hard uniqueness so two concurrent project creates can't generate
  // the same slug.
  const res = await request.post("/api/projects", {
    data: { title: `Sanitizer Test ${Date.now()}-${crypto.randomUUID()}`, mode: "fiction" },
  });
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as TestProject;
  expect(json.id).toBeTruthy();
  expect(json.slug).toBeTruthy();
  return json;
}

async function deleteProject(request: APIRequestContext, slug: string) {
  const res = await request.delete(`/api/projects/${slug}`);
  expect(res.ok()).toBeTruthy();
}

test.describe("Sanitizer e2e (I14)", () => {
  let project: TestProject;

  test.beforeEach(async ({ request }) => {
    project = await createTestProject(request);
  });

  test.afterEach(async ({ request }) => {
    await deleteProject(request, project.slug);
  });

  test("snapshot view sanitizes malicious img src URIs (I14)", async ({ page, request }) => {
    // Locate the auto-created chapter for the project.
    const projectRes = await request.get(`/api/projects/${project.slug}`);
    expect(projectRes.ok()).toBeTruthy();
    const projectJson = (await projectRes.json()) as ProjectWithChapters;
    expect(projectJson.chapters.length).toBeGreaterThan(0);
    const chapterId = projectJson.chapters[0]!.id;

    // PATCH the chapter with TipTap content containing two malicious-src
    // image nodes. The server's TipTapDocSchema is a passthrough record,
    // so it does not enforce the URI on element attrs — exactly the
    // route we're proving the client sanitizer closes.
    const maliciousContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "safe text before" }],
        },
        {
          type: "image",
          attrs: {
            src: "data:image/svg+xml;base64,PHN2Zy8+",
            alt: "data-uri-marker",
          },
        },
        {
          type: "image",
          attrs: {
            src: "javascript:alert(1)",
            alt: "javascript-uri-marker",
          },
        },
      ],
    };

    const patchRes = await request.patch(`/api/chapters/${chapterId}`, {
      data: { content: maliciousContent },
    });
    expect(patchRes.ok()).toBeTruthy();

    // Confirm the malicious payload actually persisted server-side. If the
    // server quietly stripped these, the e2e would not be exercising the
    // client-side sanitizer at all.
    const verifyRes = await request.get(`/api/chapters/${chapterId}`);
    expect(verifyRes.ok()).toBeTruthy();
    const verifyJson = (await verifyRes.json()) as {
      content: { content: Array<Record<string, unknown>> };
    };
    const stored = JSON.stringify(verifyJson.content);
    expect(stored).toContain("data:image/svg+xml");
    expect(stored).toContain("javascript:alert(1)");

    // Create a snapshot of that malicious chapter content.
    const snapRes = await request.post(`/api/chapters/${chapterId}/snapshots`, {
      data: {},
    });
    expect(snapRes.ok()).toBeTruthy();
    const snapJson = (await snapRes.json()) as {
      status: string;
      snapshot?: { id: string };
    };
    expect(snapJson.status).toBe("created");
    expect(snapJson.snapshot?.id).toBeTruthy();

    // Now drive the UI: open the project, open the snapshot panel,
    // click View on the snapshot. EditorPage's renderSnapshotContent
    // pipes generateHTML output through sanitizeEditorHtml before
    // rendering via dangerouslySetInnerHTML.
    await page.goto(`/projects/${project.slug}`);
    await expect(page.getByRole("textbox")).toBeVisible();

    // Open snapshot panel (toolbar button labelled "Snapshots ...").
    await page.getByRole("button", { name: /^Snapshots/ }).click();
    const panel = page.getByRole("complementary", { name: "Chapter snapshots" });
    await expect(panel).toBeVisible();

    // Click "View" on the only snapshot. Wait for the snapshot banner.
    await panel.getByRole("button", { name: "View" }).first().click();
    await expect(page.getByText("Viewing snapshot:")).toBeVisible({ timeout: 5000 });

    // The snapshot content is rendered into a single .prose div via
    // dangerouslySetInnerHTML. Scope assertions to that div so we don't
    // pick up the malicious string from anywhere else (e.g. React props).
    const snapshotDiv = page.locator("div.prose").first();
    await expect(snapshotDiv).toBeVisible();

    // The benign text proves rendering happened (sanity check).
    await expect(snapshotDiv).toContainText("safe text before");

    // The actual sanitizer assertion: neither the data: nor javascript:
    // URI may appear inside the snapshot view's rendered HTML. The
    // sanitizer's uponSanitizeAttribute hook strips any src that is not
    // a relative /api/images/ path, so the <img> elements survive only
    // without their src attributes.
    const innerHtml = await snapshotDiv.innerHTML();
    expect(innerHtml.toLowerCase()).not.toContain("data:image");
    expect(innerHtml.toLowerCase()).not.toContain("javascript:");
    // S6 (review 2026-04-25): tighten the contract — no `<img>` may
    // survive with a `src` attribute at all (the sanitizer drops the
    // attribute outright when the URI is rejected). The negative-
    // presence checks above would also pass if a regression left an
    // empty `src=""` or partially-stripped attribute, so the regex
    // assertion catches that gap.
    expect(innerHtml).not.toMatch(/<img[^>]*\bsrc=/i);
  });
});
