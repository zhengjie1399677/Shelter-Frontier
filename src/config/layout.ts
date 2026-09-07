export const WORLD = {
  width: 6800,
  height: 2200,
  wallX: 3800,
  gateTop: 900,
  gateBottom: 1200,
  mainRoadY: 1050,
  cameraZoom: 0.82,
} as const;

export type PlotGroup = "指挥" | "生活" | "农业" | "木材" | "加工" | "服务" | "检疫";

export type PlannedPlot = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  group: PlotGroup;
  initiallyActive: boolean;
};

export const PLANNED_PLOTS: PlannedPlot[] = [
  { id: "command-1", x: 950, y: 620, width: 350, height: 235, label: "指挥室 · 已建", group: "指挥", initiallyActive: true },
  { id: "home-1", x: 360, y: 100, width: 250, height: 185, label: "住房 H1 · 已建", group: "生活", initiallyActive: true },
  { id: "home-2", x: 650, y: 100, width: 250, height: 185, label: "住房 H2", group: "生活", initiallyActive: false },
  { id: "home-3", x: 360, y: 380, width: 250, height: 185, label: "住房 H3", group: "生活", initiallyActive: false },
  { id: "home-4", x: 650, y: 380, width: 250, height: 185, label: "住房 H4", group: "生活", initiallyActive: false },
  { id: "kitchen-1", x: 1080, y: 500, width: 250, height: 180, label: "厨房", group: "服务", initiallyActive: false },
  { id: "clinic-1", x: 1380, y: 490, width: 270, height: 190, label: "诊所", group: "服务", initiallyActive: false },
  { id: "field-1", x: 1600, y: 40, width: 480, height: 330, label: "菜地 A1 · 已建", group: "农业", initiallyActive: true },
  { id: "field-2", x: 2110, y: 40, width: 480, height: 330, label: "菜地 A2", group: "农业", initiallyActive: false },
  { id: "field-3", x: 2620, y: 40, width: 480, height: 330, label: "菜地 A3", group: "农业", initiallyActive: false },
  { id: "lumber-1", x: 450, y: 1510, width: 310, height: 210, label: "伐木小屋 L1 · 已建", group: "木材", initiallyActive: true },
  { id: "lumber-2", x: 800, y: 1510, width: 310, height: 210, label: "伐木小屋 L2", group: "木材", initiallyActive: false },
  { id: "forest-1", x: 40, y: 1770, width: 600, height: 380, label: "经营林地 F1", group: "木材", initiallyActive: true },
  { id: "forest-2", x: 665, y: 1770, width: 600, height: 380, label: "经营林地 F2", group: "木材", initiallyActive: false },
  { id: "forest-3", x: 1290, y: 1770, width: 600, height: 380, label: "经营林地 F3", group: "木材", initiallyActive: false },
  { id: "parts-1", x: 1260, y: 1510, width: 300, height: 210, label: "零件工作台", group: "加工", initiallyActive: false },
  { id: "weapons-1", x: 1600, y: 1510, width: 330, height: 220, label: "武器工坊", group: "加工", initiallyActive: false },
  { id: "quarantine-1", x: 3260, y: 300, width: 420, height: 370, label: "检疫建筑", group: "检疫", initiallyActive: false },
  { id: "quarantine-2", x: 3260, y: 710, width: 420, height: 250, label: "隔离扩展位", group: "检疫", initiallyActive: false },
];

export const GROUP_COLORS: Record<PlotGroup, number> = {
  指挥: 0xe5c76f,
  生活: 0xd8b36b,
  农业: 0x91bd68,
  木材: 0xb07d50,
  加工: 0x8ca4ae,
  服务: 0xd89387,
  检疫: 0xb89ad3,
};
