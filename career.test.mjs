// Testet den kompletten Karriere-Ablauf ohne Browser.
// Aufruf:  node career.test.mjs
import {
  CareerManager, CareerSave, SAVE_KEY, SAVE_VERSION,
} from './career.js';
import { FAHRZEUGE, EVENTS, MEISTERSCHAFTEN, xpFuerLevel, PUNKTE } from './career-data.js';

// --- Mini-Testrahmen ---------------------------------------------------------
let bestanden = 0, fehlgeschlagen = 0;
const gruppen = [];
function pruefe(name, fn) {
  try { fn(); bestanden++; gruppen.push(['ok', name]); }
  catch (e) { fehlgeschlagen++; gruppen.push(['FEHLER', `${name}\n     ${e.message}`]); }
}
function gleich(ist, soll, was = '') {
  if (ist !== soll) throw new Error(`${was}: erwartet ${JSON.stringify(soll)}, ist ${JSON.stringify(ist)}`);
}
function wahr(bed, was = '') { if (!bed) throw new Error(`${was}: erwartet true`); }
function groesser(a, b, was = '') { if (!(a > b)) throw new Error(`${was}: ${a} ist nicht > ${b}`); }

// localStorage-Ersatz
function speicher() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}
const startAuto = FAHRZEUGE.find((f) => f.start).id;
function frischeKarriere(st = speicher()) {
  const c = new CareerManager(st);
  c.neu('Testfahrer', startAuto);
  return c;
}
// Ein Rennergebnis, das alle Boni ausloest
const gutesErgebnis = (platz = 1, extra = {}) => ({
  platz, gegner: 5, runden: 3, km: 13.7, tempo: 248, pole: true,
  schnellsteRunde: true, sauber: true, ueberholungen: 4, schaden: 6, ...extra,
});

// --- 1. Neue Karriere --------------------------------------------------------
pruefe('neue Karriere anlegen', () => {
  const c = frischeKarriere();
  gleich(c.state.player.level, 1, 'Startlevel');
  gleich(c.state.player.xp, 0, 'Start-XP');
  gleich(c.garage.alle().length, 1, 'ein Startfahrzeug');
  gleich(c.garage.aktiv().def, startAuto, 'aktives Fahrzeug');
  groesser(c.state.player.money, 0, 'Startgeld');
  gleich(c.state.season.number, 1, 'Saison');
});

// --- 2. Speichern und Laden --------------------------------------------------
pruefe('speichern, neu starten, laden', () => {
  const st = speicher();
  const c = frischeKarriere(st);
  c.player.xpGeben(1200);
  c.economy.einnehmen(5000);
  const geld = c.state.player.money, xp = c.state.player.xp, lvl = c.state.player.level;
  c.speichern();
  const c2 = new CareerManager(st);           // simuliert Neustart des Spiels
  gleich(c2.state.player.money, geld, 'Geld nach Neustart');
  gleich(c2.state.player.xp, xp, 'XP nach Neustart');
  gleich(c2.state.player.level, lvl, 'Level nach Neustart');
  gleich(c2.garage.alle().length, 1, 'Garage nach Neustart');
});

pruefe('Speicherstand hat Version', () => {
  const st = speicher();
  frischeKarriere(st);
  const roh = JSON.parse(st.getItem(SAVE_KEY));
  gleich(roh.version, SAVE_VERSION, 'Version');
});

// --- 3. Alte und kaputte Speicherstaende ------------------------------------
pruefe('alten Speicherstand (v1) laden', () => {
  const st = speicher();
  st.setItem(SAVE_KEY, JSON.stringify({
    version: 1,
    player: { name: 'Alt', level: 7, xp: 5000, reputation: 90, money: 33000 },
    garage: { vehicles: [{ id: 'v1', def: startAuto, km: 400, rennen: 9 }], aktiv: 'v1' },
    progression: { completedEvents: ['rookie_hockenheim'] },
    // season, ai, statistics fehlen komplett
  }));
  const c = new CareerManager(st);
  gleich(c.state.version, SAVE_VERSION, 'auf aktuelle Version migriert');
  gleich(c.state.player.level, 7, 'Level uebernommen');
  wahr(!('reputation' in c.state.player), 'altes Reputationsfeld wird verworfen');
  gleich(c.garage.alle()[0].km, 400, 'Kilometerstand uebernommen');
  gleich(c.state.season.number, 1, 'Saison ergaenzt');
  wahr(c.state.statistics && typeof c.state.statistics.rennen === 'number', 'Statistik ergaenzt');
  wahr(c.ai.alle().length > 0, 'KI-Fahrer ergaenzt');
  // v1-Migration: abgeschlossene Events zaehlen als Saisonfortschritt
  gleich(c.state.season.abgeschlosseneEvents, 1, 'Saisonfortschritt migriert');
});

pruefe('beschaedigten Speicherstand abfangen', () => {
  const st = speicher();
  st.setItem(SAVE_KEY, '{das ist kein JSON');
  const c = new CareerManager(st);
  gleich(c.state.player.level, 1, 'faellt auf neuen Stand zurueck');
  gleich(c.garage.alle().length, 0, 'keine Fahrzeuge');
});

pruefe('unvollstaendige Save-Daten sinnvoll fuellen', () => {
  const st = speicher();
  st.setItem(SAVE_KEY, JSON.stringify({
    player: { level: 'kaputt', money: null },
    garage: { vehicles: [{ def: 'gibt_es_nicht' }, { def: startAuto }] },
    progression: { unlockedEvents: 'auch kaputt', completedEvents: ['nicht_existent'] },
    championships: { current: { id: 'weg' } },
    statistics: { rennen: -5, siege: 'x' },
  }));
  const c = new CareerManager(st);
  gleich(c.state.player.level, 1, 'kaputtes Level ersetzt');
  groesser(c.state.player.money, 0, 'fehlendes Geld ersetzt');
  gleich(c.garage.alle().length, 1, 'unbekanntes Fahrzeug verworfen');
  gleich(c.state.progression.unlockedEvents.length, 0, 'kaputte Liste ersetzt');
  gleich(c.state.progression.completedEvents.length, 0, 'unbekanntes Event verworfen');
  gleich(c.state.championships.current, null, 'unbekannte Meisterschaft verworfen');
  gleich(c.state.statistics.rennen, 0, 'negative Statistik korrigiert');
  gleich(c.state.statistics.siege, 0, 'kaputte Statistik korrigiert');
});

// --- 4. Rennen gewinnen und verlieren ---------------------------------------
pruefe('Rennen gewinnen bringt Geld und XP', () => {
  const c = frischeKarriere();
  const start = c.events.starten('rookie_hockenheim');
  wahr(start.ok, 'Event startbar');
  const geldVor = c.state.player.money;
  const b = c.rennenAuswerten(start.rennen, gutesErgebnis(1));
  groesser(b.xp, 0, 'XP');
  gleich(c.state.player.money, geldVor + b.geld, 'Preisgeld gutgeschrieben');
  gleich(b.geld, EVENTS[0].preisgeld[1], 'Preisgeld fuer Platz 1');
  gleich(c.stats.st.siege, 1, 'Sieg gezaehlt');
  gleich(c.garage.aktiv().siege, 1, 'Sieg am Fahrzeug');
});

pruefe('Rennen verlieren bringt weniger', () => {
  const c1 = frischeKarriere(); const c2 = frischeKarriere();
  const r1 = c1.events.starten('rookie_hockenheim').rennen;
  const r2 = c2.events.starten('rookie_hockenheim').rennen;
  const sieg = c1.rennenAuswerten(r1, gutesErgebnis(1));
  const letzter = c2.rennenAuswerten(r2, gutesErgebnis(6, { pole: false, schnellsteRunde: false }));
  groesser(sieg.xp, letzter.xp, 'Sieg gibt mehr XP');
  groesser(sieg.geld, letzter.geld, 'Sieg gibt mehr Geld');
  gleich(c2.stats.st.siege, 0, 'kein Sieg gezaehlt');
});

// Freischaltungen laufen nur noch ueber Level und Fahrzeugklasse.
pruefe('kein Reputationssystem mehr', () => {
  const c = frischeKarriere();
  wahr(!('reputation' in c.state.player), 'Fahrerprofil ohne Reputation');
  const r = c.events.starten('rookie_hockenheim').rennen;
  const b = c.rennenAuswerten(r, gutesErgebnis(1));
  wahr(!('reputation' in b), 'Rennbericht ohne Reputation');
  // Level und Klasse reichen: hoechstes Event nur mit Level + Klasse S frei
  c.state.player.level = 40; c.state.player.money = 1e7;
  const kauf = c.fahrzeugKaufen('proto_s');
  wahr(kauf.ok, `Spitzenfahrzeug ohne Ruf kaufbar: ${kauf.grund || ''}`);
  c.garage.waehlen(kauf.fahrzeug.id);
  const spezial = c.events.uebersicht().find((e) => e.def.id === 'spezial_prototyp');
  wahr(spezial.frei, `hoechstes Event frei, fehlt: ${spezial.fehlt.join(', ')}`);
  const ms = c.championships.uebersicht().find((m) => m.def.id === 'gt_championship');
  wahr(!ms.fehlt.some((f) => f.toLowerCase().includes('reputation')), 'keine Ruf-Huerde bei Meisterschaften');
});

// --- 5. Level-Up -------------------------------------------------------------
pruefe('Level-Up bei genug XP', () => {
  const c = frischeKarriere();
  gleich(c.player.level, 1, 'Start');
  const noetig = xpFuerLevel(2);
  const r = c.player.xpGeben(noetig);
  wahr(r.aufgestiegen, 'aufgestiegen');
  gleich(c.player.level, 2, 'Level 2');
  // Mehrere Level auf einmal
  const r2 = c.player.xpGeben(xpFuerLevel(8));
  wahr(r2.levelNachher >= 8, `mehrere Level auf einmal (ist ${r2.levelNachher})`);
});

pruefe('Levelfortschritt bleibt in 0…1', () => {
  const c = frischeKarriere();
  for (const xp of [0, 100, 5000, 50000, 5e6]) {
    c.state.player.xp = 0; c.state.player.level = 1;
    c.player.xpGeben(xp);
    const f = c.player.levelFortschritt();
    wahr(f >= 0 && f <= 1, `Fortschritt ${f} bei ${xp} XP`);
  }
});

// --- 6. Freischaltungen ------------------------------------------------------
pruefe('Events schalten mit Level und Vorbedingung frei', () => {
  const c = frischeKarriere();
  const sprint = () => c.events.uebersicht().find((e) => e.def.id === 'club_sprint_spielberg');
  wahr(!sprint().frei, 'anfangs gesperrt');
  wahr(sprint().fehlt.length > 0, 'Grund wird genannt');
  // Level reicht, aber das Vorgaengerevent fehlt
  c.state.player.level = 5;
  wahr(!sprint().frei, 'ohne Vorgaengerevent weiter gesperrt');
  wahr(sprint().fehlt.some((f) => f.includes('Rookie')), 'nennt das fehlende Event');
  c.progression.eventAbschliessen('rookie_hockenheim');
  wahr(sprint().frei, 'jetzt frei');
});

pruefe('Fahrzeugklasse als Voraussetzung', () => {
  const c = frischeKarriere();
  c.state.player.level = 40;
  const gt3 = () => c.events.uebersicht().find((e) => e.def.id === 'einladung_gt3');
  wahr(!gt3().frei, 'mit Klasse D gesperrt');
  wahr(gt3().fehlt.some((f) => f.includes('Klasse A')), 'nennt die Klasse');
  c.state.player.money = 1e7;
  const kauf = c.fahrzeugKaufen('gt3_a');
  wahr(kauf.ok, `GT3 kaufbar: ${kauf.grund || ''}`);
  c.garage.waehlen(kauf.fahrzeug.id);
  wahr(gt3().frei, 'mit Klasse A frei');
});

// --- 7. Fahrzeug kaufen ------------------------------------------------------
pruefe('Fahrzeug kaufen', () => {
  const c = frischeKarriere();
  const teuer = c.fahrzeugKaufen('sport_c');
  wahr(!teuer.ok, 'ohne Level gesperrt');
  c.state.player.level = 5;
  const ohneGeld = c.fahrzeugKaufen('sport_c');
  wahr(!ohneGeld.ok, 'ohne Geld nicht kaufbar');
  gleich(ohneGeld.grund, 'Nicht genug Geld', 'Grund');
  c.state.player.money = 100000;
  const ok = c.fahrzeugKaufen('sport_c');
  wahr(ok.ok, 'jetzt kaufbar');
  gleich(c.garage.alle().length, 2, 'zwei Fahrzeuge');
  gleich(c.stats.st.gekaufteFahrzeuge, 1, 'Statistik');
  const nochmal = c.fahrzeugKaufen('sport_c');
  wahr(!nochmal.ok, 'nicht doppelt kaufbar');
});

pruefe('Fahrzeug verkaufen, aber nicht das letzte', () => {
  const c = frischeKarriere();
  const nein = c.garage.verkaufen(c.garage.aktiv().id);
  wahr(!nein.ok, 'letztes Fahrzeug bleibt');
  c.state.player.level = 5; c.state.player.money = 100000;
  c.fahrzeugKaufen('sport_c');
  const geldVor = c.state.player.money;
  const ja = c.garage.verkaufen(c.garage.alle()[0].id);
  wahr(ja.ok, 'Verkauf moeglich');
  groesser(c.state.player.money, geldVor, 'Erloes gutgeschrieben');
  gleich(c.garage.alle().length, 1, 'eins uebrig');
});

// --- 8. Upgrades -------------------------------------------------------------
pruefe('Fahrzeug upgraden', () => {
  const c = frischeKarriere();
  const f = c.garage.aktiv();
  c.state.player.money = 200000;
  gleich(c.upgrades.stufe(f, 'motor'), 0, 'Startstufe');
  const r = c.upgrades.kaufen(f.id, 'motor');
  wahr(r.ok, 'Kauf ok');
  gleich(c.upgrades.stufe(f, 'motor'), 1, 'Stufe 1');
  c.upgrades.kaufen(f.id, 'motor');
  c.upgrades.kaufen(f.id, 'motor');
  gleich(c.upgrades.stufe(f, 'motor'), 3, 'Stufe 3');
  const zuviel = c.upgrades.kaufen(f.id, 'motor');
  wahr(!zuviel.ok, 'keine vierte Stufe');
});

pruefe('Upgrades wirken auf die Physik', () => {
  const c = frischeKarriere();
  const f = c.garage.aktiv();
  const vorher = c.physikFaktoren(f).faktoren.powerWheel ?? 1;
  c.state.player.money = 200000;
  c.upgrades.kaufen(f.id, 'motor');
  const nachher = c.physikFaktoren(f).faktoren.powerWheel ?? 1;
  groesser(nachher, vorher, 'Motor-Upgrade erhoeht die Leistung');
  const gewichtVor = c.physikFaktoren(f).faktoren.mass ?? 1;
  c.upgrades.kaufen(f.id, 'gewicht');
  wahr((c.physikFaktoren(f).faktoren.mass ?? 1) < gewichtVor, 'Gewichtsreduktion senkt die Masse');
});

pruefe('schlechter Zustand kostet Leistung', () => {
  const c = frischeKarriere();
  const f = c.garage.aktiv();
  const gut = c.physikFaktoren(f).faktoren.maxLatG;
  f.zustand = 20;
  const schlecht = c.physikFaktoren(f).faktoren.maxLatG;
  wahr(schlecht < gut, `Zustand wirkt (${schlecht} < ${gut})`);
});

// --- 9. Meisterschaft --------------------------------------------------------
pruefe('Meisterschaft starten', () => {
  const c = frischeKarriere();
  const nein = c.championships.starten('club_championship');
  wahr(!nein.ok, 'ohne Level gesperrt');
  c.state.player.level = 5; c.state.player.money = 50000;
  const ja = c.championships.starten('club_championship');
  wahr(ja.ok, `startbar: ${ja.grund || ''}`);
  wahr(c.championships.aktuelle() !== null, 'laeuft');
  const doppelt = c.championships.starten('club_championship');
  wahr(!doppelt.ok, 'nicht zweimal gleichzeitig');
});

pruefe('mehrere Meisterschaftslaeufe, Punkte stimmen', () => {
  const c = frischeKarriere();
  c.state.player.level = 5; c.state.player.money = 50000;
  c.championships.starten('club_championship');
  const m = MEISTERSCHAFTEN.find((x) => x.id === 'club_championship');
  let erwartet = 0;
  const plaetze = [1, 3, 2, 1, 4];
  for (let i = 0; i < m.laeufe.length; i++) {
    const lauf = c.championships.naechsterLauf();
    wahr(lauf !== null, `Lauf ${i + 1} vorhanden`);
    gleich(lauf.strecke, m.laeufe[i].strecke, `Strecke Lauf ${i + 1}`);
    const b = c.rennenAuswerten(lauf, gutesErgebnis(plaetze[i]));
    erwartet += PUNKTE[plaetze[i] - 1];
    if (i < m.laeufe.length - 1) {
      gleich(c.championships.aktuelle().punkte.spieler, erwartet, `Punkte nach Lauf ${i + 1}`);
      wahr(b.meisterschaft && !b.meisterschaft.fertig, 'noch nicht fertig');
    } else {
      wahr(b.meisterschaft && b.meisterschaft.fertig, 'nach dem letzten Lauf fertig');
      gleich(b.meisterschaft.abschluss.punkte, erwartet, 'Endpunkte');
    }
  }
  gleich(c.championships.aktuelle(), null, 'Meisterschaft abgelegt');
  gleich(c.state.championships.completed.length, 1, 'als abgeschlossen abgelegt');
});

pruefe('Meisterschaft gewinnen zahlt Siegpraemie', () => {
  const c = frischeKarriere();
  c.state.player.level = 5; c.state.player.money = 50000;
  c.championships.starten('club_championship');
  const m = MEISTERSCHAFTEN.find((x) => x.id === 'club_championship');
  let letzter = null;
  for (let i = 0; i < m.laeufe.length; i++) {
    letzter = c.rennenAuswerten(c.championships.naechsterLauf(), gutesErgebnis(1));
  }
  gleich(letzter.meisterschaft.position, 1, 'Spieler gewinnt (KI ohne Punkte)');
  groesser(letzter.geld, m.siegPreis - 1, 'Siegpraemie enthalten');
  gleich(c.stats.st.meisterschaftsSiege, 1, 'Statistik');
});

pruefe('Meisterschaft verlieren: KI sammelt Punkte', () => {
  const c = frischeKarriere();
  c.state.player.level = 5; c.state.player.money = 50000;
  c.championships.starten('club_championship');
  const m = MEISTERSCHAFTEN.find((x) => x.id === 'club_championship');
  const gegner = c.championships.aktuelle().fahrer[0];
  let letzter = null;
  for (let i = 0; i < m.laeufe.length; i++) {
    // Spieler wird immer Letzter, ein KI-Fahrer immer Erster
    letzter = c.rennenAuswerten(c.championships.naechsterLauf(),
      gutesErgebnis(6, { pole: false, schnellsteRunde: false, kiPlatzierungen: { [gegner]: 1 } }));
  }
  wahr(letzter.meisterschaft.position > 1, `Spieler nicht Erster (ist ${letzter.meisterschaft.position})`);
  const tab = letzter.meisterschaft.abschluss.tabelle;
  gleich(tab[0].id, gegner, 'KI-Fahrer fuehrt die Tabelle an');
  gleich(tab[0].punkte, PUNKTE[0] * m.laeufe.length, 'KI-Punkte stimmen');
});

// --- 10. Saison --------------------------------------------------------------
pruefe('Saison abschliessen und neue starten', () => {
  const c = frischeKarriere();
  wahr(!c.saisonAbschliessbar(), 'am Anfang nicht abschliessbar');
  c.state.season.abgeschlosseneEvents = 3;
  const geldVor = c.state.player.money;
  const r = c.saisonAbschliessen();
  wahr(r.ok, 'abschliessbar');
  gleich(c.state.season.number, 2, 'Saison 2');
  groesser(c.state.player.money, geldVor, 'Saisonbonus');
  gleich(c.state.season.abgeschlosseneEvents, 0, 'Zaehler zurueckgesetzt');
});

pruefe('Saisonwechsel behaelt Fahrzeuge, Geld, Level, Statistik', () => {
  const c = frischeKarriere();
  c.state.player.level = 12;
  c.state.player.money = 90000; c.state.statistics.rennen = 17;
  c.state.player.money = 90000;
  c.state.player.level = 12;
  c.state.season.abgeschlosseneEvents = 3;
  const fahrzeuge = c.garage.alle().length;
  c.saisonAbschliessen();
  gleich(c.state.player.level, 12, 'Level bleibt');
  gleich(c.garage.alle().length, fahrzeuge, 'Fahrzeuge bleiben');
  gleich(c.state.statistics.rennen, 17, 'Statistik bleibt');
  groesser(c.state.player.money, 90000, 'Geld bleibt (plus Bonus)');
});

// --- 11. Wirtschaft ----------------------------------------------------------
pruefe('Startgeld reicht nicht fuer die Spitzenfahrzeuge', () => {
  const c = frischeKarriere();
  const teuerste = FAHRZEUGE.reduce((a, b) => (b.preis > a.preis ? b : a));
  wahr(c.state.player.money < teuerste.preis, 'Topauto nicht sofort kaufbar');
});

pruefe('Startgeld wird abgebucht und fehlt bei zu wenig Geld', () => {
  const c = frischeKarriere();
  c.progression.eventAbschliessen('rookie_hockenheim');
  c.state.player.level = 2;
  const e = EVENTS.find((x) => x.id === 'club_sprint_spielberg');
  const vor = c.state.player.money;
  const r = c.events.starten('club_sprint_spielberg');
  wahr(r.ok, `startbar: ${r.grund || ''}`);
  gleich(c.state.player.money, vor - e.startgeld, 'Startgeld abgebucht');
  c.state.player.money = 0;
  const r2 = c.events.starten('club_sprint_spielberg');
  wahr(!r2.ok, 'ohne Geld kein Start');
});

pruefe('Reparatur kostet und stellt den Zustand her', () => {
  const c = frischeKarriere();
  const f = c.garage.aktiv();
  f.zustand = 60;
  c.state.player.money = 500000;
  const kosten = c.economy.reparaturKosten(f);
  groesser(kosten, 0, 'Kosten');
  const r = c.garage.reparieren(f.id);
  wahr(r.ok, 'repariert');
  gleich(f.zustand, 100, 'Zustand wieder 100');
});

// --- 12. KI ------------------------------------------------------------------
pruefe('KI-Fahrer bleiben ueber die Meisterschaft dieselben', () => {
  const c = frischeKarriere();
  c.state.player.level = 5; c.state.player.money = 50000;
  c.championships.starten('club_championship');
  const feld1 = [...c.championships.aktuelle().fahrer];
  c.rennenAuswerten(c.championships.naechsterLauf(), gutesErgebnis(2));
  const feld2 = [...c.championships.aktuelle().fahrer];
  gleich(JSON.stringify(feld1), JSON.stringify(feld2), 'gleiches Fahrerfeld');
});

pruefe('KI-Werte: besseres Koennen faehrt schneller, kein Rubberbanding', () => {
  const c = frischeKarriere();
  const schnell = c.ai.alle()[0], langsam = c.ai.alle()[c.ai.alle().length - 1];
  const a = c.ai.botWerte(schnell, 0.9, 5), b = c.ai.botWerte(langsam, 0.9, 5);
  groesser(a.cornerF, b.cornerF, 'besserer Fahrer bremst spaeter');
  // Karrierefortschritt hebt das Niveau, aber unabhaengig vom Spielerergebnis
  const spaet = c.ai.botWerte(schnell, 0.9, 40);
  groesser(spaet.cornerF, a.cornerF, 'spaetere Karriere = staerkere Gegner');
  wahr(spaet.fehler < a.fehler, 'weniger Fehler statt mehr Tempo');
});

// --- 13. Statistik -----------------------------------------------------------
pruefe('Statistik zaehlt mit', () => {
  const c = frischeKarriere();
  const r = c.events.starten('rookie_hockenheim').rennen;
  c.rennenAuswerten(r, gutesErgebnis(1, { km: 12, tempo: 250 }));
  c.rennenAuswerten(r, gutesErgebnis(3, { km: 12, tempo: 265 }));
  gleich(c.stats.st.rennen, 2, 'Rennen');
  gleich(c.stats.st.siege, 1, 'Siege');
  gleich(c.stats.st.podien, 2, 'Podien');
  gleich(c.stats.st.hoechstesTempo, 265, 'Hoechsttempo');
  gleich(c.stats.durchschnittsPlatz(), 2, 'Durchschnittsplatz');
  groesser(c.stats.st.kilometer, 23, 'Kilometer');
});

// --- 14. Quick Race bleibt unberuehrt ---------------------------------------
pruefe('Karriere ohne Speicher funktioniert (Quick Race unberuehrt)', () => {
  const c = new CareerManager(null);   // kein localStorage vorhanden
  gleich(c.vorhanden(), false, 'keine Karriere');
  gleich(c.speichern(), false, 'Speichern schlaegt sauber fehl');
  c.neu('Ohne Speicher', startAuto);
  gleich(c.garage.alle().length, 1, 'trotzdem spielbar');
});

// --- Ausgabe -----------------------------------------------------------------
for (const [status, name] of gruppen) {
  console.log(`${status === 'ok' ? '  ok  ' : ' FEHL '} ${name}`);
}
console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen ? 1 : 0);
