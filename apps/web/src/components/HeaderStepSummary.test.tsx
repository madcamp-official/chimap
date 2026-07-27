import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HeaderStepSummary } from "./HeaderStepSummary.js";

const profile = {
  birthYear: 2000,
  heightCm: 170,
  weightKg: 65,
  biologicalSex: "FEMALE" as const,
};

describe("헤더 걸음 요약", () => {
  it("현재 걸음을 Enter로 반영하고 목표와 개인화 값을 함께 표시한다", () => {
    const onCurrentStepsChange = vi.fn();
    render(
      <HeaderStepSummary
        currentSteps={1200}
        goalSteps={8000}
        walkingProfile={profile}
        onCurrentStepsChange={onCurrentStepsChange}
        onEditProfile={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("현재 걸음"), {
      target: { value: "5200" },
    });
    fireEvent.keyDown(screen.getByLabelText("현재 걸음"), { key: "Enter" });

    expect(onCurrentStepsChange).toHaveBeenCalledWith(5200);
    expect(screen.getByText("8,000걸음")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "개인화 걸음 설정 수정" }))
      .toHaveTextContent(/cm/u);
  });

  it("범위 밖 값은 반영하지 않고 이전 값과 오류를 보여준다", () => {
    const onCurrentStepsChange = vi.fn();
    render(
      <HeaderStepSummary
        currentSteps={1200}
        goalSteps={8000}
        walkingProfile={profile}
        onCurrentStepsChange={onCurrentStepsChange}
        onEditProfile={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("현재 걸음");
    fireEvent.change(input, { target: { value: "100001" } });
    fireEvent.blur(input);

    expect(onCurrentStepsChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(1200);
    expect(screen.getByText(/0~100,000/u)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCurrentStepsChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(1200);
  });
});
