export type DayPhase = "day" | "dusk" | "night" | "dawn";

export type ResourceState = {
  wood: number;
  food: number;
  scrap: number;
};

export type ResidentState = {
  id: string;
  name: string;
  sex: "male" | "female";
  health: number;
  hunger: number;
  morale: number;
  jobPlotId: string | null;
  action: "idle" | "walking" | "working" | "defending" | "quarantined";
};

export type DefenseState = { id: string; kind: "wire" | "mine"; x: number; y: number; durability: number };
export type QuarantineCandidate = { id: string; name: string; condition: "injured" | "suspected"; observationDays: number; checked: boolean };

export type GameState = {
  schemaVersion: 1;
  day: number;
  phase: DayPhase;
  paused: boolean;
  resources: ResourceState;
  gateHealth: number;
  gateMaxHealth: number;
  housingCapacity: number;
  unlockedPlotIds: string[];
  residents: ResidentState[];
  defenses: DefenseState[];
  quarantineCandidates: QuarantineCandidate[];
};

export function createInitialGameState(): GameState {
  return {
    schemaVersion: 1,
    day: 1,
    phase: "day",
    paused: false,
    resources: { wood: 120, food: 86, scrap: 42 },
    gateHealth: 850,
    gateMaxHealth: 850,
    housingCapacity: 4,
    unlockedPlotIds: ["command-1", "home-1", "field-1", "lumber-1", "forest-1"],
    residents: [
      { id: "resident-1", name: "林", sex: "male", health: 100, hunger: 86, morale: 72, jobPlotId: "lumber-1", action: "working" },
      { id: "resident-2", name: "遥", sex: "female", health: 100, hunger: 90, morale: 76, jobPlotId: "field-1", action: "working" },
    ],
    defenses: [],
    quarantineCandidates: [
      { id: "candidate-1", name: "苏禾", condition: "injured", observationDays: 1, checked: false },
      { id: "candidate-2", name: "顾岚", condition: "suspected", observationDays: 2, checked: false },
    ],
  };
}
