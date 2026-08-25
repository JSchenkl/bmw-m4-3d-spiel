// Bildschirme des Karrieremodus. Baut sein DOM selbst auf und spricht mit
// main.js nur ueber zwei Rueckrufe:
//   onRaceStart(rennen)  – Rennen mit den Karriere-Parametern starten
//   onExit()             – zurueck zum normalen Startbildschirm
// Umgekehrt meldet main.js ein beendetes Rennen ueber rennenBeendet(ergebnis).

import { CareerManager } from './career.js';
import {
  FAHRZEUGE, fahrzeugDef, UPGRADES, KLASSEN, MEISTERSCHAFTEN,
  EVENT_TYPEN, MAX_LEVEL, xpFuerLevel,
} from './career-data.js';

const geld = (n) => `${Math.round(n).toLocaleString('de-DE')} €`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class CareerUI {
  constructor({ onRaceStart, onExit, trackName }) {
    this.onRaceStart = onRaceStart;
    this.onExit = onExit;
    this.trackName = trackName || ((id) => id);
    this.karriere = new CareerManager(typeof localStorage !== 'undefined' ? localStorage : null);
    this.aktivesRennen = null;
    this.ansicht = 'haupt';
    this.wurzel = null;
  }

  // ---------------------------------------------------------------- Aufbau
  aufbauen() {
    if (this.wurzel) return;
    const el = document.createElement('div');
    el.id = 'career-screen';
    el.innerHTML = `
      <div class="kar-kopf">
        <div class="kar-titel">KARRIERE</div>
        <div class="kar-status" id="kar-status"></div>
      </div>
      <div class="kar-body">
        <nav class="kar-nav" id="kar-nav"></nav>
        <section class="kar-inhalt" id="kar-inhalt"></section>
      </div>`;
    document.body.appendChild(el);
    this.wurzel = el;
    this.navEl = el.querySelector('#kar-nav');
    this.inhaltEl = el.querySelector('#kar-inhalt');
    this.statusEl = el.querySelector('#kar-status');

    this.navEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (b) { this.ansicht = b.dataset.view; this.zeichnen(); }
    });
    this.inhaltEl.addEventListener('click', (e) => this.klick(e));
  }

  zeigen() {
    this.aufbauen();
    this.wurzel.classList.add('visible');
    this.ansicht = this.karriere.vorhanden() ? 'haupt' : 'neu';
    this.zeichnen();
  }
  verbergen() { if (this.wurzel) this.wurzel.classList.remove('visible'); }

  // ---------------------------------------------------------------- Zeichnen
  zeichnen() {
    const k = this.karriere;
    const p = k.state.player;
    const auto = k.garage.aktiv();
    const autoDef = auto ? fahrzeugDef(auto.def) : null;
    const meister = k.championships.aktuelle();
    const tabelle = k.championships.tabelle();
    const meisterPos = meister ? (tabelle.findIndex((r) => r.id === 'spieler') + 1) : null;

    this.statusEl.innerHTML = k.vorhanden() ? `
      <span><b>${esc(p.name)}</b> · ${esc(k.player.titel)}</span>
      <span>Level ${p.level}</span>
      <span class="kar-xp"><i style="width:${(k.player.levelFortschritt() * 100).toFixed(0)}%"></i></span>
      <span>${p.xp.toLocaleString('de-DE')} XP</span>
      <span>Ruf ${p.reputation}</span>
      <span class="kar-geld">${geld(p.money)}</span>
      <span>Saison ${k.state.season.number}</span>
      <span>${autoDef ? esc(autoDef.name) : 'kein Fahrzeug'}</span>
      ${meister ? `<span>Meisterschaft: Platz ${meisterPos}</span>` : ''}` : '';

    const punkte = [
      ['haupt', 'Weiter / Nächstes Rennen'], ['kalender', 'Rennkalender'],
      ['garage', 'Garage'], ['kaufen', 'Fahrzeug kaufen'], ['upgrade', 'Fahrzeug verbessern'],
      ['profil', 'Fahrerprofil'], ['statistik', 'Statistik'], ['meisterschaft', 'Meisterschaften'],
      ['speichern', 'Speichern / Laden'], ['ende', 'Zurück zum Hauptmenü'],
    ];
    this.navEl.innerHTML = k.vorhanden()
      ? punkte.map(([v, t]) => `<button data-view="${v}" class="${this.ansicht === v ? 'an' : ''}">${t}</button>`).join('')
      : '';

    const bau = {
      neu: () => this.viewNeu(), haupt: () => this.viewHaupt(), kalender: () => this.viewKalender(),
      garage: () => this.viewGarage(), kaufen: () => this.viewKaufen(), upgrade: () => this.viewUpgrade(),
      profil: () => this.viewProfil(), statistik: () => this.viewStatistik(),
      meisterschaft: () => this.viewMeisterschaft(), speichern: () => this.viewSpeichern(),
      ende: () => this.viewEnde(),
    };
    this.inhaltEl.innerHTML = (bau[this.ansicht] || bau.haupt)();
  }

  // ------------------------------------------------------------ Einzelviews
  viewNeu() {
    const start = FAHRZEUGE.filter((f) => f.start);
    return `<h2>Neue Karriere</h2>
      <p class="kar-hinweis">Du beginnst als unbekannter Fahrer mit einem Einstiegsfahrzeug
      und wenig Geld. Fahre Rennen, verdiene Geld, Erfahrung und Ruf – und arbeite dich
      bis in die Spitzenserien hoch.</p>
      <label class="kar-feld">Fahrername
        <input id="kar-name" maxlength="18" value="Fahrer">
      </label>
      <h3>Startfahrzeug</h3>
      <div class="kar-liste">
        ${start.map((f) => `<div class="kar-karte">
          <div class="kar-k-titel">${esc(f.name)} <span class="kar-klasse k-${f.klasse}">${f.klasse}</span></div>
          <div class="kar-k-text">${esc(f.beschreibung)}</div>
          <button class="kar-btn gut" data-akt="neu" data-id="${f.id}">Karriere starten</button>
        </div>`).join('')}
      </div>
      ${this.karriere.vorhanden() ? '<button class="kar-btn" data-akt="abbrechen">Abbrechen</button>' : ''}`;
  }

  viewHaupt() {
    const k = this.karriere;
    const lauf = k.championships.naechsterLauf();
    const ev = k.events.naechstes();
    const naechstes = lauf || (ev && ev.frei ? { name: ev.def.name, strecke: ev.def.strecke, runden: ev.def.runden } : null);
    return `<h2>Nächstes Rennen</h2>
      ${naechstes ? `
        <div class="kar-karte gross">
          <div class="kar-k-titel">${esc(naechstes.name)}</div>
          <div class="kar-k-text">${esc(this.trackName(naechstes.strecke))} · ${naechstes.runden} Runden</div>
          <button class="kar-btn gut" data-akt="${lauf ? 'meisterlauf' : 'event'}" data-id="${lauf ? '' : ev.def.id}">
            ${lauf ? 'Meisterschaftslauf starten' : 'Rennen starten'}</button>
        </div>`
        : `<p class="kar-hinweis">Kein Rennen verfügbar. Sieh im Rennkalender nach, was dir zum
           Freischalten fehlt – oder kaufe ein stärkeres Fahrzeug.</p>`}
      ${k.saisonAbschliessbar() ? `
        <div class="kar-karte">
          <div class="kar-k-titel">Saison ${k.state.season.number} abschließen</div>
          <div class="kar-k-text">Bonus kassieren und in die nächste Saison starten.
          Fahrzeuge, Geld, Level, Ruf und Statistik bleiben erhalten.</div>
          <button class="kar-btn" data-akt="saison">Saison abschließen</button>
        </div>` : ''}`;
  }

  viewKalender() {
    const eintraege = this.karriere.events.uebersicht();
    return `<h2>Rennkalender</h2>
      <div class="kar-liste">
        ${eintraege.map((e) => `
          <div class="kar-karte ${e.frei ? '' : 'gesperrt'}">
            <div class="kar-k-titel">${esc(e.def.name)}
              <span class="kar-typ">${esc(e.typName)}</span>
              ${e.erledigt ? '<span class="kar-fertig">✓ absolviert</span>' : ''}</div>
            <div class="kar-k-text">${esc(this.trackName(e.def.strecke))} · ${e.def.runden} Runden ·
              ${e.def.gegner} Gegner${e.def.startgeld ? ` · Startgeld ${geld(e.def.startgeld)}` : ''}</div>
            <div class="kar-k-preis">Preisgeld: ${Object.entries(e.def.preisgeld)
              .slice(0, 3).map(([pl, g]) => `${pl}. ${geld(g)}`).join(' · ')}</div>
            ${e.frei
              ? `<button class="kar-btn gut" data-akt="event" data-id="${e.def.id}"
                   ${e.bezahlbar ? '' : 'disabled'}>${e.bezahlbar ? 'Starten' : 'Startgeld fehlt'}</button>`
              : `<div class="kar-sperre">🔒 ${e.fehlt.map(esc).join(' · ')}</div>`}
          </div>`).join('')}
      </div>`;
  }

  viewGarage() {
    const k = this.karriere;
    return `<h2>Garage</h2>
      <div class="kar-liste">
        ${k.garage.alle().map((f) => {
          const d = fahrzeugDef(f.def);
          const aktiv = f.id === k.state.garage.aktiv;
          const rep = k.economy.reparaturKosten(f);
          return `<div class="kar-karte ${aktiv ? 'aktiv' : ''}">
            <div class="kar-k-titel">${esc(d.name)} <span class="kar-klasse k-${d.klasse}">${d.klasse}</span>
              ${aktiv ? '<span class="kar-fertig">im Einsatz</span>' : ''}</div>
            <div class="kar-k-text">
              ${f.km.toFixed(0)} km · ${f.rennen} Rennen · ${f.siege} Siege · ${f.podien} Podien<br>
              Zustand ${f.zustand.toFixed(0)} % · Wert ${geld(k.garage.wert(f))}</div>
            <div class="kar-zustand"><i style="width:${f.zustand.toFixed(0)}%"></i></div>
            <div class="kar-knopfreihe">
              ${aktiv ? '' : `<button class="kar-btn" data-akt="waehlen" data-id="${f.id}">Einsetzen</button>`}
              ${rep > 0 ? `<button class="kar-btn" data-akt="reparieren" data-id="${f.id}">Reparieren (${geld(rep)})</button>` : ''}
              ${k.garage.alle().length > 1 ? `<button class="kar-btn schlecht" data-akt="verkaufen" data-id="${f.id}">Verkaufen</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  viewKaufen() {
    return `<h2>Fahrzeug kaufen</h2>
      <p class="kar-hinweis">Klassen: ${KLASSEN.map((k) => `<span class="kar-klasse k-${k.id}">${k.id}</span> ${esc(k.name)}`).join(' · ')}</p>
      <div class="kar-liste">
        ${this.karriere.fahrzeugAngebot().map((a) => `
          <div class="kar-karte ${a.frei ? '' : 'gesperrt'}">
            <div class="kar-k-titel">${esc(a.def.name)}
              <span class="kar-klasse k-${a.def.klasse}">${a.def.klasse}</span>
              ${a.besessen ? '<span class="kar-fertig">✓ in der Garage</span>' : ''}</div>
            <div class="kar-k-text">${esc(a.def.beschreibung)}</div>
            <div class="kar-k-preis">${a.def.preis ? geld(a.def.preis) : 'Startfahrzeug'}</div>
            ${a.besessen ? ''
              : a.frei
                ? `<button class="kar-btn gut" data-akt="kaufen" data-id="${a.def.id}"
                     ${a.bezahlbar ? '' : 'disabled'}>${a.bezahlbar ? 'Kaufen' : 'Nicht genug Geld'}</button>`
                : `<div class="kar-sperre">🔒 ${a.fehlt.map(esc).join(' · ')}</div>`}
          </div>`).join('')}
      </div>`;
  }

  viewUpgrade() {
    const k = this.karriere;
    const f = k.garage.aktiv();
    if (!f) return '<h2>Fahrzeug verbessern</h2><p class="kar-hinweis">Kein Fahrzeug im Einsatz.</p>';
    const d = fahrzeugDef(f.def);
    return `<h2>Fahrzeug verbessern</h2>
      <p class="kar-hinweis">${esc(d.name)} — jede Stufe verändert die Fahrphysik wirklich.</p>
      <div class="kar-liste">
        ${UPGRADES.map((u) => {
          const st = k.upgrades.stufe(f, u.id);
          const preis = k.upgrades.naechsteStufePreis(f, u.id);
          return `<div class="kar-karte">
            <div class="kar-k-titel">${esc(u.name)}
              <span class="kar-stufen">${'●'.repeat(st)}${'○'.repeat(u.stufen.length - st)}</span></div>
            <div class="kar-k-text">${esc(u.beschreibung)}</div>
            ${preis === null
              ? '<div class="kar-fertig">Höchste Stufe erreicht</div>'
              : `<button class="kar-btn gut" data-akt="upgrade" data-id="${u.id}"
                   ${k.economy.kannZahlen(preis) ? '' : 'disabled'}>Stufe ${st + 1} — ${geld(preis)}</button>`}
          </div>`;
        }).join('')}
      </div>`;
  }

  viewProfil() {
    const k = this.karriere, p = k.state.player;
    const bisLevel = k.player.xpBisLevelup();
    return `<h2>Fahrerprofil</h2>
      <table class="kar-tabelle">
        <tr><td>Name</td><td>${esc(p.name)}</td></tr>
        <tr><td>Titel</td><td>${esc(k.player.titel)}</td></tr>
        <tr><td>Level</td><td>${p.level} von ${MAX_LEVEL}</td></tr>
        <tr><td>Erfahrung</td><td>${p.xp.toLocaleString('de-DE')} XP${p.level < MAX_LEVEL
          ? ` — noch ${bisLevel.toLocaleString('de-DE')} bis Level ${p.level + 1}` : ''}</td></tr>
        <tr><td>Reputation</td><td>${p.reputation}</td></tr>
        <tr><td>Konto</td><td>${geld(p.money)}</td></tr>
        <tr><td>Saison</td><td>${k.state.season.number}</td></tr>
        <tr><td>Fahrzeuge</td><td>${k.garage.alle().length}</td></tr>
      </table>
      <h3>Gegner der Karriere</h3>
      <table class="kar-tabelle">
        ${k.ai.alle().map((f) => `<tr><td>${esc(f.name)}</td>
          <td>Tempo ${(f.skill * 100).toFixed(0)} · Konstanz ${(f.konstanz * 100).toFixed(0)} ·
              Aggressivität ${(f.aggressiv * 100).toFixed(0)} · Fehlerquote ${(f.fehler * 100).toFixed(0)}</td></tr>`).join('')}
      </table>`;
  }

  viewStatistik() {
    const s = this.karriere.stats;
    const st = s.st;
    const zeile = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    return `<h2>Statistik</h2>
      <table class="kar-tabelle">
        ${zeile('Rennen', st.rennen)}
        ${zeile('Siege', st.siege)}
        ${zeile('Podiumsplätze', st.podien)}
        ${zeile('Pole Positions', st.poles)}
        ${zeile('Schnellste Runden', st.schnellsteRunden)}
        ${zeile('Meisterschaftssiege', st.meisterschaftsSiege)}
        ${zeile('Durchschnittliche Platzierung', st.rennen ? s.durchschnittsPlatz().toFixed(2) : '—')}
        ${zeile('Gefahrene Kilometer', st.kilometer.toFixed(1))}
        ${zeile('Höchstgeschwindigkeit', `${st.hoechstesTempo.toFixed(0)} km/h`)}
        ${zeile('Verdientes Geld', geld(st.verdient))}
        ${zeile('Ausgegebenes Geld', geld(st.ausgegeben))}
        ${zeile('Gekaufte Fahrzeuge', st.gekaufteFahrzeuge)}
        ${zeile('Beste Rennserie', s.besteSerie() ? esc(s.besteSerie()) : '—')}
      </table>`;
  }

  viewMeisterschaft() {
    const k = this.karriere;
    const laufend = k.championships.aktuelle();
    let html = '<h2>Meisterschaften</h2>';
    if (laufend) {
      const m = MEISTERSCHAFTEN.find((x) => x.id === laufend.id);
      html += `<div class="kar-karte aktiv">
        <div class="kar-k-titel">${esc(m.name)} — Lauf ${laufend.lauf + 1} von ${m.laeufe.length}</div>
        <table class="kar-tabelle">
          ${k.championships.tabelle().map((r, i) => `<tr class="${r.id === 'spieler' ? 'ich' : ''}">
            <td>${i + 1}.</td><td>${esc(r.name)}</td><td>${r.punkte} Punkte</td></tr>`).join('')}
        </table>
        <div class="kar-knopfreihe">
          <button class="kar-btn gut" data-akt="meisterlauf">Nächsten Lauf starten</button>
          <button class="kar-btn schlecht" data-akt="meisterabbruch">Meisterschaft abbrechen</button>
        </div></div>`;
    }
    html += `<div class="kar-liste">
      ${k.championships.uebersicht().map((m) => `
        <div class="kar-karte ${m.frei ? '' : 'gesperrt'}">
          <div class="kar-k-titel">${esc(m.def.name)}
            ${m.absolviert ? `<span class="kar-fertig">${m.absolviert}× gefahren</span>` : ''}</div>
          <div class="kar-k-text">${m.def.laeufe.length} Läufe ·
            ${m.def.laeufe.map((l) => esc(this.trackName(l.strecke))).join(', ')}</div>
          <div class="kar-k-preis">Startgeld ${geld(m.def.startgeld)} · Titelprämie ${geld(m.def.siegPreis)}</div>
          ${m.frei
            ? (laufend ? '' : `<button class="kar-btn gut" data-akt="meisterstart" data-id="${m.def.id}">Meisterschaft starten</button>`)
            : `<div class="kar-sperre">🔒 ${m.fehlt.map(esc).join(' · ')}</div>`}
        </div>`).join('')}
    </div>`;
    return html;
  }

  viewSpeichern() {
    return `<h2>Speichern / Laden</h2>
      <p class="kar-hinweis">Die Karriere wird nach jedem Rennen und jedem Kauf automatisch
      im Browser gespeichert.</p>
      <div class="kar-knopfreihe">
        <button class="kar-btn gut" data-akt="speichern">Jetzt speichern</button>
        <button class="kar-btn" data-akt="laden">Vom Speicherstand laden</button>
        <button class="kar-btn schlecht" data-akt="loeschen">Karriere löschen</button>
      </div>
      <div id="kar-meldung" class="kar-meldung"></div>`;
  }

  viewEnde() {
    return `<h2>Zurück zum Hauptmenü</h2>
      <p class="kar-hinweis">Der Fortschritt ist gespeichert.</p>
      <button class="kar-btn" data-akt="verlassen">Hauptmenü</button>`;
  }

  // ------------------------------------------------------------------ Klicks
  klick(e) {
    const b = e.target.closest('button[data-akt]');
    if (!b || b.disabled) return;
    const k = this.karriere;
    const id = b.dataset.id;
    const melde = (t, gut) => {
      const m = this.inhaltEl.querySelector('#kar-meldung');
      if (m) { m.textContent = t; m.className = `kar-meldung ${gut ? 'gut' : 'schlecht'}`; }
      else alert(t);
    };
    switch (b.dataset.akt) {
      case 'neu': {
        const name = this.inhaltEl.querySelector('#kar-name')?.value || 'Fahrer';
        k.neu(name, id);
        this.ansicht = 'haupt'; this.zeichnen();
        break;
      }
      case 'abbrechen': this.ansicht = 'haupt'; this.zeichnen(); break;
      case 'event': {
        const r = k.events.starten(id);
        if (!r.ok) { alert(r.grund); this.zeichnen(); return; }
        this.rennenStarten(r.rennen);
        break;
      }
      case 'meisterstart': {
        const r = k.championships.starten(id);
        if (!r.ok) { alert(r.grund); return; }
        k.speichern(); this.zeichnen();
        break;
      }
      case 'meisterlauf': {
        const lauf = k.championships.naechsterLauf();
        if (!lauf) { alert('Kein Lauf offen'); return; }
        this.rennenStarten(lauf);
        break;
      }
      case 'meisterabbruch':
        if (confirm('Laufende Meisterschaft wirklich abbrechen? Die Punkte verfallen.')) {
          k.championships.abbrechen(); k.speichern(); this.zeichnen();
        }
        break;
      case 'waehlen': k.garage.waehlen(id); k.speichern(); this.zeichnen(); break;
      case 'reparieren': { const r = k.garage.reparieren(id); if (!r.ok) alert(r.grund); k.speichern(); this.zeichnen(); break; }
      case 'verkaufen': {
        const r = k.garage.verkaufen(id);
        if (!r.ok) alert(r.grund); else k.speichern();
        this.zeichnen(); break;
      }
      case 'kaufen': { const r = k.fahrzeugKaufen(id); if (!r.ok) alert(r.grund); this.zeichnen(); break; }
      case 'upgrade': {
        const f = k.garage.aktiv();
        if (!f) { alert('Kein Fahrzeug im Einsatz'); return; }
        const r = k.upgrades.kaufen(f.id, id);
        if (!r.ok) alert(r.grund); else k.speichern();
        this.zeichnen(); break;
      }
      case 'saison': { const r = k.saisonAbschliessen(); if (!r.ok) alert(r.grund); this.zeichnen(); break; }
      case 'speichern': {
        const ok = k.speichern();
        melde(ok ? 'Gespeichert.' : 'Speichern fehlgeschlagen.', ok);
        break;
      }
      case 'laden': {
        const geladen = k.save.laden();
        if (geladen) { k.state = geladen; k.verdrahten(); }
        // erst neu zeichnen, dann melden – sonst überschreibt das Neuzeichnen die Meldung
        this.zeichnen();
        melde(geladen ? 'Geladen.' : 'Kein Speicherstand gefunden.', !!geladen);
        break;
      }
      case 'loeschen':
        if (confirm('Karriere wirklich löschen? Das lässt sich nicht rückgängig machen.')) {
          k.loeschen(); this.ansicht = 'neu'; this.zeichnen();
        }
        break;
      case 'verlassen': this.verbergen(); this.onExit?.(); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ Rennablauf
  rennenStarten(rennen) {
    this.aktivesRennen = rennen;
    // Gegnerfeld aus den persistenten KI-Fahrern ableiten
    const feld = (rennen.fahrer
      ? rennen.fahrer.map((id) => this.karriere.ai.alle().find((f) => f.id === id)).filter(Boolean)
      : this.karriere.ai.feld(rennen.gegner));
    rennen.gegnerWerte = feld.map((f) =>
      this.karriere.ai.botWerte(f, rennen.gegnerStaerke, this.karriere.state.player.level));
    this.verbergen();
    this.onRaceStart?.(rennen, this.karriere.physikFaktoren());
  }

  // Von main.js aufgerufen, sobald ein Karriere-Rennen zu Ende ist
  rennenBeendet(ergebnis) {
    // Ohne bekanntes Rennen gibt es nichts zu verbuchen – der Spieler darf aber
    // nicht ohne Bildschirm auf der Strecke stehen bleiben.
    if (!this.aktivesRennen) { this.zeigen(); return null; }
    const rennen = this.aktivesRennen;
    this.aktivesRennen = null;
    const bericht = this.karriere.rennenAuswerten(rennen, ergebnis);
    this.zeigen();
    this.berichtZeigen(rennen, ergebnis, bericht);
    return bericht;
  }

  berichtZeigen(rennen, ergebnis, b) {
    const m = b.meisterschaft;
    const posten = b.posten.map((p) => `<tr><td>${esc(p.was)}</td><td>+${p.xp} XP</td></tr>`).join('');
    this.inhaltEl.innerHTML = `
      <h2>${esc(rennen.name)} — Platz ${ergebnis.platz} von ${(rennen.gegner || 5) + 1}</h2>
      <table class="kar-tabelle">
        ${posten}
        <tr class="ich"><td><b>Erfahrung gesamt</b></td><td><b>+${b.xp} XP</b></td></tr>
        <tr class="ich"><td><b>Preisgeld</b></td><td><b>${geld(b.geld)}</b></td></tr>
        <tr class="ich"><td><b>Reputation</b></td><td><b>${b.reputation >= 0 ? '+' : ''}${b.reputation}</b></td></tr>
      </table>
      ${b.levelUp?.aufgestiegen
        ? `<div class="kar-karte aktiv"><div class="kar-k-titel">Level ${b.levelUp.levelNachher} erreicht!</div>
           <div class="kar-k-text">Neue Events und Fahrzeuge können jetzt freigeschaltet sein.</div></div>` : ''}
      ${m && m.fertig
        ? `<div class="kar-karte aktiv"><div class="kar-k-titel">${esc(m.abschluss.name)} beendet — Platz ${m.position}</div>
           <table class="kar-tabelle">${m.abschluss.tabelle.map((r, i) =>
             `<tr class="${r.id === 'spieler' ? 'ich' : ''}"><td>${i + 1}.</td><td>${esc(r.name)}</td><td>${r.punkte}</td></tr>`).join('')}
           </table></div>`
        : m ? `<div class="kar-karte"><div class="kar-k-titel">Meisterschaftsstand</div>
           <table class="kar-tabelle">${m.stand.map((r, i) =>
             `<tr class="${r.id === 'spieler' ? 'ich' : ''}"><td>${i + 1}.</td><td>${esc(r.name)}</td><td>${r.punkte}</td></tr>`).join('')}
           </table></div>` : ''}
      <button class="kar-btn gut" data-akt="weiter">Weiter</button>`;
    this.inhaltEl.querySelector('[data-akt="weiter"]')
      ?.addEventListener('click', () => { this.ansicht = 'haupt'; this.zeichnen(); });
  }
}
