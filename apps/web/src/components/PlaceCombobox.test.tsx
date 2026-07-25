import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { kaistPlace } from "../test/fixtures.js";
import { PlaceCombobox } from "./PlaceCombobox.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PlaceCombobox", () => {
  it("300ms 디바운스 후 검색하고 키보드로 장소를 선택한다", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ items: [kaistPlace] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <PlaceCombobox
          label="출발지"
          placeholder="출발 장소 검색"
          value={undefined}
          onChange={onChange}
        />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText("출발지");
    await user.type(input, "KAIST");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), {
      timeout: 1000,
    });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(kaistPlace);
    expect(input).toHaveValue("한국과학기술원 KAIST");
  });
});
