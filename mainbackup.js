import { creaPartita } from "./engine/game.js";
import { Demone, Imprevisto, CartaRifornimento, ElementoSimbolo } from "./engine/entities.js";

const config = {
  type: Phaser.AUTO,
  width: 1350,
  height: 720,
  backgroundColor: "#1b1b1b",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: { preload, create, update },
};
const game = new Phaser.Game(config);

let hand = [];
let limboSprites = [];
let cerchiaSprites = [];
let modalOpen = false;
let demonDeck, resourceDeck, bossCard;
let bossFrame = null;
let bossFrame2 = null;
let pendingDemone = null;
let gioco = null;
let giocoPronto = false;
let settingsControls = null;
let settingsMenu = null;
let logPanel = null;
let actionLog = [];
let spionePanel = null;

function formatLogEntry(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  const parts = [entry.message || entry.type || ""];
  const d = entry.detail || {};
  if (d.carta) parts.push(`Carta: ${d.carta}`);
  if (d.demone) parts.push(`Demone: ${d.demone}`);
  if (d.giocatore) parts.push(`Giocatore: ${d.giocatore}`);
  return parts.filter(Boolean).join(" | ");
}

function pushLog(msgOrEntry) {
  const msg = typeof msgOrEntry === "string" ? msgOrEntry : formatLogEntry(msgOrEntry);
  if (!msg) return;
  actionLog.push(msg);
  if (actionLog.length > 200) actionLog.shift();
  refreshLogPanel();
}

// Posizioni bot per animazioni
const botPositions = {
  "Bot Beta": { mano: { x: 60, y: 155 }, cerchia: { x: 160, y: 250 } },
  "Bot Gamma": { mano: { x: 60, y: 380 }, cerchia: { x: 160, y: 470 } },
  "Bot Alpha": { mano: { x: 1140, y: 155 }, cerchia: { x: 1025, y: 250 } },
  "Bot Delta": { mano: { x: 1140, y: 380 }, cerchia: { x: 1025, y: 470 } },
};

// Traccia carte visibili nei bot e LIMBO
const botCerchiaSprites = {
  "Bot Beta": [],
  "Bot Gamma": [],
  "Bot Alpha": [],
  "Bot Delta": [],
};

const ui = {
  bots: [],
  human: {},
  mazzi: {},
  azioni: null,
};
const BOT_ACTION_DELAY = 2000;
const activeBalloons = new Set();
const BOT_NAMES = ["Bot Beta", "Bot Gamma", "Bot Alpha", "Bot Delta"];
const SIGILLI_POOL = ["A", "B", "C", "D", "E"];
const playerConfig = {
  totalPlayers: 5, // include il player umano
  humanEnabled: true,
  sigilliRandom: true,
  sigilliManual: {},
};

function preload() {
  // === Tavolo di gioco ===
  this.load.image("table", "assets/table/table.png");

  // === Boss ===
  this.load.image("boss_card", "assets/boss/boss_carta.png");
  this.load.image("boss_back", "assets/boss/boss_dorso.png");
  this.load.image("boss_frame1", "assets/boss/boss_frame1.png");
  this.load.image("boss_frame2", "assets/boss/boss_frame2.png");

  // === Bottoni / Mazzi ===
  this.load.image("btn_rifornimenti", "assets/buttons/pesca_rifornimenti.png");
  this.load.image("btn_demoni", "assets/buttons/rivela_demoni.png");
  this.load.image("btn_next", "assets/buttons/next.png");
  this.load.image("btn_settings", "assets/buttons/setting.png");

  // === Dorsi e frame carte ===
  this.load.image("dorso_rifornimenti", "assets/cards/frames/dorso_rifornimenti.png");

  // === Carte Demoni ===
  const demonElements = ["fuoco", "acqua", "aria", "terra", "etere"];
  demonElements.forEach(el => {
    this.load.image(`demon_${el}`, `assets/cards/demons_front/demon_${el}.png`);
  });
  this.load.image("imprevisto", "assets/cards/demons_front/imprevisto.png");

  // === Carte Energia ===
  const energies = ["a", "af", "at", "aw", "e", "f", "ft", "T", "w", "wf", "wt"];
  energies.forEach(e => {
    this.load.image(`energy_${e}`, `assets/cards/energy_front/${e}.png`);
  });

  // === Carte Magia ===
  ["magia", "spostastelle", "stoppastella"].forEach(name => {
    this.load.image(name, `assets/cards/magic/${name}.png`);
  });

  // === Tavolo Extra ===
  ["cemetery_pile", "cemetry_empty", "discard_empty", "discard_pile", "limbo"].forEach(img => {
    this.load.image(img, `assets/table/${img}.png`);
  });
  // Alias per cimitero con key corretta usata nel layout
  this.load.image("cemetery_empty", "assets/table/cemetry_empty.png");

  // === Mano Avversari ===
  this.load.image("mano_opp", "assets/cards/frames/mano_opp.png");
}

function create() {
  // --- Sfondo tavolo ---
  this.add.image(625, 360, "table").setScale(0.5);

  // --- LIMBO ---  // Riquadro LIMBO
  {
    const g = this.add.graphics();
    const x1 = 290, x2 = 950;
    const w = x2 - x1, h = 125;
    const cx = (x1 + x2) / 2, cy = 65, r = 10;
    g.fillStyle(0x0a001a, 0.7);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
    g.lineStyle(2, 0xFFD700, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
  }    this.add.text(340, 30, "LIMBO", { font: "20px Arial", fill: "#fff" }).setOrigin(0.5, 0).setDepth(1000);

  ui.limboCount = this.add.text(330, 55, "0", { font: "18px Arial", fill: "#fff" });
  const limboBtn = this.add.text(625, 125, "Evoca dal Limbo", {
    font: "16px Arial",
    fill: "#fff",
    backgroundColor: "#555",
    padding: { x: 10, y: 5 },
  }).setOrigin(0.5).setInteractive();
  limboBtn.on("pointerdown", () => evocaDalLimbo(this));

  // --- Slot LIMBO ---
  const limboSlotStartX = 410;
  const limboSlotY = 60;
  const limboSlotWidth = 60;
  const limboSlotHeight = 80;
  const limboSlotSpacing = 70;
  this.limboSlots = [];
  for (let i = 0; i < 8; i++) {
    const slotX = limboSlotStartX + i * limboSlotSpacing;
    this.add.rectangle(slotX, limboSlotY, limboSlotWidth, limboSlotHeight, 0x333333, 0.3)
      .setStrokeStyle(2, 0x777777);
    this.limboSlots.push({ x: slotX, y: limboSlotY });
  }

  // --- Boss e mazzi ---
  bossCard = this.add.image(625, 320, "boss_back").setInteractive().setScale(0.6);
  bossFrame = this.add.image(625, 320, "boss_frame1").setScale(0.65);
  bossFrame2 = this.add.image(625, 320, "boss_frame2").setScale(0.65);
  bossFrame.setAlpha(0);
  bossFrame2.setAlpha(0);
  bossFrame.setDepth(bossCard.depth + 0.1);
  bossFrame2.setDepth(bossCard.depth + 0.2);
  bossFrame.disableInteractive(); // non blocca i click
  bossFrame2.disableInteractive();
  bossCard.flipped = false;
  bossCard.on("pointerdown", () => {
    revealBossCard(this);
    tentaConquista(this);
  });
  
  // Rettangolo dietro scritte boss
  {
    const g = this.add.graphics();
    const cx = 625, cy = 440, w = 220, h = 32, r = 8;
    g.fillStyle(0x000000, 0.7);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
    g.lineStyle(2, 0xFFD700, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
  }
  
  ui.bossName = this.add.text(625, 430, "Boss: -", { font: "16px Arial", fill: "#fff" }).setOrigin(0.5);
  ui.bossReq = this.add.text(625, 450, "", { font: "12px Arial", fill: "#aaa" }).setOrigin(0.5);
  const conquerBtn = this.add.text(625, 230, "Tenta Conquista", {
    font: "14px Arial",
    fill: "#fff",
    backgroundColor: "#444",
    padding: { x: 8, y: 4 },
  }).setOrigin(0.5).setInteractive();
  conquerBtn.on("pointerdown", () => {
    tentaConquista(this);
  });

  resourceDeck = this.add.image(450, 350, "btn_rifornimenti").setScale(0.5).setInteractive();
  demonDeck = this.add.image(830, 350, "btn_demoni").setScale(0.5).setInteractive();
  resourceDeck.on("pointerdown", async () => { await drawCard(this, "rifornimento"); });
  demonDeck.on("pointerdown", async () => { await drawCard(this, "demone"); });
  this.add.text(410, 440, "Pesca\nRifornimento", { font: "12px Arial", fill: "#fff" });
  this.add.text(810, 430, "Rivela\nEvocazione", { font: "12px Arial", fill: "#fff" });
  ui.mazzi.rif = this.add.text(410, 470, "Mazzo: -", { font: "11px Arial", fill: "#aaa" });
  ui.mazzi.evo = this.add.text(810, 460, "Mazzo: -", { font: "11px Arial", fill: "#aaa" });

  // --- Cimitero e scarti ---
  this.add.image(830, 240, "cemetery_empty").setScale(0.4);
  this.add.image(450, 230, "discard_empty").setScale(0.4);
  this.add.text(800, 182, "CIMITERO", { font: "11px Arial", fill: "#aaa" });
  this.add.text(415, 175, "SCARTI", { font: "11px Arial", fill: "#aaa" });

  // --- Giocatori BOT ---
  const botStyle = { font: "13px Arial", fill: "#fff", stroke: "#000", strokeThickness: 3 };
  const cardCountStyle = { font: "22px Arial", fill: "#fff", stroke: "#000", strokeThickness: 2, align: "center" };

  // Bot Beta (sinistra alto)
  const betaElems = [];
  {
    const g = this.add.graphics();
    betaElems.push(g);
    const cx = 160, cy = 151, w = 100, h = 100, r = 10;
    g.fillStyle(0x000000, 0.7);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
    g.lineStyle(2, 0xFFD700, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
  }
  betaElems.push(this.add.text(120, 105, "Bot Beta", botStyle));
  const betaSig = this.add.text(120, 123, "Sigillo: -", botStyle); betaElems.push(betaSig);
  const betaHandText = this.add.text(120, 141, "Mano: -", botStyle); betaElems.push(betaHandText);
  const betaStars = this.add.text(120, 159, "Stelle: -", botStyle); betaElems.push(betaStars);
  const betaBoss = this.add.text(120, 177, "Boss: -", botStyle); betaElems.push(betaBoss);
  const betaHand = this.add.image(60, 155, "mano_opp").setScale(0.063); betaElems.push(betaHand);
  const betaHandCount = this.add.text(60, 147, "-", cardCountStyle); betaElems.push(betaHandCount);
  // Slot cerchia Bot Beta
  const betaCerchiaStartX = 80;
  const betaCerchiaY = 250;
  const cerchiaSlotW = 60;
  const cerchiaSlotH = 80;
  const cerchiaSlotSpacing = 70;
  for (let i = 0; i < 4; i++) {
    const slotX = betaCerchiaStartX + i * cerchiaSlotSpacing;
    betaElems.push(
      this.add.rectangle(slotX, betaCerchiaY, cerchiaSlotW, cerchiaSlotH, 0x333333, 0.3)
        .setStrokeStyle(2, 0x777777)
    );
  }
  ui.bots.push({
    nome: "Bot Beta",
    sigillo: betaSig,
    mano: betaHandText,
    stelle: betaStars,
    boss: betaBoss,
    manoCount: betaHandCount,
    panelElems: betaElems,
  });

  // Bot Gamma (sinistra basso)
  const gammaElems = [];
  {
    const g = this.add.graphics();
    gammaElems.push(g);
    const cx = 160, cy = 376, w = 100, h = 100, r = 10;
    g.fillStyle(0x000000, 0.7);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
    g.lineStyle(2, 0xFFD700, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
  }
  gammaElems.push(this.add.text(120, 330, "Bot Gamma", botStyle));
  const gammaSig = this.add.text(120, 348, "Sigillo: -", botStyle); gammaElems.push(gammaSig);
  const gammaHandText = this.add.text(120, 366, "Mano: -", botStyle); gammaElems.push(gammaHandText);
  const gammaStars = this.add.text(120, 384, "Stelle: -", botStyle); gammaElems.push(gammaStars);
  const gammaBoss = this.add.text(120, 402, "Boss: -", botStyle); gammaElems.push(gammaBoss);
  const gammaHand = this.add.image(60, 380, "mano_opp").setScale(0.063); gammaElems.push(gammaHand);
  const gammaHandCount = this.add.text(60, 372, "-", cardCountStyle); gammaElems.push(gammaHandCount);
  // Slot cerchia Bot Gamma
  const gammaCerchiaStartX = 80;
  const gammaCerchiaY = 470;
  for (let i = 0; i < 4; i++) {
    const slotX = gammaCerchiaStartX + i * cerchiaSlotSpacing;
    gammaElems.push(
      this.add.rectangle(slotX, gammaCerchiaY, cerchiaSlotW, cerchiaSlotH, 0x333333, 0.3)
        .setStrokeStyle(2, 0x777777)
    );
  }
  ui.bots.push({
    nome: "Bot Gamma",
    sigillo: gammaSig,
    mano: gammaHandText,
    stelle: gammaStars,
    boss: gammaBoss,
    manoCount: gammaHandCount,
    panelElems: gammaElems,
  });

  // Bot Alpha (destra alto)
  const alphaElems = [];
  {
    const g = this.add.graphics();
    alphaElems.push(g);
    const cx = 1025, cy = 151, w = 100, h = 100, r = 10;
    g.fillStyle(0x000000, 0.7);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
    g.lineStyle(2, 0xFFD700, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
  }
  alphaElems.push(this.add.text(980, 105, "Bot Alpha", botStyle));
  const alphaSig = this.add.text(980, 123, "Sigillo: -", botStyle); alphaElems.push(alphaSig);
  const alphaHandText = this.add.text(980, 141, "Mano: -", botStyle); alphaElems.push(alphaHandText);
  const alphaStars = this.add.text(980, 159, "Stelle: -", botStyle); alphaElems.push(alphaStars);
  const alphaBoss = this.add.text(980, 177, "Boss: -", botStyle); alphaElems.push(alphaBoss);
  const alphaHand = this.add.image(1140, 155, "mano_opp").setScale(0.063); alphaElems.push(alphaHand);
  const alphaHandCount = this.add.text(1140, 147, "-", cardCountStyle); alphaElems.push(alphaHandCount);
  // Slot cerchia Bot Alpha
  const alphaCerchiaStartX = 980;
  const alphaCerchiaY = 250;
  for (let i = 0; i < 4; i++) {
    const slotX = alphaCerchiaStartX + i * cerchiaSlotSpacing;
    alphaElems.push(
      this.add.rectangle(slotX, alphaCerchiaY, cerchiaSlotW, cerchiaSlotH, 0x333333, 0.3)
        .setStrokeStyle(2, 0x777777)
    );
  }
  ui.bots.push({
    nome: "Bot Alpha",
    sigillo: alphaSig,
    mano: alphaHandText,
    stelle: alphaStars,
    boss: alphaBoss,
    manoCount: alphaHandCount,
    panelElems: alphaElems,
  });

  // Bot Delta (destra basso)
  const deltaElems = [];
  {
    const g = this.add.graphics();
    deltaElems.push(g);
    const cx = 1025, cy = 376, w = 100, h = 100, r = 10;
    g.fillStyle(0x000000, 0.7);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
    g.lineStyle(2, 0xFFD700, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
  }
  deltaElems.push(this.add.text(980, 330, "Bot Delta", botStyle));
  const deltaSig = this.add.text(980, 348, "Sigillo: -", botStyle); deltaElems.push(deltaSig);
  const deltaHandText = this.add.text(980, 366, "Mano: -", botStyle); deltaElems.push(deltaHandText);
  const deltaStars = this.add.text(980, 384, "Stelle: -", botStyle); deltaElems.push(deltaStars);
  const deltaBoss = this.add.text(980, 402, "Boss: -", botStyle); deltaElems.push(deltaBoss);
  const deltaHand = this.add.image(1140, 380, "mano_opp").setScale(0.063); deltaElems.push(deltaHand);
  const deltaHandCount = this.add.text(1140, 372, "-", cardCountStyle); deltaElems.push(deltaHandCount);
  // Slot cerchia Bot Delta
  const deltaCerchiaStartX = 980;
  const deltaCerchiaY = 470;
  for (let i = 0; i < 4; i++) {
    const slotX = deltaCerchiaStartX + i * cerchiaSlotSpacing;
    deltaElems.push(
      this.add.rectangle(slotX, deltaCerchiaY, cerchiaSlotW, cerchiaSlotH, 0x333333, 0.3)
        .setStrokeStyle(2, 0x777777)
    );
  }
  ui.bots.push({
    nome: "Bot Delta",
    sigillo: deltaSig,
    mano: deltaHandText,
    stelle: deltaStars,
    boss: deltaBoss,
    manoCount: deltaHandCount,
    panelElems: deltaElems,
  });

  // --- Giocatore Umano ---
  const humanStyle = { font: "13px Arial", fill: "#fff", stroke: "#000", strokeThickness: 3 };
  {
    const g = this.add.graphics();
    const cx = 155, cy = 552, w = 180, h = 55, r = 10;
    g.fillStyle(0x000000, 0.7);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
    g.lineStyle(2, 0xFFD700, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, r);
  }
  this.add.text(75, 530, "Umano", humanStyle);
  const humanSig = this.add.text(75, 548, "Sigillo: -", humanStyle);
  const humanBoss = this.add.text(175, 530, "Boss: -", humanStyle);
  const humanStars = this.add.text(175, 548, "Stelle: -", humanStyle);
  ui.human = { sigillo: humanSig, boss: humanBoss, stelle: humanStars };

  // --- Pulsante NEXT ---
  const nextBtn = this.add.image(125, 33, "btn_next").setScale(0.25).setInteractive();
  nextBtn.on("pointerdown", () => nextTurn(this));
  ui.nextBtn = nextBtn;
  ui.azioni = this.add.text(200, 20, "Azioni: -/2", { font: "16px Arial", fill: "#fff" });

  // --- Pulsante SETTINGS ---
  const settingsBtn = this.add.image(1125, 35, "btn_settings").setScale(0.25).setInteractive();
  settingsBtn.on("pointerdown", () => toggleSettingsMenu(this));

  // --- Slot Mano Giocatore ---
  const slotStartX = 50;
  const slotY = 650;
  const slotWidth = 70;
  const slotHeight = 100;
  const slotSpacing = 90;
  
  for (let i = 0; i < 6; i++) {
    const slotX = slotStartX + i * slotSpacing;
    this.add.rectangle(slotX, slotY, slotWidth, slotHeight, 0x444444, 0.35).setStrokeStyle(2, 0x666666);
  }

  // --- Slot Cerchia Giocatore ---
  const cerchiaStartX = 820;
  const cerchiaY = 650;
  const cerchiaSpacing = 120;
  const cerchiaWidth = 80;
  const cerchiaHeight = 110;

  for (let i = 0; i < 4; i++) {
    const slotX = cerchiaStartX + i * cerchiaSpacing;
    this.add.rectangle(slotX, cerchiaY, cerchiaWidth, cerchiaHeight, 0x333333, 0.3)
      .setStrokeStyle(2, 0x777777);
  }

  // Drag disabilitato per le carte (non serve)

  // Avvia il motore JS (carica JSON) e abilita i mazzi quando pronto
  startNewGame(this);
}

function setBotVisibility(name, visible) {
  const entry = ui.bots.find(b => b.nome === name);
  if (!entry) return;
  const elems = entry.panelElems || [];
  elems.forEach(el => {
    try { el.setVisible(visible); el.active = visible; } catch (_) {}
  });
}

function toggleLogPanel(scene) {
  if (logPanel && logPanel.container?.active) {
    try { logPanel.container.destroy(true); } catch (_) {}
    logPanel = null;
    return;
  }
  const depth = 3000;
  const width = 150;
  const height = 450;
  const container = scene.add.container(1350 - width, 90).setDepth(depth);
  const bg = scene.add.rectangle(0, 0, width, height, 0x111111, 0.9)
    .setOrigin(0)
    .setInteractive({ draggable: true });
  const title = scene.add.text(8, 6, "Log azioni", { font: "16px Arial", fill: "#FFD700" });
  const closeX = scene.add.text(width - 18, 6, "✖", { font: "14px Arial", fill: "#ffaaaa" }).setInteractive();
  const resizeHandle = scene.add.rectangle(width, height, 16, 16, 0x666666, 0.8)
    .setOrigin(1)
    .setStrokeStyle(1, 0xaaaaaa)
    .setInteractive({ draggable: true });

  const textObj = scene.add.text(8, 26, "", {
    font: "12px Arial",
    fill: "#fff",
    wordWrap: { width: width - 16 }
  }).setOrigin(0);

  container.add([bg, title, textObj, closeX, resizeHandle]);
  container.setSize(width, height);
  container.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);

  // Draggabile (bg e titolo) con offset per evitare salti
  let dragOffset = { x: 0, y: 0 };
  scene.input.setDraggable(bg);
  bg.on("dragstart", (pointer) => {
    dragOffset = { x: pointer.x - container.x, y: pointer.y - container.y };
  });
  bg.on("drag", (pointer) => {
    container.x = pointer.x - dragOffset.x;
    container.y = pointer.y - dragOffset.y;
  });
  title.setInteractive({ draggable: true });
  scene.input.setDraggable(title);
  title.on("dragstart", (pointer) => {
    dragOffset = { x: pointer.x - container.x, y: pointer.y - container.y };
  });
  title.on("drag", (pointer) => {
    container.x = pointer.x - dragOffset.x;
    container.y = pointer.y - dragOffset.y;
  });

  // Ridimensionabile con offset
  scene.input.setDraggable(resizeHandle);
  let logResizeStart = null;
  resizeHandle.on("dragstart", (pointer) => {
    logResizeStart = { x: pointer.x, y: pointer.y, w: bg.width, h: bg.height };
  });
  resizeHandle.on("drag", (pointer) => {
    if (!logResizeStart) return;
    const newW = Math.max(200, logResizeStart.w + (pointer.x - logResizeStart.x));
    const newH = Math.max(160, logResizeStart.h + (pointer.y - logResizeStart.y));
    bg.width = newW;
    bg.height = newH;
    resizeHandle.x = newW;
    resizeHandle.y = newH;
    closeX.x = newW - 18;
    textObj.setWordWrapWidth(newW - 16);
    container.setSize(newW, newH);
  });
  resizeHandle.on("dragend", () => { logResizeStart = null; });

  closeX.on("pointerdown", () => {
    container.destroy(true);
    logPanel = null;
  });

  logPanel = { container, textObj };
  refreshLogPanel();
}

function refreshLogPanel() {
  if (!logPanel || !logPanel.container?.active) return;
  const textObj = logPanel.textObj;
  if (!textObj || !textObj.active) return;
  const lines = actionLog.slice(-12).map(e => `• ${e}`);
  textObj.setText(lines.join("\n"));
}

function toggleSpionePanel(scene) {
  if (spionePanel && spionePanel.container?.active) {
    try { spionePanel.container.destroy(true); } catch (_) {}
    spionePanel = null;
    return;
  }
  const depth = 3000;
  const container = scene.add.container(300, 460).setDepth(depth);
  const width = 380;
  const height = 260;
  const bg = scene.add.rectangle(0, 0, width, height, 0x111111, 0.9)
    .setOrigin(0)
    .setInteractive({ draggable: true });
  const title = scene.add.text(8, 6, "Spione (bot + prossimo boss)", { font: "16px Arial", fill: "#FFD700", wordWrap: { width: width - 16 } });
  const closeX = scene.add.text(width - 18, 6, "✖", { font: "14px Arial", fill: "#ffaaaa" }).setInteractive();
  const resizeHandle = scene.add.rectangle(width, height, 16, 16, 0x666666, 0.8)
    .setOrigin(1)
    .setStrokeStyle(1, 0xaaaaaa)
    .setInteractive({ draggable: true });

  const textObj = scene.add.text(8, 32, "", {
    font: "14px Arial",
    fill: "#fff",
    stroke: "#000",
    strokeThickness: 2,
    wordWrap: { width: width - 16 }
  }).setOrigin(0);

  container.add([bg, title, textObj, closeX, resizeHandle]);
  container.setSize(width, height);
  container.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);

  // Drag con offset
  let dragOffset = { x: 0, y: 0 };
  scene.input.setDraggable(bg);
  bg.on("dragstart", (pointer) => { dragOffset = { x: pointer.x - container.x, y: pointer.y - container.y }; });
  bg.on("drag", (pointer) => {
    container.x = pointer.x - dragOffset.x;
    container.y = pointer.y - dragOffset.y;
  });
  title.setInteractive({ draggable: true });
  scene.input.setDraggable(title);
  title.on("dragstart", (pointer) => { dragOffset = { x: pointer.x - container.x, y: pointer.y - container.y }; });
  title.on("drag", (pointer) => {
    container.x = pointer.x - dragOffset.x;
    container.y = pointer.y - dragOffset.y;
  });

  // Resize con offset
  scene.input.setDraggable(resizeHandle);
  let resizeStart = null;
  resizeHandle.on("dragstart", (pointer) => {
    resizeStart = { x: pointer.x, y: pointer.y, w: bg.width, h: bg.height };
  });
  resizeHandle.on("drag", (pointer) => {
    if (!resizeStart) return;
    const newW = Math.max(260, resizeStart.w + (pointer.x - resizeStart.x));
    const newH = Math.max(180, resizeStart.h + (pointer.y - resizeStart.y));
    bg.width = newW;
    bg.height = newH;
    resizeHandle.x = newW;
    resizeHandle.y = newH;
    closeX.x = newW - 18;
    textObj.setWordWrapWidth(newW - 16);
    container.setSize(newW, newH);
  });
  resizeHandle.on("dragend", () => { resizeStart = null; });

  closeX.on("pointerdown", () => {
    container.destroy(true);
    spionePanel = null;
  });

  spionePanel = { container, textObj };
  refreshSpionePanel();
}

function refreshSpionePanel() {
  if (!spionePanel || !spionePanel.container?.active || !gioco) return;
  const textObj = spionePanel.textObj;
  if (!textObj || !textObj.active) return;
  const lines = [];
  const bots = gioco.giocatori.filter(g => g.isBot);
  bots.forEach(bot => {
    const carte = (bot.mano || []).map(c => c?.nome || "??").join(", ") || "-";
    lines.push(`${bot.nome}: ${carte}`);
  });
  const boss = gioco.prossimoBoss ? gioco.prossimoBoss() : null;
  if (boss) {
    lines.push("");
    lines.push(`Prossimo Boss: ${boss.nome}`);
    const vals = boss.valori || {};
    lines.push(`Req: E${vals.E || 0} W${vals.W || 0} F${vals.F || 0} T${vals.T || 0} A${vals.A || 0}`);
  } else {
    lines.push("");
    lines.push("Prossimo Boss: -");
  }
  textObj.setText(lines.join("\n"));
}

function toggleSettingsMenu(scene) {
  if (settingsMenu) {
    settingsMenu.destroy(true);
    settingsMenu = null;
    return;
  }
  const depth = 1200;
  const container = scene.add.container(1125, 60).setDepth(depth);
  const bg = scene.add.rectangle(0, 0, 180, 120, 0x222222, 0.95)
    .setOrigin(1, 0)
    .setStrokeStyle(2, 0x888888)
    .setInteractive();
  const makeEntry = (label, y, onClick) => {
    const hitW = 180; // allineata alla larghezza del menu
    const hitbox = scene.add.rectangle(-hitW, y + 8, hitW, 22, 0xffffff, 0)
      .setOrigin(0, 0.5)
      .setInteractive();
    hitbox.setInteractive(new Phaser.Geom.Rectangle(-hitW, y - 3, hitW, 22), Phaser.Geom.Rectangle.Contains);
    const txt = scene.add.text(-150, y + 2, label, {
      font: "14px Arial",
      fill: "#fff"
    });
    hitbox.on("pointerover", () => {
      txt.setStyle({ fill: "#FFD700" });
      hitbox.setFillStyle(0xffffff, 0.18);
    });
    hitbox.on("pointerout", () => {
      txt.setStyle({ fill: "#fff" });
      hitbox.setFillStyle(0xffffff, 0);
    });
    hitbox.on("pointerdown", () => {
      toggleSettingsMenu(scene);
      onClick();
    });
    return { hitbox, txt };
  };
  const entries = [
    makeEntry("Player", 12, () => openPlayerSettings(scene)),
    makeEntry("Log", 36, () => toggleLogPanel(scene)),
    makeEntry("Spione", 60, () => toggleSpionePanel(scene)),
    makeEntry("Restart", 84, () => startNewGame(scene)),
  ];
  container.add([bg, ...entries.flatMap(e => [e.hitbox, e.txt])]);
  settingsMenu = container;
}

function openPlayerSettings(scene) {
  if (modalOpen) return;
  modalOpen = true;
  const depth = 1300;
  const controls = [];
  settingsControls = controls;

  let tempTotal = playerConfig.totalPlayers;
  let tempHuman = playerConfig.humanEnabled;
  let tempRandom = playerConfig.sigilliRandom;
  let tempManual = { ...playerConfig.sigilliManual };

  const overlay = scene.add.rectangle(625, 360, 1250, 720, 0x000000, 0.65)
    .setDepth(depth).setInteractive();
  const panel = scene.add.rectangle(625, 360, 780, 500, 0x202020, 0.95)
    .setDepth(depth + 1).setStrokeStyle(2, 0x888888);
  const title = scene.add.text(400, 140, "Configurazione Giocatori", {
    font: "24px Arial",
    fill: "#fff"
  }).setDepth(depth + 2);

  const totalLabel = scene.add.text(400, 190, "Numero giocatori (max 5):", {
    font: "16px Arial",
    fill: "#ccc"
  }).setDepth(depth + 2);
  const totalValue = scene.add.text(680, 190, `${tempTotal}`, {
    font: "18px Arial",
    fill: "#ffda77"
  }).setDepth(depth + 2);
  const minus = scene.add.text(640, 188, "-", {
    font: "22px Arial",
    fill: "#fff",
    backgroundColor: "#444",
    padding: { x: 6, y: 2 }
  }).setDepth(depth + 2).setInteractive();
  const closeX = scene.add.text(940, 140, "✖", {
    font: "18px Arial",
    fill: "#ffaaaa",
    backgroundColor: "#800",
    padding: { x: 6, y: 2 }
  }).setDepth(depth + 2).setInteractive();
  const plus = scene.add.text(710, 188, "+", {
    font: "22px Arial",
    fill: "#fff",
    backgroundColor: "#444",
    padding: { x: 6, y: 2 }
  }).setDepth(depth + 2).setInteractive();

  const humanLabel = scene.add.text(400, 225, "Player umano:", {
    font: "16px Arial",
    fill: "#ccc"
  }).setDepth(depth + 2);
  const humanToggle = scene.add.text(520, 225, tempHuman ? "Attivo" : "Disattivo", {
    font: "16px Arial",
    fill: tempHuman ? "#a8ff7a" : "#ff8888",
    backgroundColor: "#444",
    padding: { x: 8, y: 4 }
  }).setDepth(depth + 2).setInteractive();

  const randomLabel = scene.add.text(400, 260, "Sigilli:", {
    font: "16px Arial",
    fill: "#ccc"
  }).setDepth(depth + 2);
  const randomToggle = scene.add.text(460, 260, tempRandom ? "Random" : "Manuale", {
    font: "16px Arial",
    fill: tempRandom ? "#ffda77" : "#a8ff7a",
    backgroundColor: "#444",
    padding: { x: 8, y: 4 }
  }).setDepth(depth + 2).setInteractive();

  const sigilliTitle = scene.add.text(400, 300, "Sigilli per giocatore:", {
    font: "16px Arial",
    fill: "#ccc"
  }).setDepth(depth + 2);

  const sigilliEntries = [];
  const destroySigilliEntries = () => {
    while (sigilliEntries.length) {
      const it = sigilliEntries.pop();
      try { it.name.destroy(); } catch (_) {}
      try { it.value.destroy(); } catch (_) {}
    }
  };

  const currentPlayersList = () => {
    const tot = Math.max(2, Math.min(tempTotal, SIGILLI_POOL.length));
    const players = ["Player"];
    const botsNeeded = Math.max(0, tot - 1);
    for (let i = 0; i < botsNeeded && i < BOT_NAMES.length; i += 1) {
      players.push(BOT_NAMES[i]);
    }
    return players;
  };

  const cycleSigillo = (name) => {
    const pool = [...SIGILLI_POOL, "-"];
    const current = tempManual[name] || "-";
    const idx = pool.indexOf(current);
    const next = pool[(idx + 1) % pool.length];
    if (next === "-") {
      delete tempManual[name];
    } else {
      tempManual[name] = next;
    }
    refreshSigilliEntries();
  };

  const refreshSigilliEntries = () => {
    destroySigilliEntries();
    const list = currentPlayersList();
    list.forEach((nome, i) => {
      const y = 330 + i * 30;
      const nameText = scene.add.text(400, y, nome, { font: "15px Arial", fill: "#fff" })
        .setDepth(depth + 2);
      const val = tempRandom ? "Random" : (tempManual[nome] || "-");
      const valText = scene.add.text(600, y, val, {
        font: "15px Arial",
        fill: tempRandom ? "#aaa" : "#ffda77",
        backgroundColor: tempRandom ? "#333" : "#444",
        padding: { x: 6, y: 2 }
      }).setDepth(depth + 2);
      if (!tempRandom) {
        valText.setInteractive();
        valText.on("pointerdown", () => cycleSigillo(nome));
      }
      sigilliEntries.push({ name: nameText, value: valText });
    });
  };

  const applyChanges = () => {
    playerConfig.totalPlayers = Math.max(2, Math.min(tempTotal, SIGILLI_POOL.length));
    playerConfig.humanEnabled = tempHuman;
    playerConfig.sigilliRandom = tempRandom;
    playerConfig.sigilliManual = tempRandom ? {} : { ...tempManual };
    cleanup();
    startNewGame(scene);
  };

  const cleanup = () => {
    destroySigilliEntries();
    controls.forEach(c => { try { c.destroy(); } catch (_) {} });
    settingsControls = null;
    modalOpen = false;
  };

  minus.on("pointerdown", () => {
    tempTotal = Math.max(2, tempTotal - 1);
    totalValue.setText(`${tempTotal}`);
    refreshSigilliEntries();
  });
  plus.on("pointerdown", () => {
    tempTotal = Math.min(SIGILLI_POOL.length, tempTotal + 1);
    totalValue.setText(`${tempTotal}`);
    refreshSigilliEntries();
  });
  humanToggle.on("pointerdown", () => {
    tempHuman = !tempHuman;
    humanToggle.setText(tempHuman ? "Attivo" : "Disattivo");
    humanToggle.setFill(tempHuman ? "#a8ff7a" : "#ff8888");
  });
  randomToggle.on("pointerdown", () => {
    tempRandom = !tempRandom;
    randomToggle.setText(tempRandom ? "Random" : "Manuale");
    randomToggle.setFill(tempRandom ? "#ffda77" : "#a8ff7a");
    refreshSigilliEntries();
  });

  const applyBtn = scene.add.text(500, 500, "Applica", {
    font: "18px Arial",
    fill: "#fff",
    backgroundColor: "#3a9c4f",
    padding: { x: 12, y: 6 }
  }).setDepth(depth + 2).setInteractive();
  const cancelBtn = scene.add.text(650, 500, "Annulla", {
    font: "18px Arial",
    fill: "#fff",
    backgroundColor: "#666",
    padding: { x: 12, y: 6 }
  }).setDepth(depth + 2).setInteractive();

  applyBtn.on("pointerdown", applyChanges);
  cancelBtn.on("pointerdown", cleanup);
  closeX.on("pointerdown", cleanup);
  overlay.on("pointerdown", cleanup);

  controls.push(
    overlay, panel, title, closeX,
    totalLabel, totalValue, minus, plus,
    humanLabel, humanToggle, randomLabel, randomToggle, sigilliTitle,
    applyBtn, cancelBtn
  );

  refreshSigilliEntries();
}

function closePlayerSettings(scene) {
  if (settingsControls) {
    settingsControls.forEach(c => { try { c.destroy(); } catch (_) {} });
    settingsControls = null;
  }
  modalOpen = false;
}

function resetBoardState(scene) {
  hand.forEach(s => { try { s.destroy(); } catch (_) {} });
  limboSprites.forEach(s => { try { s.destroy(); } catch (_) {} });
  cerchiaSprites.forEach(s => { try { s.destroy(); } catch (_) {} });
  hand = [];
  limboSprites = [];
  cerchiaSprites = [];
  activeBalloons.forEach(b => { try { b.destroy(); } catch (_) {} });
  activeBalloons.clear();
  if (ui.limboCount) ui.limboCount.setText("0");
  ui.bots.forEach(b => {
    b.sigillo?.setText("Sigillo: -");
    b.mano?.setText("Mano: -");
    b.stelle?.setText("Stelle: -");
    b.boss?.setText("Boss: -");
    b.manoCount?.setText("-");
  });
  if (ui.human.sigillo) ui.human.sigillo.setText("Sigillo: -");
  if (ui.human.boss) ui.human.boss.setText("Boss: -");
  if (ui.human.stelle) ui.human.stelle.setText("Stelle: -");
}

function applySigilliConfig(g) {
  if (!g) return;
  const pool = [...SIGILLI_POOL];
  if (playerConfig.sigilliRandom) {
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  const manual = playerConfig.sigilliRandom ? {} : { ...playerConfig.sigilliManual };
  g.giocatori.forEach(plr => {
    let chosen = null;
    const val = manual[plr.nome];
    if (val && pool.includes(val)) {
      chosen = val;
      pool.splice(pool.indexOf(val), 1);
    }
    if (!chosen && pool.length) {
      chosen = pool.shift();
    }
    plr.sigillo = chosen || null;
  });
}

async function startNewGame(scene) {
  closePlayerSettings(scene);
  if (settingsMenu) {
    try { settingsMenu.destroy(true); } catch (_) {}
    settingsMenu = null;
  }
  giocoPronto = false;
  modalOpen = false;
  resetBoardState(scene);

  const total = Math.max(2, Math.min(playerConfig.totalPlayers, SIGILLI_POOL.length));
  const botsNeeded = Math.max(0, total - 1);
  const botNames = BOT_NAMES.slice(0, botsNeeded);
  const activeBotSet = new Set(botNames);
  ui.bots.forEach(b => setBotVisibility(b.nome, activeBotSet.has(b.nome)));
  const azioneCb = (nomeBotOGiocatore, azione) => {
    const posizioni = {
      "Bot Beta": { x: 160, y: 80 },
      "Bot Gamma": { x: 160, y: 350 },
      "Bot Alpha": { x: 1025, y: 80 },
      "Bot Delta": { x: 1025, y: 350 },
      "Player": { x: 625, y: 600 }
    };
    const pos = posizioni[nomeBotOGiocatore] || { x: 625, y: 360 };
    showBotBalloon(scene, nomeBotOGiocatore, azione, pos.x, pos.y);
    pushLog(`${nomeBotOGiocatore}: ${azione}`);
  };

  try {
    const g = await creaPartita("Player", botNames, azioneCb);
    if (!playerConfig.humanEnabled) {
      const human = g.giocatori.find(p => p.nome === "Player");
      if (human) human.isBot = true;
    }
    applySigilliConfig(g);
    gioco = g;
    gioco.azioni_per_turno = 2;
    gioco.fase = "turno";
    // popola log iniziale
    actionLog = (gioco.log || []).map(formatLogEntry);
    refreshLogPanel();
    if (gioco.addListener) {
      gioco.addListener("log", (entry) => pushLog(entry));
    }
    giocoPronto = true;
    syncHumanHand(scene);
    refreshUI(scene);
  } catch (err) {
    console.error("Errore creazione partita", err);
  }
}

async function drawCard(scene, tipo) {
  if (!giocoPronto || !gioco) return;
  // Se per qualche motivo il flag rimane true, sbloccalo all'inizio del turno
  if (modalOpen) {
    console.warn("modalOpen ancora true, lo resetto");
    modalOpen = false;
  }
  const actionType = tipo === "rifornimento" ? "pesca_rifornimento" : "rivela_evocazione";
  if (gioco.requestAction) {
    const req = gioco.requestAction(actionType);
    if (!req.ok) {
      showBotBalloon(scene, "Sistema", "Niente azioni rimaste", 625, 80);
      return;
    }
  } else if (!gioco.puoAgire()) {
    showBotBalloon(scene, "Sistema", "Niente azioni rimaste", 625, 80);
    return;
  }

  const giocatore = gioco.giocatoreCorrente();
  let cartaModel = null;
  let actionUsed = false;

  try {
    if (tipo === "rifornimento") {
      cartaModel = gioco.pescaRifornimento(giocatore);

      if (!cartaModel) {
        console.warn("Nessuna carta rifornimento pescata.");
        modalOpen = false;
        return;
      }

      const texture = getTextureForCard(cartaModel, "rifornimento");
      if (!scene.textures.exists(texture)) {
        console.error("Texture non trovata per:", texture);
        modalOpen = false;
        return;
      }

      addCardToHand(scene, cartaModel);
      actionUsed = true;
      modalOpen = false; // sblocca sempre il flusso
    } else {
      // Evocazioni e imprevisti — codice originale
      cartaModel = gioco.pescaEvocazione(giocatore);
      if (cartaModel instanceof Demone) {
        pendingDemone = cartaModel;
        const costo = gioco.calcolaCostoEffettivo(giocatore, cartaModel);
        const scelta = await openPaymentDialog(scene, giocatore, cartaModel, costo);
        if (scelta && scelta.pagamentoValido && (costo === 0 || scelta.selezionate.length)) {
          // pagamento riuscito: demone va direttamente in cerchia
          scelta.selezionate.forEach(c => {
            const idx = giocatore.mano.indexOf(c);
            if (idx >= 0) giocatore.mano.splice(idx, 1);
          });
          gioco.scartaCarte(scelta.selezionate);
          removePaidFromHand(scene, scelta.selezionate);
          giocatore.cerchia.push(cartaModel);
          addCerchiaSprite(scene, cartaModel);
          actionUsed = true;
        } else {
          // pagamento fallito: manda nel Limbo ora
          gioco.mandaNelLimbo(cartaModel);
          placeInLimbo(scene, cartaModel);
          actionUsed = true;
        }
        pendingDemone = null;
      } else if (cartaModel instanceof Imprevisto) {
        const eff = gioco.processaImprevisto(cartaModel, giocatore);
        handleImprevisto(scene, eff);
        showBotBalloon(scene, giocatore.nome, `Imprevisto: ${cartaModel.nome}`, 625, 100);
        actionUsed = true;
      }
      modalOpen = false; // sblocca anche in caso di imprevisti
    }
  } catch (err) {
    console.error("Errore durante drawCard:", err);
    modalOpen = false; // fallback di sicurezza
  } finally {
    pendingDemone = null;
    if (modalOpen) {
      // assicurati che non rimanga true
      modalOpen = false;
    }
  }

  if (actionUsed) {
    if (gioco.completeAction) gioco.completeAction(true);
    else gioco.registraAzione();
  } else if (gioco.completeAction) {
    gioco.completeAction(false);
  }
  refreshUI(scene);
}

function getTextureForCard(cartaModel, tipo) {
  if (!cartaModel) {
    return tipo === "rifornimento" ? "dorso_rifornimenti" : "demon_fuoco";
  }
  // Rifornimenti (energia/magie)
  if (cartaModel instanceof CartaRifornimento) {
    if (cartaModel.categoria === "magia") {
      return resolveMagicTextureKey(cartaModel);
    }
    const key = resolveEnergyTextureKey(cartaModel);
    return key ? `energy_${key}` : "dorso_rifornimenti";
  }
  // Imprevisti
  if (cartaModel instanceof Imprevisto) {
    return "imprevisto";
  }
  // Demoni
  if (cartaModel instanceof Demone) {
    const elemento = cartaModel.elemento || null;
    if (elemento) {
      const symbol = ElementoSimbolo[elemento];
      if (symbol) return `demon_${symbol}`;
    }
    return "demon_fuoco";
  }
  return tipo === "rifornimento" ? "dorso_rifornimenti" : "demon_fuoco";
}

function resolveEnergyTextureKey(carta) {
  const mapSingle = {
    ENERGIA_ARIA: "a",
    ENERGIA_FUOCO: "f",
    ENERGIA_TERRA: "T",
    ENERGIA_ACQUA: "w",
    ENERGIA_ETERE: "e",
  };
  const combos = {
    "ENERGIA_ARIA+ENERGIA_FUOCO": "af",
    "ENERGIA_ARIA+ENERGIA_TERRA": "at",
    "ENERGIA_ARIA+ENERGIA_ACQUA": "aw",
    "ENERGIA_ACQUA+ENERGIA_ARIA": "aw",
    "ENERGIA_ACQUA+ENERGIA_FUOCO": "wf",
    "ENERGIA_ACQUA+ENERGIA_TERRA": "wt",
    "ENERGIA_FUOCO+ENERGIA_TERRA": "ft",
    "ENERGIA_ARIA+ENERGIA_ETERE": "a", // fallback: usa aria
    "ENERGIA_ACQUA+ENERGIA_ETERE": "w", // fallback: usa acqua
  };
  const tipi = Array.isArray(carta.tipi) ? [...new Set(carta.tipi)] : [];
  if (!tipi.length && carta.tipo) tipi.push(carta.tipo);
  if (!tipi.length) return null;
  if (tipi.length === 1) {
    return mapSingle[tipi[0]] || null;
  }
  const key = tipi.sort().join("+");
  const found = combos[key];
  if (!found) {
    // fallback per doppie non mappate: prendi il primo tipo noto
    const primary = tipi.find(t => mapSingle[t]);
    return mapSingle[primary] || null;
  }
  return found;
}

function resolveMagicTextureKey(carta) {
  const name = (carta?.nome || "").toLowerCase();
  if (name.includes("spostastelle") || name.includes("sposta stelle")) return "spostastelle";
  if (name.includes("stoppastella") || name.includes("stoppa stella")) return "stoppastella";
  return "magia";
}

async function openPaymentDialog(scene, giocatore, demone, costoEffettivo) {
  // Se il costo è 0, evocazione diretta
  if (costoEffettivo <= 0) {
    return { pagamentoValido: true, selezionate: [] };
  }

  return new Promise(resolve => {
    modalOpen = true;
    // assicurati che la mano UI sia allineata allo stato di gioco
    syncHumanHand(scene);

    const reqTipo = demone?.costo_tipo || null;
    const reqMin = demone?.costo_tipo_minimo || 0;
    const energie = (giocatore?.mano || []).filter(c => c?.categoria === "energia");
    const suggerite = giocatore.trovaPagamento(costoEffettivo, reqTipo, reqMin) || [];

    const depth = 100;
    const selected = new Set();

    // === OVERLAY & PANNELLO ===
    const overlay = scene.add.rectangle(625, 360, 1250, 720, 0x000000, 0.75)
      .setDepth(depth).setInteractive();
    const panel = scene.add.rectangle(625, 360, 950, 500, 0x202020, 0.95)
      .setDepth(depth + 1)
      .setStrokeStyle(3, 0x888888)
      .setOrigin(0.5);

    // === INFO DEMONE ===
    const demTex = getTextureForCard(demone, "demone");
    const demSprite = scene.add.image(285, 400, demTex).setScale(0.2).setDepth(depth + 2);
    const demoneName = truncateText(demone.nome, 14);
    const demonOverlay = scene.add.text(285, 320, demoneName, {
      font: "11px Arial",
      fill: "#000",
      backgroundColor: "transparent",
      padding: { x: 3, y: 2 },
      align: "center",
      stroke: "#fff",
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(depth + 3);
    const title = scene.add.text(180, 140, demone.nome, {
      font: "26px Arial", fill: "#fff"
    }).setDepth(depth + 2);
    const stelle = demone?.livello_stella ? `★ ${demone.livello_stella}` : "";
    const costLabel = `Costo: ${costoEffettivo}` + (reqTipo ? ` (min ${reqMin} ${reqTipo})` : "");
    const reqText = scene.add.text(180, 170, costLabel, { font: "16px Arial", fill: "#ffda77" }).setDepth(depth + 2);
    const effetto = demone?.effetto ? `Effetto: ${demone.effetto}` : "";
    const effettoText = scene.add.text(180, 200, effetto, {
      font: "14px Arial", fill: "#ccc", wordWrap: { width: 250 }
    }).setDepth(depth + 2);

    // === CARTE ENERGIA IN MANO ===
    const cardEntries = [];
    const startX = 520, startY = 240;
    const spacingX = 120, spacingY = 130;
    const perRow = 4;

    energie.forEach((model, idx) => {
      const col = idx % perRow;
      const row = Math.floor(idx / perRow);
      const cx = startX + col * spacingX;
      const cy = startY + row * spacingY;

      const bg = scene.add.rectangle(cx, cy, 95, 125, 0x333333, 0.9)
        .setStrokeStyle(2, 0x555555)
        .setDepth(depth + 1);

      const tex = getTextureForCard(model, "rifornimento");
      const img = scene.add.image(cx, cy - 6, tex)
        .setScale(0.075)
        .setDepth(depth + 2);

      const nomeText = truncateText(model.nome, 12);
      const overlay = scene.add.text(cx, cy - 58, nomeText, {
        font: "10px Arial",
        fill: "#000",
        backgroundColor: "transparent",
        padding: { x: 2, y: 1 },
        align: "center",
        stroke: "#fff",
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(depth + 3);

      const valText = scene.add.text(cx, cy + 53, `${model.valore}`, {
        font: "16px Arial", fill: "#fff"
      }).setOrigin(0.5).setDepth(depth + 3);

      const select = () => {
        if (selected.has(model)) {
          selected.delete(model);
          bg.setStrokeStyle(2, 0x555555);
          bg.setAlpha(0.9);
        } else {
          selected.add(model);
          bg.setStrokeStyle(4, 0x00ff77);
          bg.setAlpha(1);
          // piccolo effetto "salto"
          scene.tweens.add({ targets: img, y: cy - 15, duration: 100, yoyo: true });
        }
        updateTotals();
      };

      bg.setInteractive();
      img.setInteractive();
      bg.on("pointerdown", select);
      img.on("pointerdown", select);

      cardEntries.push({ bg, img, valText, model, overlay });
    });

    // === TESTO TOTALE & STATO ===
    const totalText = scene.add.text(625, 470, "Totale: 0", {
      font: "18px Arial",
      fill: "#ff5555"
    }).setOrigin(0.5).setDepth(depth + 2);

    const statusText = scene.add.text(625, 495, "Seleziona energia sufficiente", {
      font: "14px Arial",
      fill: "#aaa"
    }).setOrigin(0.5).setDepth(depth + 2);

    // === BOTTONI ===
    const evocaBtn = scene.add.text(500, 540, "Evoca", {
      font: "18px Arial",
      fill: "#fff",
      backgroundColor: "#3a9c4f",
      padding: { x: 12, y: 6 }
    }).setDepth(depth + 2).setInteractive();

    const limboBtn = scene.add.text(670, 540, "Manda nel Limbo", {
      font: "18px Arial",
      fill: "#fff",
      backgroundColor: "#666",
      padding: { x: 12, y: 6 }
    }).setDepth(depth + 2).setInteractive();

    const closeX = scene.add.text(920, 130, "✖", {
      font: "20px Arial",
      fill: "#ffaaaa",
      backgroundColor: "#800",
      padding: { x: 6, y: 2 }
    }).setDepth(depth + 2).setInteractive();

    const controls = [
      overlay, panel, title, reqText, effettoText,
      demSprite, demonOverlay, totalText, statusText,
      evocaBtn, limboBtn, closeX, ...cardEntries.flatMap(c => [c.bg, c.img, c.valText, c.overlay])
    ];

    // === FUNZIONI INTERNE ===
    const computeStatus = () => {
      const total = Array.from(selected).reduce((sum, m) => sum + (m?.valore || 0), 0);
      const tipoVal = reqTipo
        ? Array.from(selected).filter(m => (m?.tipi || []).includes(reqTipo) || m?.tipo === reqTipo)
            .reduce((sum, m) => sum + (m?.valore || 0), 0)
        : 0;
      const enoughTipo = !reqTipo || tipoVal >= reqMin;
      const enoughVal = total >= costoEffettivo;
      return { total, enoughTipo, enoughVal, tipoVal };
    };

    const updateTotals = () => {
      const { total, enoughTipo, enoughVal, tipoVal } = computeStatus();
      totalText.setText(`Totale: ${total}`);
      totalText.setFill(enoughVal ? "#a8ff7a" : "#ff5555");
      if (enoughVal && enoughTipo) {
        statusText.setText("Pronto a evocare");
        evocaBtn.setBackgroundColor("#3a9c4f");
      } else if (!enoughVal) {
        statusText.setText(`Manca ${(costoEffettivo - total)} energia`);
        evocaBtn.setBackgroundColor("#444");
      } else {
        statusText.setText(`Serve ${reqMin} ${reqTipo} (ora ${tipoVal})`);
        evocaBtn.setBackgroundColor("#444");
      }
    };

    const cleanup = (result) => {
      controls.forEach(o => { try { o.destroy(); } catch (_) {} });
      modalOpen = false;
      resolve(result);
    };

    // === EVENTI ===
    evocaBtn.on("pointerdown", () => {
      const { enoughTipo, enoughVal } = computeStatus();
      if (enoughTipo && enoughVal) {
        cleanup({ pagamentoValido: true, selezionate: Array.from(selected) });
      } else {
        scene.tweens.add({ targets: statusText, alpha: 0.3, yoyo: true, duration: 100 });
      }
    });
    limboBtn.on("pointerdown", () => cleanup({ pagamentoValido: false, selezionate: [] }));
    closeX.on("pointerdown", () => cleanup({ pagamentoValido: false, selezionate: [] }));
    overlay.on("pointerdown", () => cleanup({ pagamentoValido: false, selezionate: [] }));

    // === SELEZIONA CARTE CONSIGLIATE ===
    suggerite.forEach(m => {
      const entry = cardEntries.find(c => c.model === m);
      if (entry) {
        selected.add(entry.model);
        entry.bg.setStrokeStyle(4, 0x00ff77);
      }
    });

    updateTotals();
  });
}

function handleImprevisto(scene, eff) {
  if (!eff || !eff.effetto) return;
  switch (eff.effetto) {
    case "fine_turno":
      nextTurn(scene);
      break;
    case "conquista_immediata":
      tentaConquista(scene, true);
      break;
    default:
      refreshUI(scene);
  }
}

function truncateText(text, maxLen = 12) {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + "…";
}

function addCardOverlay(scene, card, cartaModel, offset = 45) {
  if (!cartaModel || !cartaModel.nome) return;
  const nomeText = truncateText(cartaModel.nome, 12);
  const overlay = scene.add.text(card.x, card.y - offset, nomeText, {
    font: "11px Arial",
    fill: "#000",
    backgroundColor: "transparent",
    padding: { x: 3, y: 2 },
    align: "center",
    stroke: "#fff",
    strokeThickness: 3,
  }).setOrigin(0.5);
  overlay.setDepth(card.depth + 1);

  // Lega l'overlay al movimento della carta
  card._overlay = overlay;
  card._overlayOffset = offset;
  return overlay;
}

function syncOverlayPosition(sprite) {
  if (!sprite || !sprite._overlay || !sprite._overlay.active) return;
  const off = sprite._overlayOffset || 45;
  sprite._overlay.setPosition(sprite.x, sprite.y - off);
}

function attachTooltip(sprite, getText, opts = {}) {
  if (!sprite || !getText) return;
  const growDown = !!opts.growDown;
  sprite.setInteractive({ useHandCursor: true });
  const style = {
    font: "12px Arial",
    fill: "#fff",
    backgroundColor: "rgba(0,0,0,0.85)",
    padding: { x: 8, y: 6 },
    stroke: "#000",
    strokeThickness: 3,
    wordWrap: { width: 240 },
  };
  const destroyTip = () => {
    if (sprite._tooltip && sprite._tooltip.active) {
      sprite._tooltip.destroy();
    }
    sprite._tooltip = null;
  };
  const setPos = (pointer) => {
    if (!sprite._tooltip || !sprite._tooltip.active) return;
    const offsetY = growDown ? 12 : -12;
    sprite._tooltip.setPosition(pointer.worldX + 12, pointer.worldY + offsetY);
  };
  sprite.on("pointerover", (pointer) => {
    const txt = getText();
    if (!txt) return;
    destroyTip();
    const offsetY = growDown ? 12 : -12;
    const originY = growDown ? 0 : 1;
    sprite._tooltip = sprite.scene.add.text(pointer.worldX + 12, pointer.worldY + offsetY, txt, style)
      .setOrigin(0, originY)
      .setDepth(5000);
  });
  sprite.on("pointermove", setPos);
  sprite.on("pointerout", destroyTip);
  sprite.on("destroy", destroyTip);
}

function demoneTooltipText(d) {
  if (!d) return "";
  const tipo = d.elemento || (Array.isArray(d.tipi) ? d.tipi.join(", ") : "-");
  const livello = d.livello_stella != null ? d.livello_stella : "-";
  const costo = d.costo != null ? d.costo : "-";
  const reqTipo = d.costo_tipo ? ` (${d.costo_tipo}${d.costo_tipo_minimo ? " min " + d.costo_tipo_minimo : ""})` : "";
  const effetto = d.effetto || "-";
  return `${d.nome || "Demone"}\nTipo: ${tipo}\nLivello: ${livello}\nCosto: ${costo}${reqTipo}\nEffetto: ${effetto}`;
}

function magiaTooltipText(c) {
  if (!c) return "";
  const tipo = Array.isArray(c.tipi) ? c.tipi.join(", ") : (c.tipo || "-");
  const valore = c.valore != null ? c.valore : "-";
  const effetto = c.effetto || "-";
  return `${c.nome || "Magia"}\nTipo: ${tipo}\nValore: ${valore}\nEffetto: ${effetto}`;
}

function addCardToHand(scene, cartaModel, options = {}) {
  const { silent = false } = options;
  const xStart = 450;
  const yStart = 350;
  const texture = getTextureForCard(cartaModel, "rifornimento");
  const card = scene.add.image(xStart, yStart, texture).setScale(0.08);
  card._model = cartaModel;
  addCardOverlay(scene, card, cartaModel, 45);
  if (cartaModel?.categoria === "magia") {
    attachTooltip(card, () => magiaTooltipText(cartaModel));
  }
  const slotIndex = hand.length;
  hand.push(card); // registra subito così gli slot non si sovrappongono
  const targetX = 50 + slotIndex * 90;
  const targetY = 650;

  scene.tweens.add({
    targets: card,
    x: targetX,
    y: targetY,
    duration: 700,
    ease: "Cubic.easeOut",
    onComplete: () => {
      if (!silent) modalOpen = false;
    },
  });

  if (card._overlay) {
    scene.tweens.add({
      targets: card._overlay,
      x: targetX,
      y: targetY - (card._overlayOffset || 45),
      duration: 700,
      ease: "Cubic.easeOut",
    });
  }
}

function layoutHand(scene) {
  hand = hand.filter(h => h?.active);
  hand.forEach((sprite, idx) => {
    const targetX = 50 + idx * 90;
    const targetY = 650;
    scene.tweens.add({
      targets: sprite,
      x: targetX,
      y: targetY,
      duration: 450,
      ease: "Cubic.easeOut",
    });
  });
}

function syncHumanHand(scene) {
  if (!gioco) return;
  const player = gioco.giocatori.find(p => p.nome === "Player");
  if (!player) return;
  
  // Rimuovi carte che non sono più nella mano del giocatore
  hand = hand.filter(sprite => {
    if (!player.mano.includes(sprite._model)) {
      if (sprite._overlay) sprite._overlay.destroy();
      sprite.destroy();
      return false;
    }
    return true;
  });
  
  // Aggiungi carte che mancano nell'UI
  const existing = new Set(hand.map(s => s._model));
  player.mano.forEach(carta => {
    if (!existing.has(carta)) {
      addCardToHand(scene, carta, { silent: true });
      existing.add(carta);
    }
  });
  
  layoutHand(scene);
}

function syncLimboSprites(scene) {
  if (!gioco) return;
  const desired = gioco.limbo || [];
  const pool = limboSprites.filter(s => s?.active);
  const newSprites = [];

  desired.forEach((model) => {
    const idx = pool.findIndex(s => s._model === model);
    if (idx >= 0) {
      const sprite = pool.splice(idx, 1)[0];
      newSprites.push(sprite);
    } else {
      const texture = getTextureForCard(model, "demone");
      const card = scene.add.image(410, 60, texture).setScale(0.08);
      card._model = model;
      addCardOverlay(scene, card, model);
      attachTooltip(card, () => demoneTooltipText(card._model), { growDown: true });
      card._tooltipAttached = true;
      newSprites.push(card);
    }
  });

  // distruggi sprite non più necessari
  pool.forEach(sprite => {
    try { sprite._overlay?.destroy(); } catch (_) {}
    try { sprite.destroy(); } catch (_) {}
  });

  limboSprites = newSprites;
  layoutLimboSprites(scene);
}

function syncBotCerchiaSprites(scene) {
  if (!gioco) return;
  gioco.giocatori.filter(g => g.isBot).forEach(bot => {
    const arr = botCerchiaSprites[bot.nome] || (botCerchiaSprites[bot.nome] = []);
    // Rimuovi sprite non più presenti
    const filtered = [];
    arr.forEach(sprite => {
      if (bot.cerchia.includes(sprite._model)) {
        filtered.push(sprite);
      } else {
        if (sprite._overlay) sprite._overlay.destroy();
        sprite.destroy();
      }
    });
    botCerchiaSprites[bot.nome] = filtered;

    // Aggiungi mancanti
    const pos = botPositions[bot.nome];
    const spacing = 75; // leggermente più distanza tra carte
    bot.cerchia.forEach((d, idx) => {
      if (!filtered.find(s => s._model === d)) {
        const texture = getTextureForCard(d, "demone");
        const card = scene.add.image(pos.cerchia.x, pos.cerchia.y, texture).setScale(0.08);
        card._model = d;
        addCardOverlay(scene, card, d);
        filtered.push(card);
      }
    });

    // Riallinea posizioni
    filtered.forEach((sprite, idx) => {
      const offsetX = idx * spacing;
      const finalX = pos.cerchia.x - 105 + offsetX;
      const finalY = pos.cerchia.y;
      scene.tweens.add({
        targets: sprite,
        x: finalX,
        y: finalY,
        duration: 300,
        ease: "Cubic.easeOut",
        onComplete: () => {
          if (sprite._overlay) sprite._overlay.setPosition(sprite.x, sprite.y - 35);
        },
      });
    });
  });
}

function placeInLimbo(scene, cartaModel) {
  // evita duplicati visivi
  if (limboSprites.find(s => s._model === cartaModel)) {
    layoutLimboSprites(scene);
    return;
  }
  const texture = getTextureForCard(cartaModel, "demone");
  const card = scene.add.image(830, 350, texture).setScale(0.08);
  card._model = cartaModel;
  addCardOverlay(scene, card, cartaModel);
  attachTooltip(card, () => demoneTooltipText(cartaModel), { growDown: true });
  card._tooltipAttached = true;
  const idx = gioco?.limbo?.indexOf?.(cartaModel) ?? limboSprites.length;
  const slot = (scene.limboSlots && scene.limboSlots[idx]) || { x: 300 + idx * 70, y: 65 };
  scene.tweens.add({
    targets: card,
    x: slot.x,
    y: slot.y,
    duration: 700,
    ease: "Cubic.easeOut",
    onComplete: () => {
      limboSprites.splice(idx, 0, card);
      layoutLimboSprites(scene);
    },
  });

  if (card._overlay) {
    scene.tweens.add({
      targets: card._overlay,
      x: slot.x,
      y: slot.y - (card._overlayOffset || 45),
      duration: 700,
      ease: "Cubic.easeOut",
    });
  }
}

function layoutLimboSprites(scene) {
  limboSprites = limboSprites.filter(s => s?.active);
  const slots = scene.limboSlots || [];
  limboSprites.forEach((sprite, idx) => {
    const slot = slots[idx] || slots[slots.length - 1] || { x: 300 + idx * 70, y: 65 };
    if (sprite._model instanceof Demone && !sprite._tooltipAttached) {
      attachTooltip(sprite, () => demoneTooltipText(sprite._model), { growDown: true });
      sprite._tooltipAttached = true;
    }
    scene.tweens.add({
      targets: sprite,
      x: slot.x,
      y: slot.y,
      duration: 350,
      ease: "Cubic.easeOut",
      onUpdate: () => {
        syncOverlayPosition(sprite);
      },
    });
  });
  if (ui.limboCount) ui.limboCount.setText(String(gioco?.limbo?.length || 0));
}

function evocaDalLimbo(scene) {
  if (!giocoPronto || !gioco) return;
  if (gioco.requestAction) {
    const req = gioco.requestAction("evoca_limbo");
    if (!req.ok) {
      showBotBalloon(scene, "Sistema", "Niente azioni rimaste", 625, 360);
      return;
    }
  } else if (!gioco.puoAgire()) {
    showBotBalloon(scene, "Sistema", "Niente azioni rimaste", 625, 360);
    return;
  }
  if (!gioco.limbo.length) {
    showBotBalloon(scene, "Player", "Nessun demone nel Limbo", 625, 360);
    return;
  }
  const giocatore = gioco.giocatoreCorrente();
  const demone = gioco.limbo[0];
  if (!demone) {
    showBotBalloon(scene, "Player", "Nessun demone disponibile", 625, 360);
    return;
  }
  const costo = gioco.calcolaCostoEffettivo(giocatore, demone);
  openPaymentDialog(scene, giocatore, demone, costo).then(scelta => {
    if (scelta && scelta.pagamentoValido && (costo === 0 || scelta.selezionate.length)) {
      const idxLimbo = gioco.limbo.indexOf(demone);
      if (idxLimbo >= 0) gioco.limbo.splice(idxLimbo, 1);
      removeFromLimboSprites(scene, demone);
      scelta.selezionate.forEach(c => {
        const idx = giocatore.mano.indexOf(c);
        if (idx >= 0) giocatore.mano.splice(idx, 1);
      });
      gioco.scartaCarte(scelta.selezionate);
      removePaidFromHand(scene, scelta.selezionate);
      giocatore.cerchia.push(demone);
      addCerchiaSprite(scene, demone);
      if (gioco.completeAction) gioco.completeAction(true);
      else gioco.registraAzione();
      showBotBalloon(scene, "Player", `Evocato ${demone.nome} dal Limbo`, 625, 360);
    } else {
      showBotBalloon(scene, "Player", "Pagamento fallito", 625, 360);
      if (gioco.completeAction) gioco.completeAction(false);
    }
    refreshUI(scene);
  }).catch(err => {
    console.error("Errore evocaDalLimbo:", err);
    modalOpen = false;
    if (gioco.completeAction) gioco.completeAction(false);
  });
}

function removeFromLimboSprites(scene, demone) {
  const idx = limboSprites.findIndex(s => s._model === demone);
  if (idx >= 0) {
    const [sprite] = limboSprites.splice(idx, 1);
    if (sprite._overlay) sprite._overlay.destroy();
    sprite.destroy();
  }
  layoutLimboSprites(scene);
}

function removePaidFromHand(scene, cartePagate) {
  if (!Array.isArray(cartePagate)) return;
  cartePagate.forEach(model => {
    const idx = hand.findIndex(s => s._model === model);
    if (idx >= 0) {
      const [sprite] = hand.splice(idx, 1);
      if (sprite._overlay) sprite._overlay.destroy();
      sprite.destroy();
    }
  });
  layoutHand(scene);
}

function removeDemoneFromLimbo(scene, demone) {
  const idx = gioco?.limbo?.indexOf?.(demone);
  if (idx != null && idx >= 0) {
    gioco.limbo.splice(idx, 1);
  }
  // Rimuovi eventuale sprite in limbo già presente
  const sIdx = limboSprites.findIndex(s => s._model === demone);
  if (sIdx >= 0) {
    const [sprite] = limboSprites.splice(sIdx, 1);
    if (sprite._overlay) sprite._overlay.destroy();
    sprite.destroy();
    layoutLimboSprites(scene);
  }
}

function addCerchiaSprite(scene, demone) {
  const idx = cerchiaSprites.length;
  const startX = 820;
  const spacing = 120;
  const y = 650;
  const texture = getTextureForCard(demone, "demone");
  const card = scene.add.image(1020, 350, texture).setScale(0.12);
  card._model = demone;
  addCardOverlay(scene, card, demone, 45);
  attachTooltip(card, () => demoneTooltipText(demone));
  scene.tweens.add({
    targets: card,
    x: startX + idx * spacing,
    y: y,
    duration: 700,
    ease: "Cubic.easeOut",
    onComplete: () => {
      cerchiaSprites.push(card);
    },
  });

  if (card._overlay) {
    scene.tweens.add({
      targets: card._overlay,
      x: startX + idx * spacing,
      y: y - (card._overlayOffset || 45),
      duration: 700,
      ease: "Cubic.easeOut",
    });
  }
}

function nextTurn(scene) {
  if (!giocoPronto || !gioco) return;
  modalOpen = false; // reset di sicurezza
  advanceTurn(scene);
}

function tentaConquista(scene, forzato = false) {
  if (!giocoPronto || !gioco) return;
  if (!forzato && !gioco.puoAgire()) {
    showBotBalloon(scene, "Sistema", "Niente azioni rimaste", 650, 120);
    return;
  }
  revealBossCard(scene);
  const doConquista = () => {
    const boss = gioco.prossimoBoss();
    if (!boss) {
      showBotBalloon(scene, "Sistema", "Nessun boss rimanente", 650, 120);
      if (!forzato && gioco.completeAction) gioco.completeAction(false);
      return;
    }
    const ok = gioco.conquistaBoss(boss);
    showBotBalloon(scene, "Player", ok ? `Conquistato ${boss.nome}!` : `Fallita conquista di ${boss.nome}`, 650, 120);
    if (!forzato) {
      if (gioco.completeAction) gioco.completeAction(true);
      else gioco.registraAzione();
    }
    refreshUI(scene);
  };
  playBossFrameEffect(scene, doConquista);
}

function updateBossUI(scene) {
  if (!ui.bossName) return;
  const boss = gioco?.prossimoBoss?.() || null;
  if (!boss || !bossCard?.flipped) {
    ui.bossName.setText("Boss: ???");
    ui.bossReq.setText("");
    return;
  }
  ui.bossName.setText(`Boss: ${boss.nome}`);
  const vals = boss.valori || {};
  const reqText = `E${vals.E || 0} W${vals.W || 0} F${vals.F || 0} T${vals.T || 0} A${vals.A || 0}`;
  ui.bossReq.setText(reqText);
}

function revealBossCard(scene) {
  if (!bossCard) return;
  bossCard.setTexture("boss_card");
  bossCard.flipped = true;
  updateBossUI(scene);
}

function playBossFrameEffect(scene, onComplete) {
  if (!bossFrame) {
    if (onComplete) onComplete();
    return;
  }
  bossCard?.setAlpha(0);
  bossFrame.setAlpha(1); // ingresso netto frame 1
  if (bossFrame2) bossFrame2.setAlpha(0);
  scene.time.delayedCall(180, () => {
    bossFrame.setAlpha(0); // uscita frame 1
    bossCard?.setAlpha(1); // faccia del boss torna visibile
    if (bossFrame2) {
      bossFrame2.setAlpha(1); // ingresso netto frame 2
      scene.time.delayedCall(180, () => {
        bossFrame2.setAlpha(0); // uscita frame 2
        if (onComplete) onComplete();
      });
    } else {
      if (onComplete) onComplete();
    }
  });
}

function refreshUI(scene) {
  if (!giocoPronto || !gioco) return;
  gioco.giocatori.forEach(p => {
    if (p.nome === "Player") {
      ui.human.sigillo?.setText(`Sigillo: ${p.sigillo || "-"}`);
      ui.human.boss?.setText(`Boss: ${p.boss_conquistati.length}`);
      ui.human.stelle?.setText(`Stelle: ${p.totale_stelle}`);
    } else {
      const target = ui.bots.find(b => b.nome === p.nome);
      if (target) {
        target.sigillo?.setText(`Sigillo: ${p.sigillo || "-"}`);
        target.mano?.setText(`Mano: ${p.mano.length}`);
        target.stelle?.setText(`Stelle: ${p.totale_stelle}`);
        target.boss?.setText(`Boss: ${p.boss_conquistati.length}`);
        target.manoCount?.setText(`${p.mano.length}`);
      }
    }
  });
  if (ui.limboCount) {
    ui.limboCount.setText(String(gioco.limbo.length));
  }
  if (ui.mazzi.rif) ui.mazzi.rif.setText(`Mazzo: ${gioco.mazzo_rifornimenti.size}`);
  if (ui.mazzi.evo) ui.mazzi.evo.setText(`Mazzo: ${gioco.mazzo_evocazioni.size}`);
  if (ui.azioni) ui.azioni.setText(`Azioni: ${gioco.azione_corrente}/${gioco.azioni_per_turno}`);
  updateBossUI(scene);
  syncLimboSprites(scene);
  syncBotCerchiaSprites(scene);
  updateNextButtonState(scene);
  updateDecksInteractivity(scene);
  refreshSpionePanel();
}

function update() {
  hand.forEach(syncOverlayPosition);
  limboSprites.forEach(syncOverlayPosition);
  cerchiaSprites.forEach(syncOverlayPosition);
  Object.values(botCerchiaSprites || {}).forEach(arr => {
    (arr || []).forEach(syncOverlayPosition);
  });
}

function updateNextButtonState(scene) {
  try {
    const current = gioco?.giocatoreCorrente ? gioco.giocatoreCorrente() : null;
    const isBotTurn = !!(current && current.isBot);
    if (ui.nextBtn) {
      if (isBotTurn) {
        ui.nextBtn.disableInteractive();
        ui.nextBtn.setAlpha(0.5);
      } else {
        ui.nextBtn.setInteractive();
        ui.nextBtn.setAlpha(1);
      }
    }
  } catch (_) {}
}

function updateDecksInteractivity(scene) {
  try {
    const current = gioco?.giocatoreCorrente ? gioco.giocatoreCorrente() : null;
    const isBotTurn = !!(current && current.isBot);
    if (resourceDeck) {
      if (isBotTurn) {
        resourceDeck.disableInteractive();
        resourceDeck.setAlpha(0.8);
      } else {
        resourceDeck.setInteractive();
        resourceDeck.setAlpha(1);
      }
    }
    if (demonDeck) {
      if (isBotTurn) {
        demonDeck.disableInteractive();
        demonDeck.setAlpha(0.8);
      } else {
        demonDeck.setInteractive();
        demonDeck.setAlpha(1);
      }
    }
  } catch (_) {}
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function advanceTurn(scene) {
  if (!giocoPronto || !gioco) return;
  gioco.prossimoTurno();
  modalOpen = false;
  refreshUI(scene);
  let current = gioco.giocatoreCorrente();
  showBotBalloon(scene, current.nome, "Nuovo turno", 625, 80);
  while (current?.isBot) {
    await runBotTurn(scene, current);
    gioco.prossimoTurno();
    refreshUI(scene);
    current = gioco.giocatoreCorrente();
    showBotBalloon(scene, current.nome, "Nuovo turno", 625, 80);
    if (!current?.isBot) break;
  }
}

async function runBotTurn(scene, bot) {
  if (!bot) return;
  for (let i = 0; i < (gioco?.azioni_per_turno || 2); i += 1) {
    if (gioco.requestAction) {
      const req = gioco.requestAction("bot_action");
      if (!req.ok) break;
    } else if (!gioco.puoAgire()) break;
    const azione = decideBotAction(bot);
    await performBotAction(scene, bot, azione);
    refreshUI(scene);
    await sleep(BOT_ACTION_DELAY);
  }
}

function decideBotAction(bot) {
  const actionNum = gioco.azione_corrente + 1;
  const boss = gioco.prossimoBoss();
  const reqBoss = bossRequirement(bot, boss);
  if (reqBoss !== null && bot.totale_stelle >= reqBoss) {
    return { tipo: "conquista_boss" };
  }

  // Se nel Limbo c'è un demone pagabile che aumenta le stelle, prova a evocarlo
  const payLimbo = findAffordableLimbo(bot);
  if (payLimbo && actionNum <= 2) {
    return { tipo: "paga_limbo", carta: payLimbo };
  }

  // Altrimenti: prima azione pesca rifornimento, seconda rivela evocazione
  if (actionNum === 1) return { tipo: "pesca_rifornimento" };
  return { tipo: "rivela_evocazione" };
}

async function performBotAction(scene, bot, azione) {
  if (!azione || !azione.tipo) return;
  switch (azione.tipo) {
    case "pesca_rifornimento": {
      const carta = gioco.pescaRifornimento(bot);
      if (carta && gioco.onAzione) gioco.onAzione(bot.nome, "Pesca rifornimento");
      await animateBotDrawRifornimento(scene, bot);
      if (gioco.completeAction) gioco.completeAction(true);
      else gioco.registraAzione();
      break;
    }
    case "paga_limbo": {
      const idx = gioco.limbo.indexOf(azione.carta);
      if (idx >= 0) {
        const res = gioco.evocaDaLimbo(idx, bot);
        if (res.ok) {
          if (gioco.onAzione) gioco.onAzione(bot.nome, `Evoca ${azione.carta.nome} dal Limbo`);
          await animateBotEvocaDemone(scene, bot, azione.carta);
        }
      }
      if (gioco.completeAction) gioco.completeAction(true);
      else gioco.registraAzione();
      break;
    }
    case "rivela_evocazione": {
      const carta = gioco.pescaEvocazione(bot);
      if (carta instanceof Demone) {
        const costo = gioco.calcolaCostoEffettivo(bot, carta);
        const pagate = bot.pagaEvocazione(carta, costo);
        if (pagate) {
          bot.cerchia.push(carta);
          gioco.scartaCarte(pagate);
          if (gioco.onAzione) gioco.onAzione(bot.nome, `Evoca ${carta.nome}`);
          await animateBotEvocaDemone(scene, bot, carta);
        } else {
          gioco.mandaNelLimbo(carta);
          if (gioco.onAzione) gioco.onAzione(bot.nome, `Mette ${carta.nome} nel Limbo`);
          await animateBotDemoneToLimbo(scene, carta);
        }
      } else if (carta instanceof Imprevisto) {
        gioco.processaImprevisto(carta, bot);
        if (gioco.onAzione) gioco.onAzione(bot.nome, `Imprevisto: ${carta.nome}`);
      }
      if (gioco.completeAction) gioco.completeAction(true);
      else gioco.registraAzione();
      break;
    }
    case "conquista_boss": {
      const boss = gioco.prossimoBoss();
      revealBossCard(scene);
      gioco.conquistaBoss(boss);
      if (gioco.onAzione && boss) gioco.onAzione(bot.nome, `Tenta ${boss.nome}`);
      if (gioco.completeAction) gioco.completeAction(true);
      else gioco.registraAzione();
      break;
    }
    default:
      if (gioco.completeAction) gioco.completeAction(false);
      break;
  }
}

function animateBotDrawRifornimento(scene, bot) {
  return new Promise(resolve => {
    const pos = botPositions[bot.nome];
    if (!pos) {
      resolve();
      return;
    }
    const startX = 450;
    const startY = 350;
    const card = scene.add.image(startX, startY, "dorso_rifornimenti").setScale(0.06);
    scene.tweens.add({
      targets: card,
      x: pos.mano.x,
      y: pos.mano.y,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => {
        card.destroy();
        resolve();
      },
    });
  });
}

function animateBotEvocaDemone(scene, bot, demone) {
  return new Promise(resolve => {
    const pos = botPositions[bot.nome];
    if (!pos) {
      resolve();
      return;
    }
    const texture = getTextureForCard(demone, "demone");
    const startX = 830;
    const startY = 350;
    const card = scene.add.image(startX, startY, texture).setScale(0.08);
    card._model = demone;
    addCardOverlay(scene, card, demone, 45);
    attachTooltip(card, () => demoneTooltipText(demone));
    attachTooltip(card, () => demoneTooltipText(demone));
    
    // Calcola posizione slot ordinata
    const cerchiaArray = botCerchiaSprites[bot.nome];
    const slotIndex = cerchiaArray.length;
    const offsetX = slotIndex * 70;
    const finalX = pos.cerchia.x - 105 + offsetX; // Centra gli slot
    const finalY = pos.cerchia.y;
    
    scene.tweens.add({
      targets: card,
      x: finalX,
      y: finalY,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => {
        cerchiaArray.push(card);
        resolve();
      },
    });

    if (card._overlay) {
      scene.tweens.add({
        targets: card._overlay,
        x: finalX,
        y: finalY - (card._overlayOffset || 45),
        duration: 600,
        ease: "Cubic.easeOut",
      });
    }
  });
}

function animateBotDemoneToLimbo(scene, demone) {
  return new Promise(resolve => {
    const texture = getTextureForCard(demone, "demone");
    const startX = 830;
    const startY = 350;
    const card = scene.add.image(startX, startY, texture).setScale(0.08);
    card._model = demone;
    addCardOverlay(scene, card, demone, 45);
    
    // Posiziona nei slot LIMBO
    const idx = limboSprites.length;
    const targetX = 410 + idx * 70;
    const targetY = 60;
    
    scene.tweens.add({
      targets: card,
      x: targetX,
      y: targetY,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => {
        limboSprites.push(card);
        resolve();
      },
    });

    if (card._overlay) {
      scene.tweens.add({
        targets: card._overlay,
        x: targetX,
        y: targetY - (card._overlayOffset || 45),
        duration: 600,
        ease: "Cubic.easeOut",
      });
    }
  });
}

function bossRequirement(bot, boss) {
  if (!boss || !boss.valori) return null;
  // I sigilli nel prototipo sono A/B/C/D/E, mappali a requisiti minimi
  const vals = boss.valori;
  const numbers = Object.values(vals).map(v => Number(v) || 0);
  if (!numbers.length) return null;
  // Heuristica: usa il valore minimo come requisito per il bot
  return Math.min(...numbers);
}

function findAffordableLimbo(bot) {
  if (!gioco?.limbo?.length) return null;
  let best = null;
  let bestStars = 0;
  gioco.limbo.forEach(d => {
    if (!(d instanceof Demone)) return;
    const costo = gioco.calcolaCostoEffettivo(bot, d);
    const pagate = bot.trovaPagamento(costo, d.costo_tipo, d.costo_tipo_minimo);
    if (pagate && pagate.length) {
      const stars = bot.livelloEffettivo ? bot.livelloEffettivo(d) : (d.livello_stella || 0);
      if (stars > bestStars) {
        bestStars = stars;
        best = d;
      }
    }
  });
  return best;
}

function showBotBalloon(scene, botName, message, x, y) {
  // rimuovi eventuali balloon attivi prima di mostrarne uno nuovo
  activeBalloons.forEach(b => {
    try { b.destroy(); } catch (_) { /* ignore */ }
  });
  activeBalloons.clear();

  const padding = { x: 12, y: 8 };
  const text = scene.add.text(0, 0, `${botName}: ${message}`, {
    font: "16px Arial",
    fill: "#fff",
  });
  const w = text.width + padding.x * 2;
  const h = text.height + padding.y * 2;
  const bg = scene.add.graphics();
  bg.fillStyle(0x000000, 0.8);
  bg.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
  bg.lineStyle(2, 0xffffff, 0.9);
  bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
  const container = scene.add.container(x, y, [bg, text]);
  text.setOrigin(0.5);
  container.setDepth(5000);
  activeBalloons.add(container);

  // Piccola fluttuazione in entrata
  scene.tweens.add({
    targets: container,
    y: y - 8,
    duration: 250,
    yoyo: true,
    repeat: 0,
    ease: "Sine.easeInOut",
  });

  // Dissolvenza in uscita
  scene.tweens.add({
    targets: container,
    alpha: 0,
    duration: 1500,
    delay: 2000,
    onComplete: () => {
      activeBalloons.delete(container);
      container.destroy();
    },
  });
}
