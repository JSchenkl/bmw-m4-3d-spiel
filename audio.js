// Prozeduraler Motorsound (Web Audio API) im Charakter eines sportlichen
// Reihensechszylinders (BMW M4, S58). Echte, urheberrechtlich geschützte
// BMW-Aufnahmen können nicht mitgeliefert werden – der Klang wird daher
// synthetisiert und reagiert live auf Drehzahl, Gas und Gangwechsel:
//   • Drehzahl  → Tonhöhe & Klangfarbe
//   • Gas       → Lautstärke & Härte
//   • Hochschalten   → kurze Zündunterbrechung + Auspuffknall
//   • Runterschalten → Zwischengas-Stoß (Drehzahl springt kurz hoch)

let ctx = null;
let master, filter, engineGain, noiseGain, noiseFilter;
const oscs = []; // { o, mult }
let started = false;
let enabled = false;

let curRev = 0; // geglättete Drehzahl 0…1
let blip = 0;   // Zwischengas-Hüllkurve (Runterschalten)
let cut = 0;    // Zündunterbrechungs-Hüllkurve (Hochschalten)

const IDLE_HZ = 50;     // Grundfrequenz im Leerlauf
const REDLINE_HZ = 235; // Grundfrequenz am Begrenzer

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

  // Harmonische: Sägezähne + Quadrat für den kernigen Reihensechser-Ton, Sinus als Sub
  const harmonics = [
    { mult: 0.5, gain: 0.40, type: 'sine' },     // sattes Brummen (Auspuff)
    { mult: 1.0, gain: 0.50, type: 'sawtooth' }, // Grundton
    { mult: 2.0, gain: 0.30, type: 'sawtooth' },
    { mult: 3.0, gain: 0.20, type: 'square' },   // metallischer Biss
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

  const load = 0.35 + 0.65 * throttle;
  const vol = (0.18 + 0.5 * rev) * load * (1 - 0.85 * cut); // Zündunterbrechung senkt Pegel
  engineGain.gain.setTargetAtTime(vol, t, 0.03);
  filter.frequency.setTargetAtTime(500 + 4500 * rev, t, 0.03);
  noiseGain.gain.setTargetAtTime((0.05 + 0.25 * rev) * load * (1 - cut), t, 0.03);
  noiseFilter.frequency.setTargetAtTime(700 + 2500 * rev, t, 0.05);
}

export function upshift() {
  if (!enabled || !ctx) return;
  cut = 1;            // kurze Zündunterbrechung → "Bup"
  exhaustPop(0.55);   // Auspuffknall
}

export function downshift() {
  if (!enabled || !ctx) return;
  blip = 1;           // Zwischengas → Drehzahl springt kurz hoch
  exhaustPop(0.3);
}

// Aufprall-/Crash-Geräusch: dumpfer Schlag (tiefer Ton) + metallisches Rausch-Krachen.
// amp 0…1 skaliert die Härte des Einschlags (leichtes Schrammen leise, Frontal-Crash laut).
export function crash(amp = 1) {
  if (!enabled || !ctx) return;
  amp = Math.max(0.15, Math.min(1, amp));
  const t = ctx.currentTime;

  // 1) Dumpfer Schlag – Körper des Aufpralls (tiefer Ton, der schnell abfällt)
  const o = ctx.createOscillator();
  const og = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(amp * 0.95, t + 0.006);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(og); og.connect(master);
  o.start(t); o.stop(t + 0.34);

  // 2) Metallisches Krachen/Bersten – gefiltertes Rauschen mit schnellem Abfall
  const len = Math.floor(ctx.sampleRate * 0.36);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
  const nb = ctx.createBufferSource();
  nb.buffer = buf;
  const nf = ctx.createBiquadFilter();
  nf.type = 'highpass'; nf.frequency.value = 1100; nf.Q.value = 0.6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(amp * 0.85, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  nb.connect(nf); nf.connect(ng); ng.connect(master);
  nb.start(t);
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
