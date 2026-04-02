import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectSettingsDialog } from "../components/ProjectSettingsDialog";
import { api } from "../api/client";

vi.mock("../api/client");

const defaultProject = {
  id: "1",
  slug: "test",
  title: "Test",
  mode: "fiction" as const,
  target_word_count: null as number | null,
  target_deadline: null as string | null,
  completion_threshold: "final" as string,
  created_at: "",
  updated_at: "",
};

describe("ProjectSettingsDialog", () => {
  const onClose = vi.fn();
  const onUpdate = vi.fn();

  beforeEach(() => {
    vi.mocked(api.projects.update).mockResolvedValue(defaultProject as any);
    onClose.mockClear();
    onUpdate.mockClear();
  });

  it("renders word count target input", () => {
    render(
      <ProjectSettingsDialog open={true} project={defaultProject as any} onClose={onClose} onUpdate={onUpdate} />
    );
    expect(screen.getByLabelText(/word count target/i)).toBeInTheDocument();
  });

  it("renders deadline input", () => {
    render(
      <ProjectSettingsDialog open={true} project={defaultProject as any} onClose={onClose} onUpdate={onUpdate} />
    );
    expect(screen.getByLabelText(/deadline/i)).toBeInTheDocument();
  });

  it("renders completion threshold dropdown", () => {
    render(
      <ProjectSettingsDialog open={true} project={defaultProject as any} onClose={onClose} onUpdate={onUpdate} />
    );
    expect(screen.getByLabelText(/chapter counts as complete/i)).toBeInTheDocument();
  });

  it("saves changes on input blur", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSettingsDialog open={true} project={defaultProject as any} onClose={onClose} onUpdate={onUpdate} />
    );
    const input = screen.getByLabelText(/word count target/i);
    await user.clear(input);
    await user.type(input, "80000");
    await user.tab(); // blur triggers save

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalled();
    });
  });
});
