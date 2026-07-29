import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WalkingProfileDialog } from "./WalkingProfileDialog.js";

describe("개인화 걸음 설정", () => {
  it("만 나이·성별·하루 목표를 필수로 받고 연구식 보폭을 저장한다", () => {
    const onSave = vi.fn();
    render(<WalkingProfileDialog onSave={onSave} />);

    expect(screen.queryByText(/20m/u)).not.toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "이 값으로 시작" });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText("여성"));
    fireEvent.click(submit);

    expect(onSave).toHaveBeenCalledWith(
      {
        birthYear: new Date().getFullYear() - 25,
        heightCm: 170,
        weightKg: 65,
        biologicalSex: "FEMALE",
      },
      8000,
    );
  });

  it("첫 설정에서는 연령별 논문 근거 목표를 자동 적용한다", async () => {
    const onSave = vi.fn();
    render(<WalkingProfileDialog onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("만 나이"), {
      target: { value: "66" },
    });
    fireEvent.click(screen.getByLabelText("남성"));

    await waitFor(() =>
      expect(screen.getByLabelText("하루 목표 걸음")).toHaveValue(7000),
    );
    expect(screen.getByText("7,000걸음")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이 값으로 시작" }));
    expect(onSave).toHaveBeenCalledWith(expect.any(Object), 7000);
  });

  it("저장된 사용자 목표는 덮어쓰지 않고 추천값을 선택적으로 적용한다", () => {
    render(
      <WalkingProfileDialog
        initialDailyGoalSteps={9000}
        initialProfile={{
          birthYear: new Date().getFullYear() - 66,
          heightCm: 170,
          weightKg: 65,
          biologicalSex: "FEMALE",
        }}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("하루 목표 걸음")).toHaveValue(9000);
    fireEvent.click(screen.getByRole("button", { name: "추천값 적용" }));
    expect(screen.getByLabelText("하루 목표 걸음")).toHaveValue(7000);
    expect(screen.getByText("추천값 적용 중")).toBeInTheDocument();
  });
});
