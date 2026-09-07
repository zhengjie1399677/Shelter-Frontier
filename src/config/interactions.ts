export type InteractionKind = "building" | "production" | "field" | "quarantine" | "gate";

export type InteractionTarget = {
  id: string;
  name: string;
  kind: InteractionKind;
  x: number;
  y: number;
  range: number;
  summary: string;
  status: string;
};

export type CollisionRect = { x: number; y: number; width: number; height: number };

export const INTERACTION_TARGETS: InteractionTarget[] = [
  { id: "home-1", name: "基础住房", kind: "building", x: 485, y: 330, range: 115, summary: "供居民休息和居住。", status: "入住 2 / 4" },
  { id: "command-1", name: "指挥室", kind: "building", x: 1125, y: 900, range: 135, summary: "避难所的管理与日程中心。", status: "运转正常" },
  { id: "field-1", name: "菜地 A1", kind: "field", x: 1840, y: 410, range: 150, summary: "居民在田垄间种植和采收口粮。", status: "已派工：遥" },
  { id: "lumber-1", name: "伐木小屋 L1", kind: "production", x: 605, y: 1755, range: 130, summary: "处理经营林地采集的木料。", status: "已派工：林" },
  { id: "quarantine-1", name: "检疫区", kind: "quarantine", x: 3470, y: 720, range: 145, summary: "新居民进入生活区前必须在此接受观察。", status: "隔离位 0 / 4" },
  { id: "gate", name: "城门", kind: "gate", x: 3725, y: 1050, range: 150, summary: "避难所与城外防御区的唯一主要通道。", status: "耐久 850 / 850" },
];

export const COLLISION_RECTS: CollisionRect[] = [
  { x: 348, y: 142, width: 274, height: 155 },
  { x: 936, y: 665, width: 378, height: 202 },
  { x: 438, y: 1552, width: 334, height: 160 },
  { x: 3328, y: 390, width: 280, height: 182 },
  { x: 3758, y: 0, width: 84, height: 900 },
  { x: 3758, y: 1200, width: 84, height: 1000 },
];

export function nearestInteraction(x: number, y: number): InteractionTarget | null {
  let nearest: InteractionTarget | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const target of INTERACTION_TARGETS) {
    const distance = Math.hypot(target.x - x, target.y - y);
    if (distance <= target.range && distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function collidesWithWorld(x: number, y: number, radius = 17): boolean {
  return COLLISION_RECTS.some((rect) =>
    x + radius > rect.x && x - radius < rect.x + rect.width && y + radius > rect.y && y - radius < rect.y + rect.height,
  );
}

export function addCollisionRect(rect: CollisionRect): void {
  COLLISION_RECTS.push(rect);
}

export function addInteractionTarget(target: InteractionTarget): void {
  const existing = INTERACTION_TARGETS.findIndex((entry) => entry.id === target.id);
  if (existing >= 0) INTERACTION_TARGETS[existing] = target;
  else INTERACTION_TARGETS.push(target);
}
