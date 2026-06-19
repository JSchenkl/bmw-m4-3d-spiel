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

export async function createSpaTrack() {
  const text = await (await fetch('models/spa_track.csv')).text();
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

  // ===== Tribünen mit Zuschauern =====
  {
    const T_TIERS   = 4;
    const T_TIER_H  = 1.5;                    // m Höhe je Stufe
    const T_TIER_D  = 3.0;                    // m Tiefe je Stufe
    const T_OFFSET  = CURB_WIDTH + 3.5;       // m hinter Curb-Außenkante
    const T_TOTAL_D = T_TIERS * T_TIER_D;     // Gesamttiefe
    const T_BACK_H  = T_TIERS * T_TIER_H + 2.5; // Rückwandhöhe

    const matS = new THREE.MeshStandardMaterial({ color: 0x909090, roughness: 0.85, side: THREE.DoubleSide });
    const matR = new THREE.MeshStandardMaterial({ color: 0x404040, roughness: 0.8 });
    const CROWD = [0xd32f2f, 0x1976d2, 0xf57c00, 0x388e3c, 0xfdd835, 0xfafafa, 0x8e24aa, 0x0097a7];

    // Vertikaler Wandstreifen (für Risers und Rückwand)
    function buildWallStrip(pts3d, y0, y1) {
      const pos = [];
      for (const p of pts3d) { pos.push(p.x, y0, p.z, p.x, y1, p.z); }
      const idx = [];
      for (let k = 0; k < pts3d.length - 1; k++) {
        const a = k * 2, b = k * 2 + 1, c = (k + 1) * 2, d = (k + 1) * 2 + 1;
        idx.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    function addStand(iCenter, halfSpan, side) {
      const idxs = Array.from({ length: halfSpan * 2 + 1 },
        (_, k) => ((iCenter - halfSpan + k) % n + n) % n);
      const tw = (i) => (side > 0 ? wLeft[i] : wRight[i]);
      const sp = (i, d) => pts[i].clone().addScaledVector(leftNs[i], side * (tw(i) + d));

      // Sitzflächen + Risers
      for (let t = 0; t < T_TIERS; t++) {
        const y   = ASPHALT_Y + t * T_TIER_H;
        const fPts = idxs.map(i => sp(i, T_OFFSET + t * T_TIER_D));
        const bPts = idxs.map(i => sp(i, T_OFFSET + (t + 1) * T_TIER_D));
        const sm  = new THREE.Mesh(buildStrip(fPts, bPts, y, false), matS);
        sm.receiveShadow = sm.castShadow = true;
        group.add(sm);
        if (t > 0) {
          const rm = new THREE.Mesh(buildWallStrip(fPts, y - T_TIER_H, y), matS);
          rm.castShadow = rm.receiveShadow = true;
          group.add(rm);
        }
      }

      // Rückwand
      const bwPts = idxs.map(i => sp(i, T_OFFSET + T_TOTAL_D));
      const bwm   = new THREE.Mesh(buildWallStrip(bwPts, 0, T_BACK_H), matS);
      bwm.castShadow = bwm.receiveShadow = true;
      group.add(bwm);

      // Dach
      const dachF = idxs.map(i => sp(i, T_OFFSET));
      const dachM = new THREE.Mesh(buildStrip(dachF, bwPts, T_BACK_H, false), matR);
      dachM.castShadow = true;
      group.add(dachM);

      // Kollisionsboxen (Rückwand, alle 4 Segmente)
      for (let k = 0; k < idxs.length - 1; k += 4) {
        const j   = Math.min(k + 4, idxs.length - 1);
        const a   = bwPts[k], b = bwPts[j];
        const len = a.distanceTo(b);
        if (len < 0.1) continue;
        const mid = a.clone().add(b).multiplyScalar(0.5);
        colliders.push({
          cx: mid.x, cz: mid.z,
          ax: (b.x - a.x) / len, az: (b.z - a.z) / len,
          halfLen: len / 2, halfWid: T_TOTAL_D / 2,
        });
      }

      // Zuschauer (InstancedMesh)
      const pCount = T_TIERS * Math.floor(idxs.length / 2);
      const crowd  = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.45, 1.1, 0.35),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
        pCount
      );
      crowd.castShadow = true;
      const _pd = new THREE.Object3D();
      let pi = 0;
      for (let t = 0; t < T_TIERS; t++) {
        const y = ASPHALT_Y + t * T_TIER_H + 0.55;
        const d = T_OFFSET + t * T_TIER_D + T_TIER_D * 0.5;
        for (let r = 0; r + 2 <= idxs.length; r += 2) {
          const i = idxs[r];
          const pos = sp(i, d);
          _pd.position.set(pos.x, y, pos.z);
          _pd.rotation.y = Math.atan2(-side * leftNs[i].x, -side * leftNs[i].z);
          _pd.scale.set(1, 1, 1);
          _pd.updateMatrix();
          crowd.setMatrixAt(pi, _pd.matrix);
          crowd.setColorAt(pi, new THREE.Color(CROWD[pi % CROWD.length]));
          pi++;
        }
      }
      crowd.count = pi;
      crowd.instanceMatrix.needsUpdate = true;
      if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
      group.add(crowd);
    }

    // Kurvenerkennung: Krümmung glätten, Peaks finden
    const curvRaw = Array.from({ length: n }, (_, i) =>
      Math.max(0, 1 - tangents[i].dot(tangents[(i + 1) % n])));
    const curvS = Array.from({ length: n }, (_, i) => {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += curvRaw[(i + k + n) % n];
      return s / 5;
    });
    const allPeaks = [];
    for (let i = 0; i < n; i++) {
      if (curvS[i] > curvS[(i - 1 + n) % n] && curvS[i] > curvS[(i + 1) % n] && curvS[i] > 0.005) {
        const cross = tangents[i].x * tangents[(i + 1) % n].z - tangents[i].z * tangents[(i + 1) % n].x;
        allPeaks.push({ i, c: curvS[i], side: cross > 0 ? -1 : 1 });
      }
    }
    allPeaks.sort((a, b) => b.c - a.c);
    const tightCorners = [];
    for (const p of allPeaks) {
      const far = (q) => Math.min(Math.abs(p.i - q.i), n - Math.abs(p.i - q.i)) > 300;
      if (tightCorners.every(far)) { tightCorners.push(p); if (tightCorners.length >= 2) break; }
    }

    // Startgerade: links, zentriert bei Punkt 200, ±150 Punkte
    addStand(200, 150, 1);
    // Zwei engste Kurven: Außenseite
    for (const c of tightCorners) addStand(c.i, 60, c.side);
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

  // --- Boxengebäude: Garagenreihe entlang der Gasse (folgt der Streckenkrümmung) ---
  const garageMat = new THREE.MeshStandardMaterial({ color: 0x55565c, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x303138, roughness: 0.9 });
  for (let k = 0; k < seq.length; k++) {
    if (ramp(pitArc[k]) < 0.999) continue;            // nur am voll ausgebauten Teil
    if (k % 5 !== 0) continue;                         // ca. alle 25 m eine Garage
    const i = seq[k];
    const t = tangents[i];
    const pos = pts[i].clone().addScaledVector(leftNs[i], -(PIT_OFFSET + PIT_HALF_WIDTH + 9));
    const angle = Math.atan2(t.x, t.z);

    const garage = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 22), garageMat);
    garage.position.set(pos.x, 3.5, pos.z);
    garage.rotation.y = angle;
    garage.castShadow = true;
    garage.receiveShadow = true;
    group.add(garage);
    colliders.push({ cx: pos.x, cz: pos.z, ax: t.x, az: t.z, halfLen: 11, halfWid: 6 });

    const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 23), roofMat);
    roof.position.set(pos.x, 7.2, pos.z);
    roof.rotation.y = angle;
    roof.castShadow = true;
    group.add(roof);
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

  // --- Startplatz: Punkt der Boxengasse auf Höhe der Start/Ziel-Linie ---
  spawnSeqIdx = Math.min(spawnSeqIdx, seq.length - 1);
  const spawn = pitCenter[spawnSeqIdx].clone();
  const pitDirection = pitDirs[spawnSeqIdx].clone();

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
    pts: pts.map((p) => ({ x: p.x - spawn.x, z: p.z - spawn.z })),
    nrm: leftNs.map((nv) => ({ x: nv.x, z: nv.z })),
    wl: wLeft.slice(),
    wr: wRight.slice(),
  };

  return { group, pitDirection, colliders, curbData };
}
