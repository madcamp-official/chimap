import type { Place } from "@chimap/contracts";

const entrancePattern =
  /(정문|후문|북문|남문|동문|서문|출입구|게이트)/u;
const campusPattern = /(학교|대학교|대학원|캠퍼스)/u;

export function placeKindLabel(place: Place): string {
  if (entrancePattern.test(place.name)) {
    return "출입구";
  }
  if (
    place.id.startsWith("kakao:address:") ||
    place.id.startsWith("naver:address:") ||
    place.category.includes("주소")
  ) {
    return "도로명 주소";
  }
  if (campusPattern.test(place.category)) {
    return "캠퍼스 중심";
  }
  return "장소";
}
