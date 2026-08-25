// Karrieremodus – reine Logik, ohne DOM und ohne THREE.
// Dadurch laesst sich der komplette Ablauf in Node testen (siehe career.test.mjs).
//
// Aufbau (jede Klasse hat genau eine Verantwortung):
//   CareerSave        Laden/Speichern inkl. Version und Migration
//   PlayerCareer      Fahrerdaten: Level, XP, Reputation, Geld
//   CareerProgression Freischaltungen und deren Begruendung
//   CareerEconomy     Preisgelder, Startgebuehren, Reparatur, Kauf/Verkauf
//   GarageManager     Fahrzeugbestand mit persistenten Daten je Auto
//   VehicleUpgradeManager  Upgrade-Stufen und deren Wirkung auf die Physik
//   EventManager      Einzel-Events: Verfuegbarkeit, Start, Auswertung
//   ChampionshipManager  Meisterschaften mit Punktestand ueber mehrere Laeufe
//   CareerAIManager   persistente KI-Fahrer, Staerke pro Event
//   CareerStatistics  Langzeitzahlen
//   CareerManager     Fassade, die alles verbindet
//
// Alle Manager arbeiten auf EINEM Zustandsobjekt (`state`), das genau so
// gespeichert wird. Kein verstecktes Nebenzustandsgeflecht.

import {
  FAHRZEUGE, fahrzeugDef, UPGRADES, upgradeDef, EVENTS, eventDef,
  MEISTERSCHAFTEN, meisterschaftDef, KI_FAHRER, PUNKTE, EVENT_TYPEN,
  BALANCE, MAX_LEVEL, xpFuerLevel, titelFuerLevel, klasseRang,
} from './career-data.js';

export const SAVE_KEY = 'bmwM4Career';
export const SAVE_VERSION = 2;

// ---------------------------------------------------------------- Hilfsmittel
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const zahl = (v, ersatz = 0) => (typeof v === 'number' && isFinite(v) ? v : ersatz);
const liste = (v) => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------------ Speichern
// Robust gegen fehlende, alte und beschaedigte Staende: was fehlt, wird mit
// sinnvollen Vorgaben ergaenzt; was unbekannt ist, wird verworfen statt zu
// crashen.
export class CareerSave {
  constructor(storage) {
    // storage ist localStorage-kompatibel; in Tests ein einfaches Objekt
    this.storage = storage || null;
  }

  static leererStand() {
    return {
      version: SAVE_VERSION,
      player: { name: 'Fahrer', level: 1, xp: 0, reputation: 0, money: BALANCE.startGeld },
      garage: { vehicles: [], aktiv: null },
      progression: { unlockedEvents: [], completedEvents: [], unlockedVehicles: [] },
      championships: { current: null, completed: [] },
      season: { number: 1, abgeschlosseneEvents: 0 },
      ai: { fahrer: [] },
      statistics: {
        rennen: 0, siege: 0, podien: 0, poles: 0, schnellsteRunden: 0,
        kilometer: 0, verdient: 0, ausgegeben: 0, gekaufteFahrzeuge: 0,
        meisterschaftsSiege: 0, platzierungenSumme: 0, hoechstesTempo: 0,
        serienRennen: {},
      },
    };
  }

  // Unbekannte/alte Staende auf die aktuelle Struktur bringen.
  static migrieren(roh) {
    const leer = CareerSave.leererStand();
    if (!roh || typeof roh !== 'object') return leer;

    const v = zahl(roh.version, 1);
    const s = { ...leer, ...roh };

    // Jede Sektion einzeln absichern – ein kaputter Teil darf den Rest nicht mitreissen
    s.player = { ...leer.player, ...(roh.player || {}) };
    s.player.level = clamp(Math.floor(zahl(s.player.level, 1)), 1, MAX_LEVEL);
    s.player.xp = Math.max(0, zahl(s.player.xp, 0));
    s.player.reputation = Math.max(0, zahl(s.player.reputation, 0));
    s.player.money = Math.max(0, zahl(s.player.money, BALANCE.startGeld));
    if (typeof s.player.name !== 'string' || !s.player.name) s.player.name = 'Fahrer';

    s.garage = { ...leer.garage, ...(roh.garage || {}) };
    s.garage.vehicles = liste(s.garage.vehicles)
      .filter((f) => f && fahrzeugDef(f.def))          // Fahrzeuge unbekannter Bauart raus
      .map((f) => GarageManager.fahrzeugAbsichern(f));
    if (!s.garage.vehicles.some((f) => f.id === s.garage.aktiv)) {
      s.garage.aktiv = s.garage.vehicles[0]?.id ?? null;
    }

    s.progression = { ...leer.progression, ...(roh.progression || {}) };
    for (const k of ['unlockedEvents', 'completedEvents', 'unlockedVehicles']) {
      s.progression[k] = [...new Set(liste(s.progression[k]).filter((x) => typeof x === 'string'))];
    }
    // Events, die es nicht mehr gibt, stillschweigend vergessen
    s.progression.unlockedEvents = s.progression.unlockedEvents.filter(eventDef);
    s.progression.completedEvents = s.progression.completedEvents.filter(eventDef);
    s.progression.unlockedVehicles = s.progression.unlockedVehicles.filter(fahrzeugDef);

    s.championships = { ...leer.championships, ...(roh.championships || {}) };
    s.championships.completed = liste(s.championships.completed);
    const cur = s.championships.current;
    if (cur && !meisterschaftDef(cur.id)) s.championships.current = null;
    else if (cur) {
      cur.lauf = clamp(Math.floor(zahl(cur.lauf, 0)), 0, meisterschaftDef(cur.id).laeufe.length);
      cur.punkte = (cur.punkte && typeof cur.punkte === 'object') ? cur.punkte : {};
      cur.ergebnisse = liste(cur.ergebnisse);
    }

    s.season = { ...leer.season, ...(roh.season || {}) };
    s.season.number = Math.max(1, Math.floor(zahl(s.season.number, 1)));

    s.ai = { ...leer.ai, ...(roh.ai || {}) };
    s.ai.fahrer = liste(s.ai.fahrer).filter((f) => f && KI_FAHRER.some((k) => k.id === f.id));

    s.statistics = { ...leer.statistics, ...(roh.statistics || {}) };
    for (const k of Object.keys(leer.statistics)) {
      if (k === 'serienRennen') {
        s.statistics[k] = (s.statistics[k] && typeof s.statistics[k] === 'object') ? s.statistics[k] : {};
      } else {
        s.statistics[k] = Math.max(0, zahl(s.statistics[k], 0));
      }
    }

    // --- Versionsmigrationen ---
    // v1 kannte weder Saison noch KI-Fahrer; beides ist oben schon ergaenzt.
    // Kuenftige Schritte hier anhaengen.
    if (v < 2) s.season.abgeschlosseneEvents = s.progression.completedEvents.length;

    s.version = SAVE_VERSION;
    return s;
  }

  laden() {
    if (!this.storage) return null;
    try {
      const roh = this.storage.getItem(SAVE_KEY);
      if (!roh) return null;
      return CareerSave.migrieren(JSON.parse(roh));
    } catch (e) {
      return null; // beschaedigter Stand: lieber neu anfangen als crashen
    }
  }

  speichern(state) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false; // z. B. Speicher voll oder privater Modus
    }
  }

  loeschen() {
    if (!this.storage) return;
    try { this.storage.removeItem(SAVE_KEY); } catch (e) {}
  }
}

// -------------------------------------------------------------- Fahrerprofil
export class PlayerCareer {
  constructor(state) { this.s = state; }
  get p() { return this.s.player; }

  get level() { return this.p.level; }
  get xp() { return this.p.xp; }
  get reputation() { return this.p.reputation; }
  get money() { return this.p.money; }
  get titel() { return titelFuerLevel(this.p.level); }

  // XP gutschreiben und ggf. mehrere Level aufsteigen
  xpGeben(menge) {
    const vorher = this.p.level;
    this.p.xp += Math.max(0, Math.round(menge));
    while (this.p.level < MAX_LEVEL && this.p.xp >= xpFuerLevel(this.p.level + 1)) this.p.level++;
    return { levelVorher: vorher, levelNachher: this.p.level, aufgestiegen: this.p.level > vorher };
  }

  reputationGeben(menge) {
    this.p.reputation = Math.max(0, this.p.reputation + Math.round(menge));
    return this.p.reputation;
  }

  // Fortschritt innerhalb des aktuellen Levels (0…1) für die Anzeige
  levelFortschritt() {
    if (this.p.level >= MAX_LEVEL) return 1;
    const von = xpFuerLevel(this.p.level), bis = xpFuerLevel(this.p.level + 1);
    return clamp((this.p.xp - von) / Math.max(1, bis - von), 0, 1);
  }
  xpBisLevelup() {
    if (this.p.level >= MAX_LEVEL) return 0;
    return Math.max(0, xpFuerLevel(this.p.level + 1) - this.p.xp);
  }
}

// ------------------------------------------------------------------ Wirtschaft
export class CareerEconomy {
  constructor(state, stats) { this.s = state; this.stats = stats; }

  kannZahlen(betrag) { return this.s.player.money >= betrag; }

  ausgeben(betrag, grund = '') {
    if (betrag <= 0) return true;
    if (!this.kannZahlen(betrag)) return false;
    this.s.player.money -= betrag;
    this.s.statistics.ausgegeben += betrag;
    return true;
  }

  einnehmen(betrag) {
    if (betrag <= 0) return;
    this.s.player.money += betrag;
    this.s.statistics.verdient += betrag;
  }

  // Preisgeld nach Platzierung; Plaetze ohne Eintrag gehen leer aus
  preisgeld(tabelle, platz) { return Math.max(0, zahl(tabelle?.[platz], 0)); }

  reparaturKosten(fahrzeug) {
    const fehlt = Math.max(0, 100 - zahl(fahrzeug.zustand, 100));
    return Math.round(fehlt * BALANCE.reparaturProZustand);
  }
}

// -------------------------------------------------------------------- Garage
export class GarageManager {
  constructor(state, economy) { this.s = state; this.eco = economy; }

  static fahrzeugAbsichern(f) {
    return {
      id: typeof f.id === 'string' ? f.id : `veh_${Math.random().toString(36).slice(2, 9)}`,
      def: f.def,
      kaufpreis: Math.max(0, zahl(f.kaufpreis, fahrzeugDef(f.def)?.preis ?? 0)),
      km: Math.max(0, zahl(f.km, 0)),
      rennen: Math.max(0, zahl(f.rennen, 0)),
      siege: Math.max(0, zahl(f.siege, 0)),
      podien: Math.max(0, zahl(f.podien, 0)),
      zustand: clamp(zahl(f.zustand, 100), 0, 100),
      upgrades: (f.upgrades && typeof f.upgrades === 'object')
        ? Object.fromEntries(UPGRADES.map((u) => [u.id, clamp(Math.floor(zahl(f.upgrades[u.id], 0)), 0, u.stufen.length)]))
        : Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
    };
  }

  alle() { return this.s.garage.vehicles; }
  aktiv() { return this.alle().find((f) => f.id === this.s.garage.aktiv) || null; }
  waehlen(id) {
    if (!this.alle().some((f) => f.id === id)) return false;
    this.s.garage.aktiv = id; return true;
  }
  besitzt(defId) { return this.alle().some((f) => f.def === defId); }

  // Fahrzeug in die Garage stellen (Kauf oder Startfahrzeug)
  hinzufuegen(defId, kaufpreis) {
    const def = fahrzeugDef(defId);
    if (!def) return null;
    const f = GarageManager.fahrzeugAbsichern({
      id: `veh_${defId}_${this.alle().length}_${Math.floor(Math.random() * 1e6)}`,
      def: defId, kaufpreis: zahl(kaufpreis, def.preis),
    });
    this.alle().push(f);
    if (!this.s.garage.aktiv) this.s.garage.aktiv = f.id;
    return f;
  }

  // Aktueller Wert: Kaufpreis + Upgrades, abgewertet nach Zustand.
  // Geschenkte Startfahrzeuge haben kaufpreis 0 – dafuer gibt es basiswert,
  // sonst waeren sie beim Verkauf wertlos.
  wert(f) {
    const def = fahrzeugDef(f.def);
    const grund = f.kaufpreis > 0 ? f.kaufpreis : (def?.basiswert ?? 0);
    const upg = UPGRADES.reduce((sum, u) => {
      const stufe = f.upgrades[u.id] || 0;
      return sum + u.stufen.slice(0, stufe).reduce((a, st) => a + st.preis, 0);
    }, 0);
    return Math.round((grund + upg) * BALANCE.wiederverkauf * (0.55 + 0.45 * (f.zustand / 100)));
  }

  verkaufen(id) {
    const i = this.alle().findIndex((f) => f.id === id);
    if (i < 0) return { ok: false, grund: 'Fahrzeug nicht gefunden' };
    if (this.alle().length <= 1) return { ok: false, grund: 'Das letzte Fahrzeug kann nicht verkauft werden' };
    const f = this.alle()[i];
    const erloes = this.wert(f);
    this.alle().splice(i, 1);
    if (this.s.garage.aktiv === id) this.s.garage.aktiv = this.alle()[0].id;
    this.eco.einnehmen(erloes);
    return { ok: true, erloes };
  }

  reparieren(id) {
    const f = this.alle().find((x) => x.id === id);
    if (!f) return { ok: false, grund: 'Fahrzeug nicht gefunden' };
    const kosten = this.eco.reparaturKosten(f);
    if (kosten === 0) return { ok: false, grund: 'Fahrzeug ist in Ordnung' };
    if (!this.eco.ausgeben(kosten)) return { ok: false, grund: 'Nicht genug Geld' };
    f.zustand = 100;
    return { ok: true, kosten };
  }

  // Verschleiss nach einem Rennen: Distanz und Reifen-/Felgenschaden zaehlen
  nachRennen(id, { km = 0, schaden = 0, platz = 99 } = {}) {
    const f = this.alle().find((x) => x.id === id);
    if (!f) return;
    f.km += Math.max(0, km);
    f.rennen += 1;
    if (platz === 1) f.siege += 1;
    if (platz <= 3) f.podien += 1;
    f.zustand = clamp(f.zustand - Math.max(0, schaden), 0, 100);
  }
}

// ------------------------------------------------------------------ Upgrades
export class VehicleUpgradeManager {
  constructor(state, garage, economy) { this.s = state; this.garage = garage; this.eco = economy; }

  stufe(f, upgradeId) { return f?.upgrades?.[upgradeId] ?? 0; }
  maxStufe(upgradeId) { return upgradeDef(upgradeId)?.stufen.length ?? 0; }

  naechsteStufePreis(f, upgradeId) {
    const def = upgradeDef(upgradeId);
    const st = this.stufe(f, upgradeId);
    if (!def || st >= def.stufen.length) return null;
    return def.stufen[st].preis;
  }

  kaufen(fahrzeugId, upgradeId) {
    const f = this.garage.alle().find((x) => x.id === fahrzeugId);
    const def = upgradeDef(upgradeId);
    if (!f || !def) return { ok: false, grund: 'Unbekanntes Upgrade' };
    const st = this.stufe(f, upgradeId);
    if (st >= def.stufen.length) return { ok: false, grund: 'Höchste Stufe erreicht' };
    const preis = def.stufen[st].preis;
    if (!this.eco.ausgeben(preis)) return { ok: false, grund: 'Nicht genug Geld' };
    f.upgrades[upgradeId] = st + 1;
    return { ok: true, stufe: st + 1, preis };
  }

  // Gesamtwirkung aller Upgrades eines Fahrzeugs als Multiplikatoren.
  // Wirkungen derselben Kategorie ersetzen sich (hoechste Stufe zaehlt),
  // Kategorien untereinander multiplizieren sich.
  wirkung(f) {
    const w = {};
    for (const u of UPGRADES) {
      const st = this.stufe(f, u.id);
      if (!st) continue;
      const stufe = u.stufen[st - 1];
      for (const [k, v] of Object.entries(stufe.wirkung)) w[k] = (w[k] ?? 1) * v;
    }
    return w;
  }
}

// ------------------------------------------------------------- Freischaltung
export class CareerProgression {
  constructor(state, garage, upgrades) { this.s = state; this.garage = garage; this.upgrades = upgrades; }

  // Prueft eine Voraussetzung und liefert IMMER eine Begruendung mit –
  // die UI kann damit anzeigen, warum etwas gesperrt ist.
  pruefen(vor = {}, fahrzeug = null) {
    const fehlt = [];
    const p = this.s.player;
    if (vor.level && p.level < vor.level) fehlt.push(`Level ${vor.level} nötig (du: ${p.level})`);
    if (vor.reputation && p.reputation < vor.reputation) {
      fehlt.push(`Reputation ${vor.reputation} nötig (du: ${p.reputation})`);
    }
    if (vor.klasse) {
      const def = fahrzeug ? fahrzeugDef(fahrzeug.def) : null;
      if (!def || klasseRang(def.klasse) < klasseRang(vor.klasse)) {
        fehlt.push(`Fahrzeug der Klasse ${vor.klasse} oder besser nötig`);
      }
    }
    if (vor.fahrzeug) {
      const ids = liste(vor.fahrzeug);
      if (!fahrzeug || !ids.includes(fahrzeug.def)) {
        const namen = ids.map((i) => fahrzeugDef(i)?.name || i).join(' oder ');
        fehlt.push(`Nur mit ${namen} fahrbar`);
      }
    }
    for (const e of liste(vor.events)) {
      if (!this.s.progression.completedEvents.includes(e)) {
        fehlt.push(`Zuerst „${eventDef(e)?.name || e}" abschließen`);
      }
    }
    return { frei: fehlt.length === 0, fehlt };
  }

  fahrzeugFrei(defId) {
    const def = fahrzeugDef(defId);
    if (!def) return { frei: false, fehlt: ['Unbekanntes Fahrzeug'] };
    return this.pruefen({ level: def.level, reputation: def.reputation });
  }

  eventAbschliessen(eventId) {
    if (!this.s.progression.completedEvents.includes(eventId)) {
      this.s.progression.completedEvents.push(eventId);
      this.s.season.abgeschlosseneEvents += 1;
    }
  }
}

// -------------------------------------------------------------- KI-Fahrer
export class CareerAIManager {
  constructor(state) {
    this.s = state;
    if (!this.s.ai.fahrer.length) this.s.ai.fahrer = KI_FAHRER.map((f) => ({ ...f, punkte: 0, siege: 0 }));
  }

  alle() { return this.s.ai.fahrer; }

  // Feld fuer ein Event: die staerksten `anzahl` Fahrer, in stabiler Reihenfolge.
  // Dieselben Fahrer bleiben ueber eine Meisterschaft hinweg dieselben.
  feld(anzahl) { return this.alle().slice(0, anzahl); }

  // Umrechnung auf die Bot-Stellschrauben in main.js.
  // `eventStaerke` skaliert das ganze Feld; die Karrierestufe hebt es zusaetzlich
  // an – aber ueber KOENNEN (Bremspunkte, Konstanz, Fehler), nicht ueber
  // kuenstliches Mehrtempo, und ohne Bezug zur aktuellen Spielerposition.
  botWerte(fahrer, eventStaerke, level) {
    const reife = clamp(level / MAX_LEVEL, 0, 1);      // Karrierefortschritt 0…1
    const koennen = clamp(fahrer.skill * eventStaerke * (0.90 + 0.14 * reife), 0.4, 1.06);
    return {
      id: fahrer.id,
      name: fahrer.name,
      // cornerF: Kurvenmut – gutes Koennen bremst spaeter
      cornerF: 0.84 + 0.22 * koennen,
      // accelF: wie frueh und voll ans Gas
      accelF: 0.80 + 0.24 * koennen,
      // Reaktionszeit am Start: konstante Fahrer starten zuverlaessiger
      reaktion: 0.22 + 0.28 * (1 - fahrer.konstanz),
      // Streuung von Runde zu Runde
      streuung: 0.10 * (1 - fahrer.konstanz),
      // Wahrscheinlichkeit eines Patzers pro Runde
      fehler: fahrer.fehler * (1.15 - 0.30 * reife),
      aggressiv: fahrer.aggressiv,
    };
  }
}

// ------------------------------------------------------------------ Statistik
export class CareerStatistics {
  constructor(state) { this.s = state; }
  get st() { return this.s.statistics; }

  rennenErfassen({ platz, km, tempo, pole, schnellsteRunde, serie }) {
    const st = this.st;
    st.rennen += 1;
    st.platzierungenSumme += platz;
    st.kilometer += Math.max(0, km);
    if (platz === 1) st.siege += 1;
    if (platz <= 3) st.podien += 1;
    if (pole) st.poles += 1;
    if (schnellsteRunde) st.schnellsteRunden += 1;
    if (tempo > st.hoechstesTempo) st.hoechstesTempo = tempo;
    if (serie) st.serienRennen[serie] = (st.serienRennen[serie] || 0) + 1;
  }

  durchschnittsPlatz() {
    return this.st.rennen ? this.st.platzierungenSumme / this.st.rennen : 0;
  }
  besteSerie() {
    const e = Object.entries(this.st.serienRennen);
    if (!e.length) return null;
    return e.sort((a, b) => b[1] - a[1])[0][0];
  }
}

// ------------------------------------------------------------------- Events
export class EventManager {
  constructor(state, progression, garage, economy) {
    this.s = state; this.prog = progression; this.garage = garage; this.eco = economy;
  }

  // Alle Events mit Status – die UI zeigt damit auch die gesperrten samt Grund.
  uebersicht() {
    const aktiv = this.garage.aktiv();
    return EVENTS.map((e) => {
      const p = this.prog.pruefen(e.voraussetzung, aktiv);
      const erledigt = this.s.progression.completedEvents.includes(e.id);
      return {
        def: e, frei: p.frei, fehlt: p.fehlt, erledigt,
        startgeld: e.startgeld,
        bezahlbar: this.eco.kannZahlen(e.startgeld),
        typName: EVENT_TYPEN[e.typ]?.name || e.typ,
      };
    });
  }

  naechstes() {
    return this.uebersicht().find((e) => e.frei && !e.erledigt)
        || this.uebersicht().find((e) => e.frei) || null;
  }

  // Startgebuehr abbuchen und die Renn-Parameter liefern
  starten(eventId) {
    const e = eventDef(eventId);
    if (!e) return { ok: false, grund: 'Unbekanntes Event' };
    const aktiv = this.garage.aktiv();
    const p = this.prog.pruefen(e.voraussetzung, aktiv);
    if (!p.frei) return { ok: false, grund: p.fehlt.join(' · ') };
    if (!this.eco.ausgeben(e.startgeld)) return { ok: false, grund: 'Startgeld nicht bezahlbar' };
    return {
      ok: true,
      rennen: {
        quelle: 'event', id: e.id, name: e.name,
        strecke: e.strecke, runden: e.runden, gegner: e.gegner,
        gegnerStaerke: e.gegnerStaerke, quali: EVENT_TYPEN[e.typ]?.quali !== false,
        preisgeld: e.preisgeld, xpBasis: EVENT_TYPEN[e.typ]?.xpBasis ?? 200,
      },
    };
  }
}

// ----------------------------------------------------------- Meisterschaften
export class ChampionshipManager {
  constructor(state, progression, garage, economy, ai) {
    this.s = state; this.prog = progression; this.garage = garage; this.eco = economy; this.ai = ai;
  }

  aktuelle() { return this.s.championships.current; }

  uebersicht() {
    const aktiv = this.garage.aktiv();
    return MEISTERSCHAFTEN.map((m) => {
      const p = this.prog.pruefen(m.voraussetzung, aktiv);
      const gewonnen = this.s.championships.completed.filter((c) => c.id === m.id);
      return { def: m, frei: p.frei, fehlt: p.fehlt, absolviert: gewonnen.length, ergebnisse: gewonnen };
    });
  }

  starten(id) {
    const m = meisterschaftDef(id);
    if (!m) return { ok: false, grund: 'Unbekannte Meisterschaft' };
    if (this.aktuelle()) return { ok: false, grund: 'Es läuft bereits eine Meisterschaft' };
    const p = this.prog.pruefen(m.voraussetzung, this.garage.aktiv());
    if (!p.frei) return { ok: false, grund: p.fehlt.join(' · ') };
    if (!this.eco.ausgeben(m.startgeld)) return { ok: false, grund: 'Startgeld nicht bezahlbar' };
    const feld = this.ai.feld(m.gegner);
    this.s.championships.current = {
      id, lauf: 0,
      punkte: { spieler: 0, ...Object.fromEntries(feld.map((f) => [f.id, 0])) },
      ergebnisse: [],
      fahrer: feld.map((f) => f.id),
    };
    return { ok: true };
  }

  // Renn-Parameter des naechsten Laufs
  naechsterLauf() {
    const c = this.aktuelle();
    if (!c) return null;
    const m = meisterschaftDef(c.id);
    if (c.lauf >= m.laeufe.length) return null;
    const l = m.laeufe[c.lauf];
    return {
      quelle: 'meisterschaft', id: m.id, name: `${m.name} — Lauf ${c.lauf + 1}/${m.laeufe.length}`,
      strecke: l.strecke, runden: l.runden, gegner: m.gegner,
      gegnerStaerke: m.gegnerStaerke, quali: true,
      preisgeld: null, xpBasis: EVENT_TYPEN.einzelrennen.xpBasis,
      fahrer: c.fahrer,
    };
  }

  // Punkte fuer Spieler und KI verbuchen; liefert Endstand, wenn die Serie endet
  laufAuswerten(platz, kiPlatzierungen) {
    const c = this.aktuelle();
    if (!c) return null;
    const m = meisterschaftDef(c.id);
    const punkteFuer = (pl) => PUNKTE[pl - 1] ?? 0;
    c.punkte.spieler += punkteFuer(platz);
    for (const [fahrerId, pl] of Object.entries(kiPlatzierungen || {})) {
      c.punkte[fahrerId] = (c.punkte[fahrerId] || 0) + punkteFuer(pl);
    }
    c.ergebnisse.push({ lauf: c.lauf + 1, platz });
    c.lauf += 1;

    if (c.lauf < m.laeufe.length) return { fertig: false, stand: this.tabelle() };

    // Serie zu Ende: Endstand, Belohnung, ablegen
    const tabelle = this.tabelle();
    const pos = tabelle.findIndex((r) => r.id === 'spieler') + 1;
    const abschluss = {
      id: m.id, name: m.name, saison: this.s.season.number,
      position: pos, punkte: c.punkte.spieler, tabelle,
    };
    this.s.championships.completed.push(abschluss);
    this.s.championships.current = null;
    return { fertig: true, abschluss, meisterschaft: m, position: pos };
  }

  tabelle() {
    const c = this.aktuelle() || this.s.championships.completed.slice(-1)[0];
    if (!c || !c.punkte) return [];
    return Object.entries(c.punkte)
      .map(([id, punkte]) => ({
        id, punkte,
        name: id === 'spieler' ? (this.s.player.name || 'Du')
          : (KI_FAHRER.find((f) => f.id === id)?.name || id),
      }))
      .sort((a, b) => b.punkte - a.punkte || (a.id === 'spieler' ? -1 : 1));
  }

  abbrechen() { this.s.championships.current = null; }
}

// ------------------------------------------------------------------- Fassade
export class CareerManager {
  constructor(storage) {
    this.save = new CareerSave(storage);
    this.state = this.save.laden() || CareerSave.leererStand();
    this.verdrahten();
  }

  verdrahten() {
    const s = this.state;
    this.stats = new CareerStatistics(s);
    this.player = new PlayerCareer(s);
    this.economy = new CareerEconomy(s, this.stats);
    this.garage = new GarageManager(s, this.economy);
    this.upgrades = new VehicleUpgradeManager(s, this.garage, this.economy);
    this.progression = new CareerProgression(s, this.garage, this.upgrades);
    this.ai = new CareerAIManager(s);
    this.events = new EventManager(s, this.progression, this.garage, this.economy);
    this.championships = new ChampionshipManager(s, this.progression, this.garage, this.economy, this.ai);
  }

  vorhanden() { return this.garage.alle().length > 0; }
  speichern() { return this.save.speichern(this.state); }

  neu(name, startFahrzeugId) {
    this.state = CareerSave.leererStand();
    this.state.player.name = name || 'Fahrer';
    this.verdrahten();
    const start = fahrzeugDef(startFahrzeugId) || FAHRZEUGE.find((f) => f.start);
    this.garage.hinzufuegen(start.id, 0);
    this.state.progression.unlockedVehicles.push(start.id);
    this.speichern();
    return this.state;
  }

  loeschen() { this.save.loeschen(); this.state = CareerSave.leererStand(); this.verdrahten(); }

  // Fahrzeug kaufen (prueft Freischaltung UND Geld)
  fahrzeugKaufen(defId) {
    const def = fahrzeugDef(defId);
    if (!def) return { ok: false, grund: 'Unbekanntes Fahrzeug' };
    if (this.garage.besitzt(defId)) return { ok: false, grund: 'Fahrzeug bereits in der Garage' };
    const frei = this.progression.fahrzeugFrei(defId);
    if (!frei.frei) return { ok: false, grund: frei.fehlt.join(' · ') };
    if (!this.economy.ausgeben(def.preis)) return { ok: false, grund: 'Nicht genug Geld' };
    const f = this.garage.hinzufuegen(defId, def.preis);
    this.state.statistics.gekaufteFahrzeuge += 1;
    if (!this.state.progression.unlockedVehicles.includes(defId)) {
      this.state.progression.unlockedVehicles.push(defId);
    }
    this.speichern();
    return { ok: true, fahrzeug: f };
  }

  // Kaufbare Fahrzeuge mit Sperrgrund für die UI
  fahrzeugAngebot() {
    return FAHRZEUGE.map((def) => {
      const frei = this.progression.fahrzeugFrei(def.id);
      return {
        def, frei: frei.frei, fehlt: frei.fehlt,
        besessen: this.garage.besitzt(def.id),
        bezahlbar: this.economy.kannZahlen(def.preis),
      };
    });
  }

  // ---- Renn-Ergebnis verbuchen -------------------------------------------
  // `ergebnis` kommt aus main.js: { platz, gegner, runden, km, tempo, pole,
  // schnellsteRunde, sauber, ueberholungen, schaden, kiPlatzierungen }
  rennenAuswerten(rennen, ergebnis) {
    const e = { platz: 99, gegner: 5, runden: 3, km: 0, tempo: 0, pole: false,
                schnellsteRunde: false, sauber: true, ueberholungen: 0, schaden: 0,
                kiPlatzierungen: {}, ...ergebnis };
    const feld = e.gegner + 1;
    const bericht = { geld: 0, xp: 0, reputation: 0, levelUp: null, meisterschaft: null, posten: [] };

    // --- XP ---
    const posFaktor = BALANCE.xpProPosition[Math.min(e.platz - 1, BALANCE.xpProPosition.length - 1)] ?? 0.35;
    const gegnerFaktor = 0.7 + 0.6 * (rennen.gegnerStaerke ?? 0.8); // starke Gegner zahlen mehr
    let xp = Math.round((rennen.xpBasis ?? 200) * posFaktor * gegnerFaktor);
    bericht.posten.push({ was: `Platz ${e.platz} von ${feld}`, xp });
    const add = (was, menge) => { if (menge > 0) { xp += menge; bericht.posten.push({ was, xp: menge }); } };
    add('Rennlänge', Math.round(BALANCE.xpProRunde * e.runden));
    if (e.platz === 1) add('Sieg', BALANCE.xpSieg);
    if (e.pole) add('Pole Position', BALANCE.xpPole);
    if (e.schnellsteRunde) add('Schnellste Runde', BALANCE.xpSchnellsteRunde);
    if (e.sauber) add('Sauberes Rennen', BALANCE.xpSauber);
    add('Überholmanöver', Math.round(BALANCE.xpProUeberholung * e.ueberholungen));
    bericht.xp = xp;
    bericht.levelUp = this.player.xpGeben(xp);

    // --- Reputation ---
    let rep = 0;
    if (e.platz === 1) rep += BALANCE.repSieg;
    else if (e.platz <= 3) rep += BALANCE.repPodium;
    else if (e.platz <= 10) rep += BALANCE.repPunkte;
    if (e.platz === 1 && (rennen.gegnerStaerke ?? 0) >= 0.92) rep += BALANCE.repUeberlegen;
    if (!e.sauber) rep += BALANCE.repUnsauber;
    bericht.reputation = rep;
    this.player.reputationGeben(rep);

    // --- Geld ---
    if (rennen.preisgeld) {
      const geld = this.economy.preisgeld(rennen.preisgeld, e.platz);
      if (geld > 0) { this.economy.einnehmen(geld); bericht.geld += geld; }
    }

    // --- Fahrzeug und Statistik ---
    const aktiv = this.garage.aktiv();
    if (aktiv) this.garage.nachRennen(aktiv.id, { km: e.km, schaden: e.schaden, platz: e.platz });
    this.stats.rennenErfassen({
      platz: e.platz, km: e.km, tempo: e.tempo, pole: e.pole,
      schnellsteRunde: e.schnellsteRunde, serie: rennen.name,
    });

    // --- Meisterschaft ---
    if (rennen.quelle === 'meisterschaft') {
      const r = this.championships.laufAuswerten(e.platz, e.kiPlatzierungen);
      bericht.meisterschaft = r;
      if (r && r.fertig) {
        const m = r.meisterschaft;
        if (r.position === 1) {
          this.economy.einnehmen(m.siegPreis);
          this.player.reputationGeben(m.siegReputation);
          this.state.statistics.meisterschaftsSiege += 1;
          bericht.geld += m.siegPreis;
          bericht.reputation += m.siegReputation;
        } else if (r.position <= 3) {
          const teil = Math.round(m.siegPreis * (r.position === 2 ? 0.55 : 0.35));
          this.economy.einnehmen(teil);
          bericht.geld += teil;
        }
      }
    } else if (rennen.quelle === 'event') {
      this.progression.eventAbschliessen(rennen.id);
    }

    this.speichern();
    return bericht;
  }

  // ---- Saison --------------------------------------------------------------
  saisonAbschliessbar() {
    // Saison endet, wenn keine laufende Meisterschaft offen ist und genug
    // Events absolviert wurden.
    return !this.championships.aktuelle() && this.state.season.abgeschlosseneEvents >= 3;
  }

  saisonAbschliessen() {
    if (!this.saisonAbschliessbar()) return { ok: false, grund: 'Saison noch nicht abgeschlossen' };
    const nr = this.state.season.number;
    const bonus = 8000 + nr * 4000;
    this.economy.einnehmen(bonus);
    this.state.season.number += 1;
    this.state.season.abgeschlosseneEvents = 0;
    // Events der neuen Saison wieder fahrbar machen; Fortschritt bleibt erhalten
    this.state.progression.completedEvents = [];
    this.speichern();
    return { ok: true, saison: this.state.season.number, bonus };
  }

  // ---- Physik --------------------------------------------------------------
  // Liefert die Multiplikatoren fuer CARS[basis].phys aus Fahrzeugklasse,
  // Upgrades und Zustand. main.js baut daraus die tatsaechliche Config.
  physikFaktoren(fahrzeug) {
    const f = fahrzeug || this.garage.aktiv();
    if (!f) return { basis: null, faktoren: {} };
    const def = fahrzeugDef(f.def);
    const faktoren = { ...(def.tuning || {}) };
    const upg = this.upgrades.wirkung(f);
    for (const [k, v] of Object.entries(upg)) faktoren[k] = (faktoren[k] ?? 1) * v;
    // Schlechter Zustand kostet Grip und Bremse – ein vernachlaessigtes Auto
    // faehrt messbar schlechter.
    const zust = clamp(f.zustand / 100, 0, 1);
    const zustandFaktor = 0.90 + 0.10 * zust;
    for (const k of ['maxLatG', 'brakeDecel']) faktoren[k] = (faktoren[k] ?? 1) * zustandFaktor;
    return { basis: def.basis, faktoren, def, fahrzeug: f };
  }
}
