const KST_OFFSET = "+09:00";

function datePartsInKst(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function toKstDateTimeLocal(date: Date): string {
  const parts = datePartsInKst(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function defaultDeadline(now = new Date()): string {
  return toKstDateTimeLocal(new Date(now.getTime() + 60 * 60 * 1000));
}

export function kstDateTimeLocalToIso(value: string): string {
  const date = new Date(`${value}:00${KST_OFFSET}`);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("유효한 한국 시간 형식이 아닙니다.");
  }
  return date.toISOString();
}

export function formatKstTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${minutes}분`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)}km`;
}
