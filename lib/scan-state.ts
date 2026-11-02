export interface CaptureGate {
  waitingForRemoval: boolean;
  absentFrames: number;
}
export const freshCaptureGate: CaptureGate = {
  waitingForRemoval: false,
  absentFrames: 0,
};
export function captured(): CaptureGate {
  return { waitingForRemoval: true, absentFrames: 0 };
}
export function observeCaptureGate(
  gate: CaptureGate,
  hasCard: boolean,
): CaptureGate {
  if (!gate.waitingForRemoval) return gate;
  const absentFrames = hasCard ? 0 : gate.absentFrames + 1;
  return absentFrames >= 3
    ? { ...freshCaptureGate }
    : { waitingForRemoval: true, absentFrames };
}
