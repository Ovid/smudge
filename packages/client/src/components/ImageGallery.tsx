import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import type { ImageRow } from "@smudge/shared";
import { api } from "../api/client";
import { STRINGS } from "../strings";

interface ImageGalleryProps {
  projectId: string;
  onInsertImage: (imageUrl: string, altText: string) => void;
  onNavigateToChapter: (chapterId: string) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ANNOUNCEMENT_DURATION = 3000;
const ACCEPTED_TYPES = "image/jpeg,image/png,image/gif,image/webp";

interface DetailFormState {
  alt_text: string;
  caption: string;
  source: string;
  license: string;
}

type SaveStatus = "idle" | "saving" | "saved";

export function ImageGallery({ projectId, onInsertImage, onNavigateToChapter }: ImageGalleryProps) {
  const [images, setImages] = useState<ImageRow[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageRow | null>(null);
  const [formState, setFormState] = useState<DetailFormState>({
    alt_text: "",
    caption: "",
    source: "",
    license: "",
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [announcement, setAnnouncement] = useState("");
  const [references, setReferences] = useState<Array<{ id: string; title: string }>>([]);
  const [referencesLoaded, setReferencesLoaded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const S = STRINGS.imageGallery;

  const announce = useCallback((message: string) => {
    if (announcementTimerRef.current) {
      clearTimeout(announcementTimerRef.current);
    }
    setAnnouncement(message);
    announcementTimerRef.current = setTimeout(() => {
      setAnnouncement("");
      announcementTimerRef.current = null;
    }, ANNOUNCEMENT_DURATION);
  }, []);

  // Counter to trigger re-fetch from event handlers without calling setState in useEffect
  const [refreshKey, incrementRefreshKey] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    let cancelled = false;
    api.images
      .list(projectId)
      .then((list) => {
        if (!cancelled) setImages(list);
      })
      .catch(() => {
        // Silently fail — the empty state handles it
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  useEffect(() => {
    return () => {
      if (announcementTimerRef.current) {
        clearTimeout(announcementTimerRef.current);
      }
    };
  }, []);

  // Load references when detail view opens
  const selectedImageId = selectedImage?.id ?? null;
  useEffect(() => {
    if (!selectedImageId) return;
    let cancelled = false;
    api.images
      .references(selectedImageId)
      .then((data) => {
        if (!cancelled) {
          setReferences(data.chapters);
          setReferencesLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReferences([]);
          setReferencesLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedImageId]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    e.target.value = "";

    if (file.size > MAX_FILE_SIZE) {
      announce(S.fileTooLarge);
      return;
    }

    api.images
      .upload(projectId, file)
      .then((newImage) => {
        announce(S.uploadSuccess(newImage.filename));
        incrementRefreshKey();
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : "Unknown error";
        announce(S.uploadFailed(reason));
      });
  }

  function openDetail(image: ImageRow) {
    setSelectedImage(image);
    setFormState({
      alt_text: image.alt_text,
      caption: image.caption,
      source: image.source,
      license: image.license,
    });
    setSaveStatus("idle");
    setConfirmingDelete(false);
    setReferencesLoaded(false);
  }

  function backToGrid() {
    setSelectedImage(null);
    setReferences([]);
    setReferencesLoaded(false);
    setConfirmingDelete(false);
  }

  async function handleSave() {
    if (!selectedImage) return;
    setSaveStatus("saving");
    try {
      const updated = await api.images.update(selectedImage.id, formState);
      setSelectedImage(updated);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("idle");
    }
  }

  async function handleInsert() {
    if (!selectedImage) return;
    // Auto-save pending metadata changes before inserting so the DB stays in sync
    if (saveStatus !== "saved" && saveStatus !== "saving") {
      try {
        setSaveStatus("saving");
        const updated = await api.images.update(selectedImage.id, formState);
        setSelectedImage(updated);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("idle");
      }
    }
    onInsertImage(`/api/images/${selectedImage.id}`, formState.alt_text);
    announce(S.insertSuccess(selectedImage.filename));
  }

  async function handleDelete() {
    if (!selectedImage) return;

    try {
      const result = await api.images.delete(selectedImage.id);
      if ("error" in result) {
        // Image is in use — blocked
        return;
      }
      setSelectedImage(null);
      setConfirmingDelete(false);
      incrementRefreshKey();
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      announce(S.deleteFailed(reason));
      setConfirmingDelete(false);
    }
  }

  function updateField(field: keyof DetailFormState, value: string) {
    setFormState((prev) => ({ ...prev, [field]: value }));
    if (saveStatus === "saved") setSaveStatus("idle");
  }

  // --- Grid View ---
  if (!selectedImage) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-border/40">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring shadow-sm"
          >
            {S.uploadButton}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {images.length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">{S.noImages}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-4 overflow-y-auto">
            {images.map((image) => (
              <button
                key={image.id}
                onClick={() => openDetail(image)}
                aria-label={`${image.filename}${image.reference_count === 0 ? `, ${S.unusedBadge}` : ""}`}
                className="relative aspect-square rounded-lg overflow-hidden border border-border/40 hover:border-accent focus:outline-none focus:ring-2 focus:ring-focus-ring group"
              >
                <img
                  src={`/api/images/${image.id}`}
                  alt={image.alt_text || image.filename}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity flex flex-col justify-end p-1.5">
                  <span className="text-xs text-white truncate">{image.filename}</span>
                  {image.reference_count === 0 && (
                    <span className="text-xs text-amber-300">{S.unusedBadge}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>
    );
  }

  // --- Detail View ---
  // Once references have loaded from the server, use that as the source of truth
  // instead of the potentially-stale reference_count from the image list.
  const isUsed = referencesLoaded ? references.length > 0 : selectedImage.reference_count > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-border/40">
        <button
          onClick={backToGrid}
          className="text-sm text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-2 py-1"
        >
          {S.backToGrid}
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Image preview */}
        <div className="rounded-lg overflow-hidden border border-border/40">
          <img
            src={`/api/images/${selectedImage.id}`}
            alt={selectedImage.alt_text || selectedImage.filename}
            className="w-full object-contain max-h-64"
          />
        </div>

        {/* Metadata form */}
        <div className="space-y-3">
          <div>
            <label
              htmlFor="img-alt-text"
              className="block text-xs font-medium text-text-secondary mb-1"
            >
              {S.altTextLabel}
            </label>
            <input
              id="img-alt-text"
              type="text"
              value={formState.alt_text}
              onChange={(e) => updateField("alt_text", e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            {!formState.alt_text && <p className="text-xs text-status-error mt-1">{S.noAltText}</p>}
          </div>

          <div>
            <label
              htmlFor="img-caption"
              className="block text-xs font-medium text-text-secondary mb-1"
            >
              {S.captionLabel}
            </label>
            <input
              id="img-caption"
              type="text"
              value={formState.caption}
              onChange={(e) => updateField("caption", e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
          </div>

          <div>
            <label
              htmlFor="img-source"
              className="block text-xs font-medium text-text-secondary mb-1"
            >
              {S.sourceLabel}
            </label>
            <input
              id="img-source"
              type="text"
              value={formState.source}
              onChange={(e) => updateField("source", e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
          </div>

          <div>
            <label
              htmlFor="img-license"
              className="block text-xs font-medium text-text-secondary mb-1"
            >
              {S.licenseLabel}
            </label>
            <input
              id="img-license"
              type="text"
              value={formState.license}
              onChange={(e) => updateField("license", e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleSave}
            disabled={saveStatus === "saving"}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring shadow-sm disabled:opacity-60"
          >
            {saveStatus === "saving" ? S.saving : saveStatus === "saved" ? S.saved : S.saveButton}
          </button>

          <button
            onClick={handleInsert}
            className="w-full rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {S.insertButton}
          </button>
        </div>

        {/* Where-used section */}
        {isUsed && references.length > 0 && (
          <div>
            <p className="text-xs font-medium text-text-secondary mb-1">{S.usedInChapters}</p>
            <ul className="space-y-1">
              {references.map((chapter) => (
                <li key={chapter.id}>
                  <button
                    onClick={() => onNavigateToChapter(chapter.id)}
                    className="text-sm text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-1"
                  >
                    {chapter.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Delete section */}
        <div className="pt-2 border-t border-border/40">
          {confirmingDelete ? (
            isUsed ? (
              <p className="text-sm text-status-error">
                {S.deleteBlocked(references.map((r) => r.title))}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-sm text-text-secondary flex-1">{S.deleteConfirm}</p>
                <button
                  onClick={handleDelete}
                  className="rounded-lg bg-status-error px-4 py-1.5 text-sm font-medium text-text-inverse hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring shadow-sm"
                >
                  {S.deleteButton}
                </button>
              </div>
            )
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="text-sm text-status-error hover:underline focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-1"
            >
              {S.deleteButton}
            </button>
          )}
        </div>
      </div>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
