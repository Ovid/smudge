import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageGallery } from "../components/ImageGallery";
import { api, ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import type { ImageRow } from "@smudge/shared";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    api: {
      images: {
        list: vi.fn(),
        upload: vi.fn(),
        references: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

const S = STRINGS.imageGallery;

/** Build the aria-label that the grid button gets for a given image */
function imageButtonName(image: ImageRow): string {
  return image.reference_count === 0 ? `${image.filename}, ${S.unusedBadge}` : image.filename;
}

function makeImage(overrides: Partial<ImageRow> = {}): ImageRow {
  return {
    id: "img-1",
    project_id: "proj-1",
    filename: "photo.png",
    alt_text: "A photo",
    caption: "Photo caption",
    source: "Photo source",
    license: "MIT",
    mime_type: "image/png",
    size_bytes: 1024,
    reference_count: 0,
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultProps = {
  projectId: "proj-1",
  onInsertImage: vi.fn(),
  onNavigateToChapter: vi.fn(),
};

/** Helper: render gallery, wait for images to load, click an image to open detail view */
async function renderAndOpenDetail(
  image: ImageRow,
  user: ReturnType<typeof userEvent.setup>,
  props: Partial<typeof defaultProps> = {},
) {
  const btnName = imageButtonName(image);
  vi.mocked(api.images.list).mockResolvedValue([image]);
  render(<ImageGallery {...defaultProps} {...props} />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: btnName })).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: btnName }));
}

describe("ImageGallery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(api.images.list).mockResolvedValue([]);
    vi.mocked(api.images.references).mockResolvedValue({ chapters: [] });
  });

  afterEach(() => {
    cleanup();
  });

  // --- Grid view ---

  it("renders empty state when no images exist", async () => {
    render(<ImageGallery {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(S.noImages)).toBeInTheDocument();
    });
  });

  it("renders upload button", () => {
    render(<ImageGallery {...defaultProps} />);
    expect(screen.getByText(S.uploadButton)).toBeInTheDocument();
  });

  it("renders image grid when images are loaded", async () => {
    const images = [
      makeImage({ id: "img-1", filename: "photo1.png", reference_count: 1 }),
      makeImage({ id: "img-2", filename: "photo2.png", reference_count: 0 }),
    ];
    vi.mocked(api.images.list).mockResolvedValue(images);

    render(<ImageGallery {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "photo1.png" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `photo2.png, ${S.unusedBadge}` }),
      ).toBeInTheDocument();
    });
  });

  it("shows unused badge for images with zero references", async () => {
    vi.mocked(api.images.list).mockResolvedValue([
      makeImage({ id: "img-1", filename: "unused.png", reference_count: 0 }),
    ]);

    render(<ImageGallery {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(S.unusedBadge)).toBeInTheDocument();
    });
  });

  it("does not show unused badge for images with references", async () => {
    vi.mocked(api.images.list).mockResolvedValue([
      makeImage({ id: "img-1", filename: "used.png", reference_count: 2 }),
    ]);

    render(<ImageGallery {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "used.png" })).toBeInTheDocument();
    });
    expect(screen.queryByText(S.unusedBadge)).not.toBeInTheDocument();
  });

  // --- Upload ---

  it("announces success after uploading a file", async () => {
    const user = userEvent.setup();
    const newImage = makeImage({ id: "img-new", filename: "uploaded.png" });
    vi.mocked(api.images.upload).mockResolvedValue(newImage);

    render(<ImageGallery {...defaultProps} />);

    const file = new File(["pixels"], "uploaded.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(S.uploadSuccess("uploaded.png"))).toBeInTheDocument();
    });
  });

  it("announces generic error when upload fails with ApiRequestError", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.upload).mockRejectedValue(new ApiRequestError("Server error", 500));

    render(<ImageGallery {...defaultProps} />);

    const file = new File(["pixels"], "bad.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(S.uploadFailedGeneric)).toBeInTheDocument();
    });
  });

  it("announces generic error for non-Error upload failures", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.upload).mockRejectedValue("something weird");

    render(<ImageGallery {...defaultProps} />);

    const file = new File(["pixels"], "bad.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(S.uploadFailedGeneric)).toBeInTheDocument();
    });
  });

  // I3 (2026-04-24 review): 2xx BAD_JSON on upload means the server stored
  // the image but the client couldn't parse the response. Without special
  // handling the gallery kept its stale list, the user retried, and the
  // server created a second row for the same file (no server-side dedupe).
  // The fix: surface the committed copy and call incrementRefreshKey so
  // the authoritative list is fetched — future retry sees the row and
  // stops duplicating uploads.
  it("on 2xx BAD_JSON, announces committed copy and re-fetches gallery (I3)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.list).mockResolvedValue([]);
    vi.mocked(api.images.upload).mockRejectedValue(
      new ApiRequestError("[dev] bad body", 200, "BAD_JSON"),
    );

    render(<ImageGallery {...defaultProps} />);

    await waitFor(() => {
      expect(api.images.list).toHaveBeenCalledTimes(1);
    });

    const file = new File(["pixels"], "committed.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(S.uploadCommittedRefresh)).toBeInTheDocument();
    });
    // Gallery re-fetches after possiblyCommitted so the authoritative
    // list includes the newly-stored image and prevents duplicate
    // uploads on retry.
    await waitFor(() => {
      expect(api.images.list).toHaveBeenCalledTimes(2);
    });
  });

  it("stays silent when upload is aborted", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.upload).mockRejectedValue(new ApiRequestError("aborted", 0, "ABORTED"));

    render(<ImageGallery {...defaultProps} />);

    const file = new File(["pixels"], "bad.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(api.images.upload).toHaveBeenCalled();
    });
    expect(screen.queryByText(S.uploadFailedGeneric)).not.toBeInTheDocument();
  });

  it("rejects files larger than 10MB", async () => {
    const user = userEvent.setup();

    render(<ImageGallery {...defaultProps} />);

    const bigFile = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(bigFile, "size", { value: 11 * 1024 * 1024 });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, bigFile);

    await waitFor(() => {
      expect(screen.getByText(S.fileTooLarge)).toBeInTheDocument();
    });
    expect(api.images.upload).not.toHaveBeenCalled();
  });

  // --- Detail view ---

  it("opens detail view when clicking an image", async () => {
    const user = userEvent.setup();
    const image = makeImage({ alt_text: "A photo" });
    await renderAndOpenDetail(image, user);

    expect(screen.getByText(S.backToGrid)).toBeInTheDocument();
    expect(screen.getByLabelText(S.altTextLabel)).toHaveValue("A photo");
    expect(screen.getByLabelText(S.captionLabel)).toHaveValue("Photo caption");
    expect(screen.getByLabelText(S.sourceLabel)).toHaveValue("Photo source");
    expect(screen.getByLabelText(S.licenseLabel)).toHaveValue("MIT");
  });

  it("populates form fields from the selected image", async () => {
    const user = userEvent.setup();
    const image = makeImage({
      alt_text: "My alt",
      caption: "My caption",
      source: "My source",
      license: "CC-BY",
    });
    await renderAndOpenDetail(image, user);

    expect(screen.getByLabelText(S.altTextLabel)).toHaveValue("My alt");
    expect(screen.getByLabelText(S.captionLabel)).toHaveValue("My caption");
    expect(screen.getByLabelText(S.sourceLabel)).toHaveValue("My source");
    expect(screen.getByLabelText(S.licenseLabel)).toHaveValue("CC-BY");
  });

  it("shows no-alt-text warning when alt_text is empty", async () => {
    const user = userEvent.setup();
    const image = makeImage({ alt_text: "" });
    await renderAndOpenDetail(image, user);

    expect(screen.getByText(S.noAltText)).toBeInTheDocument();
  });

  it("hides no-alt-text warning when alt_text is provided", async () => {
    const user = userEvent.setup();
    const image = makeImage({ alt_text: "Has alt" });
    await renderAndOpenDetail(image, user);

    expect(screen.queryByText(S.noAltText)).not.toBeInTheDocument();
  });

  it("shows no-alt-text warning after clearing alt text field", async () => {
    const user = userEvent.setup();
    const image = makeImage({ alt_text: "Has alt" });
    await renderAndOpenDetail(image, user);

    const altInput = screen.getByLabelText(S.altTextLabel);
    await user.clear(altInput);

    expect(screen.getByText(S.noAltText)).toBeInTheDocument();
  });

  it("navigates back to grid when back button is clicked", async () => {
    const user = userEvent.setup();
    await renderAndOpenDetail(makeImage(), user);

    expect(screen.getByText(S.backToGrid)).toBeInTheDocument();
    await user.click(screen.getByText(S.backToGrid));

    expect(screen.getByText(S.uploadButton)).toBeInTheDocument();
  });

  // --- Save ---

  it("saves metadata and shows saved status", async () => {
    const user = userEvent.setup();
    const image = makeImage();
    const updatedImage = makeImage({ alt_text: "Updated alt" });
    vi.mocked(api.images.update).mockResolvedValue(updatedImage);
    await renderAndOpenDetail(image, user);

    const altInput = screen.getByLabelText(S.altTextLabel);
    await user.clear(altInput);
    await user.type(altInput, "Updated alt");

    await user.click(screen.getByText(S.saveButton));

    await waitFor(() => {
      expect(screen.getByText(S.saved)).toBeInTheDocument();
    });
    expect(api.images.update).toHaveBeenCalledWith("img-1", {
      alt_text: "Updated alt",
      caption: "Photo caption",
      source: "Photo source",
      license: "MIT",
    });
  });

  it("shows saving text while save is in flight", async () => {
    const user = userEvent.setup();
    let resolveSave!: (img: ImageRow) => void;
    vi.mocked(api.images.update).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    await renderAndOpenDetail(makeImage(), user);

    // Edit a field to transition from "saved" (initial) to "idle"
    await user.type(screen.getByLabelText(S.captionLabel), "x");
    await user.click(screen.getByText(S.saveButton));

    await waitFor(() => {
      expect(screen.getByText(S.saving)).toBeInTheDocument();
    });

    resolveSave(makeImage());
    await waitFor(() => {
      expect(screen.getByText(S.saved)).toBeInTheDocument();
    });
  });

  it("reverts save status to idle on save failure", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.update).mockRejectedValue(new Error("Save failed"));
    await renderAndOpenDetail(makeImage(), user);

    // Edit a field to transition from "saved" (initial) to "idle"
    await user.type(screen.getByLabelText(S.captionLabel), "x");
    await user.click(screen.getByText(S.saveButton));

    await waitFor(() => {
      expect(screen.getByText(S.saveButton)).toBeInTheDocument();
    });
  });

  it("resets save status to idle when editing after save", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.update).mockResolvedValue(makeImage());
    await renderAndOpenDetail(makeImage(), user);

    // Edit a field to transition from "saved" (initial) to "idle"
    await user.type(screen.getByLabelText(S.captionLabel), "x");
    await user.click(screen.getByText(S.saveButton));

    await waitFor(() => {
      expect(screen.getByText(S.saved)).toBeInTheDocument();
    });

    const captionInput = screen.getByLabelText(S.captionLabel);
    await user.type(captionInput, "x");

    expect(screen.getByText(S.saveButton)).toBeInTheDocument();
  });

  // --- Insert ---

  it("calls onInsertImage with correct URL and alt text", async () => {
    const user = userEvent.setup();
    const onInsertImage = vi.fn();
    const image = makeImage({ id: "img-42", alt_text: "My image" });
    vi.mocked(api.images.update).mockResolvedValue(image);
    await renderAndOpenDetail(image, user, { onInsertImage });

    await user.click(screen.getByText(S.insertButton));

    await waitFor(() => {
      expect(onInsertImage).toHaveBeenCalledWith("/api/images/img-42", "My image");
    });
  });

  it("announces insert success", async () => {
    const user = userEvent.setup();
    const image = makeImage({ filename: "hero.png" });
    vi.mocked(api.images.update).mockResolvedValue(image);
    await renderAndOpenDetail(image, user);

    await user.click(screen.getByText(S.insertButton));

    await waitFor(() => {
      expect(screen.getByText(S.insertSuccess("hero.png"))).toBeInTheDocument();
    });
  });

  // --- Delete ---

  it("shows confirmation prompt when delete is clicked", async () => {
    const user = userEvent.setup();
    await renderAndOpenDetail(makeImage(), user);

    await user.click(screen.getByText(S.deleteButton));

    expect(screen.getByText(S.deleteConfirm)).toBeInTheDocument();
  });

  it("deletes unused image and returns to grid", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.delete).mockResolvedValue({ deleted: true });
    await renderAndOpenDetail(makeImage({ reference_count: 0 }), user);

    // First click shows confirmation
    await user.click(screen.getByText(S.deleteButton));
    // Second click actually deletes
    await user.click(screen.getByText(S.deleteButton));

    await waitFor(() => {
      expect(screen.getByText(S.uploadButton)).toBeInTheDocument();
    });
    expect(api.images.delete).toHaveBeenCalledWith("img-1");
  });

  it("announces deletion success for screen readers", async () => {
    const user = userEvent.setup();
    const image = makeImage({ reference_count: 0, filename: "sunset.png" });
    vi.mocked(api.images.delete).mockResolvedValue({ deleted: true });
    await renderAndOpenDetail(image, user);

    await user.click(screen.getByText(S.deleteButton));
    await user.click(screen.getByText(S.deleteButton));

    await waitFor(() => {
      expect(screen.getByText(S.deleteSuccess("sunset.png"))).toBeInTheDocument();
    });
  });

  // C3 (review 2026-04-24): handleDelete ignored possiblyCommitted. On
  // 2xx BAD_JSON the server already deleted but the detail view stayed
  // open, confirmingDelete stayed true, and incrementRefreshKey was not
  // called. User retried → server 409'd because the image was gone.
  // Mirror handleFileSelect's committed branch: close the detail view,
  // reset confirmation, bump the refresh key, and surface the mapped
  // committed copy.
  it("on 2xx BAD_JSON delete, closes detail view and re-fetches gallery (C3)", async () => {
    const user = userEvent.setup();
    const image = makeImage({ reference_count: 0, filename: "gone.png" });
    vi.mocked(api.images.delete).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );
    await renderAndOpenDetail(image, user);

    await waitFor(() => {
      expect(api.images.list).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByText(S.deleteButton));
    await user.click(screen.getByText(S.deleteButton));

    // Detail view closes → grid (upload button visible again)
    await waitFor(() => {
      expect(screen.getByText(S.uploadButton)).toBeInTheDocument();
    });
    // Gallery re-fetched so the deleted image disappears from the grid
    // and a retry can't 409 against a stale row.
    await waitFor(() => {
      expect(api.images.list).toHaveBeenCalledTimes(2);
    });
  });

  it("shows delete-blocked message for images in use", async () => {
    const user = userEvent.setup();
    const image = makeImage({ reference_count: 2 });
    vi.mocked(api.images.references).mockResolvedValue({
      chapters: [
        { id: "ch-1", title: "Chapter One" },
        { id: "ch-2", title: "Chapter Two" },
      ],
    });
    await renderAndOpenDetail(image, user);

    // Wait for references to load
    await waitFor(() => {
      expect(screen.getByText(S.usedInChapters)).toBeInTheDocument();
    });

    // Click delete — should show blocked message with clickable chapter links
    await user.click(screen.getByText(S.deleteButton));

    expect(screen.getByText(S.deleteBlockedPrefix)).toBeInTheDocument();
    expect(screen.getByText(S.deleteBlockedSuffix)).toBeInTheDocument();
    // Chapter titles appear in both "Used in" and delete-blocked sections
    expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Chapter Two").length).toBeGreaterThanOrEqual(2);
  });

  it("re-fetches references when delete button is clicked", async () => {
    const user = userEvent.setup();
    const image = makeImage({ reference_count: 1 });
    // Initial fetch shows references, second fetch (on delete click) shows none
    vi.mocked(api.images.references)
      .mockResolvedValueOnce({ chapters: [{ id: "ch-1", title: "Chapter One" }] })
      .mockResolvedValueOnce({ chapters: [] });
    await renderAndOpenDetail(image, user);

    await waitFor(() => {
      expect(screen.getByText("Chapter One")).toBeInTheDocument();
    });

    // Click delete — triggers re-fetch that returns empty references
    await user.click(screen.getByText(S.deleteButton));

    // After re-fetch resolves, should show delete confirmation (not blocked)
    await waitFor(() => {
      expect(screen.getByText(S.deleteConfirm)).toBeInTheDocument();
    });
    expect(api.images.references).toHaveBeenCalledTimes(2);
  });

  // Review 2026-04-24: the Delete-click references refresh had no
  // stale-guard. User opens A, clicks Delete (starts A's refresh),
  // navigates back to grid and opens B. When A's in-flight refresh
  // finally resolves, it must NOT overwrite B's detail-view references
  // (which could enable a delete that should have been blocked, or
  // surface a stale "Used in" list for a different image).
  it("delete-click references refresh does not leak across image-selection change", async () => {
    const user = userEvent.setup();
    const imageA = makeImage({ id: "img-A", filename: "a.png", reference_count: 2 });
    const imageB = makeImage({ id: "img-B", filename: "b.png", reference_count: 0 });

    vi.mocked(api.images.list).mockResolvedValue([imageA, imageB]);

    // Hold the Delete-click refresh for A open so we can resolve it
    // AFTER the user has navigated to a different image.
    let resolveStaleRefresh!: (data: { chapters: Array<{ id: string; title: string }> }) => void;
    const deferredStaleRefresh = new Promise<{
      chapters: Array<{ id: string; title: string }>;
    }>((resolve) => {
      resolveStaleRefresh = resolve;
    });

    vi.mocked(api.images.references)
      // A's mount-load references
      .mockResolvedValueOnce({ chapters: [{ id: "ch-A", title: "Chapter A" }] })
      // A's Delete-click refresh — deferred
      .mockReturnValueOnce(deferredStaleRefresh)
      // B's mount-load references
      .mockResolvedValueOnce({ chapters: [] });

    render(<ImageGallery {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "a.png" })).toBeInTheDocument();
    });

    // Open A — mount-load fires and resolves with Chapter A
    await user.click(screen.getByRole("button", { name: "a.png" }));
    await waitFor(() => {
      expect(screen.getByText("Chapter A")).toBeInTheDocument();
    });

    // Click Delete — starts the Delete-click refresh (still pending).
    await user.click(screen.getByText(S.deleteButton));

    // Navigate back to grid and open B before the stale refresh resolves.
    await user.click(screen.getByText(S.backToGrid));
    await user.click(screen.getByRole("button", { name: `b.png, ${S.unusedBadge}` }));
    await waitFor(() => {
      expect(api.images.references).toHaveBeenCalledWith("img-B", expect.any(AbortSignal));
    });

    // Now resolve the stale A-refresh with A's references.
    resolveStaleRefresh({ chapters: [{ id: "ch-A-stale", title: "Chapter A stale" }] });
    // Give React a tick to process the resolved promise.
    await new Promise((r) => setTimeout(r, 10));

    // B's detail view must not surface A's stale references, and must
    // not mis-gate the Delete button by flipping into the "in use" path.
    expect(screen.queryByText("Chapter A stale")).not.toBeInTheDocument();
    expect(screen.queryByText(S.usedInChapters)).not.toBeInTheDocument();
    // B has reference_count: 0, so Delete should remain the unblocked copy.
    await user.click(screen.getByText(S.deleteButton));
    expect(screen.getByText(S.deleteConfirm)).toBeInTheDocument();
  });

  // --- Where-used / references ---

  it("shows chapters where image is used", async () => {
    const user = userEvent.setup();
    const image = makeImage({ reference_count: 1 });
    vi.mocked(api.images.references).mockResolvedValue({
      chapters: [{ id: "ch-1", title: "The Beginning" }],
    });
    await renderAndOpenDetail(image, user);

    await waitFor(() => {
      expect(screen.getByText("The Beginning")).toBeInTheDocument();
    });
    expect(screen.getByText(S.usedInChapters)).toBeInTheDocument();
  });

  it("calls onNavigateToChapter when a chapter reference is clicked", async () => {
    const user = userEvent.setup();
    const onNavigateToChapter = vi.fn();
    const image = makeImage({ reference_count: 1 });
    vi.mocked(api.images.references).mockResolvedValue({
      chapters: [{ id: "ch-99", title: "Chapter Ninety-Nine" }],
    });
    await renderAndOpenDetail(image, user, { onNavigateToChapter });

    await waitFor(() => {
      expect(screen.getByText("Chapter Ninety-Nine")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Chapter Ninety-Nine"));

    expect(onNavigateToChapter).toHaveBeenCalledWith("ch-99");
  });

  it("does not show where-used section for unused images", async () => {
    const user = userEvent.setup();
    const image = makeImage({ reference_count: 0 });
    vi.mocked(api.images.references).mockResolvedValue({ chapters: [] });
    await renderAndOpenDetail(image, user);

    await waitFor(() => {
      expect(api.images.references).toHaveBeenCalled();
    });
    expect(screen.queryByText(S.usedInChapters)).not.toBeInTheDocument();
  });

  // --- Error handling ---

  it("shows error state with retry button on list API failure", async () => {
    vi.mocked(api.images.list).mockRejectedValue(new Error("Network failure"));

    render(<ImageGallery {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(S.loadFailed)).toBeInTheDocument();
    });
    expect(screen.getByText(S.retryButton)).toBeInTheDocument();
  });

  // I9 (review 2026-04-24): the list useEffect no longer uses a
  // `let cancelled` flag. An AbortController drops the request on
  // unmount / projectId change so the browser does not waste work and
  // the ABORTED → message:null guard is reachable.
  it("aborts in-flight images.list on unmount (I9)", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.images.list).mockImplementation((_id, signal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    const { unmount } = render(<ImageGallery {...defaultProps} />);
    await waitFor(() => expect(api.images.list).toHaveBeenCalled());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("stays silent when list request is aborted (no loadError banner)", async () => {
    vi.mocked(api.images.list).mockRejectedValue(new ApiRequestError("aborted", 0, "ABORTED"));

    render(<ImageGallery {...defaultProps} />);

    await waitFor(() => {
      expect(api.images.list).toHaveBeenCalled();
    });
    expect(screen.queryByText(S.loadFailed)).not.toBeInTheDocument();
    expect(screen.queryByText(S.retryButton)).not.toBeInTheDocument();
  });

  it("retries loading images when retry button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.list)
      .mockRejectedValueOnce(new Error("Network failure"))
      .mockResolvedValueOnce([makeImage({ filename: "recovered.png" })]);

    render(<ImageGallery {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(S.loadFailed)).toBeInTheDocument();
    });

    await user.click(screen.getByText(S.retryButton));

    await waitFor(() => {
      expect(screen.queryByText(S.loadFailed)).not.toBeInTheDocument();
    });
  });

  it("handles references API failure gracefully", async () => {
    const user = userEvent.setup();
    const image = makeImage({ reference_count: 1 });
    vi.mocked(api.images.references).mockRejectedValue(new Error("Ref fail"));
    await renderAndOpenDetail(image, user);

    await waitFor(() => {
      expect(api.images.references).toHaveBeenCalled();
    });
    // reference_count > 0 but references array is empty due to error, so section hidden
    expect(screen.queryByText(S.usedInChapters)).not.toBeInTheDocument();
  });

  it("announces mapped references failure instead of silently swallowing (I6)", async () => {
    const user = userEvent.setup();
    const image = makeImage({ reference_count: 1 });
    vi.mocked(api.images.references).mockRejectedValue(
      new ApiRequestError("boom", 500, "INTERNAL_ERROR"),
    );
    await renderAndOpenDetail(image, user);

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toContain(S.referencesLoadFailed);
    });
  });

  it("stays silent when references fetch is aborted (I6)", async () => {
    const user = userEvent.setup();
    const image = makeImage({ reference_count: 1 });
    vi.mocked(api.images.references).mockRejectedValue(
      new ApiRequestError("aborted", 0, "ABORTED"),
    );
    await renderAndOpenDetail(image, user);

    await waitFor(() => {
      expect(api.images.references).toHaveBeenCalled();
    });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent ?? "").not.toContain(S.referencesLoadFailed);
  });

  it("handles delete API returning an in-use error", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.delete).mockRejectedValue(
      new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
        chapters: [{ id: "ch-1", title: "Chapter One" }],
      }),
    );
    await renderAndOpenDetail(makeImage({ reference_count: 0 }), user);

    // Show confirm, then click delete
    await user.click(screen.getByText(S.deleteButton));
    await user.click(screen.getByText(S.deleteButton));

    // Should stay in detail view (not go back to grid) because delete was blocked
    await waitFor(() => {
      expect(screen.getByText(S.backToGrid)).toBeInTheDocument();
    });
  });

  it("announces blocked message with chapter list when server returns 409 IMAGE_IN_USE", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.delete).mockRejectedValue(
      new ApiRequestError("in use", 409, "IMAGE_IN_USE", {
        chapters: [
          { id: "ch-1", title: "Chapter One" },
          { id: "ch-2", title: "Chapter Two", trashed: true },
        ],
      }),
    );
    await renderAndOpenDetail(makeImage({ reference_count: 0 }), user);

    await user.click(screen.getByText(S.deleteButton));
    await user.click(screen.getByText(S.deleteButton));

    await waitFor(() => {
      expect(
        screen.getByText(S.deleteBlocked(["Chapter One", `Chapter Two (${S.inTrash})`])),
      ).toBeInTheDocument();
    });
  });

  it("announces generic delete failure when server returns non-409 error", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.delete).mockRejectedValue(
      new ApiRequestError("boom", 500, "INTERNAL_ERROR"),
    );
    await renderAndOpenDetail(makeImage({ reference_count: 0 }), user);

    await user.click(screen.getByText(S.deleteButton));
    await user.click(screen.getByText(S.deleteButton));

    await waitFor(() => {
      expect(screen.getByText(S.deleteFailedGeneric)).toBeInTheDocument();
    });
  });

  it("silently swallows an ABORTED delete (no announcement)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.delete).mockRejectedValue(new ApiRequestError("aborted", 0, "ABORTED"));
    await renderAndOpenDetail(makeImage({ reference_count: 0 }), user);

    await user.click(screen.getByText(S.deleteButton));
    await user.click(screen.getByText(S.deleteButton));

    // No announcement should surface, and the detail view should remain.
    await waitFor(() => {
      expect(api.images.delete).toHaveBeenCalled();
    });
    expect(screen.queryByText(S.deleteFailedGeneric)).not.toBeInTheDocument();
    expect(screen.getByText(S.backToGrid)).toBeInTheDocument();
  });

  // --- Aria live region ---

  it("has an aria-live region for announcements", () => {
    render(<ImageGallery {...defaultProps} />);
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });

  // --- Editing form fields ---

  it("allows editing all four metadata fields", async () => {
    const user = userEvent.setup();
    await renderAndOpenDetail(makeImage(), user);

    const altInput = screen.getByLabelText(S.altTextLabel);
    const captionInput = screen.getByLabelText(S.captionLabel);
    const sourceInput = screen.getByLabelText(S.sourceLabel);
    const licenseInput = screen.getByLabelText(S.licenseLabel);

    await user.clear(altInput);
    await user.type(altInput, "new alt");
    await user.clear(captionInput);
    await user.type(captionInput, "new caption");
    await user.clear(sourceInput);
    await user.type(sourceInput, "new source");
    await user.clear(licenseInput);
    await user.type(licenseInput, "new license");

    expect(altInput).toHaveValue("new alt");
    expect(captionInput).toHaveValue("new caption");
    expect(sourceInput).toHaveValue("new source");
    expect(licenseInput).toHaveValue("new license");
  });

  it("uses server-returned alt text for insert after auto-save", async () => {
    const user = userEvent.setup();
    const onInsertImage = vi.fn();
    const image = makeImage({ id: "img-1", alt_text: "Original" });
    vi.mocked(api.images.update).mockResolvedValue(
      makeImage({ id: "img-1", alt_text: "Edited alt" }),
    );
    await renderAndOpenDetail(image, user, { onInsertImage });

    const altInput = screen.getByLabelText(S.altTextLabel);
    await user.clear(altInput);
    await user.type(altInput, "Edited alt");

    await user.click(screen.getByText(S.insertButton));

    await waitFor(() => {
      expect(onInsertImage).toHaveBeenCalledWith("/api/images/img-1", "Edited alt");
    });
  });

  it("fetches images on mount with the correct project ID", () => {
    render(<ImageGallery {...defaultProps} projectId="proj-abc" />);
    expect(api.images.list).toHaveBeenCalledWith("proj-abc", expect.any(AbortSignal));
  });

  it("resets confirming-delete state when navigating back to grid", async () => {
    const user = userEvent.setup();
    const image = makeImage();
    const btnName = imageButtonName(image);
    await renderAndOpenDetail(image, user);

    // Start delete flow
    await user.click(screen.getByText(S.deleteButton));
    expect(screen.getByText(S.deleteConfirm)).toBeInTheDocument();

    // Go back to grid
    await user.click(screen.getByText(S.backToGrid));

    // Re-open same image
    await waitFor(() => {
      expect(screen.getByRole("button", { name: btnName })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: btnName }));

    // Should not show confirmation — delete state was reset
    expect(screen.queryByText(S.deleteConfirm)).not.toBeInTheDocument();
  });
});
