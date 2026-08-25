// Datengetriebene Definition der Karriere: Fahrzeugklassen, Fahrzeuge, Upgrades,
// Events, Meisterschaften, KI-Fahrer, Levelkurve und Punktesystem.
//
// Hier steht NUR Beschreibung, keine Logik. Neue Events, Fahrzeuge oder
// Meisterschaften lassen sich durch Ergänzen dieser Tabellen hinzufügen, ohne
// career.js anzufassen.
//
// Fahrzeuge: das Spiel liefert zwei 3D-Modelle mit (BMW M4 GT3, Toyota TS030).
// Karriere-Fahrzeuge bestehen deshalb aus einem BASISMODELL plus Tuning-Faktoren
// auf dessen Kennwerte – so entstehen unterschiedlich starke Autos aus den
// vorhandenen Modellen. `basis` verweist auf CARS[i].id in main.js.

export const KLASSEN = [
  { id: 'D', name: 'Einsteiger', rang: 0 },
  { id: 'C', name: 'Sport', rang: 1 },
  { id: 'B', name: 'Performance', rang: 2 },
  { id: 'A', name: 'High Performance', rang: 3 },
  { id: 'S', name: 'Supersportwagen', rang: 4 },
  { id: 'R', name: 'Rennfahrzeug', rang: 5 },
];
export const klasseRang = (id) => KLASSEN.find((k) => k.id === id)?.rang ?? 0;

// Tuning-Faktoren wirken multiplikativ auf CARS[basis].phys.
// Nicht genannte Kennwerte bleiben unverändert.
export const FAHRZEUGE = [
  {
    id: 'club_d', name: 'Clubsport 240', klasse: 'D', basis: 'm4',
    // preis 0 = geschenktes Startfahrzeug. basiswert ist trotzdem gesetzt,
    // sonst waere das Auto beim Verkauf wertlos.
    preis: 0, basiswert: 9000, level: 1, reputation: 0, start: true,
    beschreibung: 'Abgerüsteter Einstiegs-Renner. Langsam, aber gutmütig.',
    tuning: { powerWheel: 0.34, fTraction: 0.52, mass: 1.06, maxLatG: 0.72,
              brakeDecel: 0.66, vmaxKmh: 0.66, aeroMax: 0.25 },
  },
  {
    id: 'sport_c', name: 'Sport Trophy 320', klasse: 'C', basis: 'm4',
    preis: 42000, level: 5, reputation: 40,
    beschreibung: 'Deutlich mehr Druck, spürbar mehr Kurvengrip.',
    tuning: { powerWheel: 0.50, fTraction: 0.66, mass: 1.03, maxLatG: 0.82,
              brakeDecel: 0.78, vmaxKmh: 0.78, aeroMax: 0.45 },
  },
  {
    id: 'perf_b', name: 'Performance 420', klasse: 'B', basis: 'm4',
    preis: 96000, level: 10, reputation: 120,
    beschreibung: 'Seriennaher Rennwagen mit echtem Abtrieb.',
    tuning: { powerWheel: 0.68, fTraction: 0.80, mass: 1.0, maxLatG: 0.90,
              brakeDecel: 0.88, vmaxKmh: 0.88, aeroMax: 0.68 },
  },
  {
    id: 'gt3_a', name: 'BMW M4 GT3 EVO', klasse: 'A', basis: 'm4',
    preis: 235000, level: 20, reputation: 320,
    beschreibung: 'Der GT3 in Werksabstimmung – volle Originaldaten.',
    tuning: {},
  },
  {
    id: 'proto_s', name: 'Prototyp LMP (Clubversion)', klasse: 'S', basis: 'ts030',
    preis: 420000, level: 28, reputation: 560,
    beschreibung: 'Le-Mans-Prototyp, für Clubrennen entschärft.',
    tuning: { powerWheel: 0.82, fTraction: 0.88, maxLatG: 0.90, brakeDecel: 0.92,
              vmaxKmh: 0.90, aeroMax: 0.80 },
  },
  {
    id: 'lmp_r', name: 'Toyota TS030 Hybrid', klasse: 'R', basis: 'ts030',
    preis: 780000, level: 38, reputation: 900,
    beschreibung: 'Der TS030 in Le-Mans-Abstimmung – volle Originaldaten.',
    tuning: {},
  },
];
export const fahrzeugDef = (id) => FAHRZEUGE.find((f) => f.id === id) || null;

// Upgrades: je Kategorie mehrere Stufen. `wirkung` sind Multiplikatoren auf die
// Physik-Kennwerte – jede Stufe verändert das Fahrverhalten wirklich.
export const UPGRADES = [
  {
    id: 'motor', name: 'Motor', beschreibung: 'Leistung und Antritt',
    stufen: [
      { preis: 6000, wirkung: { powerWheel: 1.05, fTraction: 1.03 } },
      { preis: 14000, wirkung: { powerWheel: 1.11, fTraction: 1.06 } },
      { preis: 30000, wirkung: { powerWheel: 1.18, fTraction: 1.10 } },
    ],
  },
  {
    id: 'getriebe', name: 'Getriebe', beschreibung: 'Übersetzung und Durchzug',
    stufen: [
      { preis: 5000, wirkung: { gearPull: 1.04 } },
      { preis: 12000, wirkung: { gearPull: 1.08 } },
      { preis: 24000, wirkung: { gearPull: 1.13 } },
    ],
  },
  {
    id: 'fahrwerk', name: 'Fahrwerk', beschreibung: 'Kurvengeschwindigkeit und Stabilität',
    stufen: [
      { preis: 7000, wirkung: { maxLatG: 1.04, aeroMax: 1.06, oversteerGain: 0.94 } },
      { preis: 16000, wirkung: { maxLatG: 1.08, aeroMax: 1.13, oversteerGain: 0.88 } },
      { preis: 34000, wirkung: { maxLatG: 1.13, aeroMax: 1.22, oversteerGain: 0.80 } },
    ],
  },
  {
    id: 'bremsen', name: 'Bremsen', beschreibung: 'Bremsleistung und Standfestigkeit',
    stufen: [
      { preis: 5500, wirkung: { brakeDecel: 1.05 } },
      { preis: 13000, wirkung: { brakeDecel: 1.10 } },
      { preis: 27000, wirkung: { brakeDecel: 1.16 } },
    ],
  },
  {
    id: 'reifen', name: 'Reifen', beschreibung: 'Grip und Haltbarkeit',
    stufen: [
      { preis: 4500, wirkung: { reifenHaftung: 1.03, reifenDauer: 1.10 } },
      { preis: 11000, wirkung: { reifenHaftung: 1.06, reifenDauer: 1.22 } },
      { preis: 23000, wirkung: { reifenHaftung: 1.10, reifenDauer: 1.38 } },
    ],
  },
  {
    id: 'gewicht', name: 'Gewichtsreduktion', beschreibung: 'Weniger Masse, mehr von allem',
    stufen: [
      { preis: 8000, wirkung: { mass: 0.97 } },
      { preis: 19000, wirkung: { mass: 0.94 } },
      { preis: 40000, wirkung: { mass: 0.90 } },
    ],
  },
];
export const upgradeDef = (id) => UPGRADES.find((u) => u.id === id) || null;

// Levelkurve: benötigte GESAMT-XP je Level. Wächst überproportional.
export const LEVEL_TITEL = [
  { ab: 1, titel: 'Anfänger' }, { ab: 5, titel: 'Amateur' },
  { ab: 10, titel: 'Club Racer' }, { ab: 20, titel: 'Profi' },
  { ab: 30, titel: 'Elite' }, { ab: 40, titel: 'Champion' },
  { ab: 50, titel: 'Legende' },
];
export const MAX_LEVEL = 50;
export function xpFuerLevel(level) {
  if (level <= 1) return 0;
  // 1→2 kostet 400 XP, danach wächst der Bedarf um gut 12 % je Stufe
  let summe = 0, stufe = 400;
  for (let l = 2; l <= level; l++) { summe += Math.round(stufe); stufe *= 1.12; }
  return summe;
}
export function titelFuerLevel(level) {
  let t = LEVEL_TITEL[0].titel;
  for (const e of LEVEL_TITEL) if (level >= e.ab) t = e.titel;
  return t;
}

// Meisterschaftspunkte nach Platzierung (Platz 1 = Index 0)
export const PUNKTE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

// XP- und Geldbasis je Eventtyp. `dauer` = Rundenzahl im Rennen.
export const EVENT_TYPEN = {
  einzelrennen: { name: 'Einzelrennen', xpBasis: 220, quali: true },
  sprint:       { name: 'Sprint',       xpBasis: 150, quali: false },
  langstrecke:  { name: 'Langstrecke',  xpBasis: 420, quali: true },
  zeitfahren:   { name: 'Zeitfahren',   xpBasis: 140, quali: false, soloGegen: true },
  markenpokal:  { name: 'Markenpokal',  xpBasis: 260, quali: true },
  klassencup:   { name: 'Klassen-Cup',  xpBasis: 260, quali: true },
  einladung:    { name: 'Einladungsevent', xpBasis: 520, quali: true },
  spezial:      { name: 'Spezialevent', xpBasis: 600, quali: true },
};

// Einzel-Events. `strecke` = TRACKS[i].id, `runden` = Renndistanz.
// `voraussetzung.events` nennt IDs, die vorher abgeschlossen sein müssen.
export const EVENTS = [
  { id: 'rookie_hockenheim', name: 'Rookie Shakedown', typ: 'einzelrennen',
    strecke: 'hockenheim', runden: 3, gegner: 4, gegnerStaerke: 0.72,
    voraussetzung: { level: 1, reputation: 0, klasse: 'D' },
    startgeld: 0, preisgeld: { 1: 4000, 2: 2600, 3: 1800, 4: 1200, 5: 800, 6: 500 } },

  { id: 'club_sprint_spielberg', name: 'Club Sprint Spielberg', typ: 'sprint',
    strecke: 'spielberg', runden: 2, gegner: 4, gegnerStaerke: 0.76,
    voraussetzung: { level: 2, reputation: 0, klasse: 'D', events: ['rookie_hockenheim'] },
    startgeld: 300, preisgeld: { 1: 5200, 2: 3400, 3: 2300, 4: 1500, 5: 900, 6: 600 } },

  { id: 'zeitfahren_zandvoort', name: 'Zeitjagd Zandvoort', typ: 'zeitfahren',
    strecke: 'zandvoort', runden: 2, gegner: 3, gegnerStaerke: 0.80,
    voraussetzung: { level: 3, reputation: 20, klasse: 'D' },
    startgeld: 0, preisgeld: { 1: 4800, 2: 3000, 3: 2000 } },

  { id: 'sports_challenge', name: 'Sports Car Challenge', typ: 'klassencup',
    strecke: 'montreal', runden: 4, gegner: 4, gegnerStaerke: 0.84,
    voraussetzung: { level: 8, reputation: 60, klasse: 'C' },
    startgeld: 1200, preisgeld: { 1: 16000, 2: 11000, 3: 7500, 4: 5000, 5: 3000, 6: 1800 } },

  { id: 'marken_m4', name: 'M4-Markenpokal', typ: 'markenpokal',
    strecke: 'hockenheim', runden: 4, gegner: 4, gegnerStaerke: 0.88,
    voraussetzung: { level: 12, reputation: 140, fahrzeug: ['perf_b', 'gt3_a'] },
    startgeld: 2000, preisgeld: { 1: 26000, 2: 17000, 3: 12000, 4: 8000, 5: 5000, 6: 3000 } },

  { id: 'langstrecke_saopaulo', name: '12 Runden von Interlagos', typ: 'langstrecke',
    strecke: 'saopaulo', runden: 12, gegner: 4, gegnerStaerke: 0.90,
    voraussetzung: { level: 16, reputation: 220, klasse: 'B' },
    startgeld: 3000, preisgeld: { 1: 44000, 2: 30000, 3: 21000, 4: 14000, 5: 9000, 6: 5000 } },

  { id: 'einladung_gt3', name: 'GT3-Einladungsrennen', typ: 'einladung',
    strecke: 'zandvoort', runden: 6, gegner: 4, gegnerStaerke: 0.95,
    voraussetzung: { level: 22, reputation: 400, klasse: 'A' },
    startgeld: 5000, preisgeld: { 1: 78000, 2: 52000, 3: 36000, 4: 24000, 5: 15000, 6: 9000 } },

  { id: 'spezial_prototyp', name: 'Prototypen-Showdown', typ: 'spezial',
    strecke: 'spielberg', runden: 8, gegner: 4, gegnerStaerke: 1.0,
    voraussetzung: { level: 32, reputation: 700, klasse: 'S' },
    startgeld: 9000, preisgeld: { 1: 150000, 2: 100000, 3: 70000, 4: 45000, 5: 28000, 6: 16000 } },
];
export const eventDef = (id) => EVENTS.find((e) => e.id === id) || null;

// Meisterschaften: Folge von Läufen, die auf dieselben Event-Regeln zurückgreifen.
export const MEISTERSCHAFTEN = [
  {
    id: 'club_championship', name: 'European Club Championship',
    voraussetzung: { level: 4, reputation: 30, klasse: 'D' },
    gegner: 4, gegnerStaerke: 0.80, startgeld: 800,
    siegPreis: 30000, siegReputation: 90,
    laeufe: [
      { strecke: 'hockenheim', runden: 3 }, { strecke: 'spielberg', runden: 3 },
      { strecke: 'zandvoort', runden: 3 },  { strecke: 'montreal', runden: 3 },
      { strecke: 'saopaulo', runden: 4 },
    ],
  },
  {
    id: 'sports_championship', name: 'Sports Car Series',
    voraussetzung: { level: 10, reputation: 100, klasse: 'C' },
    gegner: 4, gegnerStaerke: 0.87, startgeld: 2500,
    siegPreis: 90000, siegReputation: 180,
    laeufe: [
      { strecke: 'spielberg', runden: 4 }, { strecke: 'montreal', runden: 4 },
      { strecke: 'hockenheim', runden: 5 }, { strecke: 'zandvoort', runden: 5 },
    ],
  },
  {
    id: 'gt_championship', name: 'GT Championship',
    voraussetzung: { level: 20, reputation: 350, klasse: 'A' },
    gegner: 4, gegnerStaerke: 0.96, startgeld: 6000,
    siegPreis: 260000, siegReputation: 400,
    laeufe: [
      { strecke: 'zandvoort', runden: 6 }, { strecke: 'saopaulo', runden: 6 },
      { strecke: 'montreal', runden: 6 },  { strecke: 'spielberg', runden: 7 },
      { strecke: 'hockenheim', runden: 8 },
    ],
  },
];
export const meisterschaftDef = (id) => MEISTERSCHAFTEN.find((m) => m.id === id) || null;

// Persistente KI-Fahrer. skill 0…1 (Tempo), aggressiv 0…1 (Überholmut),
// konstanz 0…1 (Streuung von Rennen zu Rennen), fehler 0…1 (Patzerquote).
export const KI_FAHRER = [
  { id: 'ai_koenig',  name: 'M. König',    skill: 0.94, aggressiv: 0.85, konstanz: 0.62, fehler: 0.22 },
  { id: 'ai_laurent', name: 'P. Laurent',  skill: 0.90, aggressiv: 0.45, konstanz: 0.93, fehler: 0.06 },
  { id: 'ai_ferrand', name: 'L. Ferrand',  skill: 0.86, aggressiv: 0.70, konstanz: 0.75, fehler: 0.14 },
  { id: 'ai_bakker',  name: 'J. Bakker',   skill: 0.82, aggressiv: 0.35, konstanz: 0.88, fehler: 0.08 },
  { id: 'ai_moretti', name: 'A. Moretti',  skill: 0.79, aggressiv: 0.92, konstanz: 0.48, fehler: 0.30 },
  { id: 'ai_svensson',name: 'E. Svensson', skill: 0.76, aggressiv: 0.55, konstanz: 0.80, fehler: 0.12 },
  { id: 'ai_novak',   name: 'R. Novák',    skill: 0.72, aggressiv: 0.60, konstanz: 0.70, fehler: 0.18 },
  { id: 'ai_duarte',  name: 'C. Duarte',   skill: 0.68, aggressiv: 0.40, konstanz: 0.85, fehler: 0.10 },
];

// Belohnungs-Stellschrauben an einer Stelle, damit die Kurve tunebar bleibt.
export const BALANCE = {
  startGeld: 12000,
  xpProPosition: [1.0, 0.82, 0.70, 0.58, 0.48, 0.40], // Faktor auf xpBasis je Platz
  xpSieg: 150,          // Bonus für Platz 1
  xpPole: 90,
  xpSchnellsteRunde: 70,
  xpSauber: 110,        // ohne Kollision/Strafe ins Ziel
  xpProUeberholung: 12,
  xpProRunde: 14,       // Rennlänge zahlt sich aus
  repSieg: 22, repPodium: 12, repPunkte: 4,
  repUeberlegen: 18,    // Sieg gegen deutlich stärkere Gegner
  repUnsauber: -14,     // sehr unsauberes Rennen
  reparaturProZustand: 900, // Kosten je Prozentpunkt fehlender Fahrzeugzustand
  wiederverkauf: 0.62,  // Anteil des Kaufpreises beim Verkauf
};
