import * as THREE from 'three';

// Baut die Spa-Francorchamps-Strecke aus den echten Vermessungsdaten
// (TUM racetrack-database: Mittellinie x/y in Metern + Fahrbahnbreite links/rechts).
// Rückgabe: { group, pitDirection } — die Gruppe ist so verschoben, dass der
// Startplatz in der Boxengasse genau im Ursprung (0/0/0) liegt.

const ASPHALT_Y = 0.05;   // Fahrbahn liegt minimal über dem Gras (gegen Z-Fighting)
const LINE_Y = 0.07;
const PIT_Y = 0.06;
const PIT_OFFSET = 15;    // Abstand der Boxengasse von der Streckenmitte
const PIT_HALF_WIDTH = 3.5;
const PIT_BEFORE = 350;   // Boxengassen-Länge vor der Start/Ziel-Linie (Meter)
const PIT_AFTER = 300;    // … und danach

// Dreiecksband zwischen zwei gleichlangen Punktreihen (links/rechts)
function buildStrip(left, right, y, closed) {
  const n = left.length;
  const positions = [];
  const normals = [];
  for (let i = 0; i < n; i++) {
    positions.push(left[i].x, y, left[i].z, right[i].x, y, right[i].z);
    normals.push(0, 1, 0, 0, 1, 0);
  }
  const indices = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = 2 * i, b = 2 * i + 1, c = 2 * ((i + 1) % n), d = 2 * ((i + 1) % n) + 1;
    indices.push(a, b, c, b, d, c); // so gewickelt, dass die Flächen nach oben zeigen
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

export async function createTrack(file) {
  const text = await (await fetch(file)).text();
  const rows = text.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(',').map(Number));

  // CSV: x nach Osten, y nach Norden → three.js: x, z = -y (damit nichts gespiegelt ist)
  const pts = rows.map(([x, y]) => new THREE.Vector3(x, 0, -y));
  const wRight = rows.map((r) => r[2]);
  const wLeft = rows.map((r) => r[3]);
  const n = pts.length;

  // Tangenten (zentrale Differenz, geschlossene Runde) und Quernormalen
  const tangents = [];
  const leftNs = [];
  for (let i = 0; i < n; i++) {
    const t = pts[(i + 1) % n].clone().sub(pts[(i - 1 + n) % n]).setY(0).normalize();
    tangents.push(t);
    leftNs.push(new THREE.Vector3(t.z, 0, -t.x)); // links der Fahrtrichtung
  }

  // Kumulierte Bogenlänge
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = s[n - 1] + pts[0].distanceTo(pts[n - 1]);

  const group = new THREE.Group();

  // Kollisionsboxen (2D, auf den Boden projiziert) für Mauern und Gebäude:
  // { cx, cz: Mittelpunkt, ax, az: Einheitsvektor der Längsachse, halfLen, halfWid }
  const colliders = [];

  // --- Asphaltband der Strecke ---
  const leftEdge = pts.map((p, i) => p.clone().addScaledVector(leftNs[i], wLeft[i]));
  const rightEdge = pts.map((p, i) => p.clone().addScaledVector(leftNs[i], -wRight[i]));
  const asphaltMat = new THREE.MeshStandardMaterial({ color: 0x3c3c40, roughness: 0.95, side: THREE.DoubleSide });
  const asphalt = new THREE.Mesh(buildStrip(leftEdge, rightEdge, ASPHALT_Y, true), asphaltMat);
  asphalt.receiveShadow = true;
  group.add(asphalt);

  // --- Weiße Randlinien ---
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.8, side: THREE.DoubleSide });
  const leftIn = pts.map((p, i) => p.clone().addScaledVector(leftNs[i], wLeft[i] - 0.35));
  const rightIn = pts.map((p, i) => p.clone().addScaledVector(leftNs[i], -(wRight[i] - 0.35)));
  group.add(new THREE.Mesh(buildStrip(leftEdge, leftIn, LINE_Y, true), lineMat));
  group.add(new THREE.Mesh(buildStrip(rightIn, rightEdge, LINE_Y, true), lineMat));

  // --- Rot-weiße Curbs entlang der GESAMTEN Strecke (beidseitig) ---
  const CURB_WIDTH = 1.3;
  const CURB_Y = 0.13;          // Randsteine liegen leicht erhöht über dem Asphalt (0.05)
  const CURB_BLOCK = 5;        // Meter pro Farbblock (rot/weiß)
  const extended = new Array(n).fill(true); // überall Randsteine, nicht nur in Kurven

  // Quads in zwei Farbbuffer einsammeln (ein Mesh pro Farbe statt vieler kleiner)
  const curbPos = { red: [], white: [] };
  const pushQuad = (buf, a, b, c, d) => {
    // a/b = innere, c/d = äußere Kante des Segments
    buf.push(a.x, CURB_Y, a.z, c.x, CURB_Y, c.z, b.x, CURB_Y, b.z);
    buf.push(b.x, CURB_Y, b.z, c.x, CURB_Y, c.z, d.x, CURB_Y, d.z);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!extended[i] || !extended[j]) continue;
    const color = Math.floor(s[i] / CURB_BLOCK) % 2 === 0 ? 'red' : 'white';
    for (const side of [1, -1]) {
      const wi = side === 1 ? wLeft[i] : wRight[i];
      const wj = side === 1 ? wLeft[j] : wRight[j];
      const a = pts[i].clone().addScaledVector(leftNs[i], side * wi);
      const b = pts[j].clone().addScaledVector(leftNs[j], side * wj);
      const c = pts[i].clone().addScaledVector(leftNs[i], side * (wi + CURB_WIDTH));
      const d = pts[j].clone().addScaledVector(leftNs[j], side * (wj + CURB_WIDTH));
      if (side === 1) pushQuad(curbPos[color], a, b, c, d);
      else pushQuad(curbPos[color], b, a, d, c); // Wicklung spiegeln → Fläche zeigt nach oben
    }
  }
  const curbColors = { red: 0xc62828, white: 0xf5f5f5 };
  for (const key of ['red', 'white']) {
    if (!curbPos[key].length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(curbPos[key], 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: curbColors[key], roughness: 0.75, side: THREE.DoubleSide,
    }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- Start/Ziel-Linie (am Datenpunkt 0) ---
  const sfA = [leftEdge[0], rightEdge[0]].map((p) => p.clone().addScaledVector(tangents[0], -2));
  const sfB = [leftEdge[0], rightEdge[0]].map((p) => p.clone().addScaledVector(tangents[0], 2));
  group.add(new THREE.Mesh(
    buildStrip([sfA[0], sfB[0]], [sfA[1], sfB[1]], LINE_Y + 0.01, false),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide })
  ));

  // --- Boxengasse: rechts neben der Strecke, rund um die Start/Ziel-Linie ---
  // Indizes einsammeln: die letzten PIT_BEFORE Meter der Runde + die ersten PIT_AFTER Meter
  const seq = [];
  for (let i = 0; i < n; i++) if (s[i] >= total - PIT_BEFORE) seq.push(i);
  let spawnSeqIdx = seq.length; // erster Punkt nach der Linie = Datenpunkt 0
  for (let i = 0; i < n; i++) if (s[i] <= PIT_AFTER) seq.push(i);

  // Bogenlänge innerhalb der Boxengasse (für sanftes Ein-/Ausfädeln)
  const pitArc = [0];
  for (let k = 1; k < seq.length; k++) {
    pitArc.push(pitArc[k - 1] + pts[seq[k]].distanceTo(pts[seq[k - 1]]));
  }
  const pitTotal = pitArc[pitArc.length - 1];
  const ramp = (a) => {
    const r = Math.min(1, a / 120, (pitTotal - a) / 120);
    return r * r * (3 - 2 * r); // smoothstep
  };

  const pitCenter = [];
  const pitDirs = [];
  for (let k = 0; k < seq.length; k++) {
    const i = seq[k];
    const off = PIT_OFFSET * ramp(pitArc[k]);
    pitCenter.push(pts[i].clone().addScaledVector(leftNs[i], -off)); // rechts = -links
    pitDirs.push(tangents[i]);
  }
  const pitLeft = pitCenter.map((p, k) => p.clone().addScaledVector(leftNs[seq[k]], PIT_HALF_WIDTH));
  const pitRight = pitCenter.map((p, k) => p.clone().addScaledVector(leftNs[seq[k]], -PIT_HALF_WIDTH));
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x2e2e33, roughness: 0.95, side: THREE.DoubleSide });
  const pit = new THREE.Mesh(buildStrip(pitLeft, pitRight, PIT_Y, false), pitMat);
  pit.receiveShadow = true;
  group.add(pit);

  // --- Boxengaragen: offene Häuser mit je 2 Stellplätzen, innen weiß ---
  // In jedem Stellplatz steht ein Auto – außer im Stellplatz des Spielers,
  // in dem der Spieler startet. Die offene Front zeigt zur Boxengasse.
  const garageOutMat = new THREE.MeshStandardMaterial({ color: 0x55565c, roughness: 0.85, side: THREE.DoubleSide });
  const garageWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.85, side: THREE.DoubleSide });
  const garageRoofMat = new THREE.MeshStandardMaterial({ color: 0x303138, roughness: 0.9 });
  const carPalette = [0xb01421, 0x163a6b, 0x1f5a3a, 0xd8d8db, 0x222831, 0xd0a000, 0x6b6f76, 0x8a1f24];

  // einfaches, leichtes Park-Auto (kein schweres GLB-Klonen für viele Boxen)
  function makeParkedCar(color) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 0.2, metalness: 0.2 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.4), paint); body.position.y = 0.6;
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.42, 4.2), paint); lower.position.y = 0.36;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.6, 2.1), glass); cabin.position.set(0, 1.05, -0.15);
    g.add(body, lower, cabin);
    for (const sx of [-1, 1]) for (const sz of [1.4, -1.4]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16), tire);
      w.rotation.z = Math.PI / 2; w.position.set(sx * 0.96, 0.34, sz); g.add(w);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  const GA_D = 7, GA_H = 4.5, WALL = 0.3, BAY = 3.25; // Tiefe, Höhe, Wandstärke, halbe Stellplatzbreite
  const houseW = 4 * BAY + 2 * WALL;                  // Hausbreite (2 Stellplätze)
  const D_front = PIT_OFFSET + PIT_HALF_WIDTH + 1.5;  // Vorderkante an der Gasse
  const D_mid = D_front + GA_D / 2, D_back = D_front + GA_D;

  const houseKs = [];
  for (let k = 0; k < seq.length; k++) if (ramp(pitArc[k]) >= 0.999 && k % 5 === 0) houseKs.push(k);
  let playerK = houseKs.length ? houseKs[0] : -1;     // Haus am nächsten zur Start/Ziel-Linie
  for (const k of houseKs) if (Math.abs(k - spawnSeqIdx) < Math.abs(playerK - spawnSeqIdx)) playerK = k;
  let garageSpawn = null, garageSpawnDir = null;

  for (const k of houseKs) {
    const i = seq[k];
    const t = tangents[i], nrm = leftNs[i];
    const angle = Math.atan2(t.x, t.z);                // lokal: z entlang Gasse, x quer
    const faceAng = Math.atan2(nrm.x, nrm.z);          // Blick zur Gasse (Front)
    // Welt-Position aus (u entlang Gasse, D quer nach außen = -nrm)
    const P = (u, D) => ({ x: pts[i].x + t.x * u - nrm.x * D, z: pts[i].z + t.z * u - nrm.z * D });
    const addBox = (u, D, y, sa, sd, h, mat) => {
      const p = P(u, D);
      const m = new THREE.Mesh(new THREE.BoxGeometry(sd, h, sa), mat); // x=quer, z=entlang
      m.position.set(p.x, y, p.z); m.rotation.y = angle;
      // Garagenstruktur wirft keinen Schatten → Innenraum (Spielerstart) bleibt hell
      m.castShadow = false; m.receiveShadow = true; group.add(m);
    };
    // weißer Boden, Rückwand, Seitenwände + Mitteltrennwand (innen weiß), dunkles Dach
    addBox(0, D_mid, 0.07, houseW, GA_D, 0.12, garageWhiteMat);
    addBox(0, D_back - WALL / 2, GA_H / 2, houseW, WALL, GA_H, garageWhiteMat);
    for (const u of [-houseW / 2 + WALL / 2, 0, houseW / 2 - WALL / 2]) addBox(u, D_mid, GA_H / 2, WALL, GA_D, GA_H, garageWhiteMat);
    addBox(0, D_mid, GA_H + 0.15, houseW + 0.6, GA_D + 0.6, 0.3, garageRoofMat);
    // Kollision nur an der Rückwand (offene Front bleibt befahrbar)
    const bw = P(0, D_back - 0.25);
    colliders.push({ cx: bw.x, cz: bw.z, ax: t.x, az: t.z, halfLen: houseW / 2, halfWid: 0.5 });

    // zwei Stellplätze (links/rechts der Mitteltrennwand): Auto hineinstellen – außer im Spieler-Stellplatz
    for (const [bi, u] of [[0, -BAY], [1, BAY]]) {
      if (k === playerK && bi === 1) {
        // Spieler startet etwas vorne im Stellplatz (Front zur Gasse), Abstand zur Rückwand
        const sp = P(u, D_front + 2.0);
        garageSpawn = new THREE.Vector3(sp.x, 0, sp.z); garageSpawnDir = nrm.clone();
        continue;
      }
      const bc = P(u, D_mid);
      const car = makeParkedCar(carPalette[(k + bi) % carPalette.length]);
      car.position.set(bc.x, 0, bc.z);
      car.rotation.y = faceAng;                        // Front zur Gasse
      group.add(car);
    }
  }

  // --- Boxenmauer zwischen Strecke und Boxengasse ---
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.8 });
  for (let k = 0; k < seq.length - 1; k++) {
    if (ramp(pitArc[k]) < 0.999 || ramp(pitArc[k + 1]) < 0.999) continue;
    const i = seq[k], j = seq[k + 1];
    const a = pts[i].clone().addScaledVector(leftNs[i], -(PIT_OFFSET - PIT_HALF_WIDTH - 1.5));
    const b = pts[j].clone().addScaledVector(leftNs[j], -(PIT_OFFSET - PIT_HALF_WIDTH - 1.5));
    const len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, len + 0.1), wallMat);
    wall.position.set(mid.x, 0.55, mid.z);
    wall.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    colliders.push({
      cx: mid.x, cz: mid.z,
      ax: (b.x - a.x) / len, az: (b.z - a.z) / len,
      halfLen: len / 2 + 0.05, halfWid: 0.2,
    });
  }

  // --- Auslaufzone: Gras + Kiesbett + Bande (außerhalb der Curbs; überschneidet die Strecke nicht) ---
  const GRASS_WIDTH = 50;      // Grasstreifen zwischen Curb-Außenkante und Kiesbett
  const GRAVEL_MAX = 15;       // maximale Kiesbett-Breite (offene Auslaufzonen, 2,5× vergrößert)
  const BARRIER_H = 1.1;       // Höhe der rot-weißen Rückwand hinter der Reifenwand
  const STRIPE = 6;            // Blocklänge des klassischen rot-weißen Musters (Meter)
  const SAFE = 1.5;            // Sicherheitsabstand zu anderen Streckenteilen
  // Reifenwand (gestapelte Reifen als 3D-Bande)
  const TIRE_R = 0.26, TIRE_TUBE = 0.12;          // Reifenradius + Wulststärke
  const TIRE_OUT = TIRE_R + TIRE_TUBE;            // Außenradius (~0.38 m)
  const TIRE_STEP = 1.2;                          // Reifenabstand entlang der Bande (m)
  const TIRE_ROWS = [TIRE_OUT, TIRE_OUT + 0.58];  // zwei Reihen übereinander
  const pitSet = new Set(seq); // Boxengassen-Bereich (Pit-Seite dort aussparen)
  let gravelL = null, gravelR = null;
  let grassL = null, grassR = null;
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x3a7d2c, roughness: 1, side: THREE.DoubleSide });
  const gravelMat = new THREE.MeshStandardMaterial({ color: 0xc9b489, roughness: 1, side: THREE.DoubleSide });
  const backRedMat = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.7, side: THREE.DoubleSide });
  const backWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7, side: THREE.DoubleSide });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.95 });
  const tireGeo = new THREE.TorusGeometry(TIRE_R, TIRE_TUBE, 6, 8);
  const tireMatrices = [];   // sammelt alle Reifen-Instanzen → eine InstancedMesh am Ende
  const _tQ = new THREE.Quaternion(), _tP = new THREE.Vector3(), _tA = new THREE.Vector3();
  const _tM = new THREE.Matrix4(), _tZ = new THREE.Vector3(0, 0, 1), _tONE = new THREE.Vector3(1, 1, 1);

  // Berechnet für jeden Streckenpunkt den sicheren Auslaufraum ab Curb-Außenkante.
  // Strahl startet am Curb-Rand in Richtung side*leftNs[i] und wird gestoppt,
  // bevor er einen anderen Streckenabschnitt (inkl. Curb + SAFE-Puffer) berührt.
  // Rückgabe: { grassW, gravelW } — beide Arrays, bereits geglättet.
  function computeRunoff(side, w) {
    const maxTotal = GRASS_WIDTH + GRAVEL_MAX;
    const raw = new Array(n);

    for (let i = 0; i < n; i++) {
      // Strahlursprung = Curb-Außenkante auf der gewählten Seite
      const origin = pts[i].clone().addScaledVector(leftNs[i], side * (w[i] + CURB_WIDTH));
      const dir = { x: side * leftNs[i].x, z: side * leftNs[i].z }; // nach außen

      let lim = maxTotal;
      for (let j = 0; j < n; j++) {
        // Nur Punkte überspringen, die auf derselben Geraden liegen (sehr nahe Nachbarn).
        // Punkte, die sich geometrisch nähern (z. B. Haarnadelkurven), werden NICHT übersprungen.
        let ad = Math.abs(s[i] - s[j]); ad = Math.min(ad, total - ad);
        if (ad < 15) continue;

        // Ausschlussradius: Streckenmitte ± Fahrbahnbreite + Curb + Sicherheitsabstand
        const R = Math.max(wLeft[j], wRight[j]) + CURB_WIDTH + SAFE;
        const rx = origin.x - pts[j].x, rz = origin.z - pts[j].z;

        // Schnelles Vorausfilter: zu weit weg, keine Überschneidung möglich
        if (rx * rx + rz * rz > (R + maxTotal) * (R + maxTotal)) continue;

        const b = dir.x * rx + dir.z * rz;
        const c = rx * rx + rz * rz - R * R;
        if (c < 0) { lim = 0; break; }   // Ursprung liegt schon im Sperrkreis → kein Auslauf
        const disc = b * b - c;
        if (disc <= 0) continue;
        const g1 = -b - Math.sqrt(disc);  // erster Eintritt in den Sperrkreis
        if (g1 >= 0 && g1 < lim) lim = g1;
      }
      raw[i] = Math.max(0, lim);
    }

    // Glätten: gleitendes Minimum (konservativ), dann Mittelwert (weiche Kante)
    const mn = raw.slice();
    for (let i = 0; i < n; i++) {
      let m = raw[i];
      for (let k = -3; k <= 3; k++) m = Math.min(m, raw[(i + k + n) % n]);
      mn[i] = m;
    }
    const sm = mn.slice();
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let k = -3; k <= 3; k++) a += mn[(i + k + n) % n];
      sm[i] = a / 7;
    }

    // Aufteilen in Gras (bis GRASS_WIDTH) und Kies (Rest, max GRAVEL_MAX)
    const grassW = sm.map(t => Math.min(GRASS_WIDTH, t));
    const gravelW = sm.map(t => Math.max(0, Math.min(GRAVEL_MAX, t - GRASS_WIDTH)));
    return { grassW, gravelW };
  }

  const mkGeo = (b) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setIndex(b.idx); g.computeVertexNormals(); return g;
  };

  for (const side of [1, -1]) {                // 1 = links, -1 = rechts (Boxengassenseite)
    const w = side === 1 ? wLeft : wRight;
    const { grassW, gravelW } = computeRunoff(side, w);
    const grassInner = pts.map((p, i) => p.clone().addScaledVector(leftNs[i], side * (w[i] + CURB_WIDTH)));
    const grassOuter = pts.map((p, i) => p.clone().addScaledVector(leftNs[i], side * (w[i] + CURB_WIDTH + grassW[i])));
    const inner = grassOuter; // Kiesbett beginnt an der Gras-Außenkante
    const outer = pts.map((p, i) => p.clone().addScaledVector(leftNs[i], side * (w[i] + CURB_WIDTH + grassW[i] + gravelW[i])));
    if (side === 1) { gravelL = gravelW; grassL = grassW; }
    else            { gravelR = gravelW; grassR = grassW; }

    // Segmentweise aufbauen, damit auf der Boxengassenseite der Pit-Bereich
    // ausgespart wird (sonst überschneiden Kies/Bande die Boxengasse & den Start).
    const grass = { pos: [], idx: [] };
    const gravel = { pos: [], idx: [] };
    const backRed = { pos: [], idx: [] }, backWhite = { pos: [], idx: [] };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (side === -1 && (pitSet.has(i) || pitSet.has(j))) continue; // Pit-Bereich frei lassen
      const gi = grassInner[i], gj = grassInner[j], goi = grassOuter[i], goj = grassOuter[j];
      const ai = inner[i], aj = inner[j], oi = outer[i], oj = outer[j];
      const gy = ASPHALT_Y + 0.003;
      // Gras-Fläche
      const ggo = grass.pos.length / 3;
      grass.pos.push(gi.x, gy, gi.z, goi.x, gy, goi.z, gj.x, gy, gj.z, goj.x, gy, goj.z);
      if (side === 1) grass.idx.push(ggo, ggo + 2, ggo + 1, ggo + 1, ggo + 2, ggo + 3);
      else grass.idx.push(ggo, ggo + 1, ggo + 2, ggo + 1, ggo + 3, ggo + 2);
      // Kiesbett-Fläche
      const go = gravel.pos.length / 3;
      gravel.pos.push(ai.x, gy + 0.002, ai.z, oi.x, gy + 0.002, oi.z, aj.x, gy + 0.002, aj.z, oj.x, gy + 0.002, oj.z);
      if (side === 1) gravel.idx.push(go, go + 2, go + 1, go + 1, go + 2, go + 3);
      else gravel.idx.push(go, go + 1, go + 2, go + 1, go + 3, go + 2);
      // rot-weiße Rückwand an der Kies-Außenkante (klassisches Muster, hinter den Reifen)
      const back = (Math.floor(s[i] / STRIPE) % 2 === 0) ? backRed : backWhite;
      const bo = back.pos.length / 3;
      back.pos.push(oi.x, ASPHALT_Y, oi.z, oi.x, BARRIER_H, oi.z, oj.x, ASPHALT_Y, oj.z, oj.x, BARRIER_H, oj.z);
      back.idx.push(bo, bo + 2, bo + 1, bo + 1, bo + 2, bo + 3);

      // Kollisionssegment exakt auf der Bande (je Segment, dünn) – folgt der Kurve.
      const clen = oi.distanceTo(oj);
      if (clen >= 0.01) {
        const dirx = (oj.x - oi.x) / clen, dirz = (oj.z - oi.z) / clen;
        const cmid = oi.clone().add(oj).multiplyScalar(0.5);
        colliders.push({ cx: cmid.x, cz: cmid.z, ax: dirx, az: dirz, halfLen: clen / 2 + 0.05, halfWid: 0.12 });
        // Reifen entlang des Segments verteilen (Reifenachse quer zur Bande, zwei Reihen)
        _tA.set(dirz, 0, -dirx);
        _tQ.setFromUnitVectors(_tZ, _tA);
        const cnt = Math.max(1, Math.round(clen / TIRE_STEP));
        for (let t = 0; t < cnt; t++) {
          const f = (t + 0.5) / cnt, px = oi.x + (oj.x - oi.x) * f, pz = oi.z + (oj.z - oi.z) * f;
          for (const ry of TIRE_ROWS) {
            _tP.set(px, ry, pz);
            _tM.compose(_tP, _tQ, _tONE);
            tireMatrices.push(_tM.clone());
          }
        }
      }
    }
    const grassMesh = new THREE.Mesh(mkGeo(grass), grassMat); grassMesh.receiveShadow = true; group.add(grassMesh);
    const gMesh = new THREE.Mesh(mkGeo(gravel), gravelMat); gMesh.receiveShadow = true; group.add(gMesh);
    for (const part of [[backRed, backRedMat], [backWhite, backWhiteMat]]) {
      const backMesh = new THREE.Mesh(mkGeo(part[0]), part[1]);
      backMesh.castShadow = true; backMesh.receiveShadow = true; group.add(backMesh);
    }
  }

  // Reifenwand als eine InstancedMesh (ein Draw-Call für alle Reifen)
  if (tireMatrices.length) {
    const tires = new THREE.InstancedMesh(tireGeo, tireMat, tireMatrices.length);
    for (let i = 0; i < tireMatrices.length; i++) tires.setMatrixAt(i, tireMatrices[i]);
    tires.instanceMatrix.needsUpdate = true;
    tires.castShadow = true; tires.receiveShadow = true;
    tires.frustumCulled = false; // Bande umschließt die gesamte Strecke
    group.add(tires);
  }

  // --- Startplatz: Punkt der Boxengasse auf Höhe der Start/Ziel-Linie ---
  spawnSeqIdx = Math.min(spawnSeqIdx, seq.length - 1);
  // Spieler startet im freien Stellplatz seiner Garage (Front zur Gasse); Fallback: Boxengasse
  const spawn = garageSpawn ? garageSpawn.clone() : pitCenter[spawnSeqIdx].clone();
  const pitDirection = garageSpawnDir ? garageSpawnDir.clone() : pitDirs[spawnSeqIdx].clone();

  // Gruppe so verschieben, dass der Startplatz im Ursprung liegt
  group.position.set(-spawn.x, 0, -spawn.z);

  // Kollisionsboxen in Weltkoordinaten mitschieben
  for (const c of colliders) {
    c.cx -= spawn.x;
    c.cz -= spawn.z;
  }

  // Curb-Daten für die Fahrzeug-Neigung: Mittellinie (Weltkoordinaten), Quernormale
  // und Fahrbahnbreiten je Punkt. main.js prüft damit, ob ein Rad auf einem Curb steht.
  const curbData = {
    width: CURB_WIDTH,
    grassMaxWidth: GRASS_WIDTH,
    pitHalfWidth: PIT_HALF_WIDTH,
    gravelL: gravelL ? gravelL.slice() : null,
    gravelR: gravelR ? gravelR.slice() : null,
    pts: pts.map((p) => ({ x: p.x - spawn.x, z: p.z - spawn.z })),
    nrm: leftNs.map((nv) => ({ x: nv.x, z: nv.z })),
    wl: wLeft.slice(),
    wr: wRight.slice(),
    grassL: grassL ? grassL.slice() : null,
    grassR: grassR ? grassR.slice() : null,
    pitPts: pitCenter.map((p) => ({ x: p.x - spawn.x, z: p.z - spawn.z })),
  };

  return { group, pitDirection, colliders, curbData };
}
