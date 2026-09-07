import Phaser from "phaser";
import "./style.css";
import { GROUP_COLORS, PLANNED_PLOTS, WORLD, type PlannedPlot } from "./config/layout";
import { addCollisionRect, addInteractionTarget, collidesWithWorld, nearestInteraction, type InteractionTarget } from "./config/interactions";
import { createInitialGameState, type DefenseState, type GameState, type QuarantineCandidate, type ResidentState } from "./game/state";
import { createDayCycle, DUSK_DURATION_MS, enterPhase, phaseLabel, updateDayCycle } from "./game/dayCycle";

const SAVE_KEY = "shelter-frontier-save-v1";
function loadGameState(): GameState {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null") as Partial<GameState> | null;
    if (saved?.schemaVersion === 1 && saved.resources && saved.residents && Array.isArray(saved.unlockedPlotIds)) {
      const defaults = createInitialGameState();
      return { ...defaults, ...saved, defenses: saved.defenses ?? [], quarantineCandidates: saved.quarantineCandidates ?? defaults.quarantineCandidates } as GameState;
    }
  } catch { localStorage.removeItem(SAVE_KEY); }
  return createInitialGameState();
}
const initialState = loadGameState();
type BuildKind = "home" | "field" | "lumber" | "wire" | "mine";
type ZombieKind = "walker" | "runner";
type ZombieEntity = { id: string; kind: ZombieKind; hp: number; maxHp: number; speed: number; damage: number; attackElapsed: number; visual: Phaser.GameObjects.Container; healthBar: Phaser.GameObjects.Graphics };
type BulletEntity = { visual: Phaser.GameObjects.Arc; velocity: Phaser.Math.Vector2; life: number; damage: number };
const BUILD_COST = { home: 80, field: 30, lumber: 60, wire: 12, mine: 18 } as const;

class PrototypeScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container;
  private keys!: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  private planLayer!: Phaser.GameObjects.Container;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private activeTarget: InteractionTarget | null = null;
  private promptElement!: HTMLDivElement;
  private panelElement!: HTMLElement;
  private residentDetails!: HTMLElement;
  private quarantineDetails!: HTMLElement;
  private residentVisuals = new Map<string, Phaser.GameObjects.Container>();
  private residentDestinations = new Map<string, Phaser.Math.Vector2>();
  private selectedResidentId: string | null = null;
  private productionElapsed = 0;
  private buildKind: BuildKind | null = null;
  private buildPlot: PlannedPlot | null = null;
  private buildPreview: Phaser.GameObjects.Graphics | null = null;
  private defensePosition: Phaser.Math.Vector2 | null = null;
  private defenseVisuals = new Map<string, Phaser.GameObjects.Container>();
  private buildModeElement!: HTMLElement;
  private readonly dayCycle = createDayCycle();
  private manualPaused = false;
  private visibilityPaused = false;
  private zombies: ZombieEntity[] = [];
  private zombieVisuals = new Set<Phaser.GameObjects.Container>();
  private bullets: BulletEntity[] = [];
  private shootCooldown = 0;
  private residentAttackElapsed = 0;
  private nightWaveActive = false;
  private defeated = false;

  constructor() {
    super("prototype");
  }

  preload(): void {
    this.load.image("building-basic-house", "/assets/buildings/basic-house.png");
    this.load.image("building-command-room", "/assets/buildings/command-room.png");
    this.load.image("terrain-grass-ground", "/assets/terrain/grass-ground-v2.png");
  }

  create(): void {
    this.registry.set("gameState", initialState);
    this.cameras.main.setBackgroundColor("#6f9258");
    this.physics.world.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);

    this.drawGround();
    this.drawShelter();
    this.drawWallAndFrontier();
    this.restoreBuiltWorld();
    this.drawResidents();
    this.planLayer = this.drawMasterPlanOverlay().setVisible(false);
    this.player = this.makePerson(1120, 900, 0x294f68, 0xe6d8bd);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setZoom(WORLD.cameraZoom);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error("Keyboard input is unavailable");
    const cursors = keyboard.createCursorKeys();
    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.interactKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    keyboard.on("keydown-P", () => this.planLayer.setVisible(!this.planLayer.visible));
    keyboard.on("keydown-ESC", () => { this.cancelBuild(); this.closeInspection(); });
    this.registry.set("cursors", cursors);

    this.promptElement = document.querySelector<HTMLDivElement>("#interaction-prompt")!;
    this.panelElement = document.querySelector<HTMLElement>("#inspect-panel")!;
    this.residentDetails = document.querySelector<HTMLElement>("#resident-details")!;
    this.quarantineDetails = document.querySelector<HTMLElement>("#quarantine-details")!;
    this.buildModeElement = document.querySelector<HTMLElement>("#build-mode")!;
    document.querySelector<HTMLButtonElement>("#inspect-close")!.addEventListener("click", () => this.closeInspection());
    document.querySelectorAll<HTMLButtonElement>("[data-job]").forEach((button) => {
      button.addEventListener("click", () => this.assignSelectedResident(button.dataset.job ?? "none"));
    });
    document.querySelectorAll<HTMLButtonElement>("[data-build]").forEach((button) => {
      button.addEventListener("click", () => this.startBuild(button.dataset.build as BuildKind));
    });
    document.querySelector<HTMLButtonElement>("#build-confirm")!.addEventListener("click", () => this.confirmBuild());
    document.querySelector<HTMLButtonElement>("#build-cancel")!.addEventListener("click", () => this.cancelBuild());
    document.querySelector<HTMLButtonElement>("#night-start")!.addEventListener("click", () => this.startNight());
    document.querySelector<HTMLButtonElement>("#pause-toggle")!.addEventListener("click", () => this.togglePause());
    document.querySelector<HTMLButtonElement>("#save-button")!.addEventListener("click", () => { this.saveGame(); this.showBanner("已保存", "当前稳定状态已写入本地存档槽"); });
    document.querySelector<HTMLButtonElement>("#restart-button")!.addEventListener("click", () => { localStorage.removeItem(SAVE_KEY); window.location.reload(); });
    document.querySelectorAll<HTMLButtonElement>("[data-quarantine-action]").forEach((button) => button.addEventListener("click", () => this.handleQuarantineAction(button.dataset.quarantineAction!)));
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.cancelBuild();
      else if (pointer.leftButtonDown() && initialState.phase === "night") this.firePlayerShot(pointer.worldX, pointer.worldY);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => this.updateDefensePreview(pointer.worldX, pointer.worldY));

    document.addEventListener("visibilitychange", () => this.handleVisibilityChange());
    this.renderPhaseUi();
    this.renderCombatUi();
    this.renderResourceUi();
    if (initialState.phase === "night") this.onPhaseChanged();
  }

  update(_: number, delta: number): void {
    if (updateDayCycle(initialState, this.dayCycle, delta)) this.onPhaseChanged();
    if (initialState.phase === "dusk") this.renderPhaseUi();
    const cursors = this.registry.get("cursors") as Phaser.Types.Input.Keyboard.CursorKeys;
    const horizontal = Number(this.keys.right.isDown || cursors.right.isDown) - Number(this.keys.left.isDown || cursors.left.isDown);
    const vertical = Number(this.keys.down.isDown || cursors.down.isDown) - Number(this.keys.up.isDown || cursors.up.isDown);
    if (horizontal || vertical) {
      const direction = new Phaser.Math.Vector2(horizontal, vertical).normalize();
      const speed = 260 * (delta / 1000);
      const nextX = Phaser.Math.Clamp(this.player.x + direction.x * speed, 28, WORLD.width - 28);
      const nextY = Phaser.Math.Clamp(this.player.y + direction.y * speed, 72, WORLD.height - 34);
      if (!collidesWithWorld(nextX, this.player.y)) this.player.x = nextX;
      if (!collidesWithWorld(this.player.x, nextY)) this.player.y = nextY;
    }

    const nearby = nearestInteraction(this.player.x, this.player.y);
    if (nearby?.id !== this.activeTarget?.id) {
      this.activeTarget = nearby;
      this.updateInteractionPrompt();
    }
    if (nearby && Phaser.Input.Keyboard.JustDown(this.interactKey)) this.openInspection(nearby);
    this.updateResidents(delta);
    this.updateProduction(delta);
    this.updateCombat(delta);
  }

  private updateInteractionPrompt(): void {
    if (!this.activeTarget) {
      this.promptElement.hidden = true;
      return;
    }
    this.promptElement.textContent = `E  查看 ${this.activeTarget.name}`;
    this.promptElement.hidden = false;
  }

  private openInspection(target: InteractionTarget): void {
    this.selectedResidentId = null;
    this.residentDetails.hidden = true;
    this.quarantineDetails.hidden = target.kind !== "quarantine";
    document.querySelector<HTMLElement>("#inspect-kind")!.textContent = this.kindLabel(target);
    document.querySelector<HTMLElement>("#inspect-name")!.textContent = target.name;
    document.querySelector<HTMLElement>("#inspect-summary")!.textContent = target.summary;
    document.querySelector<HTMLElement>("#inspect-status")!.textContent = target.status;
    this.panelElement.hidden = false;
    if (target.kind === "quarantine") this.renderQuarantinePanel();
  }

  private closeInspection(): void {
    if (this.panelElement) this.panelElement.hidden = true;
    this.selectedResidentId = null;
    if (this.player) this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
  }

  private kindLabel(target: InteractionTarget): string {
    const labels: Record<InteractionTarget["kind"], string> = {
      building: "建筑",
      production: "生产设施",
      field: "农业区域",
      quarantine: "检疫设施",
      gate: "城防结构",
    };
    return labels[target.kind];
  }

  private startBuild(kind: BuildKind): void {
    this.cancelBuild();
    if (initialState.phase !== "day") {
      this.buildModeElement.hidden = false;
      document.querySelector<HTMLElement>("#build-message")!.textContent = "黄昏与夜间不能开始新建造";
      document.querySelector<HTMLButtonElement>("#build-confirm")!.hidden = true;
      return;
    }
    if (kind === "wire" || kind === "mine") {
      this.buildKind = kind;
      this.defensePosition = new Phaser.Math.Vector2(WORLD.wallX + 340, WORLD.mainRoadY);
      this.buildPreview = this.add.graphics().setDepth(19);
      this.drawDefensePreview();
      this.cameras.main.stopFollow();
      this.cameras.main.pan(WORLD.wallX + 300, WORLD.mainRoadY, 420, "Sine.easeInOut");
      this.buildModeElement.hidden = false;
      document.querySelector<HTMLButtonElement>("#build-confirm")!.hidden = false;
      document.querySelector<HTMLElement>("#build-message")!.textContent = `${kind === "wire" ? "铁丝网" : "地雷"} · 移动鼠标选址 · 消耗 ${BUILD_COST[kind]} 废铁`;
      return;
    }
    const group = kind === "home" ? "生活" : kind === "field" ? "农业" : "木材";
    const plot = PLANNED_PLOTS.find((entry) => entry.group === group && !entry.initiallyActive && !initialState.unlockedPlotIds.includes(entry.id) && !entry.id.startsWith("forest"));
    if (!plot) {
      this.buildModeElement.hidden = false;
      document.querySelector<HTMLElement>("#build-message")!.textContent = "当前组团没有可用地块";
      document.querySelector<HTMLButtonElement>("#build-confirm")!.hidden = true;
      return;
    }
    this.buildKind = kind;
    this.buildPlot = plot;
    const cost = BUILD_COST[kind];
    this.buildPreview = this.add.graphics().setDepth(19);
    this.buildPreview.fillStyle(0xe8cf78, 0.18).fillRoundedRect(plot.x, plot.y, plot.width, plot.height, 12);
    this.buildPreview.lineStyle(5, 0xf1d36e, 0.95).strokeRoundedRect(plot.x, plot.y, plot.width, plot.height, 12);
    this.cameras.main.stopFollow();
    this.cameras.main.pan(plot.x + plot.width / 2, plot.y + plot.height / 2, 420, "Sine.easeInOut");
    this.buildModeElement.hidden = false;
    document.querySelector<HTMLButtonElement>("#build-confirm")!.hidden = false;
    document.querySelector<HTMLElement>("#build-message")!.textContent = `${plot.label} · 消耗 ${cost} 木材`;
  }

  private confirmBuild(): void {
    if (!this.buildKind) return;
    if (this.buildKind === "wire" || this.buildKind === "mine") {
      if (!this.defensePosition) return;
      const cost = BUILD_COST[this.buildKind];
      if (initialState.resources.scrap < cost) {
        document.querySelector<HTMLElement>("#build-message")!.textContent = `废铁不足：需要 ${cost}`;
        return;
      }
      initialState.resources.scrap -= cost;
      const defense: DefenseState = { id: `defense-${Date.now()}`, kind: this.buildKind, x: this.defensePosition.x, y: this.defensePosition.y, durability: this.buildKind === "wire" ? 120 : 1 };
      initialState.defenses.push(defense);
      this.renderDefense(defense);
      document.querySelector<HTMLElement>("#resource-scrap")!.textContent = String(initialState.resources.scrap);
      this.saveGame();
      this.cancelBuild();
      return;
    }
    if (!this.buildPlot) return;
    const cost = BUILD_COST[this.buildKind];
    if (initialState.resources.wood < cost) {
      document.querySelector<HTMLElement>("#build-message")!.textContent = `木材不足：需要 ${cost}`;
      return;
    }
    initialState.resources.wood -= cost;
    initialState.unlockedPlotIds.push(this.buildPlot.id);
    if (this.buildKind === "home") initialState.housingCapacity += 4;
    this.renderBuiltPlot(this.buildKind, this.buildPlot);
    document.querySelector<HTMLElement>("#resource-wood")!.textContent = String(initialState.resources.wood);
    document.querySelector<HTMLElement>("#housing-capacity")!.textContent = String(initialState.housingCapacity);
    document.querySelector<HTMLElement>("#resident-count")!.textContent = String(initialState.residents.length);
    this.saveGame();
    this.cancelBuild();
  }

  private renderBuiltPlot(kind: "home" | "field" | "lumber", plot: PlannedPlot): void {
    if (kind === "home") {
      this.drawBuilding(plot.x, plot.y, plot.width, plot.height, "住房 · 0 / 4", 0x8d6747, 0x344e4e);
      addCollisionRect({ x: plot.x - 12, y: plot.y + 42, width: plot.width + 24, height: plot.height - 30 });
      addInteractionTarget({ id: plot.id, name: "基础住房", kind: "building", x: plot.x + plot.width / 2, y: plot.y + plot.height + 45, range: 115, summary: "新建住房，可容纳 4 名居民。", status: "入住 0 / 4" });
    } else if (kind === "field") {
      this.drawField(plot.x, plot.y);
      addInteractionTarget({ id: plot.id, name: plot.label, kind: "field", x: plot.x + plot.width / 2, y: plot.y + plot.height + 40, range: 150, summary: "新开放的贴地种植区域。", status: "尚未派工" });
    } else {
      this.drawWorkshop(plot.x, plot.y);
      addCollisionRect({ x: plot.x - 12, y: plot.y + 42, width: 334, height: 160 });
      addInteractionTarget({ id: plot.id, name: plot.label, kind: "production", x: plot.x + plot.width / 2, y: plot.y + plot.height + 42, range: 130, summary: "处理经营林地采集的木料。", status: "尚未派工" });
    }
  }

  private cancelBuild(): void {
    this.buildPreview?.destroy();
    this.buildPreview = null;
    this.buildKind = null;
    this.buildPlot = null;
    this.defensePosition = null;
    if (this.buildModeElement) this.buildModeElement.hidden = true;
    const confirm = document.querySelector<HTMLButtonElement>("#build-confirm");
    if (confirm) confirm.hidden = false;
    if (this.player) this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
  }

  private updateDefensePreview(x: number, y: number): void {
    if ((this.buildKind !== "wire" && this.buildKind !== "mine") || !this.defensePosition) return;
    this.defensePosition.set(Phaser.Math.Clamp(x, WORLD.wallX + 110, WORLD.width - 70), Phaser.Math.Clamp(y, 90, WORLD.height - 70));
    this.drawDefensePreview();
  }

  private drawDefensePreview(): void {
    if (!this.buildPreview || !this.defensePosition || (this.buildKind !== "wire" && this.buildKind !== "mine")) return;
    const { x, y } = this.defensePosition;
    this.buildPreview.clear();
    this.buildPreview.fillStyle(0xe8cf78, 0.18);
    this.buildPreview.lineStyle(4, 0xf1d36e, 0.95);
    if (this.buildKind === "wire") this.buildPreview.fillRoundedRect(x - 22, y - 75, 44, 150, 8).strokeRoundedRect(x - 22, y - 75, 44, 150, 8);
    else this.buildPreview.fillCircle(x, y, 34).strokeCircle(x, y, 34);
  }

  private restoreBuiltWorld(): void {
    for (const plotId of initialState.unlockedPlotIds) {
      const plot = PLANNED_PLOTS.find((entry) => entry.id === plotId && !entry.initiallyActive);
      if (!plot) continue;
      const kind = plot.group === "生活" ? "home" : plot.group === "农业" ? "field" : plot.group === "木材" && !plot.id.startsWith("forest") ? "lumber" : null;
      if (kind) this.renderBuiltPlot(kind, plot);
    }
    for (const defense of initialState.defenses) this.renderDefense(defense);
  }

  private renderDefense(defense: DefenseState): void {
    const g = this.add.graphics();
    if (defense.kind === "wire") {
      g.lineStyle(5, 0x8b8170).strokeRoundedRect(-19, -72, 38, 144, 7);
      for (let y = -58; y <= 58; y += 29) g.lineBetween(-15, y - 12, 15, y + 12).lineBetween(15, y - 12, -15, y + 12);
    } else {
      g.fillStyle(0x504a3e).fillCircle(0, 0, 27);
      g.lineStyle(3, 0xd9ad55).strokeCircle(0, 0, 27);
      g.fillStyle(0xd9ad55).fillCircle(0, 0, 5);
    }
    const label = this.add.text(0, 30, defense.kind === "wire" ? "铁丝网" : "地雷", { color: "#eee2bd", fontSize: "12px", stroke: "#1b2525", strokeThickness: 3 }).setOrigin(0.5);
    this.defenseVisuals.set(defense.id, this.add.container(defense.x, defense.y, [g, label]).setDepth(6));
  }

  private renderResourceUi(): void {
    document.querySelector<HTMLElement>("#resource-wood")!.textContent = String(initialState.resources.wood);
    document.querySelector<HTMLElement>("#resource-food")!.textContent = String(initialState.resources.food);
    document.querySelector<HTMLElement>("#resource-scrap")!.textContent = String(initialState.resources.scrap);
    document.querySelector<HTMLElement>("#housing-capacity")!.textContent = String(initialState.housingCapacity);
  }

  private drawGround(): void {
    this.add.rectangle(0, 0, WORLD.wallX, WORLD.height, 0x789b5c).setOrigin(0).setDepth(-21);
    this.add.tileSprite(WORLD.wallX / 2, WORLD.height / 2, WORLD.wallX, WORLD.height, "terrain-grass-ground")
      .setAlpha(0.62)
      .setTint(0xc7d9bb)
      .setDepth(-20);
    const graphics = this.add.graphics();
    graphics.fillStyle(0x243338).fillRect(WORLD.wallX, 0, WORLD.width - WORLD.wallX, WORLD.height);
    this.drawRoad(graphics, [[260, WORLD.mainRoadY], [WORLD.wallX, WORLD.mainRoadY]], 52);
    this.drawRoad(graphics, [[830, 1050], [830, 700], [280, 700]], 34);
    this.drawRoad(graphics, [[1350, 1050], [1350, 760]], 34);
    this.drawRoad(graphics, [[1700, 1050], [1700, 430], [3120, 430]], 34);
    this.drawRoad(graphics, [[980, 1050], [980, 1460], [360, 1460]], 34);
    this.drawRoad(graphics, [[980, 1460], [2000, 1460]], 34);
    this.drawRoad(graphics, [[WORLD.wallX - 20, WORLD.mainRoadY], [3470, WORLD.mainRoadY], [3470, 690]], 28);
  }

  private drawRoad(graphics: Phaser.GameObjects.Graphics, points: number[][], width: number): void {
    const stroke = (strokeWidth: number, color: number, alpha: number) => {
      graphics.lineStyle(strokeWidth, color, alpha).beginPath().moveTo(points[0][0], points[0][1]);
      for (let index = 1; index < points.length; index += 1) graphics.lineTo(points[index][0], points[index][1]);
      graphics.strokePath();
    };
    stroke(width + 14, 0x51452f, 0.2);
    stroke(width, 0xb29a71, 0.58);
    stroke(Math.max(6, width - 12), 0xc0aa80, 0.18);
  }

  private drawShelter(): void {
    this.drawBuilding(360, 100, 250, 185, "住房 · 2 / 4", 0x8d6747, 0x344e4e);
    this.drawBuilding(950, 620, 350, 235, "指挥室 · 道路中心", 0x7f6044, 0x315563);
    this.drawWorkshop(450, 1510);
    this.drawField(1600, 40);
    this.drawExpansionLand();
    this.drawQuarantine();
    this.drawTrees();
  }

  private drawBuilding(x: number, y: number, width: number, height: number, label: string, wall: number, roof: number): void {
    if (label.includes("住房")) {
      this.addBuildingGrounding(x, y, width, height);
      const renderHeight = height * 0.86;
      this.add.image(x + width / 2, y + height - renderHeight / 2, "building-basic-house").setDisplaySize(width, renderHeight).setDepth(2);
      this.add.text(x + width / 2, y + height + 26, label, { color: "#f4f0dc", fontSize: "16px", stroke: "#1e2a28", strokeThickness: 4 }).setOrigin(0.5, 0).setDepth(3);
      return;
    }
    if (label.includes("指挥室")) {
      this.addBuildingGrounding(x, y, width, height);
      const renderHeight = height * 0.84;
      this.add.image(x + width / 2, y + height - renderHeight / 2, "building-command-room").setDisplaySize(width, renderHeight).setDepth(2);
      this.add.text(x + width / 2, y + height + 26, label, { color: "#f4f0dc", fontSize: "16px", stroke: "#1e2a28", strokeThickness: 4 }).setOrigin(0.5, 0).setDepth(3);
      return;
    }
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.16).fillEllipse(x + width / 2, y + height + 14, width * 0.9, 28);
    g.fillStyle(wall).fillRoundedRect(x, y + 48, width, height - 48, 8);
    g.fillStyle(roof).fillTriangle(x - 18, y + 58, x + width / 2, y - 18, x + width + 18, y + 58);
    g.fillStyle(0x3d2d24).fillRect(x + width * 0.42, y + height - 74, width * 0.16, 74);
    g.fillStyle(0xe9c56a).fillRect(x + 34, y + 94, 38, 33).fillRect(x + width - 72, y + 94, 38, 33);
    this.add.text(x + width / 2, y + height + 26, label, { color: "#f4f0dc", fontSize: "16px", stroke: "#1e2a28", strokeThickness: 4 }).setOrigin(0.5, 0);
  }

  private addBuildingGrounding(x: number, y: number, width: number, height: number): void {
    this.add.ellipse(x + width / 2, y + height - 3, width * 0.72, Math.max(7, height * 0.045), 0x263027, 0.24).setDepth(1.2);
  }

  private drawWorkshop(x: number, y: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x5e4633).fillRect(x, y + 45, 310, 145);
    g.fillStyle(0x304a48).fillTriangle(x - 12, y + 52, x + 155, y - 18, x + 322, y + 52);
    g.fillStyle(0x9e7650).fillRect(x + 36, y + 103, 160, 25);
    g.fillStyle(0x4b3627).fillRect(x + 55, y + 128, 16, 58).fillRect(x + 172, y + 128, 16, 58);
    for (let i = 0; i < 4; i += 1) g.fillStyle(0x8b613d).fillCircle(x + 250, y + 154 - i * 28, 22);
    this.add.text(x + 155, y + 210, "木材设施", { color: "#f4f0dc", fontSize: "16px", stroke: "#1e2a28", strokeThickness: 4 }).setOrigin(0.5);
  }

  private drawField(x: number, y: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x59402d).fillRoundedRect(x, y, 480, 330, 28);
    for (let row = 0; row < 5; row += 1) {
      g.fillStyle(row < 2 ? 0x44733c : row < 4 ? 0x65964d : 0x83aa57);
      for (let col = 0; col < 7; col += 1) g.fillCircle(x + 44 + col * 65, y + 38 + row * 61, 10 + row * 1.5);
    }
    this.add.text(x + 240, y + 350, "菜地 · 三个成长阶段", { color: "#f4f0dc", fontSize: "16px", stroke: "#1e2a28", strokeThickness: 4 }).setOrigin(0.5);
  }

  private drawExpansionLand(): void {
    const g = this.add.graphics();
    g.fillStyle(0x527448, 0.42).fillRoundedRect(2190, 560, 820, 320, 50);
    g.fillStyle(0x527448, 0.32).fillRoundedRect(2100, 1120, 1320, 820, 50);
    this.add.text(2600, 720, "树林与荒地 · 后续清理扩展", { color: "#dbe4c3", fontSize: "18px", stroke: "#26392d", strokeThickness: 4 }).setOrigin(0.5);
    this.add.text(2710, 1510, "远期组团扩展方向", { color: "#dbe4c3", fontSize: "18px", stroke: "#26392d", strokeThickness: 4 }).setOrigin(0.5);
  }

  private drawQuarantine(): void {
    const x = 3260;
    const y = 310;
    const width = 420;
    const height = 370;
    const g = this.add.graphics();
    g.fillStyle(0x6b785d, 0.28).fillRoundedRect(x, y, width, height, 16);
    g.lineStyle(7, 0x7b684d, 0.95).strokeRoundedRect(x, y, width, height, 16);
    for (let px = x + 28; px < x + width; px += 54) {
      g.fillStyle(0x554633).fillRect(px, y - 4, 7, 20).fillRect(px, y + height - 16, 7, 20);
    }
    g.fillStyle(0x75624a).fillRoundedRect(x + 68, y + 86, 280, 175, 8);
    g.fillStyle(0x344e4e).fillTriangle(x + 48, y + 102, x + 208, y + 34, x + 368, y + 102);
    g.fillStyle(0x302821).fillRect(x + 188, y + 183, 42, 78);
    g.fillStyle(0xd8b85f).fillRect(x + 104, y + 142, 34, 28).fillRect(x + 280, y + 142, 34, 28);
    g.lineStyle(5, 0xb99b61, 0.8).lineBetween(x + width, y + height - 86, x + width, y + height - 22);
    this.add.text(x + width / 2, y + height + 24, "检疫区 · 由城门独立进入", { color: "#f2e6bd", fontSize: "17px", stroke: "#25352d", strokeThickness: 4 }).setOrigin(0.5);
    this.add.text(x + width / 2, y + 292, "隔离位 0 / 4", { color: "#d8e0c5", fontSize: "14px", stroke: "#25352d", strokeThickness: 3 }).setOrigin(0.5);
  }

  private drawMasterPlanOverlay(): Phaser.GameObjects.Container {
    const layer = this.add.container(0, 0).setDepth(20);
    for (const plot of PLANNED_PLOTS) {
      const box = this.add.graphics();
      box.lineStyle(4, GROUP_COLORS[plot.group], 0.88).strokeRoundedRect(plot.x, plot.y, plot.width, plot.height, 12);
      box.fillStyle(GROUP_COLORS[plot.group], 0.1).fillRoundedRect(plot.x, plot.y, plot.width, plot.height, 12);
      const label = this.add.text(plot.x + plot.width / 2, plot.y + plot.height / 2, plot.label, {
        color: "#fff4d1",
        fontSize: "15px",
        align: "center",
        stroke: "#1d2c28",
        strokeThickness: 4,
      }).setOrigin(0.5);
      layer.add([box, label]);
    }
    const note = this.add.text(1120, 1050, "总平面规划层 · 按 P 隐藏", {
      color: "#f5dfa1",
      fontSize: "18px",
      stroke: "#1d2c28",
      strokeThickness: 5,
    }).setOrigin(0.5);
    layer.add(note);
    return layer;
  }

  private drawWallAndFrontier(): void {
    const g = this.add.graphics();
    g.fillStyle(0x34474b).fillRect(WORLD.wallX - 32, 0, 64, WORLD.height);
    for (let y = 0; y < WORLD.height; y += 90) {
      g.fillStyle(0x718083).fillRect(WORLD.wallX - 42, y, 84, 18);
      g.lineStyle(2, 0x1e2c30).strokeRect(WORLD.wallX - 42, y, 84, 18);
    }
    g.fillStyle(0x6e4e34).fillRect(WORLD.wallX - 54, WORLD.gateTop, 108, WORLD.gateBottom - WORLD.gateTop);
    g.lineStyle(5, 0x2d241f).strokeRect(WORLD.wallX - 54, WORLD.gateTop, 108, WORLD.gateBottom - WORLD.gateTop);
    g.lineBetween(WORLD.wallX, WORLD.gateTop, WORLD.wallX, WORLD.gateBottom);
    this.add.text(WORLD.wallX - 80, WORLD.gateTop - 42, "城门", { color: "#f2dfaa", fontSize: "18px", stroke: "#172326", strokeThickness: 4 });
    for (let y = 220; y < 1600; y += 180) {
      g.lineStyle(5, 0x7d735f).lineBetween(WORLD.wallX + 150, y, WORLD.wallX + 360, y + 60);
      g.lineBetween(WORLD.wallX + 150, y + 60, WORLD.wallX + 360, y);
    }
    g.lineStyle(3, 0xe7b75e, 0.8).strokeCircle(WORLD.wallX + 470, 980, 34);
    this.add.text(WORLD.wallX + 470, 980, "地雷", { color: "#f3d997", fontSize: "13px" }).setOrigin(0.5);
  }

  private drawResidents(): void {
    const positions: Record<string, Phaser.Math.Vector2> = {
      "resident-1": new Phaser.Math.Vector2(620, 1640),
      "resident-2": new Phaser.Math.Vector2(1770, 250),
    };
    for (const resident of initialState.residents) {
      const position = positions[resident.id] ?? new Phaser.Math.Vector2(3410, 620);
      const colors = resident.sex === "male" ? [0x6c563d, 0xd9bea6] : [0x8a5c64, 0xe2c7ae];
      const visual = this.makePerson(position.x, position.y, colors[0], colors[1]);
      visual.setSize(48, 68).setInteractive({ useHandCursor: true });
      visual.on("pointerdown", () => this.openResident(resident.id));
      this.residentVisuals.set(resident.id, visual);
    }
  }

  private openResident(residentId: string): void {
    const resident = initialState.residents.find((entry) => entry.id === residentId);
    const visual = this.residentVisuals.get(residentId);
    if (!resident || !visual) return;
    this.selectedResidentId = residentId;
    this.cameras.main.stopFollow();
    this.cameras.main.pan(visual.x, visual.y, 350, "Sine.easeInOut");
    document.querySelector<HTMLElement>("#inspect-kind")!.textContent = resident.sex === "male" ? "男性居民" : "女性居民";
    document.querySelector<HTMLElement>("#inspect-name")!.textContent = resident.name;
    document.querySelector<HTMLElement>("#inspect-summary")!.textContent = `当前行动：${this.actionLabel(resident.action)}`;
    document.querySelector<HTMLElement>("#inspect-status")!.textContent = `岗位：${this.jobLabel(resident.jobPlotId)}`;
    this.setMeter("resident-health", resident.health);
    this.setMeter("resident-hunger", resident.hunger);
    this.setMeter("resident-morale", resident.morale);
    this.residentDetails.hidden = false;
    this.quarantineDetails.hidden = true;
    this.panelElement.hidden = false;
  }

  private assignSelectedResident(jobId: string): void {
    if (!this.selectedResidentId) return;
    const resident = initialState.residents.find((entry) => entry.id === this.selectedResidentId);
    if (!resident) return;
    if (jobId === "none") {
      resident.jobPlotId = null;
      resident.action = "idle";
      this.residentDestinations.delete(resident.id);
    } else {
      resident.jobPlotId = jobId;
      resident.action = "walking";
      const destination = jobId === "field-1" ? new Phaser.Math.Vector2(1770, 250) : new Phaser.Math.Vector2(620, 1640);
      this.residentDestinations.set(resident.id, destination);
    }
    this.openResident(resident.id);
    this.saveGame();
  }

  private updateResidents(delta: number): void {
    for (const resident of initialState.residents) {
      if (resident.action !== "walking" && resident.action !== "defending") continue;
      const visual = this.residentVisuals.get(resident.id);
      const destination = this.residentDestinations.get(resident.id);
      if (!visual || !destination) continue;
      const distance = Phaser.Math.Distance.Between(visual.x, visual.y, destination.x, destination.y);
      if (distance < 8) {
        visual.setPosition(destination.x, destination.y);
        if (resident.action === "walking") resident.action = "working";
        this.residentDestinations.delete(resident.id);
        if (this.selectedResidentId === resident.id) this.openResident(resident.id);
        continue;
      }
      const direction = new Phaser.Math.Vector2(destination.x - visual.x, destination.y - visual.y).normalize();
      const moveSpeed = resident.action === "defending" ? 360 : 145;
      visual.x += direction.x * moveSpeed * (delta / 1000);
      visual.y += direction.y * moveSpeed * (delta / 1000);
    }
  }

  private updateProduction(delta: number): void {
    if (initialState.phase !== "day") return;
    this.productionElapsed += delta;
    if (this.productionElapsed < 5000) return;
    this.productionElapsed -= 5000;
    for (const resident of initialState.residents) {
      if (resident.action !== "working") continue;
      if (resident.jobPlotId === "field-1") initialState.resources.food += 1;
      if (resident.jobPlotId === "lumber-1") initialState.resources.wood += 1;
    }
    document.querySelector<HTMLElement>("#resource-food")!.textContent = String(initialState.resources.food);
    document.querySelector<HTMLElement>("#resource-wood")!.textContent = String(initialState.resources.wood);
    this.saveGame();
  }

  private setMeter(id: string, value: number): void {
    document.querySelector<HTMLElement>(`#${id}`)!.style.setProperty("--value", `${Phaser.Math.Clamp(value, 0, 100)}%`);
  }

  private jobLabel(jobId: string | null): string {
    if (jobId === "field-1") return "菜地 A1";
    if (jobId === "lumber-1") return "伐木小屋 L1";
    return "未分配";
  }

  private actionLabel(action: ResidentState["action"]): string {
    const labels: Record<ResidentState["action"], string> = {
      idle: "空闲",
      walking: "前往工作点",
      working: "工作中",
      defending: "防守中",
      quarantined: "检疫中",
    };
    return labels[action];
  }

  private renderQuarantinePanel(): void {
    const candidate = initialState.quarantineCandidates[0];
    document.querySelector<HTMLElement>("#quarantine-capacity")!.textContent = `${initialState.quarantineCandidates.length} / 4`;
    const content = document.querySelector<HTMLElement>("#quarantine-candidate")!;
    if (!candidate) {
      content.textContent = "当前没有等待处置的新居民。";
      document.querySelectorAll<HTMLButtonElement>("[data-quarantine-action]").forEach((button) => { button.disabled = true; });
      return;
    }
    document.querySelectorAll<HTMLButtonElement>("[data-quarantine-action]").forEach((button) => { button.disabled = false; });
    const condition = candidate.checked ? (candidate.condition === "injured" ? "检查结果：健康但受伤" : "检查结果：存在感染风险") : "状况未确认";
    content.textContent = `${candidate.name} · ${condition} · 已观察 ${candidate.observationDays} 天。放行可增加劳动力，但会增加口粮压力。`;
  }

  private handleQuarantineAction(action: string): void {
    const candidate = initialState.quarantineCandidates[0];
    if (!candidate) return;
    if (action === "check") {
      if (initialState.resources.scrap < 6) { this.showBanner("无法检查", "需要 6 废铁"); return; }
      initialState.resources.scrap -= 6;
      candidate.checked = true;
      this.renderResourceUi();
    } else if (action === "extend") {
      candidate.observationDays += 1;
      initialState.resources.food = Math.max(0, initialState.resources.food - 1);
      this.renderResourceUi();
      this.showBanner("继续观察", "消耗 1 口粮，风险判断更从容");
    } else if (action === "release") {
      this.releaseCandidate(candidate);
    } else if (action === "reject") {
      initialState.quarantineCandidates.shift();
      this.showBanner("已拒绝接纳", `${candidate.name} 离开了避难所`);
    }
    this.saveGame();
    this.renderQuarantinePanel();
  }

  private releaseCandidate(candidate: QuarantineCandidate): void {
    if (initialState.residents.length >= initialState.housingCapacity) {
      this.showBanner("无法放行", "住房已满，请先新建基础住房");
      return;
    }
    const risky = candidate.condition === "suspected" && (!candidate.checked || candidate.observationDays < 3);
    const resident: ResidentState = { id: `resident-${Date.now()}`, name: candidate.name, sex: initialState.residents.length % 2 ? "male" : "female", health: risky ? 55 : candidate.condition === "injured" ? 72 : 92, hunger: 70, morale: candidate.observationDays > 3 ? 55 : 72, jobPlotId: null, action: "idle" };
    initialState.residents.push(resident);
    initialState.quarantineCandidates.shift();
    const visual = this.makePerson(3410, 620, resident.sex === "male" ? 0x6c563d : 0x8a5c64, resident.sex === "male" ? 0xd9bea6 : 0xe2c7ae);
    visual.setSize(48, 68).setInteractive({ useHandCursor: true }).on("pointerdown", () => this.openResident(resident.id));
    this.residentVisuals.set(resident.id, visual);
    this.showBanner(risky ? "风险放行" : "检疫放行", risky ? `${resident.name} 已加入，但健康明显下降` : `${resident.name} 已成为正式居民`);
  }

  private startNight(): void {
    if (initialState.phase !== "day") return;
    this.cancelBuild();
    this.closeInspection();
    enterPhase(initialState, this.dayCycle, "dusk");
    this.onPhaseChanged();
    this.player.setPosition(WORLD.wallX - 430, WORLD.mainRoadY);
    this.cameras.main.stopFollow();
    this.cameras.main.pan(WORLD.wallX - 520, WORLD.mainRoadY, 900, "Sine.easeInOut");
    this.time.delayedCall(1200, () => this.cameras.main.startFollow(this.player, true, 0.08, 0.08));
  }

  private onPhaseChanged(): void {
    if (initialState.phase === "night") {
      initialState.residents.forEach((resident, index) => {
        resident.action = "defending";
        this.residentDestinations.set(resident.id, new Phaser.Math.Vector2(WORLD.wallX - 300 - index * 65, WORLD.mainRoadY - 85 + index * 170));
      });
      this.spawnNightWave();
    } else if (initialState.phase === "dawn") {
      for (const visual of this.zombieVisuals) visual.destroy();
      this.zombieVisuals.clear();
      for (const bullet of this.bullets) bullet.visual.destroy();
      this.bullets = [];
      this.showBanner("黎明到来", `城门剩余 ${initialState.gateHealth} · 获得废铁战利品`);
      this.saveGame();
    } else if (initialState.phase === "day") {
      for (const resident of initialState.residents) {
        resident.action = resident.jobPlotId ? "walking" : "idle";
        if (resident.jobPlotId) this.residentDestinations.set(resident.id, resident.jobPlotId === "field-1" ? new Phaser.Math.Vector2(1770, 250) : new Phaser.Math.Vector2(620, 1640));
      }
      this.nightWaveActive = false;
      this.saveGame();
    }
    this.renderPhaseUi();
    this.renderCombatUi();
  }

  private renderPhaseUi(): void {
    document.querySelector<HTMLElement>("#day-label")!.textContent = `第 ${initialState.day} 天`;
    const phase = document.querySelector<HTMLElement>("#phase-label")!;
    if (initialState.phase === "dusk") {
      const remaining = Math.max(0, Math.ceil((DUSK_DURATION_MS - this.dayCycle.elapsedInPhase) / 1000));
      phase.textContent = `${phaseLabel(initialState.phase)} · ${remaining}`;
    } else {
      phase.textContent = phaseLabel(initialState.phase);
    }
    const start = document.querySelector<HTMLButtonElement>("#night-start")!;
    start.disabled = initialState.phase !== "day";
    start.textContent = initialState.phase === "day" ? "开始夜防" : initialState.phase === "dusk" ? "准备中" : initialState.phase === "dawn" ? "黎明结算" : "夜防进行中";
    document.querySelector<HTMLElement>("#night-overlay")!.dataset.phase = initialState.phase;
  }

  private togglePause(): void {
    this.manualPaused = !this.manualPaused;
    initialState.paused = this.manualPaused || this.visibilityPaused;
    const button = document.querySelector<HTMLButtonElement>("#pause-toggle")!;
    button.textContent = this.manualPaused ? "▶" : "Ⅱ";
    button.setAttribute("aria-label", this.manualPaused ? "继续游戏" : "暂停游戏");
    if (this.manualPaused) this.scene.pause();
    else if (!this.visibilityPaused) this.scene.resume();
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      this.visibilityPaused = true;
      initialState.paused = true;
      this.scene.pause();
      return;
    }
    if (!this.visibilityPaused) return;
    this.visibilityPaused = false;
    initialState.paused = this.manualPaused;
    if (!this.manualPaused) this.scene.resume();
  }

  private spawnNightWave(): void {
    this.nightWaveActive = true;
    const lineup: ZombieKind[] = ["walker", "runner", "walker", "walker", "runner", "walker"];
    lineup.forEach((kind, index) => {
      const y = WORLD.mainRoadY - 250 + index * 100;
      const visual = this.makePerson(WORLD.wallX + 520 + (index % 3) * 85, y, kind === "runner" ? 0x70433d : 0x454f48, kind === "runner" ? 0xa4a878 : 0x8b9878);
      visual.setRotation(kind === "runner" ? -0.16 : -0.08).setDepth(8);
      if (kind === "runner") visual.setScale(0.88);
      const healthBar = this.add.graphics();
      visual.add(healthBar);
      const maxHp = kind === "runner" ? 58 : 100;
      const zombie: ZombieEntity = { id: `zombie-${initialState.day}-${index}`, kind, hp: maxHp, maxHp, speed: kind === "runner" ? 104 : 56, damage: kind === "runner" ? 7 : 10, attackElapsed: 0, visual, healthBar };
      this.zombies.push(zombie);
      this.zombieVisuals.add(visual);
      this.renderZombieHealth(zombie);
    });
    this.showBanner("尸潮接近", "左键射击 · 居民将自动守卫城门");
    this.renderCombatUi();
  }

  private firePlayerShot(targetX: number, targetY: number): void {
    if (this.shootCooldown > 0 || this.defeated) return;
    const direction = new Phaser.Math.Vector2(targetX - this.player.x, targetY - this.player.y);
    if (direction.lengthSq() < 1) return;
    direction.normalize();
    const visual = this.add.circle(this.player.x + direction.x * 28, this.player.y + direction.y * 28, 6, 0xf2d472).setDepth(12);
    this.bullets.push({ visual, velocity: direction.scale(920), life: 1500, damage: 42 });
    this.shootCooldown = 230;
  }

  private updateCombat(delta: number): void {
    this.shootCooldown = Math.max(0, this.shootCooldown - delta);
    if (initialState.phase !== "night" || this.defeated) return;
    const seconds = delta / 1000;
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      bullet.visual.x += bullet.velocity.x * seconds;
      bullet.visual.y += bullet.velocity.y * seconds;
      bullet.life -= delta;
      const hit = this.zombies.find((zombie) => Phaser.Math.Distance.Between(bullet.visual.x, bullet.visual.y, zombie.visual.x, zombie.visual.y) < 30);
      if (hit) {
        this.damageZombie(hit, bullet.damage);
        bullet.life = 0;
      }
      if (bullet.life <= 0) {
        bullet.visual.destroy();
        this.bullets.splice(i, 1);
      }
    }

    for (const zombie of this.zombies) {
      const mine = initialState.defenses.find((defense) => defense.kind === "mine" && Phaser.Math.Distance.Between(defense.x, defense.y, zombie.visual.x, zombie.visual.y) < 72);
      if (mine) {
        this.detonateMine(mine);
        continue;
      }
      const wire = initialState.defenses.find((defense) => defense.kind === "wire" && Math.abs(defense.x - zombie.visual.x) < 34 && Math.abs(defense.y - zombie.visual.y) < 88);
      const speedFactor = wire ? 0.32 : 1;
      if (wire) {
        wire.durability -= 14 * seconds;
        if (wire.durability <= 0) this.removeDefense(wire);
      }
      if (zombie.visual.x > WORLD.wallX + 76) zombie.visual.x -= zombie.speed * speedFactor * seconds;
      else {
        zombie.attackElapsed += delta;
        if (zombie.attackElapsed >= 1250) {
          zombie.attackElapsed -= 1250;
          initialState.gateHealth = Math.max(0, initialState.gateHealth - zombie.damage);
          this.cameras.main.shake(100, 0.0022);
          this.renderCombatUi();
          if (initialState.gateHealth <= 0) this.triggerDefeat();
        }
      }
    }

    this.residentAttackElapsed += delta;
    if (this.residentAttackElapsed >= 780 && this.zombies.length) {
      this.residentAttackElapsed -= 780;
      for (const resident of initialState.residents) {
        if (this.zombies.length === 0 || initialState.phase !== "night") break;
        const defender = this.residentVisuals.get(resident.id);
        if (!defender || defender.x < WORLD.wallX - 520) continue;
        const target = this.zombies.reduce((nearest, zombie) => zombie.visual.x < nearest.visual.x ? zombie : nearest);
        this.drawTracer(defender.x, defender.y, target.visual.x, target.visual.y);
        this.damageZombie(target, 16);
      }
    }
  }

  private damageZombie(zombie: ZombieEntity, damage: number): void {
    zombie.hp -= damage;
    if (zombie.hp > 0) {
      this.renderZombieHealth(zombie);
      return;
    }
    zombie.visual.destroy();
    this.zombieVisuals.delete(zombie.visual);
    this.zombies = this.zombies.filter((entry) => entry !== zombie);
    initialState.resources.scrap += zombie.kind === "runner" ? 5 : 3;
    document.querySelector<HTMLElement>("#resource-scrap")!.textContent = String(initialState.resources.scrap);
    this.renderCombatUi();
    if (this.nightWaveActive && this.zombies.length === 0) {
      this.nightWaveActive = false;
      enterPhase(initialState, this.dayCycle, "dawn");
      this.onPhaseChanged();
    }
  }

  private detonateMine(mine: DefenseState): void {
    const blast = this.add.circle(mine.x, mine.y, 25, 0xf2be61, 0.8).setDepth(10);
    this.tweens.add({ targets: blast, scale: 4.5, alpha: 0, duration: 280, onComplete: () => blast.destroy() });
    const targets = this.zombies.filter((zombie) => Phaser.Math.Distance.Between(mine.x, mine.y, zombie.visual.x, zombie.visual.y) < 150);
    this.removeDefense(mine);
    for (const target of targets) this.damageZombie(target, 92);
  }

  private removeDefense(defense: DefenseState): void {
    this.defenseVisuals.get(defense.id)?.destroy();
    this.defenseVisuals.delete(defense.id);
    initialState.defenses = initialState.defenses.filter((entry) => entry.id !== defense.id);
    this.saveGame();
  }

  private renderZombieHealth(zombie: ZombieEntity): void {
    zombie.healthBar.clear();
    zombie.healthBar.fillStyle(0x1a2423, 0.9).fillRoundedRect(-23, -42, 46, 6, 2);
    zombie.healthBar.fillStyle(zombie.kind === "runner" ? 0xdb765f : 0xa8c46f).fillRoundedRect(-22, -41, 44 * Phaser.Math.Clamp(zombie.hp / zombie.maxHp, 0, 1), 4, 2);
  }

  private drawTracer(fromX: number, fromY: number, toX: number, toY: number): void {
    const tracer = this.add.graphics().setDepth(11);
    tracer.lineStyle(3, 0xf2d472, 0.85).lineBetween(fromX, fromY, toX, toY);
    this.tweens.add({ targets: tracer, alpha: 0, duration: 120, onComplete: () => tracer.destroy() });
  }

  private renderCombatUi(): void {
    document.querySelector<HTMLElement>("#gate-health")!.textContent = `${initialState.gateHealth} / ${initialState.gateMaxHealth}`;
    document.querySelector<HTMLElement>("#enemy-count")!.textContent = String(this.zombies.length);
    document.querySelector<HTMLElement>("#enemy-status")!.hidden = initialState.phase !== "night";
  }

  private showBanner(title: string, message: string): void {
    const banner = document.querySelector<HTMLElement>("#battle-banner")!;
    document.querySelector<HTMLElement>("#battle-title")!.textContent = title;
    document.querySelector<HTMLElement>("#battle-message")!.textContent = message;
    banner.hidden = false;
    window.setTimeout(() => { banner.hidden = true; }, 2600);
  }

  private triggerDefeat(): void {
    if (this.defeated) return;
    this.defeated = true;
    document.querySelector<HTMLElement>("#defeat-panel")!.hidden = false;
    this.scene.pause();
  }

  private saveGame(): void {
    localStorage.setItem(SAVE_KEY, JSON.stringify(initialState));
  }

  private makePerson(x: number, y: number, clothes: number, skin: number): Phaser.GameObjects.Container {
    const body = this.add.rectangle(0, 12, 24, 38, clothes).setStrokeStyle(2, 0x1d292a);
    const head = this.add.circle(0, -16, 11, skin).setStrokeStyle(2, 0x1d292a);
    const shadow = this.add.ellipse(0, 34, 34, 10, 0x000000, 0.18);
    return this.add.container(x, y, [shadow, body, head]);
  }

  private drawTrees(): void {
    const g = this.add.graphics();
    for (let i = 0; i < 34; i += 1) {
      const x = Phaser.Math.Between(70, WORLD.wallX - 120);
      const y = Phaser.Math.Between(100, WORLD.height - 60);
      const inInitialCore = x > 260 && x < 2020 && y > 180 && y < 1500;
      const inActiveHousing = x > 300 && x < 950 && y < 760;
      const inActiveWorkshop = x > 390 && x < 840 && y > 1430 && y < 1760;
      const onMainRoad = y > 970 && y < 1120;
      const inActiveField = x > 1540 && x < 2130 && y < 430;
      const inQuarantine = x > 3210 && x < 3720 && y > 250 && y < 1020;
      if (inInitialCore || inActiveHousing || inActiveWorkshop || onMainRoad || inActiveField || inQuarantine || x > WORLD.wallX - 120) continue;
      g.fillStyle(0x60462f).fillRect(x - 5, y, 10, 34);
      g.fillStyle(0x315f3f).fillCircle(x - 12, y - 5, 26).fillCircle(x + 15, y - 8, 30).fillCircle(x, y - 28, 32);
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#101817",
  physics: { default: "arcade", arcade: { debug: false } },
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: PrototypeScene,
  render: { antialias: true, pixelArt: false },
});
