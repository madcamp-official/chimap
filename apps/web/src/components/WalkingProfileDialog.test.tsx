import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WalkingProfileDialog } from "./WalkingProfileDialog.js";

describe("개인화 걸음 설정", () => {
  it("생물학적 성별을 필수로 받고 연구식 보폭을 저장한다", () => {
    const onSave = vi.fn();
    render(<WalkingProfileDialog onSave={onSave} />);

    expect(screen.queryByText(/20m/u)).not.toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "이 값으로 시작" });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText("여성"));
    fireEvent.click(submit);

    expect(onSave).toHaveBeenCalledWith({
      birthYear: new Date().getFullYear() - 25,
      heightCm: 170,
      weightKg: 65,
      biologicalSex: "FEMALE",
    });
  });
});
