// The loading rows of docs/design.md 8.13.2 (openspec screens-align).
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOADING_DELAY_MS, LoadingRows } from "./common.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LoadingRows", () => {
  it("shows nothing for 300 ms, then skeleton rows and no Loading text", () => {
    vi.useFakeTimers();
    render(<LoadingRows rows={3} label="Loading the devices" />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(LOADING_DELAY_MS - 1);
    });
    expect(screen.queryByRole("status")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const status = screen.getByRole("status", { name: "Loading the devices" });
    expect(status.querySelectorAll(".MuiSkeleton-root")).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/Loading/);
  });
});
