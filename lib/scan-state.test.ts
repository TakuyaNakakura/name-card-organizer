import { describe, expect, it } from "vitest";
import { captured, observeCaptureGate } from "@/lib/scan-state";
describe("continuous capture guard", () => {
  it("does not rearm while the same card remains in view", () => {
    let gate = captured();
    for (let i = 0; i < 50; i++) gate = observeCaptureGate(gate, true);
    expect(gate.waitingForRemoval).toBe(true);
  });
  it("requires three consecutive absent frames", () => {
    let gate = captured();
    gate = observeCaptureGate(gate, false);
    gate = observeCaptureGate(gate, false);
    expect(gate.waitingForRemoval).toBe(true);
    gate = observeCaptureGate(gate, true);
    expect(gate.absentFrames).toBe(0);
    for (let i = 0; i < 3; i++) gate = observeCaptureGate(gate, false);
    expect(gate.waitingForRemoval).toBe(false);
  });
});
