export function shouldPollRouteVehicles(input: {
  appActive: boolean;
  hasBusLeg: boolean;
}): boolean {
  return input.appActive && input.hasBusLeg;
}
