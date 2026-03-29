import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewProjectDialog } from "../components/NewProjectDialog";

beforeEach(() => {
  cleanup();
});

// jsdom doesn't implement HTMLDialogElement.showModal/close, so we stub them
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

describe("NewProjectDialog", () => {
  it("calls showModal when opened", () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("calls close when open changes to false", () => {
    const { rerender } = render(
      <NewProjectDialog open={true} onClose={vi.fn()} onCreate={vi.fn()} />,
    );
    rerender(<NewProjectDialog open={false} onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it("renders the form fields", () => {
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByText("New Project")).toBeInTheDocument();
    expect(screen.getByText("Project title")).toBeInTheDocument();
    expect(screen.getByText("Fiction")).toBeInTheDocument();
    expect(screen.getByText("Non-fiction")).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onCreate with trimmed title and mode on submit", async () => {
    const onCreate = vi.fn();
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreate={onCreate} />);

    const input = screen.getByRole("textbox");
    await userEvent.type(input, "  My Novel  ");
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onCreate).toHaveBeenCalledWith("My Novel", "fiction");
  });

  it("resets form after submission", async () => {
    const onCreate = vi.fn();
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreate={onCreate} />);

    const input = screen.getByRole("textbox");
    await userEvent.type(input, "My Novel");
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect((input as HTMLInputElement).value).toBe("");
  });

  it("does not call onCreate when title is empty", () => {
    const onCreate = vi.fn();
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreate={onCreate} />);

    fireEvent.submit(screen.getByRole("textbox").closest("form") as HTMLFormElement);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("allows selecting nonfiction mode", async () => {
    const onCreate = vi.fn();
    render(<NewProjectDialog open={true} onClose={vi.fn()} onCreate={onCreate} />);

    const nonfiction = screen.getByLabelText("Non-fiction");
    await userEvent.click(nonfiction);

    const input = screen.getByRole("textbox");
    await userEvent.type(input, "My Memoir");
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onCreate).toHaveBeenCalledWith("My Memoir", "nonfiction");
  });

  it("calls onClose and resets form on cancel", async () => {
    const onClose = vi.fn();
    render(<NewProjectDialog open={true} onClose={onClose} onCreate={vi.fn()} />);

    const input = screen.getByRole("textbox");
    await userEvent.type(input, "Something");

    await userEvent.click(screen.getByText("Cancel"));

    expect(onClose).toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("");
  });
});
