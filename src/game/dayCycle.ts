import type { DayPhase, GameState } from "./state";

export const DUSK_DURATION_MS = 5000;
export const DAWN_DURATION_MS = 3500;

export type DayCycle = { elapsedInPhase: number };

export function createDayCycle(): DayCycle {
  return { elapsedInPhase: 0 };
}

export function enterPhase(state: GameState, cycle: DayCycle, phase: DayPhase): void {
  state.phase = phase;
  cycle.elapsedInPhase = 0;
}

export function updateDayCycle(state: GameState, cycle: DayCycle, delta: number): boolean {
  cycle.elapsedInPhase += delta;
  if (state.phase === "dusk" && cycle.elapsedInPhase >= DUSK_DURATION_MS) {
    enterPhase(state, cycle, "night");
    return true;
  }
  if (state.phase === "dawn" && cycle.elapsedInPhase >= DAWN_DURATION_MS) {
    state.day += 1;
    enterPhase(state, cycle, "day");
    return true;
  }
  return false;
}

export function phaseLabel(phase: DayPhase): string {
  return { day: "白天 · 准备", dusk: "黄昏 · 城防倒计时", night: "夜晚 · 守城", dawn: "黎明 · 结算" }[phase];
}
