import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTRO_SESSION_KEY,
  IntroSequence,
  shouldPlayIntro,
} from "./IntroSequence.js";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("IntroSequence", () => {
  it("경로 리빌과 종료를 순서대로 실행하고 세션에 기록한다", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const onComplete = vi.fn();
    render(
      <IntroSequence onReveal={onReveal} onComplete={onComplete} />,
    );

    expect(
      screen.getByRole("dialog", { name: "CHIMap 시작 화면" }),
    ).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_200));
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(800));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(INTRO_SESSION_KEY)).toBe("1");
  });

  it("건너뛰기 버튼으로 즉시 앱을 공개한다", () => {
    const onReveal = vi.fn();
    const onComplete = vi.fn();
    render(
      <IntroSequence onReveal={onReveal} onComplete={onComplete} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "인트로 건너뛰기" }),
    );

    expect(onReveal).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(INTRO_SESSION_KEY)).toBe("1");
  });

  it("반복 방문이나 reduced motion 환경에서는 재생하지 않는다", () => {
    sessionStorage.setItem(INTRO_SESSION_KEY, "1");
    expect(shouldPlayIntro()).toBe(false);

    sessionStorage.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
    expect(shouldPlayIntro()).toBe(false);
  });
});
