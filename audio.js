// Prozeduraler Motorsound (Web Audio API) im Charakter des BMW M4 GT3 EVO
// (P58-Rennmotor, 3,0-l-R6-Biturbo mit Rennauspuff). Echte, urheberrechtlich
// geschützte BMW-Aufnahmen können nicht mitgeliefert werden – der Klang wird
// daher synthetisiert und reagiert live auf Drehzahl, Gas und Gangwechsel:
//   • Drehzahl  → Tonhöhe & Klangfarbe (höheres Drehband, härter/rauer als das Serienauto)
//   • Gas       → Lautstärke & Härte
//   • Hochschalten   → harte Zündunterbrechung + lauter Auspuffknall (sequenzielles Getriebe)
//   • Runterschalten → Zwischengas-Stoß (Drehzahl springt kurz hoch)
//   • Gaswegnehmen   → Auspuff-Crackles (Knistern/Knallen aus den Endrohren)

let ctx = null;
let master, filter, engineGain, noiseGain, noiseFilter;
let rumpelGain = null, rumpelOsc = null, rumpelTakt = null;
const oscs = []; // { o, mult }
let started = false;
let enabled = false;

let curRev = 0; // geglättete Drehzahl 0…1
let blip = 0;   // Zwischengas-Hüllkurve (Runterschalten)
let cut = 0;    // Zündunterbrechungs-Hüllkurve (Hochschalten)

const IDLE_HZ = 58;     // Grundfrequenz im Leerlauf (Rennmotor läuft höher)
const REDLINE_HZ = 265; // Grundfrequenz am Begrenzer (P58 dreht höher)

export function setEnabled(on) {
  enabled = on;
  if (on) { ensure(); resume(); }
  if (master) master.gain.setTargetAtTime(on ? 0.85 : 0.0001, ctx.currentTime, 0.05);
}

export function resume() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function ensure() {
  if (started) return;
  started = true;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  filter = ctx.createBiquadFilter(); // öffnet mit der Drehzahl → "Aufheulen"
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 0.8;
  filter.connect(master);

  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineGain.connect(filter);

  // Harmonische: GT3-Rennauspuff – weniger Sub-Brummen, dafür deutlich mehr
  // Obertöne (Sägezahn/Quadrat) für den harten, metallisch-rauen Rennton
  const harmonics = [
    { mult: 0.5, gain: 0.28, type: 'sine' },     // etwas Sub (offener Rennauspuff)
    { mult: 1.0, gain: 0.55, type: 'sawtooth' }, // Grundton, kräftig
    { mult: 2.0, gain: 0.42, type: 'sawtooth' }, // aggressive 2. Ordnung
    { mult: 3.0, gain: 0.30, type: 'square' },   // metallischer Biss
    { mult: 4.5, gain: 0.16, type: 'square' },   // Kreissägen-Schärfe obenraus
  ];
  for (const h of harmonics) {
    const o = ctx.createOscillator();
    o.type = h.type;
    o.frequency.value = IDLE_HZ * h.mult;
    const g = ctx.createGain();
    g.gain.value = h.gain;
    o.connect(g); g.connect(engineGain);
    o.start();
    oscs.push({ o, mult: h.mult });
  }

  // Verbrennungs-/Auspuffrauschen für Textur
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = buf;
  noiseSrc.loop = true;
  noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 800;
  noiseFilter.Q.value = 0.7;
  noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  noiseSrc.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(engineGain);
  noiseSrc.start();

  // Reifenschaden: dumpfes, langsames Rumpeln. Ein tiefer Oszillator wird von
  // einem zweiten, sehr langsamen moduliert – das ergibt das Wummern eines
  // unrund laufenden Rades statt eines gleichmaessigen Brummens.
  rumpelGain = ctx.createGain();
  rumpelGain.gain.value = 0;
  const rumpelFilter = ctx.createBiquadFilter();
  rumpelFilter.type = 'lowpass'; rumpelFilter.frequency.value = 220;
  rumpelOsc = ctx.createOscillator();
  rumpelOsc.type = 'sawtooth';
  rumpelOsc.frequency.value = 28;
  const takt = ctx.createOscillator();      // Umlauftakt des Rades
  takt.type = 'sine'; takt.frequency.value = 6;
  const taktGain = ctx.createGain(); taktGain.gain.value = 0.6;
  takt.connect(taktGain); taktGain.connect(rumpelGain.gain);
  rumpelOsc.connect(rumpelFilter); rumpelFilter.connect(rumpelGain); rumpelGain.connect(master);
  rumpelOsc.start(); takt.start();
  rumpelTakt = takt;
}

// Jeden Frame aufrufen: targetRev 0…1, throttle 0…1, dt in Sekunden
export function update(targetRev, throttle, dt) {
  if (!enabled || !ctx) return;
  // Drehzahl weich nachführen – beim Gasgeben schneller hoch als beim Rollen runter
  const rate = targetRev > curRev ? 6 : 3;
  curRev += (targetRev - curRev) * Math.min(1, rate * dt);
  blip = Math.max(0, blip - dt * 3.5);
  cut = Math.max(0, cut - dt * 9);

  const rev = Math.min(1, curRev + blip * 0.5); // Zwischengas hebt die Drehzahl kurz an
  const t = ctx.currentTime;
  const fund = IDLE_HZ + (REDLINE_HZ - IDLE_HZ) * rev;
  for (const e of oscs) e.o.frequency.setTargetAtTime(fund * e.mult, t, 0.02);

  const load = 0.4 + 0.6 * throttle;
  const vol = (0.2 + 0.55 * rev) * load * (1 - 0.9 * cut); // Zündunterbrechung senkt Pegel hart
  engineGain.gain.setTargetAtTime(vol, t, 0.025);
  filter.frequency.setTargetAtTime(650 + 6200 * rev, t, 0.025); // Rennauspuff: Filter öffnet weiter
  noiseGain.gain.setTargetAtTime((0.07 + 0.32 * rev) * load * (1 - cut), t, 0.03);
  noiseFilter.frequency.setTargetAtTime(900 + 3200 * rev, t, 0.05);
}

export function upshift() {
  if (!enabled || !ctx) return;
  cut = 1;            // harte Zündunterbrechung (sequenzielles Getriebe) → "BANG"
  exhaustPop(0.75);   // lauter Auspuffknall
}

export function downshift() {
  if (!enabled || !ctx) return;
  blip = 1;           // Zwischengas → Drehzahl springt kurz hoch
  exhaustPop(0.4);
}

// Auspuff-Crackles beim Gaswegnehmen: mehrere kleine, versetzte Knaller/Knistern
export function crackle() {
  if (!enabled || !ctx) return;
  const n = 2 + Math.floor(Math.random() * 3); // 2…4 Pops
  for (let i = 0; i < n; i++) {
    setTimeout(() => { if (enabled && ctx) exhaustPop(0.2 + Math.random() * 0.3); }, i * (60 + Math.random() * 110));
  }
}

// Kurzer Auspuffknall: tiefer Ton + gefilterter Rauschimpuls
function exhaustPop(amp) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(65, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(amp, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.2);

  const len = Math.floor(ctx.sampleRate * 0.18);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const nb = ctx.createBufferSource();
  nb.buffer = buf;
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass'; nf.frequency.value = 2200; nf.Q.value = 0.9;
  const ng = ctx.createGain(); ng.gain.value = amp * 0.6;
  nb.connect(nf); nf.connect(ng); ng.connect(master);
  nb.start(t);
}

// Reifenschaden hoerbar machen: staerke 0…1, tempo in m/s.
// Der Umlauftakt steigt mit dem Tempo – ein Platten schlaegt schneller, je
// schneller man faehrt.
export function setReifenSchaden(staerke, tempo) {
  if (!enabled || !ctx || !rumpelGain) return;
  const t = ctx.currentTime;
  const pegel = Math.min(1, Math.max(0, staerke)) * Math.min(1, tempo / 22);
  rumpelGain.gain.setTargetAtTime(pegel * 0.55, t, 0.12);
  if (pegel > 0.001) {
    rumpelOsc.frequency.setTargetAtTime(24 + tempo * 0.9, t, 0.15);
    rumpelTakt.frequency.setTargetAtTime(Math.max(1.5, tempo * 0.55), t, 0.15);
  }
}
