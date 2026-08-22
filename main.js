import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createTrack } from './track.js';
import * as engineAudio from './audio.js';

// Alle Modelle sind meshopt-komprimiert (kleinere Downloads) → Dekoder anhängen
function newGLTFLoader() {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  return l;
}

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

// ---------- Szene & Kamera ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 12000);
camera.position.set(7, 2.5, 7);
// Rückspiegel-Kamera (Blick nach hinten), wird in einen kleinen Streifen oben gerendert
const mirrorCam = new THREE.PerspectiveCamera(72, 5, 0.1, 2000);
// Rückspiegel-Bild für das rechte Cockpit-Display (wird jeden Frame hineingerendert)
const mirrorRT = new THREE.WebGLRenderTarget(512, 288);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 3.5;
controls.maxDistance = 2000; // weit genug herauszoomen, um die ganze Strecke zu sehen
controls.maxPolarAngle = Math.PI / 2 - 0.03; // nicht unter den Boden schauen
controls.target.set(0, 0.6, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;

// Kameraperspektive: 0 = Verfolgerkamera (Außenansicht), 1 = Cockpit (Fahrersicht)
let cameraMode = 0;
// Belichtung: Grundwert (Tag/Nacht) × Cockpit-Dämpfung (Cockpit 15 % gedämmt)
let baseExposure = 1.0;
function applyExposure() { renderer.toneMappingExposure = baseExposure * (cameraMode === 1 ? 0.85 : 1.0); }
let lookYaw = 0;   // Umsehen in der Cockpit-Sicht (horizontal, recentert zu 0)
let lookPitch = 0; // Umsehen in der Cockpit-Sicht (vertikal)
const CHASE_FOV = 45;   // Sichtfeld der Verfolgerkamera
const COCKPIT_FOV = 72; // weiteres Sichtfeld im Cockpit für mehr Immersion
// Position des Fahrerauges relativ zur Fahrzeugmitte (für Cockpit-Kamera UND Lenkrad-Suche).
// Wird je Auto aus CARS[i].cockpitEye gesetzt (ein GT3 sitzt deutlich höher als ein LMP1).
const COCKPIT_EYE = { back: 0.30, side: 0.32, height: 1.12 };
// Nur die Kamera sitzt etwas tiefer und weiter hinten (GT3-Sitzposition);
// die Lenkrad-Suche bleibt unverändert
const COCKPIT_CAM_DROP = 0.10;
const COCKPIT_CAM_BACK = 0.05;
// Wiederverwendbare Vektoren (kein new pro Frame)
const _eye = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _camSide = new THREE.Vector3();
const _lookAt = new THREE.Vector3();

// Umgebungs-Reflexionen für den Lack
const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTexture;

// ---------- Boden (Wiese rund um die Strecke) ----------
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(8000, 64),
  new THREE.MeshStandardMaterial({ color: 0x4e7a3a, roughness: 1.0, metalness: 0.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Himmel: blauer Verlauf (überstrahlt nicht zu Weiß) + sichtbare Sonne ----------
function makeSkyGradient() {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.0, '#2e84d6');   // Zenit: Himmelblau (etwas dunkler)
  grd.addColorStop(0.45, '#549fe8');  // mittlerer Himmel
  grd.addColorStop(0.8, '#8fc4f0');   // Richtung Horizont heller
  grd.addColorStop(1.0, '#c6e2f8');   // Horizontdunst
  g.fillStyle = grd; g.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const skyTexture = makeSkyGradient();

// sichtbare Sonne als weiches Leucht-Sprite hoch am Himmel
const sunWorldDir = new THREE.Vector3(90, 150, 60).normalize();
const sunSprite = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0.0, 'rgba(255,255,245,1)');
  grd.addColorStop(0.18, 'rgba(255,250,225,0.95)');
  grd.addColorStop(0.5, 'rgba(255,238,180,0.35)');
  grd.addColorStop(1.0, 'rgba(255,238,180,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
  s.position.copy(sunWorldDir.clone().multiplyScalar(5000));
  s.scale.set(700, 700, 1);
  s.renderOrder = -1;
  scene.add(s);
  return s;
})();

// Blend-Effekt: weißer Glanz, der einblendet, wenn man in die Sonne schaut
const glareEl = document.getElementById('sun-glare');
const _camDir = new THREE.Vector3(), _sunScreen = new THREE.Vector3();
function updateSunGlare() {
  if (!glareEl) return;
  if (!sunSprite.visible) { glareEl.style.opacity = '0'; return; }
  camera.getWorldDirection(_camDir);
  const align = _camDir.dot(sunWorldDir);                 // 1 = direkt in die Sonne
  const t = THREE.MathUtils.clamp((align - 0.9) / 0.1, 0, 1);
  if (t <= 0) { glareEl.style.opacity = '0'; return; }
  _sunScreen.copy(sunSprite.position).project(camera);     // Sonnenposition am Bildschirm
  const sx = (_sunScreen.x * 0.5 + 0.5) * 100, sy = (-_sunScreen.y * 0.5 + 0.5) * 100;
  glareEl.style.background =
    `radial-gradient(circle at ${sx.toFixed(1)}% ${sy.toFixed(1)}%, rgba(255,255,250,0.95) 0%, rgba(255,255,245,0.5) 14%, rgba(255,255,245,0) 55%)`;
  glareEl.style.opacity = (t * 0.7).toFixed(2);            // „leicht blenden"
}

// ---------- Rennstrecken (echte Vermessungsdaten, TUM racetrack-database) ----------
const TRACKS = [
  // Layout aus dem 3D-Modell „Spa Francorchamps 1992 layout" (Dave Love, CC-BY-4.0) extrahiert;
  // die Szenerie (Straße, Gras, Zäune, Gebäude, Höhenprofil!) kommt direkt aus dem Modell.
  // k/offX/offZ = Transformation Modell-Koordinaten → Spiel-Koordinaten (aus der Extraktion)
  {
    id: 'spa92', name: 'Spa-Francorchamps 1992', country: 'Belgien', length: '6,940 km',
    file: 'models/spa1992_track.csv',
    scenery: {
      file: 'spa_francorchamps_1992_layout.glb', k: 0.18095075, offX: 698.586, offZ: 1163.1662,
      wallRe: 'twall|grdrl|pinewall|fnc', // Reifenwände, Leitplanken, Waldränder, Zäune
      // Startplatz auf der Boxengassen-Fahrbahn des Modells (diagonal vor den Boxengebäuden),
      // per Straßenraster-Abtastung bestimmt: ~200 m vor Start/Ziel, 35 m links
      pitSpawn: { x: 1123.4, z: 1089.8, dx: 0.2393, dz: -0.9707 },
    },
  },
  { id: 'hockenheim', name: 'Hockenheimring', country: 'Deutschland', length: '4,574 km', file: 'models/hockenheim_track.csv' },
  // Szenerie aus dem 3D-Modell „Austin Circuit of the Americas 2012 layout" (Dave Love, CC-BY-4.0);
  // Rennlinie aus der TUM racetrack-database (Austin), per Ähnlichkeitstransformation aufs Modell gelegt.
  {
    id: 'austin', name: 'Circuit of the Americas', country: 'USA', length: '5,513 km',
    file: 'models/austin_track.csv',
    scenery: {
      file: 'models/austin/austin.glb', k: 1.011103, offX: 0, offZ: 0,
      // Höhenprofil aus dem Modell (T1 geht bergauf!); Fahrbahn liegt bei Y≈-143…-113,
      // maxH=-105 hält Tribünen/Gebäude aus dem Bodenraster
      maxH: -105,
      wallRe: 'cota', // alle Meshes (Banden, Mauern) → senkrechte, bodennahe Flächen werden Kollisionen
      // nur Wände 11–60 m von der Ideallinie behalten: näher = fälschlich auf der Strecke
      // (Curbs/Gebäudefronten), weiter weg = ferner Modell-Rand/Deko
      wallCorridor: [11, 60],
      pitSpawn: { x: -712.3, z: 638.6, dx: 0.7946, dz: 0.6071 },
    },
  },
  { id: 'montreal', name: 'Circuit Gilles-Villeneuve', country: 'Kanada', length: '4,361 km', file: 'models/montreal_track.csv' },
  { id: 'saopaulo', name: 'Autódromo José Carlos Pace (Interlagos)', country: 'Brasilien', length: '4,309 km', file: 'models/saopaulo_track.csv' },
];
// Startstrecke per URL wählbar (?track=austin), Standard ist die erste
const urlTrack = new URLSearchParams(location.search).get('track');
let selectedTrackIndex = Math.max(0, TRACKS.findIndex((t) => t.id === urlTrack));
let currentTrackId = TRACKS[selectedTrackIndex].id; // aktuell geladene Strecke (für die Bestzeit-Zuordnung)
// Persönliche Bestzeiten je Strecke (in localStorage gespeichert → bleiben erhalten)
const BEST_KEY = 'bmwm4_bestTimes';
let bestByTrack = {};
try { bestByTrack = JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch (e) { bestByTrack = {}; }
function saveBestTimes() { try { localStorage.setItem(BEST_KEY, JSON.stringify(bestByTrack)); } catch (e) {} }
const fileToTrackId = (file) => { const t = TRACKS.find((t) => t.file === file); return t ? t.id : null; };
let trackGroup = null;       // aktuelle Strecken-Gruppe (zum Entfernen beim Wechsel)
let trackLoadedFile = null;  // zuletzt geladene CSV
let pitDirection = null;     // Fahrtrichtung in der Boxengasse (für die Auto-Ausrichtung)
let trackColliders = [];     // Kollisionsboxen der Mauern und Banden
let colliderGrid = null;     // räumliches Raster über trackColliders (nur bei sehr vielen Boxen)
const COLL_CELL = 24;        // Rasterweite in Metern
let curbData = null;         // Mittellinie + Breiten für die Curb-Neigung
let garageBays = [];         // gefüllte Garagen-Stellplätze (dort wird ein M4 geparkt)
let tireWall = null;         // Reifen-Bande (InstancedMesh + Grundpositionen) fürs Schadensmodell
let tireDmg = null;          // kumulierter Versatz je Reifen (dx,dy,dz) durch Einschläge

// ---------- Szenerie aus einem 3D-Modell (z. B. Spa 1992) + Höhenfeld ----------
let sceneryTrack = false;  // aktuelle Strecke nutzt ein Szenerie-Modell (Kies/Gras-Zonen aus)
let sceneryGroup = null;   // das gerenderte Streckenmodell
let sceneryHeight = null;  // Höhenraster { x0, z0, cell, w, h, data } in Weltkoordinaten
const groundY = (x, z) => {
  const f = sceneryHeight;
  if (!f) return 0;
  const gx = (x - f.x0) / f.cell, gz = (z - f.z0) / f.cell;
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  if (x0 < 0 || z0 < 0 || x0 >= f.w - 1 || z0 >= f.h - 1) return 0;
  const fx = gx - x0, fz = gz - z0;
  const d = f.data;
  const h00 = d[z0 * f.w + x0], h10 = d[z0 * f.w + x0 + 1];
  const h01 = d[(z0 + 1) * f.w + x0], h11 = d[(z0 + 1) * f.w + x0 + 1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
};
// Kollisionsboxen aus den Wand-/Banden-Meshes der Szenerie: annähernd senkrechte,
// bodennahe Dreiecke werden in ein 1,5-m-Raster gestempelt und zeilenweise zu
// Boxen zusammengefasst → das Auto prallt an den ECHTEN Mauern des Modells ab.
function buildWallColliders(g, cfg) {
  const re = new RegExp(cfg.wallRe || '.', 'i');
  const cellW = 1.5;
  const v = new THREE.Vector3();
  const cells = new Map(); // "x|z" → true (Zellkoordinaten)
  let x0 = Infinity, z0 = Infinity;
  const tris = [];
  g.traverse((node) => {
    if (!node.isMesh) return;
    const name = (node.material?.name || '') + '|' + (node.name || '');
    if (!re.test(name)) return;
    const geo = node.geometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const P = [];
      for (let j = 0; j < 3; j++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(node.matrixWorld);
        P.push({ x: v.x, y: v.y, z: v.z });
      }
      // senkrecht? (Flächennormale fast horizontal) + bodennah + hoch genug
      const ux = P[1].x - P[0].x, uy = P[1].y - P[0].y, uz = P[1].z - P[0].z;
      const wx = P[2].x - P[0].x, wy = P[2].y - P[0].y, wz = P[2].z - P[0].z;
      const ny = uz * wx - ux * wz;
      const nx = uy * wz - uz * wy, nz = ux * wy - uy * wx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      if (Math.abs(ny / nl) > 0.4) continue;                       // zu flach → Boden/Dach
      const yMin = Math.min(P[0].y, P[1].y, P[2].y);
      const yMax = Math.max(P[0].y, P[1].y, P[2].y);
      // bodennah relativ zum Höhenfeld (bei flachen Strecken = 0) – Brücken/Schilder oben ignorieren
      const gY = groundY((P[0].x + P[1].x + P[2].x) / 3, (P[0].z + P[1].z + P[2].z) / 3);
      if (yMin - gY > 2.5 || yMax - yMin < 0.5) continue;          // schwebend oder zu niedrig
      tris.push(P);
      for (const q of P) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); }
    }
  });
  for (const P of tris) {
    // Dreieckskanten abtasten und Zellen markieren
    for (let e = 0; e < 3; e++) {
      const a = P[e], b = P[(e + 1) % 3];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (cellW * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const cx = Math.floor((a.x + (b.x - a.x) * f - x0) / cellW);
        const cz = Math.floor((a.z + (b.z - a.z) * f - z0) / cellW);
        cells.set(cx + '|' + cz, true);
      }
    }
  }
  // Zeilenweise zusammenhängende Zellen zu länglichen Boxen mergen
  const rows = new Map(); // z → sortierte x-Liste
  for (const key of cells.keys()) {
    const [cx, cz] = key.split('|').map(Number);
    if (!rows.has(cz)) rows.set(cz, []);
    rows.get(cz).push(cx);
  }
  // Korridor-Filter (nur wenn cfg.wallCorridor=[min,max] gesetzt, z. B. Austin):
  // Boxen ZU NAH an der Ideallinie liegen auf der Strecke (Curbs/Gebäudefronten →
  // falsche Wände), Boxen ZU WEIT weg sind Deko/Modell-Rand. Beides verwerfen.
  let clGrid = null, clMin = 0, clMax = Infinity;
  if (cfg.wallCorridor && centerline && centerline.P) {
    clMin = cfg.wallCorridor[0]; clMax = cfg.wallCorridor[1];
    clGrid = new Map();
    const CL = 25;
    for (const p of centerline.P) {
      const k = Math.floor(p.x / CL) + '|' + Math.floor(p.z / CL);
      let a = clGrid.get(k); if (!a) clGrid.set(k, a = []); a.push(p);
    }
    clGrid._cl = CL;
  }
  const distToLine = (x, z) => {
    const CL = clGrid._cl, cx = Math.floor(x / CL), cz2 = Math.floor(z / CL);
    let bd = Infinity;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const a = clGrid.get((cx + dx) + '|' + (cz2 + dz)); if (!a) continue;
      for (const p of a) { const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (d < bd) bd = d; }
    }
    return Math.sqrt(bd);
  };
  let added = 0, skipped = 0;
  for (const [cz, xsAll] of rows) {
    // Korridor-Filter je EINZELNER Zelle (nicht erst auf der fertigen Box): sonst
    // reicht eine lange Box mit weit entferntem Mittelpunkt mit ihrer Kante bis auf
    // die Ideallinie. Ausgeschlossene Zellen unterbrechen den Lauf.
    const mcz = z0 + (cz + 0.5) * cellW;
    const xs = clGrid
      ? xsAll.filter((cx) => { const d = distToLine(x0 + (cx + 0.5) * cellW, mcz); if (d >= clMin && d <= clMax) return true; skipped++; return false; })
      : xsAll;
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    let runStart = xs[0], prev = xs[0];
    const flush = (s, e) => {
      const wx0 = x0 + s * cellW, wx1 = x0 + (e + 1) * cellW;
      trackColliders.push({
        cx: (wx0 + wx1) / 2, cz: mcz,
        ax: 1, az: 0, halfLen: (wx1 - wx0) / 2, halfWid: cellW / 2,
      });
      added++;
    };
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] === prev + 1) { prev = xs[i]; continue; }
      flush(runStart, prev);
      runStart = prev = xs[i];
    }
    flush(runStart, prev);
  }
  buildColliderGrid(); // Raster neu, die Szenerie-Banden kamen asynchron dazu
  console.log('Wand-Hitboxen aus der Szenerie:', added, 'Boxen (aus', tris.length, 'Dreiecken)', clGrid ? `(${skipped} außerhalb Korridor verworfen)` : '');
}

function loadScenery(cfg, parentGroup) {
  newGLTFLoader().load(cfg.file, (gltf) => {
    const g = new THREE.Group();
    g.add(gltf.scene);
    g.scale.setScalar(cfg.k);
    g.position.set(cfg.offX, cfg.offY || 0, cfg.offZ);
    parentGroup.add(g);   // erbt die Spawn-Verschiebung der Streckengruppe
    sceneryGroup = g;
    g.updateMatrixWorld(true);

    // Flache Strecken (Stadtkurs): kein Höhenfeld nötig – Straße liegt auf y≈0;
    // Wand-Hitboxen direkt bauen (groundY = 0)
    if (cfg.flat) {
      buildWallColliders(g, cfg);
      console.log('Szenerie geladen (flach)');
      return;
    }

    // Höhenfeld aus den Boden-Meshes (Straße/Kies/Gras/Curbs) in Weltkoordinaten
    const groundRe = /road|rmbl|grvl|gbrm|grass|hill|pit/i;
    const box = new THREE.Box3();
    const meshes = [];
    g.traverse((node) => {
      if (node.isMesh && groundRe.test(node.material?.name || '')) {
        meshes.push(node);
        box.expandByObject(node);
      }
    });
    const cellM = 3;
    const w = Math.min(1400, Math.ceil((box.max.x - box.min.x) / cellM) + 2);
    const h = Math.min(1400, Math.ceil((box.max.z - box.min.z) / cellM) + 2);
    const data = new Float32Array(w * h).fill(NaN);
    const v = new THREE.Vector3();
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      const pos = geo.getAttribute('position');
      const idx = geo.index;
      const count = idx ? idx.count : pos.count;
      const P = [];
      for (let i = 0; i < count; i += 3) {
        for (let j = 0; j < 3; j++) {
          v.fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld);
          P[j] = { x: (v.x - box.min.x) / cellM, z: (v.z - box.min.z) / cellM, y: v.y };
        }
        // Dächer/Brücken nicht ins Bodenraster übernehmen (Stadtkurse: maxH gesetzt)
        if (cfg.maxH !== undefined && Math.min(P[0].y, P[1].y, P[2].y) > cfg.maxH) continue;
        // NUR annähernd waagerechte Flächen (Boden) übernehmen – senkrechte Wände/Banden
        // dürfen NICHT ins Höhenfeld, sonst heben ihre Oberkanten das Auto an.
        {
          const ux = (P[1].x - P[0].x) * cellM, uy = P[1].y - P[0].y, uz = (P[1].z - P[0].z) * cellM;
          const wxx = (P[2].x - P[0].x) * cellM, wyy = P[2].y - P[0].y, wzz = (P[2].z - P[0].z) * cellM;
          const nx = uy * wzz - uz * wyy, ny = uz * wxx - ux * wzz, nz = ux * wyy - uy * wxx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          if (Math.abs(ny) / nl < 0.5) continue;   // steiler als ~60° → Wand, überspringen
        }
        // Dreieck ins Raster malen (Baryzentrie), pro Zelle die HÖCHSTE Fläche
        const x0 = Math.max(0, Math.floor(Math.min(P[0].x, P[1].x, P[2].x)));
        const x1 = Math.min(w - 1, Math.ceil(Math.max(P[0].x, P[1].x, P[2].x)));
        const z0 = Math.max(0, Math.floor(Math.min(P[0].z, P[1].z, P[2].z)));
        const z1 = Math.min(h - 1, Math.ceil(Math.max(P[0].z, P[1].z, P[2].z)));
        const den = (P[1].z - P[2].z) * (P[0].x - P[2].x) + (P[2].x - P[1].x) * (P[0].z - P[2].z);
        if (!den) continue;
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const l1 = ((P[1].z - P[2].z) * (x - P[2].x) + (P[2].x - P[1].x) * (z - P[2].z)) / den;
          const l2 = ((P[2].z - P[0].z) * (x - P[2].x) + (P[0].x - P[2].x) * (z - P[2].z)) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < -0.05 || l2 < -0.05 || l3 < -0.05) continue;
          const y = l1 * P[0].y + l2 * P[1].y + l3 * P[2].y;
          const o = z * w + x;
          if (!(data[o] >= y)) data[o] = y; // NaN oder niedriger → übernehmen
        }
      }
    }
    // Löcher mit Nachbarwerten füllen (ein paar Glättungs-Durchläufe)
    for (let pass = 0; pass < 4; pass++) {
      for (let z = 1; z < h - 1; z++) for (let x = 1; x < w - 1; x++) {
        const o = z * w + x;
        if (!Number.isNaN(data[o])) continue;
        let s = 0, c = 0;
        for (const q of [o - 1, o + 1, o - w, o + w]) {
          if (!Number.isNaN(data[q])) { s += data[q]; c++; }
        }
        if (c) data[o] = s / c;
      }
    }
    for (let i = 0; i < data.length; i++) if (Number.isNaN(data[i])) data[i] = 0;
    // Entspitzen: einzelne Zellen, die deutlich über dem Median ihrer Nachbarschaft
    // liegen (Wand-Oberkanten, Schilder, Objekte, die als Boden durchrutschten),
    // auf das Nachbar-Niveau ziehen – sonst katapultieren sie das Auto hoch.
    // 1) Einzel-Ausreißer entspitzen (Wand-Oberkanten etc.)
    const SPIKE = 2.0;
    for (let pass = 0; pass < 6; pass++) {
      const src = Float32Array.from(data);
      let fixed = 0;
      for (let z = 1; z < h - 1; z++) for (let x = 1; x < w - 1; x++) {
        const o = z * w + x;
        const nb = [src[o-1], src[o+1], src[o-w], src[o+w], src[o-w-1], src[o-w+1], src[o+w-1], src[o+w+1]].sort((a, b) => a - b);
        const med = (nb[3] + nb[4]) / 2;
        if (src[o] - med > SPIKE) { data[o] = med; fixed++; }
      }
      if (!fixed) break;
    }
    // 2) Nur bei flachen Strecken (cfg.heightClamp gesetzt): breite Buckel
    //    (Brücken/Objekte über der Fahrbahn) gegen ein stark geglättetes Basisniveau kappen.
    //    Höhenstrecken (COTA-Berg!) brauchen das NICHT – dort würde es die echten Hügel
    //    verflachen; die Entspitzung oben reicht.
    if (cfg.heightClamp !== undefined) {
      const MAXBUMP = cfg.heightClamp, R = 20;
      const blur = Float32Array.from(data), tmp = new Float32Array(w * h);
      for (let it = 0; it < 2; it++) {
        for (let z = 0; z < h; z++) { let acc = 0; const row = z * w;
          for (let x = 0; x < w; x++) { acc += blur[row + x]; if (x > R) acc -= blur[row + x - R - 1];
            tmp[row + x] = acc / Math.min(x + 1, R + 1); } }
        for (let x = 0; x < w; x++) { let acc = 0;
          for (let z = 0; z < h; z++) { acc += tmp[z * w + x]; if (z > R) acc -= tmp[(z - R - 1) * w + x];
            blur[z * w + x] = acc / Math.min(z + 1, R + 1); } }
      }
      for (let i = 0; i < data.length; i++) if (data[i] > blur[i] + MAXBUMP) data[i] = blur[i] + MAXBUMP;
    }
    sceneryHeight = { x0: box.min.x, z0: box.min.z, cell: cellM, w, h, data };
    // Spawn-Punkt (Ursprung) auf Höhe 0 normieren – Szenerie und Feld gemeinsam absenken
    const h0 = groundY(0, 0);
    g.position.y -= h0;
    for (let i = 0; i < data.length; i++) data[i] -= h0;
    // Startboxen neu bauen, damit sie dem Höhenprofil folgen
    if (gridBoxes) { scene.remove(gridBoxes); gridBoxes = null; }
    // Wand-Hitboxen NACH dem Höhenfeld bauen (Bodennähe-Filter braucht groundY);
    // vorher matrixWorld auffrischen – die Normierung hat g gerade verschoben!
    g.updateMatrixWorld(true);
    buildWallColliders(g, cfg);
    // Grünfläche rund um die Szenerie wieder einblenden – ein Stück UNTER dem
    // tiefsten Streckenpunkt, damit sie nirgends durch Fahrbahn/Gelände stößt
    let yLow = 0;
    for (let i = 0; i < data.length; i++) if (data[i] < yLow) yLow = data[i];
    ground.position.y = yLow - 18;
    ground.visible = true;
    console.log('Szenerie geladen, Höhenfeld', w, 'x', h, '– Spawn-Höhe normiert um', h0.toFixed(1), 'm,',
      'Grünfläche auf', (yLow - 18).toFixed(1), 'm');
  }, undefined, (err) => console.error('Szenerie konnte nicht geladen werden:', err));
}

function loadTrack(file) {
  const trackCfg = TRACKS.find((t) => t.file === file);
  return createTrack(file, {
    scenery: !!(trackCfg && trackCfg.scenery),
    pitSpawn: trackCfg && trackCfg.scenery ? trackCfg.scenery.pitSpawn : undefined,
  })
    .then(({ group, pitDirection: dir, colliders, curbData: cd, garageBays: bays, tireWall: tw }) => {
      if (trackGroup) scene.remove(trackGroup);
      trackGroup = group;
      scene.add(group);
      // Szenerie-Modell (falls vorhanden) laden; Boden/Sichtteile kommen dann von dort
      if (sceneryGroup) { sceneryGroup = null; }
      sceneryHeight = null;
      sceneryTrack = !!(trackCfg && trackCfg.scenery);
      ground.visible = !sceneryTrack; // Szenerie: erst nach der Höhenmessung wieder einblenden
      ground.position.y = 0;
      if (trackCfg && trackCfg.scenery) loadScenery(trackCfg.scenery, group);
      pitDirection = dir;
      trackColliders = colliders;
      buildColliderGrid();
      curbData = cd;
      garageBays = bays || [];
      tireWall = tw || null;
      tireDmg = tireWall ? new Float32Array(tireWall.base.length * 3) : null; // Schäden bei Streckenwechsel zurücksetzen
      buildCenterline(cd);
      // Boxengassen-Szene gehört zur Strecke → beim Wechsel neu aufbauen
      if (pitScene) { scene.remove(pitScene); pitScene = null; pitCrew.length = 0; }
      if (gridBoxes) { scene.remove(gridBoxes); gridBoxes = null; } // Startboxen neu aufbauen
      alignCarToPitlane();
      trackLoadedFile = file;
      // Strecke gewechselt: Ghost-/Rundenmessung zurücksetzen, Bestzeit dieser Strecke laden
      currentTrackId = fileToTrackId(file) || currentTrackId;
      if (ghost.mesh) { scene.remove(ghost.mesh); disposeGhostMaterials(); ghost.mesh = null; }
      ghost.best = null; ghost.bestDur = 0; ghost.recording = []; ghost.cursor = 0;
      ghost.timing = false; ghost.lapElapsed = 0; ghost.lastLap = null;
      ghost.hasProgress = false; ghost.prevProgress = 0; ghost.maxProgress = 0;
      ghost.bestLap = bestByTrack[currentTrackId] != null ? bestByTrack[currentTrackId] : Infinity;
      updateLapHud();
    })
    .catch((err) => console.error('Strecke konnte nicht geladen werden:', err));
}

loadTrack(TRACKS[selectedTrackIndex].file);

// ---------- Tageslicht ----------
const sun = new THREE.DirectionalLight(0xfff2e0, 3.0);
sun.position.set(90, 130, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
sun.shadow.bias = -0.0004;
scene.add(sun);

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a66, 1.2);
scene.add(hemi);

// Sanftes Grundlicht – hellt abgeschattete Bereiche auf (z. B. Cockpit-Innenraum, Garage)
const ambient = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambient);

// ---------- Nachtlicht (Mond) ----------
const moon = new THREE.DirectionalLight(0x8aa6ff, 0.35);
moon.position.set(-80, 120, -50);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.left = -80;
moon.shadow.camera.right = 80;
moon.shadow.camera.top = 80;
moon.shadow.camera.bottom = -80;
moon.visible = false;
scene.add(moon);

// ---------- Sterne (nur nachts sichtbar) ----------
const starGeo = new THREE.BufferGeometry();
const starPositions = [];
for (let i = 0; i < 1200; i++) {
  // Punkte auf einer Halbkugel über der Szene
  const r = 5000;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.random() * Math.PI * 0.45;
  starPositions.push(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 18, sizeAttenuation: true, fog: false }));
stars.visible = false;
scene.add(stars);

// ---------- Modell laden ----------
const barEl = document.getElementById('bar');
const pctEl = document.getElementById('pct');
const loaderEl = document.getElementById('loader');

// Verfügbare Autos. Jeder Eintrag beschreibt drei Dinge:
//   • das 3D-Modell (Datei, reale Länge, Regexe für Leuchten/Felgen/Scheiben/Innenraum),
//   • „specs“ = die Originaldaten fürs Datenblatt im Auswahlbildschirm (unten rechts),
//   • „phys“  = die Fahrphysik, die aus genau diesen Originaldaten abgeleitet ist
//     (siehe applyCarPhysics weiter unten – die Autos fahren sich bewusst unterschiedlich).
const CARS = [
  {
    id: 'm4',
    name: 'BMW M4 GT3 EVO',
    short: 'BMW M4 GT3',
    subtitle: 'GT3-Rennwagen · 3D Viewer',
    // „2022 BMW M4 GT3" von Ddiaz Design (Sketchfab, CC-BY-NC-SA-4.0)
    file: 'models/2022_bmw_m4_gt3.glb',
    length: 5.02,           // reale Fahrzeuglänge in Metern (M4 GT3 inkl. Flügel)
    lightRe: /light|red_glass/,   // LightA-Material (Front + Heck) und rotes Rücklicht-Glas
    redRe: /red_glass/,           // rotes Glas sitzt am Heck → bestimmt die Fahrtrichtung
    rimRe: /wheel/,               // Wheel1A-Material = Felgen/Reifen
    windowRe: /window_material/,  // nur die Scheiben (RED_GLASS ausgenommen)
    interiorRe: /interior|textured|coloured|badge/, // Meshes, aus denen das Lenkrad gelöst wird
    plateRe: /interior|textured/,                   // davon nur die Lenkrad-„Platte“ zum Vermessen
    forward: null,          // Fahrtrichtung wird aus den Rücklichtern bestimmt
    cockpitEye: { back: 0.30, side: 0.32, height: 1.12 }, // Fahrerauge (GT3-Sitzposition)
    // Cockpit-Displays, Maße relativ zum Fahrerauge. „inhalt“ des rechten Schirms:
    // 'spiegel' = Live-Rückspiegel, 'drehzahl' = Drehzahl mit Schaltlichtern.
    cockpit: {
      dash:  { ahead: 0.60, side: 0.01, drop: 0.24, breite: 0.20, hoehe: 0.10, layout: 'gang-tempo' },
      rechts: { ahead: 0.64, side: -0.275, drop: 0.235, breite: 0.16, hoehe: 0.09,
                neigeX: -0.12, neigeY: 0.18, inhalt: 'spiegel' },
    },
    // Originaldaten BMW M4 GT3 EVO (Datenblatt unten rechts im Auswahlbildschirm)
    specs: {
      klasse: 'GT3 · Kundensport-Rennwagen',
      baujahr: 'seit 2022 (EVO ab 2025)',
      motor: '3,0-l-R6-Biturbo (P58)',
      leistung: '590 PS (434 kW)',
      gewicht: '1300 kg (BoP-Minimum)',
      accel: '2,8 s',
      vmax: '280 km/h',
      antrieb: 'Hinterrad',
      getriebe: '6-Gang sequenziell (Xtrac)',
    },
    // Längs-/Querdynamik. Kommentare nennen jeweils die reale Größe dahinter.
    phys: {
      mass: 1300,                  // kg (BoP-Mindestgewicht GT3)
      powerWheel: 440000 * 0.9,    // W an den Rädern (~590 PS, sequenziell = wenig Verlust)
      fTraction: 16500,            // N Traktionsgrenze beim Start (Slicks)
      accelBoost: 1.15,            // ergibt 0–100 ≈ 2,8 s, 0–200 ≈ 9,4 s – wie der echte GT3
      driveRear: 1.0,              // GT3 = reiner Hinterradantrieb
      rearGripFrac: 0.52,          // Anteil der Achslast am Heck
      rearGripMu: 1.30,            // Reibwert der Slicks
      oversteerGain: 0.8,          // wie stark das Heck bei Schlupf eindreht
      brakeDecel: 17.5,            // m/s² Rennbremse + Aero (~1,8 g)
      cdArea: 0.47 * 2.2,          // cw · Stirnfläche (m²) – großer Heckflügel
      rollRes: 0.013,              // Rollwiderstandsbeiwert (Slicks)
      vmaxKmh: 280,                // Topspeed (BoP-/Getriebe-limitiert)
      wheelbase: 2.85,             // m Radstand
      maxLatG: 1.05,               // mechanische Haftgrenze in g (ohne Abtrieb)
      aeroMax: 0.45,               // max. Grip-Zuschlag durch Abtrieb (+45 %)
      aeroK: 0.00008,              // wie schnell der Abtrieb mit dem Tempo wächst
      maxSteerDeg: 27.2,           // max. Radeinschlag
      steerRate: 3.0,              // Lenkgeschwindigkeit (Rennlenkung)
      gearMaxKmh: [0, 60, 100, 140, 180, 225, 300], // Gang-Höchsttempo (GT3-Rennabstufung)
      gearPull: [0, 1.0, 0.76, 0.58, 0.48, 0.40, 0.34], // Zugkraft-Faktor je Gang
      // Für die Drehzahlanzeige: das Spiel rechnet mit dem Anteil am Gang-Limit,
      // daraus wird linear eine Drehzahl zwischen Leerlauf und Begrenzer gebildet.
      leerlauf: 1300,              // U/min im Stand
      drehzahlMax: 7300,           // U/min am Begrenzer (P58, BoP-limitiert)
    },
    // Lenkrad wird aus dem Innenraum-Mesh herausgelöst – Maße relativ zum Fahrerauge
    steerWheel: { ahead: 0.38, drop: 0.26, side: 0.0, rad: 0.20, depth: 0.10, tilt: 0.40, sign: 1, ratio: 5 },
  },
  {
    id: 'ts030',
    name: 'TOYOTA TS030 HYBRID',
    short: 'Toyota TS030',
    subtitle: 'LMP1-Le-Mans-Prototyp · 3D Viewer',
    // „Toyota TS030 Hybrid" von vecarz.com
    file: 'models/toyota_ts030_hybrid.glb',
    length: 4.65,           // reale Fahrzeuglänge in Metern (LMP1-Reglement: max. 4650 mm)
    // Materialnamen dieses Modells (aus der Datei ausgelesen):
    //   TS030_LIGHT_POD / TS030_LIGHTS_RAM = Scheinwerfer-Pods ganz vorne,
    //   TS030_SV = flache Leuchtstreifen, drei vorne (z ≈ +2,0) und zwei am
    //     Heckabschluss (z = −2,28) → liefert die Rückleuchten,
    //   inner_rim / outer_rim / Tyre / Disc = Rad (Brakes = feststehende Sättel, daher nicht),
    //   glass = Windschutzscheibe, INT_* = komplette Lenkradeinheit inkl. Display.
    // INT_LEDS (Lenkrad-Schaltblitz) bleibt bewusst draußen, sonst würde er als
    // Scheinwerfer behandelt; TS030_POZICNI (Positionsleuchten an den Flanken) ebenso.
    lightRe: /ts030_light|ts030_sv/,
    redRe: /ts030_sv/,            // Heckstreifen; für die Richtung ungenutzt, da forward gesetzt ist
    rimRe: /rim|tyre|disc/,
    windowRe: /^glass$/,
    interiorRe: /^int_/,          // INT_* ist bei diesem Modell exakt die Lenkradeinheit
    plateRe: /int_carbon|int_display/,
    // Die Fahrzeugfront zeigt in +z (Scheinwerfer-Pods und Frontsplitter liegen dort),
    // deshalb wird die Richtung hier fest gesetzt statt aus roten Rückleuchten geraten.
    forward: { x: 0, y: 0, z: 1 },
    // Fahrerauge im LMP1: tiefer und weiter vorne als im GT3 (das Auto ist nur 1,10 m hoch)
    cockpitEye: { back: -0.26, side: 0.19, height: 0.82 },
    // Prototypen-Cockpit: die Anzeige sitzt auf dem Display des Lenkrads selbst
    // (LED-Leiste oben, darunter Tempo | Gang | Drehzahl) und kippt beim Lenken mit.
    // „hoch“ = Abstand über der Nabe, „vor“ = Abstand vor der Lenkradebene.
    cockpit: {
      // Am Lenkrad-Display des Modells ausgemessen. LED-Leiste und Zahlenfelder
      // sind getrennte Bauteile und bekommen je eine eigene Flaeche - eine
      // gemeinsame waere so hoch, dass die Perspektive sie zum Trapez verzerrt.
      lenkrad: {
        felder: { hoch: 0.0882, vor: 0.016, quer: -0.0060, breite: 0.1500, hoehe: 0.028 },
        leds:   { hoch: 0.1025, vor: 0.016, quer: -0.0010, breite: 0.1025, hoehe: 0.0105 },
      },
    },
    // Originaldaten Toyota TS030 Hybrid (Le-Mans-Prototyp, 2012–2014)
    specs: {
      klasse: 'LMP1 · Le-Mans-Prototyp',
      baujahr: '2012–2014 (WEC / Le Mans)',
      motor: '3,4-l-V8 Saugmotor + THS-R Hybrid',
      leistung: '730 PS gesamt (530 PS V8 + 300 PS E-Boost)',
      gewicht: '900 kg (LMP1-Minimum)',
      accel: '2,3 s',
      vmax: '340 km/h',
      antrieb: 'Hinterrad (Hybrid an der Hinterachse)',
      getriebe: '6-Gang sequenziell',
    },
    // Deutlich leichter, stärker und mit viel mehr Abtrieb als der GT3:
    // 0–100 ≈ 2,3 s, 0–200 ≈ 6,6 s, Vmax 340 km/h (mit demselben Kraftmodell gerechnet).
    phys: {
      mass: 900,                   // kg (LMP1-Mindestgewicht)
      powerWheel: 537000 * 0.92,   // W an den Rädern (~730 PS Systemleistung)
      fTraction: 13800,            // N Traktionsgrenze (leichter, aber breite Prototypen-Slicks)
      accelBoost: 1.00,            // ergibt 0–100 ≈ 2,3 s wie beim echten TS030
      driveRear: 1.0,              // Hinterradantrieb (der Hybrid sitzt an der Hinterachse)
      rearGripFrac: 0.56,          // Mittelmotor-Prototyp → mehr Last am Heck
      rearGripMu: 1.45,            // Prototypen-Slicks greifen stärker als GT3-Slicks
      oversteerGain: 0.7,          // stabiler als der GT3
      brakeDecel: 21.0,            // m/s² (~2,1 g – Kohlefaserbremsen + Abtrieb)
      cdArea: 0.36 * 1.72,         // cw · Stirnfläche (m²) – schlanke Le-Mans-Karosserie
      rollRes: 0.012,
      vmaxKmh: 340,                // Topspeed (Le-Mans-Abstimmung)
      wheelbase: 2.98,             // m Radstand
      maxLatG: 1.25,               // mehr mechanischer Grip als der GT3
      aeroMax: 0.75,               // LMP1-Abtrieb: bis zu +75 % Kurven-Grip
      aeroK: 0.00009,
      maxSteerDeg: 25.0,           // Prototypen lenken direkter, aber weniger weit ein
      steerRate: 3.2,
      gearMaxKmh: [0, 80, 125, 170, 220, 285, 400], // langer 6. Gang für die Mulsanne-Gerade
      gearPull: [0, 1.0, 0.80, 0.65, 0.56, 0.50, 0.45],
      leerlauf: 1200,              // U/min im Stand
      drehzahlMax: 8500,           // U/min am Begrenzer (3,4-l-V8 Saugmotor)
    },
    // Lenkradmitte laut Modellvermessung 0,30 m vor und 0,26 m unter dem Fahrerauge
    steerWheel: { ahead: 0.30, drop: 0.26, side: -0.02, rad: 0.19, depth: 0.12, tilt: 0.30, sign: 1, ratio: 5 },
    // Drehmitte aus der Ausdehnung statt aus dem Schwerpunkt bestimmen (Nabe)
    wheelCenterMode: 'bbox',
  },
];
// Start-Auto per URL wählbar (?car=ts030), Standard ist der M4
const urlCar = new URLSearchParams(location.search).get('car');
let currentCarIndex = Math.max(0, CARS.findIndex((c) => c.id === urlCar));
let currentCar = null; // Szenen-Objekt des aktuell geladenen Autos

const carGroup = new THREE.Group();
carGroup.position.y = 0.05; // Höhe der Asphalt-Oberfläche
scene.add(carGroup);

// Richtung, in die die Fahrzeugfront zeigt (wird beim Laden des Autos bestimmt)
let carForward = null;

// Drehbare Räder: { spin, steer (nur vorne), radius, axisLocal, upLocal }
const wheels = [];

// Lenkrad: wird beim Laden aus dem Innenraum-Mesh herausgelöst und dreht mit der Lenkung.
// steeringParts sammelt die drehbaren Teil-Pivots; STEER_WHEEL beschreibt den Bereich.
const steeringParts = [];
const STEER_RATIO = 13;   // Lenkrad dreht ~13× stärker als die Vorderräder
// Alle Maße relativ zum Fahrerauge (zuverlässiger als Fahrzeug-Bruchteile):
const STEER_WHEEL = {
  debug: false,  // true = herausgelöster Bereich wird ROT eingefärbt (zum Justieren)
  ahead: 0.38,   // Meter vor dem Auge (Lenkrad-Mitte, GT3-Rennlenkrad – leicht zum Fahrer verschoben)
  drop: 0.26,    // Meter unter dem Auge (GT3-Lenkrad sitzt tief)
  side: 0.0,     // zentriert unter dem Fahrerauge
  rad: 0.20,     // halbe Box-Größe quer & hoch (Meter) – das GANZE Lenkrad inkl. Griffe
  depth: 0.10,   // halbe Box-Tiefe (Meter): Lenkradebene + Griffe, tiefe Konsole bleibt draußen
  tilt: 0.40,    // Neigung der Lenksäule (rad, ~23°)
  sign: 1,       // Drehrichtung des Lenkrads (umdrehen, falls verkehrt herum)
  ratio: 5,      // Lenkrad dreht stärker als die Räder (Volleinschlag ≈ 160°)
};

let carYaw = 0; // aktueller Drehwinkel des Autos um die Hochachse
let carRoll = 0; // aktuelle Seitenneigung (Roll) – z. B. wenn ein Rad auf dem Curb steht
let carPitch = 0; // Nick-Winkel am Hang (nur mit Szenerie-Höhenprofil)
let rearSlip = 0; // geglätteter Heck-Schlupf (0 = Grip, >0 = Räder drehen durch → Heck bricht aus)
const UP = new THREE.Vector3(0, 1, 0);
const CURB_TILT = 0.056; // max. Neigung auf dem Randstein (rad, ~3,2°; 20 % flacher)
const _yawQ = new THREE.Quaternion();
const _rollQ = new THREE.Quaternion();

// Hitbox des Autos: halbe Länge/Breite, wird beim Laden aus dem Modell bestimmt
const carHalf = { len: 2.4, wid: 0.95 };

// Setzt die Auto-Ausrichtung aus Gierwinkel (Lenken) und Roll (Curb-Neigung).
// Der Roll dreht um die lokale Längsachse des Autos, der Yaw um die Hochachse.
const _pitchQ = new THREE.Quaternion();
const _sideAxis = new THREE.Vector3();
function applyCarOrientation() {
  _yawQ.setFromAxisAngle(UP, carYaw);
  carGroup.quaternion.copy(_yawQ);
  if (carForward && carPitch !== 0) {
    // Nicken um die Querachse: Steigung → Nase hoch (Vorzeichen s. Rechte-Hand-Regel)
    _sideAxis.crossVectors(UP, carForward).normalize();
    _pitchQ.setFromAxisAngle(_sideAxis, -carPitch);
    carGroup.quaternion.multiply(_pitchQ);
  }
  if (carForward && carRoll !== 0) {
    _rollQ.setFromAxisAngle(carForward, carRoll);
    carGroup.quaternion.multiply(_rollQ);
  }
}

// Prüft, ob ein Rad auf einem Randstein steht, und führt die Neigung weich nach.
function updateCurbTilt(dt) {
  let target = 0;
  if (curbData && carForward) {
    const px = carGroup.position.x, pz = carGroup.position.z;
    // nächstgelegenen Mittellinienpunkt suchen
    const P = curbData.pts;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < P.length; i++) {
      const dx = px - P[i].x, dz = pz - P[i].z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    const c = P[best], nv = curbData.nrm[best];
    const lat = (px - c.x) * nv.x + (pz - c.z) * nv.z; // seitl. Abstand zur Mitte (links = +)
    const hw = carHalf.wid, w = curbData.width;
    const leftWheel = lat + hw;   // linke Radspur
    const rightWheel = lat - hw;  // rechte Radspur
    const onLeft = leftWheel > curbData.wl[best] - 0.2 && leftWheel < curbData.wl[best] + w;
    const onRight = rightWheel < -(curbData.wr[best] - 0.2) && rightWheel > -(curbData.wr[best] + w);
    // Vorzeichen passend zur Vorwärtsachse des GT3-Modells (Roll dreht um carForward)
    if (onLeft && !onRight) target = -CURB_TILT;      // linke Räder hoch → Auto neigt sich nach rechts
    else if (onRight && !onLeft) target = CURB_TILT;  // rechte Räder hoch → nach links
  }
  carRoll += (target - carRoll) * Math.min(1, dt * 9);
}

// Dreht das Auto so, dass seine Front in die gewünschte Weltrichtung zeigt
function setHeading(dir) {
  if (!carForward) return;
  const cross = new THREE.Vector3().crossVectors(carForward, dir);
  carYaw = Math.atan2(cross.y, carForward.dot(dir));
  applyCarOrientation();
}

// Dreht das Auto in Fahrtrichtung der Boxengasse, sobald Auto UND Strecke geladen sind
function alignCarToPitlane() {
  if (pitDirection) setHeading(pitDirection);
}

// Materialien der Fahrzeug-Lichter (zum An-/Ausschalten der Emission)
const headlightMats = [];
const taillightMats = [];

// Spotlights / Punktlichter, die beim Einschalten erzeugt werden.
// Sie hängen in der carGroup, damit sie sich mit dem Auto drehen.
const headlightSpots = new THREE.Group();
const taillightGlows = new THREE.Group();
carGroup.add(headlightSpots, taillightGlows);

// ---------- Cockpit-Displays (GT3) ----------
// Linkes Fahrer-Display (hinter dem Lenkrad): Gang, Drehzahl-LEDs und Tempo.
// Rechtes Center-Display: Live-Rückspiegelbild. Beide als kleine Flächen knapp
// vor den Bildschirmen des 3D-Modells, nur aus der Cockpit-Sicht relevant.
const cockpitScreens = new THREE.Group();
carGroup.add(cockpitScreens);
let dashCanvas = null, dashCtx = null, dashTex = null, centerScreenMesh = null;
let dashPrev = ''; // zuletzt gezeichneter Zustand (nur bei Änderung neu zeichnen)
// Zweites Display für die Drehzahl (nur bei Autos, die rechts keinen Spiegel haben)
let revCanvas = null, revCtx = null, revTex = null, revMesh = null, revPrev = '';
// Display im Lenkrad selbst (LMP1): dreht mit dem Lenkrad mit
let wheelDispCanvas = null, wheelDispCtx = null, wheelDispTex = null, wheelDispPrev = '';
let ledCanvas = null, ledCtx = null, ledTex = null;
let dashAktiv = false, revAktiv = false, lenkradAktiv = false;
const DASH_LED_COLORS = ['#2ecc40', '#74e22b', '#ffdc00', '#ff851b', '#ff2d20'];
// Anordnung der Cockpit-Displays des aktuellen Autos (aus CARS[i].cockpit)
let COCKPIT_SCREENS = {
  dash:  { ahead: 0.60, side: 0.01, drop: 0.24, breite: 0.20, hoehe: 0.10, layout: 'gang-tempo' },
  rechts: { ahead: 0.64, side: -0.275, drop: 0.235, breite: 0.16, hoehe: 0.09,
            neigeX: -0.12, neigeY: 0.18, inhalt: 'spiegel' },
};
function setupCockpitScreens(eyeLocal, fwd, sideVec, wheelCenter, columnAxis) {
  cockpitScreens.clear();
  centerScreenMesh = null;
  revMesh = null;
  dashAktiv = revAktiv = lenkradAktiv = false;

  // Maße und Inhalte kommen je Auto aus CARS[i].cockpit (Cockpits sind unterschiedlich hoch)
  const cfg = COCKPIT_SCREENS;
  // Fläche an einer Stelle relativ zum Fahrerauge aufhängen und zum Fahrer drehen
  const flaeche = (s, material) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.breite, s.hoehe), material);
    m.position.copy(eyeLocal.clone()
      .addScaledVector(fwd, s.ahead)
      .addScaledVector(sideVec, s.side)
      .addScaledVector(UP, -s.drop));
    m.lookAt(eyeLocal);
    if (s.neigeX) m.rotateX(s.neigeX);
    if (s.neigeY) m.rotateY(s.neigeY);
    cockpitScreens.add(m);
    return m;
  };

  // --- Display im Lenkrad selbst (LMP1): hängt am Lenkrad-Pivot und kippt mit ---
  if (cfg.lenkrad && wheelCenter && columnAxis) {
    if (!wheelDispCanvas) {
      wheelDispCanvas = document.createElement('canvas');
      wheelDispCanvas.width = 1024; wheelDispCanvas.height = 215;
      wheelDispCtx = wheelDispCanvas.getContext('2d');
      wheelDispTex = new THREE.CanvasTexture(wheelDispCanvas);
      wheelDispTex.colorSpace = THREE.SRGBColorSpace;
    }
    if (!ledCanvas) {
      ledCanvas = document.createElement('canvas');
      ledCanvas.width = 1024; ledCanvas.height = 103;
      ledCtx = ledCanvas.getContext('2d');
      ledTex = new THREE.CanvasTexture(ledCanvas);
      ledTex.colorSpace = THREE.SRGBColorSpace;
    }
    wheelDispPrev = '';
    // Achsenkreuz in der Lenkradebene: Normale zeigt zum Fahrer, „oben“ liegt in der Ebene
    const n = columnAxis.clone().negate().normalize();
    const u = UP.clone().addScaledVector(n, -UP.dot(n)).normalize();
    const r = new THREE.Vector3().crossVectors(u, n).normalize();

    const pivot = new THREE.Object3D();
    pivot.position.copy(wheelCenter);
    // Eine Fläche in der Lenkradebene aufhängen. Transparent: das Display des
    // Modells bleibt sichtbar, nur Ziffern und Schaltlichter liegen darüber.
    // „hoch“ = über der Nabe, „vor“ = vor der Ebene (sonst Z-Fighting),
    // „quer“ = seitlich in der Ebene.
    const inEbene = (s, tex) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(s.breite, s.hoehe),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }));
      m.position.copy(u).multiplyScalar(s.hoch)
        .addScaledVector(n, s.vor)
        .addScaledVector(r, s.quer || 0);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, n));
      pivot.add(m);
      return m;
    };
    inEbene(cfg.lenkrad.felder, wheelDispTex); // Tempo | Gang | Drehzahl
    inEbene(cfg.lenkrad.leds, ledTex);         // Schaltlichter darüber

    cockpitScreens.add(pivot);
    // Mit den übrigen Lenkradteilen mitdrehen lassen
    steeringParts.push({ pivot, axisLocal: columnAxis.clone().normalize() });
    lenkradAktiv = true;
  }

  // --- mittleres Fahrer-Display: gezeichnete Anzeige (CanvasTexture) ---
  if (cfg.dash) {
    if (!dashCanvas) {
      dashCanvas = document.createElement('canvas');
      dashCanvas.width = 512; dashCanvas.height = 256;
      dashCtx = dashCanvas.getContext('2d');
      dashTex = new THREE.CanvasTexture(dashCanvas);
      dashTex.colorSpace = THREE.SRGBColorSpace;
    }
    dashPrev = ''; // beim (Neu-)Aufbau einmal frisch zeichnen
    flaeche(cfg.dash, new THREE.MeshBasicMaterial({ map: dashTex, toneMapped: false }));
    dashAktiv = true;
  }

  // --- rechter Schirm: Rückspiegel oder Drehzahl ---
  if (!cfg.rechts) {
    // nichts weiter
  } else if (cfg.rechts.inhalt === 'drehzahl') {
    if (!revCanvas) {
      revCanvas = document.createElement('canvas');
      revCanvas.width = 512; revCanvas.height = 320;
      revCtx = revCanvas.getContext('2d');
      revTex = new THREE.CanvasTexture(revCanvas);
      revTex.colorSpace = THREE.SRGBColorSpace;
    }
    revPrev = '';
    revMesh = flaeche(cfg.rechts, new THREE.MeshBasicMaterial({ map: revTex, toneMapped: false }));
    revAktiv = true;
  } else {
    centerScreenMesh = flaeche(cfg.rechts,
      new THREE.MeshBasicMaterial({ map: mirrorRT.texture, toneMapped: false }));
  }
}
// Fahrer-Display zeichnen. Zwei Anordnungen:
//   'gang-tempo' (M4)    – LEDs oben, Gang links (blau), Tempo rechts
//   'tempo-gang' (TS030) – Tempo links, Gang groß und rot in der Mitte;
//                          die Drehzahl steht dort auf dem rechten Schirm
function updateDashScreen() {
  const spd = Math.round(Math.abs(speed) * 3.6);
  const gearTxt = gear === 0 ? 'R' : String(gear);
  const forward = Math.abs(speed) > 0.5 && gear >= 1;
  const frac = forward ? Math.min(1, Math.abs(speed) / GEAR_MAX_SPEED[gear]) : 0;
  const leds = REV_TH.filter((t) => frac >= t).length;
  const blink = performance.now() % 260 < 130; // Blink-Phase (nur am Limit relevant)
  const atLimit = frac >= REV_TH[4];
  const tempoGang = COCKPIT_SCREENS.dash?.layout === 'tempo-gang';

  const state = `${gearTxt}|${spd}|${leds}|${atLimit ? blink : '-'}`;
  // Drehzahl in U/min: linear zwischen Leerlauf und Begrenzer über den Anteil
  // am Gang-Höchsttempo (eine echte Kurbelwellendrehzahl simuliert das Spiel nicht)
  const rpm = Math.round(LEERLAUF + frac * (DREHZAHL_MAX - LEERLAUF));

  // --- Display im Lenkrad: LED-Leiste oben, darunter Tempo | Gang (rot) | Drehzahl ---
  const wheelState = `${state}|${rpm}`;
  if (lenkradAktiv && wheelDispCtx && wheelState !== wheelDispPrev) {
    wheelDispPrev = wheelState;
    const w = wheelDispCtx;
    w.clearRect(0, 0, 1024, 215); // durchsichtig – das Modell-Display bleibt sichtbar
    w.textAlign = 'center'; w.textBaseline = 'middle';

    // Schaltlichter auf ihrer eigenen Fläche: 15 Punkte wie im Modell, nur die
    // brennenden zeichnen – erloschene bleiben durchsichtig und die Punkte des
    // Modells scheinen durch.
    const anLeds = frac < REV_TH[0] ? 0 : Math.round(((frac - REV_TH[0]) / (1 - REV_TH[0])) * 15);
    const L = ledCtx;
    L.clearRect(0, 0, 1024, 103);
    for (let i = 0; i < 15; i++) {
      if (!(atLimit ? blink : i < anLeds)) continue;
      L.beginPath();
      L.arc(15 + i * 71, 51, 18, 0, Math.PI * 2);
      L.fillStyle = DASH_LED_COLORS[Math.min(4, Math.floor(i / 3))];
      L.fill();
    }
    ledTex.needsUpdate = true;
    // Tempo links
    w.fillStyle = '#ffffff';
    w.font = "bold 84px Consolas, monospace";
    w.fillText(String(spd), 313, 128);
    w.font = "bold 24px 'Segoe UI', Arial, sans-serif";
    w.fillStyle = 'rgba(255,255,255,0.45)';
    w.fillText('km/h', 313, 178);
    // Gang gross und rot in der Mitte
    w.fillStyle = '#ff2d20';
    w.font = "bold 120px Consolas, monospace";
    w.fillText(gearTxt, 541, 132);
    // Drehzahl rechts (U/min)
    w.fillStyle = atLimit ? '#ff2d20' : '#ffffff';
    w.font = "bold 76px Consolas, monospace";
    w.fillText(String(rpm), 781, 128);
    w.font = "bold 24px 'Segoe UI', Arial, sans-serif";
    w.fillStyle = 'rgba(255,255,255,0.45)';
    w.fillText('U/min', 781, 178);
    wheelDispTex.needsUpdate = true;
  }

  if (!dashAktiv || !dashCtx) return;
  if (state !== dashPrev) {
    dashPrev = state;
    const g = dashCtx;
    g.fillStyle = '#07090c'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 6; g.strokeRect(3, 3, 506, 250);
    g.textAlign = 'center'; g.textBaseline = 'middle';

    if (tempoGang) {
      // Tempo links …
      g.fillStyle = '#ffffff';
      g.font = "bold 108px Consolas, monospace";
      g.fillText(String(spd), 140, 120);
      g.font = "bold 26px 'Segoe UI', Arial, sans-serif";
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText('km/h', 140, 196);
      // … Gang groß und rot in der Mitte
      g.fillStyle = '#ff2d20';
      g.font = "bold 170px Consolas, monospace";
      g.fillText(gearTxt, 366, 118);
      g.font = "bold 26px 'Segoe UI', Arial, sans-serif";
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText('GANG', 366, 218);
    } else {
      // Drehzahl-LEDs (am Limit blinken alle im Takt)
      for (let i = 0; i < 5; i++) {
        const lit = atLimit ? blink : i < leds;
        g.beginPath();
        g.arc(96 + i * 80, 52, 22, 0, Math.PI * 2);
        g.fillStyle = lit ? DASH_LED_COLORS[i] : '#1b1e24';
        g.fill();
      }
      // Gang (blau, links)
      g.fillStyle = '#4da3ff';
      g.font = "bold 120px Consolas, monospace";
      g.fillText(gearTxt, 110, 168);
      g.font = "bold 26px 'Segoe UI', Arial, sans-serif";
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText('GANG', 110, 234);
      // Tempo (weiß, rechts)
      g.fillStyle = '#ffffff';
      g.font = "bold 110px Consolas, monospace";
      g.fillText(String(spd), 330, 168);
      g.font = "bold 26px 'Segoe UI', Arial, sans-serif";
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText('km/h', 330, 234);
    }
    dashTex.needsUpdate = true;
  }

  // --- rechter Schirm: Drehzahl mit Schaltlichtern und Balken ---
  if (!revAktiv || !revCtx) return;
  const revState = `${leds}|${rpm}|${atLimit ? blink : '-'}`;
  if (revState === revPrev) return;
  revPrev = revState;

  const r = revCtx;
  r.fillStyle = '#07090c'; r.fillRect(0, 0, 512, 320);
  r.strokeStyle = 'rgba(255,255,255,0.18)'; r.lineWidth = 6; r.strokeRect(3, 3, 506, 314);
  r.textAlign = 'center'; r.textBaseline = 'middle';
  // Schaltlichter
  for (let i = 0; i < 5; i++) {
    const lit = atLimit ? blink : i < leds;
    r.beginPath();
    r.arc(96 + i * 80, 58, 26, 0, Math.PI * 2);
    r.fillStyle = lit ? DASH_LED_COLORS[i] : '#1b1e24';
    r.fill();
  }
  // Drehzahlbalken (Anteil am Gang-Höchsttempo)
  r.fillStyle = '#14181f';
  r.fillRect(56, 128, 400, 34);
  r.fillStyle = atLimit ? '#ff2d20' : (leds >= 4 ? '#ff851b' : '#2ecc40');
  r.fillRect(56, 128, 400 * frac, 34);
  r.strokeStyle = 'rgba(255,255,255,0.25)'; r.lineWidth = 3;
  r.strokeRect(56, 128, 400, 34);
  // Zahlenwert in U/min
  r.fillStyle = atLimit ? '#ff2d20' : '#ffffff';
  r.font = "bold 96px Consolas, monospace";
  r.fillText(String(rpm), 256, 226);
  r.font = "bold 26px 'Segoe UI', Arial, sans-serif";
  r.fillStyle = 'rgba(255,255,255,0.5)';
  r.fillText('U/min', 256, 290);
  revTex.needsUpdate = true;
}

// ---------- Auspuffflammen (GT3): Feuerstöße aus den Endrohren ----------
// Beim Hochschalten und bei den Auspuff-Crackles (Gaswegnehmen) schlagen kurze
// Flammen aus den Endrohren. Sprites mit additivem Feuer-Verlauf, an der carGroup.
const flameGroup = new THREE.Group();
carGroup.add(flameGroup);
const flames = [];        // { sprite, t } – t = Restlebensdauer
let crackleBurst = 0;     // Restdauer der Crackle-Phase (zufällige Flammen/Pops)
function makeFlameTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,235,1)');    // weißglühender Kern
  grad.addColorStop(0.3, 'rgba(255,190,60,0.95)'); // gelb-orange
  grad.addColorStop(0.65, 'rgba(255,90,20,0.6)');  // orange-rot
  grad.addColorStop(1, 'rgba(120,20,5,0)');        // außen transparent
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
let flameTex = null;
function setupFlames(carCenter, halfLen) {
  flameGroup.clear(); flames.length = 0;
  if (!flameTex) flameTex = makeFlameTexture();
  const side = new THREE.Vector3().crossVectors(UP, carForward).normalize();
  for (const s of [-0.3, 0.3]) { // zwei Endrohre am Heck
    const mat = new THREE.SpriteMaterial({
      map: flameTex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(carCenter)
      .addScaledVector(carForward, -(halfLen + 0.12))
      .addScaledVector(side, s)
      .setY(0.34);
    sprite.scale.set(0.01, 0.01, 1);
    flameGroup.add(sprite);
    flames.push({ sprite, t: 0 });
  }
}
// Flammenstoß auslösen (strength ≈ 0,5 leichtes Knistern … 1 voller Schaltknall)
function triggerFlames(strength = 1) {
  for (const f of flames) {
    if (Math.random() > 0.85 && strength < 0.9) continue; // Crackles nicht immer aus beiden Rohren
    f.t = 0.1 + Math.random() * 0.08;
    f.max = f.t;
    f.size = (0.3 + Math.random() * 0.35) * strength;
  }
}
function updateFlames(dt) {
  // Crackle-Phase: während der Restdauer zufällig kleine Flammen nachschieben
  if (crackleBurst > 0) {
    crackleBurst -= dt;
    if (Math.random() < dt * 14) triggerFlames(0.45 + Math.random() * 0.3);
  }
  for (const f of flames) {
    if (f.t <= 0) { f.sprite.material.opacity = 0; continue; }
    f.t -= dt;
    const k = Math.max(0, f.t / (f.max || 0.15));         // 1 → 0
    f.sprite.material.opacity = Math.min(1, k * 1.6);
    const sc = f.size * (0.7 + 0.6 * (1 - k));            // Flamme wächst kurz auf und verlischt
    f.sprite.scale.set(sc, sc * (0.8 + Math.random() * 0.3), 1);
  }
}

// Mittlere Position aller Dreiecke eines Meshes entlang einer Achse (Weltkoordinaten)
function meanTriangleCoord(meshes, axis) {
  const v = new THREE.Vector3();
  let sum = 0, count = 0;
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      sum += v[axis];
      count++;
    }
  }
  return count ? sum / count : 0;
}

// Teilt die Geometrie eines Meshes pro Dreieck in eine vordere und eine hintere
// Hälfte (das Modell fasst vordere und hintere Leuchten im selben Mesh zusammen).
function splitLightMesh(mesh, axis, mid, frontSign) {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  const frontIdx = [], rearIdx = [];
  const frontBox = new THREE.Box3(), rearBox = new THREE.Box3();
  frontBox.makeEmpty();
  rearBox.makeEmpty();

  for (let i = 0; i < pos.count; i += 3) {
    let coord = 0;
    const triBox = new THREE.Box3();
    triBox.makeEmpty();
    for (let j = 0; j < 3; j++) {
      v.fromBufferAttribute(pos, i + j).applyMatrix4(mesh.matrixWorld);
      coord += v[axis];
      triBox.expandByPoint(v);
    }
    coord /= 3;
    if (Math.sign(coord - mid) === frontSign) {
      frontIdx.push(i, i + 1, i + 2);
      frontBox.union(triBox);
    } else {
      rearIdx.push(i, i + 1, i + 2);
      rearBox.union(triBox);
    }
  }

  const makeGeo = (idx) => {
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) out.setAttribute(name, geo.attributes[name]);
    out.setIndex(idx);
    return out;
  };
  return {
    frontGeo: frontIdx.length ? makeGeo(frontIdx) : null,
    rearGeo: rearIdx.length ? makeGeo(rearIdx) : null,
    frontBox, rearBox,
  };
}

// Meshes gleichen Materials zu je einem Mesh zusammenfassen. Das GT3-Modell besteht
// aus ~2260 Einzel-Meshes (= Draw-Calls) – gemergt sind es nur noch ~21. Ohne diesen
// Schritt bricht die Framerate ein, sobald die 5 Bot-Klone dazukommen.
// Die Erkennung von Lichtern/Rädern/Scheiben läuft über MATERIAL-Namen und
// funktioniert nach dem Mergen unverändert (Räder werden ohnehin per Dreiecks-
// Clustering in 4 Räder zerlegt – aus dem einen gemergten Rad-Mesh genauso).
// Attribut als einfaches Float32-Attribut kopieren. Quantisierte Modelle liefern
// normalisierte int16-Attribute – auf denen darf applyMatrix4 nicht in-place
// rechnen (Werte würden auf [-1,1] geklemmt), und mergeGeometries braucht
// einheitliche, nicht-interleavte Typen.
function toFloatAttribute(a) {
  const f = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) {
    f[i * a.itemSize] = a.getX(i);
    if (a.itemSize > 1) f[i * a.itemSize + 1] = a.getY(i);
    if (a.itemSize > 2) f[i * a.itemSize + 2] = a.getZ(i);
    if (a.itemSize > 3) f[i * a.itemSize + 3] = a.getW(i);
  }
  return new THREE.BufferAttribute(f, a.itemSize);
}

function mergeCarMeshes(car) {
  car.updateMatrixWorld(true);
  const groups = new Map(); // Material → Geometrien (Welt-Transform eingebacken)
  car.traverse((node) => {
    if (!node.isMesh || !node.geometry?.getAttribute('position')) return;
    const g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry;
    // einheitliche Attribute fürs Mergen: nur position/normal/uv, als Float32
    const ng = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      if (g.getAttribute(name)) ng.setAttribute(name, toFloatAttribute(g.getAttribute(name)));
    }
    ng.applyMatrix4(node.matrixWorld);
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    if (!groups.has(node.material)) groups.set(node.material, []);
    groups.get(node.material).push(ng);
  });
  const merged = new THREE.Group();
  for (const [material, geos] of groups) {
    // Teile ohne UV mit Null-UVs auffüllen, damit alle Attribute übereinstimmen
    const withUv = geos.some((g) => g.getAttribute('uv'));
    for (const g of geos) {
      if (withUv && !g.getAttribute('uv')) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      }
    }
    const mg = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (mg) merged.add(new THREE.Mesh(mg, material));
  }
  return merged;
}

// Lädt ein Auto aus CARS.
//   onDone  – wird nach dem Laden aufgerufen (Standard: Startbildschirm einblenden)
//   onError – wird aufgerufen, wenn die Modelldatei nicht geladen werden kann
function loadCar(index, onDone, onError) {
  const cfg = CARS[index];
  currentCarIndex = index;
  applyCarPhysics(cfg); // Gewicht, Leistung, Getriebe, Grip auf dieses Auto umstellen

  // Beim Wechsel behält das neue Auto Position und Fahrtrichtung des alten
  const prevHeading = (carForward && currentCar)
    ? carForward.clone().applyAxisAngle(UP, carYaw)
    : null;

  if (currentCar) carGroup.remove(currentCar);
  currentCar = null;
  headlightSpots.clear();
  taillightGlows.clear();
  cockpitScreens.clear();
  centerScreenMesh = null;
  revMesh = null;
  wheels.length = 0;
  steeringParts.length = 0;
  headlightMats.length = 0;
  taillightMats.length = 0;
  carForward = null;

  // UI-Texte auf das gewählte Auto umstellen
  document.querySelector('#title h1').textContent = cfg.name;
  document.querySelector('#title p').innerHTML = cfg.subtitle;
  document.querySelector('#loader .logo').textContent = cfg.name;
  barEl.style.width = '0%';
  pctEl.textContent = 'Lade Modell … 0%';
  loaderEl.classList.remove('hidden');

  newGLTFLoader().load(
  cfg.file,
  (gltf) => {
    let car = gltf.scene;
    // Viel-Mesh-Modelle (z. B. GT3: ~2260 Meshes) nach Material zusammenfassen
    let meshCount = 0;
    car.traverse((n) => { if (n.isMesh) meshCount++; });
    if (meshCount > 200) car = mergeCarMeshes(car);

    // --- Normalisieren: zentrieren, auf Boden stellen, auf reale Größe skalieren ---
    let box = new THREE.Box3().setFromObject(car);
    const size = box.getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.z);
    const scale = cfg.length / length; // auf die reale Fahrzeuglänge skalieren
    car.scale.setScalar(scale);

    box = new THREE.Box3().setFromObject(car);
    const center = box.getCenter(new THREE.Vector3());
    car.position.x -= center.x;
    car.position.z -= center.z;
    car.position.y -= box.min.y;

    // --- Schatten setzen + Leuchten-Meshes einsammeln ---
    const headlightBox = new THREE.Box3();
    const taillightBox = new THREE.Box3();
    headlightBox.makeEmpty();
    taillightBox.makeEmpty();

    const lightMeshes = [];
    car.updateMatrixWorld(true);
    car.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;

      const matName = (node.material?.name || '').toLowerCase();
      if (cfg.lightRe.test(matName) && !matName.includes('interior')) {
        lightMeshes.push(node);
      }
      if (cfg.windowRe.test(matName)) {
        node.material.transparent = true;
        node.material.opacity = Math.min(node.material.opacity, 0.15); // Scheiben ~15 % getönt
      }
    });

    // --- Vorne/Hinten bestimmen ---
    // Das Modell fasst vordere und hintere Leuchten im selben Mesh zusammen,
    // daher wird unten jede Leuchten-Geometrie pro Dreieck aufgeteilt:
    // vordere Hälfte = Scheinwerfer (weiß), hintere Hälfte = Rücklicht (nur rot).
    const carBoxW = new THREE.Box3().setFromObject(car);
    const carMid = carBoxW.getCenter(new THREE.Vector3());
    const carSize = carBoxW.getSize(new THREE.Vector3());
    const lengthAxis = carSize.x >= carSize.z ? 'x' : 'z';

    // Hitbox aus den realen Modellmaßen (Breite leicht verkleinert, da die
    // Bounding-Box auch die Außenspiegel umfasst)
    carHalf.len = Math.max(carSize.x, carSize.z) / 2;
    carHalf.wid = (Math.min(carSize.x, carSize.z) / 2) * 0.9;

    // Das Heck ist dort, wo der Schwerpunkt der roten Leuchten-Geometrie liegt.
    // Hat das Modell keine erkennbaren Leuchten, kommt die Richtung aus der Konfiguration.
    let frontSign;
    if (cfg.forward) {
      frontSign = Math.sign(cfg.forward[lengthAxis]) || 1;
    } else {
      const redMeshes = lightMeshes.filter((m) => cfg.redRe.test((m.material.name || '').toLowerCase()));
      const redMean = meanTriangleCoord(redMeshes.length ? redMeshes : lightMeshes, lengthAxis);
      frontSign = -(Math.sign(redMean - carMid[lengthAxis]) || 1);
    }
    carForward = lengthAxis === 'x'
      ? new THREE.Vector3(frontSign, 0, 0)
      : new THREE.Vector3(0, 0, frontSign);

    for (const mesh of lightMeshes) {
      const split = splitLightMesh(mesh, lengthAxis, carMid[lengthAxis], frontSign);

      if (split.frontGeo && split.rearGeo) {
        // Mesh in zwei Teile trennen: vorne behält das Original, hinten wird ein neues Kind-Mesh
        mesh.geometry = split.frontGeo;
        mesh.material = mesh.material.clone();
        const rearMesh = new THREE.Mesh(split.rearGeo, mesh.material.clone());
        rearMesh.castShadow = true;
        rearMesh.receiveShadow = true;
        mesh.add(rearMesh);
        headlightMats.push(mesh.material);
        taillightMats.push(rearMesh.material);
        headlightBox.union(split.frontBox);
        taillightBox.union(split.rearBox);
      } else {
        // Mesh liegt komplett auf einer Seite
        mesh.material = mesh.material.clone();
        if (split.frontGeo) {
          headlightMats.push(mesh.material);
          headlightBox.union(split.frontBox);
        } else {
          taillightMats.push(mesh.material);
          taillightBox.union(split.rearBox);
        }
      }
    }

    // --- Räder: verschmolzene Felgen-Meshes in 4 Räder mit eigener Drehachse aufteilen ---
    const widthAxis = lengthAxis === 'x' ? 'z' : 'x';
    // Drehrichtung so, dass die Radoberseite bei Vorwärtsfahrt nach vorne läuft
    const spinAxisWorld = (widthAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0))
      .multiplyScalar(lengthAxis === 'x' ? -frontSign : frontSign);

    const wheelMeshes = [];
    car.traverse((node) => {
      if (node.isMesh && cfg.rimRe.test((node.material?.name || '').toLowerCase())) {
        wheelMeshes.push(node);
      }
    });

    // Durchgang 1: Dreiecke jedes Rad-Meshes nach Fahrzeug-Quadrant bündeln.
    const wheelParts = [];              // { mesh, geo, clusters }
    const radiusByQuadrant = new Map(); // Quadrant → größter Halbmesser (= Reifen)
    for (const mesh of wheelMeshes) {
      const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const posAttr = geo.getAttribute('position');
      const v = new THREE.Vector3();

      // Dreiecke nach Fahrzeug-Quadrant bündeln (vorne/hinten × links/rechts)
      const clusters = new Map();
      for (let i = 0; i < posAttr.count; i += 3) {
        const c = new THREE.Vector3();
        const triBox = new THREE.Box3();
        triBox.makeEmpty();
        for (let j = 0; j < 3; j++) {
          v.fromBufferAttribute(posAttr, i + j).applyMatrix4(mesh.matrixWorld);
          c.add(v);
          triBox.expandByPoint(v);
        }
        c.multiplyScalar(1 / 3);
        const key = `${Math.sign(c[lengthAxis] - carMid[lengthAxis])}_${Math.sign(c[widthAxis] - carMid[widthAxis])}`;
        if (!clusters.has(key)) clusters.set(key, { idx: [], box: new THREE.Box3().makeEmpty() });
        const cl = clusters.get(key);
        cl.idx.push(i, i + 1, i + 2);
        cl.box.union(triBox);
      }

      wheelParts.push({ mesh, geo, clusters });

      // Liegen Felge, Bremsscheibe und Reifen eines Rades in getrennten Meshes
      // (eigene Materialien), bekäme sonst jedes Teil über ω = v/r seinen eigenen
      // Halbmesser und damit eine andere Drehzahl – die Felge würde gegenüber dem
      // Reifen durchdrehen. Maßgeblich ist deshalb der größte Halbmesser je
      // Quadrant, also der Reifen.
      for (const [key, { box }] of clusters) {
        const r = (box.max.y - box.min.y) / 2;
        radiusByQuadrant.set(key, Math.max(radiusByQuadrant.get(key) || 0, r));
      }
    }

    // Durchgang 2: je Cluster einen lenk- und drehbaren Pivot bauen.
    for (const { mesh, geo, clusters } of wheelParts) {
      const invW = mesh.matrixWorld.clone().invert();
      const material = mesh.material;
      mesh.geometry = new THREE.BufferGeometry(); // Original rendert nichts mehr

      for (const [quadrant, { idx, box: wBox }] of clusters) {
        const cg = new THREE.BufferGeometry();
        for (const name of Object.keys(geo.attributes)) cg.setAttribute(name, geo.attributes[name]);
        cg.setIndex(idx);

        const centerW = wBox.getCenter(new THREE.Vector3());
        const centerL = centerW.clone().applyMatrix4(invW);
        const isFront = Math.sign(centerW[lengthAxis] - carMid[lengthAxis]) === frontSign;

        // Pivot an der Radnabe; das Mesh hängt um die Nabe zentriert darunter
        const steerPivot = new THREE.Object3D();
        steerPivot.position.copy(centerL);
        const spinPivot = new THREE.Object3D();
        const wheelMesh = new THREE.Mesh(cg, material);
        wheelMesh.castShadow = true;
        wheelMesh.position.copy(centerL).negate();
        spinPivot.add(wheelMesh);
        steerPivot.add(spinPivot);
        mesh.add(steerPivot);

        wheels.push({
          spin: spinPivot,
          steer: isFront ? steerPivot : null,
          // Alle Teile eines Rades teilen sich den Reifen-Halbmesser (siehe oben)
          radius: Math.max(radiusByQuadrant.get(quadrant) ?? (wBox.max.y - wBox.min.y) / 2, 0.2),
          axisLocal: spinAxisWorld.clone().transformDirection(invW).normalize(),
          upLocal: new THREE.Vector3(0, 1, 0).transformDirection(invW).normalize(),
        });
      }
    }

    // --- Lenkrad aus dem Innenraum-Mesh herauslösen (dreht später mit der Lenkung) ---
    // Es gibt kein eigenes Lenkrad-Mesh; daher werden alle Dreiecke der Innenraum-Meshes,
    // deren Schwerpunkt in einer Box vor dem Fahrer liegt, in einen drehbaren Pivot ausgelagert.
    car.updateMatrixWorld(true);
    {
      // Fahrerseite (links) = UP × Fahrtrichtung
      const sideVec = new THREE.Vector3().crossVectors(UP, carForward).normalize();
      // Fahrerauge wie in der Cockpit-Kamera – verlässlicher Bezugspunkt nahe am Lenkrad
      const eye = new THREE.Vector3(carMid.x, carBoxW.min.y, carMid.z)
        .addScaledVector(carForward, -COCKPIT_EYE.back)
        .addScaledVector(sideVec, COCKPIT_EYE.side)
        .addScaledVector(UP, COCKPIT_EYE.height);
      // Lenkrad-Mitte relativ zum Auge: ein Stück nach vorne, etwas tiefer, zur Fahrerseite
      const center = eye.clone()
        .addScaledVector(carForward, STEER_WHEEL.ahead)
        .addScaledVector(UP, -STEER_WHEEL.drop)
        .addScaledVector(sideVec, STEER_WHEEL.side);

      // Achsen-ausgerichtete Box (carForward zeigt entlang einer Weltachse)
      const boxHalf = new THREE.Vector3();
      boxHalf[lengthAxis] = STEER_WHEEL.depth;
      boxHalf[widthAxis] = STEER_WHEEL.rad;
      boxHalf.y = STEER_WHEEL.rad;
      const region = new THREE.Box3(center.clone().sub(boxHalf), center.clone().add(boxHalf));

      // Drehachse = Lenksäule: Fahrtrichtung, um tilt nach UNTEN geneigt (senkrecht
      // zur Lenkradebene). Direkt aus Fahrtrichtung+UP gebaut – applyAxisAngle um die
      // Querachse kippte je nach Welt-Ausrichtung des Autos in die falsche Richtung.
      const columnAxisWorld = carForward.clone()
        .multiplyScalar(Math.cos(STEER_WHEEL.tilt))
        .addScaledVector(UP, -Math.sin(STEER_WHEEL.tilt))
        .normalize();

      // Nur Innenraum-/Ausstattungs-Meshes prüfen – NICHT die Karosserie (Paint/Base/…),
      // sonst rotieren Dach-/Armaturenteile mit, die zufällig die Box schneiden.
      // „coloured“/„badge“ gehören mit dazu: die GT3-Lenkrad-GRIFFE und das Emblem
      // bestehen daraus (der enge Zylinder in Durchgang 2 hält fremde Teile draußen).
      const interiorMeshes = [];  // fürs endgültige Greifen (inkl. Griffe/Emblem)
      const plateMeshes = [];     // nur fürs Vermessen der Lenkradebene (Platte)
      car.traverse((n) => {
        if (!n.isMesh || !n.geometry.getAttribute('position')) return;
        const mat = (n.material?.name || '').toLowerCase();
        if (!cfg.interiorRe.test(mat)) return;
        interiorMeshes.push(n);
        if (cfg.plateRe.test(mat)) plateMeshes.push(n);
      });

      const _c = new THREE.Vector3();
      const _t = new THREE.Vector3();
      // Dreiecks-Schwerpunkte gegen ein Prädikat klassifizieren (ohne die Meshes zu ändern)
      const classify = (test, meshes) => {
        const perMesh = [];
        const pts = [];
        for (const mesh of meshes) {
          const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = geo.getAttribute('position');
          const keptIdx = [];
          const grabbedIdx = [];
          for (let i = 0; i < pos.count; i += 3) {
            _c.set(0, 0, 0);
            for (let j = 0; j < 3; j++) {
              _t.fromBufferAttribute(pos, i + j).applyMatrix4(mesh.matrixWorld);
              _c.add(_t);
            }
            _c.multiplyScalar(1 / 3);
            if (test(_c)) { grabbedIdx.push(i, i + 1, i + 2); pts.push(_c.clone()); }
            else keptIdx.push(i, i + 1, i + 2);
          }
          if (grabbedIdx.length) perMesh.push({ mesh, geo, keptIdx, grabbedIdx });
        }
        return { perMesh, pts };
      };

      // Lenkradebene aus Punkten messen: Schwerpunkt + Normale (PCA, kleinste
      // Hauptkomponente per Potenz-Iteration auf (Spur·I − C))
      const measurePlane = (pts) => {
        const m = new THREE.Vector3();
        for (const p of pts) m.add(p);
        m.multiplyScalar(1 / pts.length);
        let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
        for (const p of pts) {
          const dx = p.x - m.x, dy = p.y - m.y, dz = p.z - m.z;
          xx += dx * dx; xy += dx * dy; xz += dx * dz;
          yy += dy * dy; yz += dy * dz; zz += dz * dz;
        }
        const tr = xx + yy + zz;
        const v = columnAxisWorld.clone();
        const t = new THREE.Vector3();
        for (let it = 0; it < 80; it++) {
          t.set(
            (tr - xx) * v.x - xy * v.y - xz * v.z,
            -xy * v.x + (tr - yy) * v.y - yz * v.z,
            -xz * v.x - yz * v.y + (tr - zz) * v.z,
          );
          if (t.lengthSq() < 1e-12) break;
          v.copy(t.normalize());
        }
        if (v.dot(carForward) < 0) v.negate(); // einheitlich nach vorn orientieren
        return { m, v };
      };

      // Durchgang 1: Box am Schätzwert → echtes Zentrum + Achse messen (Platte).
      // Durchgang 2: ZYLINDER um die gemessene Achse durch das Zentrum – Radius
      // fasst Platte + Griffe, der Achsbereich reicht zum Fahrer hin weiter
      // (die Griffe wölben sich zum Fahrer und lagen außerhalb der Box).
      const wheelCenter = center.clone(); // Fallback: konfigurierter Schätzwert
      let grab = classify((p) => region.containsPoint(p), plateMeshes);
      if (grab.pts.length > 30) {
        const p1 = measurePlane(grab.pts);
        if (p1.v.dot(columnAxisWorld) > 0.7) columnAxisWorld.copy(p1.v);
        wheelCenter.copy(p1.m);
        const axis = columnAxisWorld;
        const rel = new THREE.Vector3();
        grab = classify((p) => {
          rel.copy(p).sub(wheelCenter);
          const s = rel.dot(axis);                 // axial: + nach vorn, − zum Fahrer
          if (s < -0.20 || s > 0.08) return false; // Griffe hinten mitnehmen, Säule vorn nicht
          return rel.lengthSq() - s * s <= 0.22 * 0.22; // radial: Platte + Griffe
        }, interiorMeshes);
        // Der Dreiecks-Schwerpunkt liegt nur dann in der Nabe, wenn die Geometrie
        // gleichmäßig ums Zentrum verteilt ist. Beim TS030 ziehen Display und
        // LED-Leiste oben sowie die Tastencluster den Schwerpunkt aus der Mitte –
        // das Lenkrad schwingt dann beim Lenken, statt sich zu drehen. Für einen
        // Kreis ist die Mitte der Ausdehnung das richtige Maß.
        if (cfg.wheelCenterMode === 'bbox' && grab.pts.length > 30) {
          const b = new THREE.Box3().makeEmpty();
          for (const p of grab.pts) b.expandByPoint(p);
          const d = b.getCenter(new THREE.Vector3()).sub(wheelCenter);
          // Nur QUER zur Säulenachse korrigieren: die Lage in der Achse bestimmt
          // die Lenkradebene (gemessen), und für die Drehung ist sie ohnehin egal.
          d.addScaledVector(columnAxisWorld, -d.dot(columnAxisWorld));
          wheelCenter.add(d);
        }
        console.log('Lenkrad: Achse', columnAxisWorld.toArray().map((x) => x.toFixed(3)).join(','),
          '| Zentrum', wheelCenter.toArray().map((x) => x.toFixed(3)).join(','),
          '| Dreiecke', grab.pts.length);
        if (STEER_WHEEL.debug) {
          // Welche Materialien liegen im Lenkrad-Zylinder? (Griffe evtl. ausgefiltert)
          const counts = new Map();
          car.traverse((n) => {
            if (!n.isMesh || !n.geometry.getAttribute('position')) return;
            const g2 = n.geometry.index ? n.geometry.toNonIndexed() : n.geometry;
            const pos2 = g2.getAttribute('position');
            let c = 0;
            for (let i = 0; i < pos2.count; i += 3) {
              _c.set(0, 0, 0);
              for (let j = 0; j < 3; j++) { _t.fromBufferAttribute(pos2, i + j).applyMatrix4(n.matrixWorld); _c.add(_t); }
              _c.multiplyScalar(1 / 3);
              rel.copy(_c).sub(wheelCenter);
              const s = rel.dot(axis);
              if (s >= -0.20 && s <= 0.08 && rel.lengthSq() - s * s <= 0.22 * 0.22) c++;
            }
            if (c) counts.set(n.material?.name || '?', (counts.get(n.material?.name || '?') || 0) + c);
          });
          console.log('Lenkrad-Zylinder je Material:', JSON.stringify([...counts.entries()]));
        }
      }

      for (const part of grab.perMesh) {
        const makeGeo = (idx) => {
          const out = new THREE.BufferGeometry();
          for (const name of Object.keys(part.geo.attributes)) out.setAttribute(name, part.geo.attributes[name]);
          out.setIndex(idx);
          return out;
        };
        part.mesh.geometry = makeGeo(part.keptIdx); // der Rest des Innenraums bleibt stehen

        const mat = STEER_WHEEL.debug
          ? new THREE.MeshStandardMaterial({ color: 0xff1010, emissive: 0xaa0000, emissiveIntensity: 1 })
          : part.mesh.material;
        const wheelMesh = new THREE.Mesh(makeGeo(part.grabbedIdx), mat);
        wheelMesh.castShadow = true;

        // Pivot im gemessenen Lenkrad-Zentrum: Geometrie bleibt am Platz, dreht
        // aber exakt um die Säulenachse DURCH das Zentrum (kein Herumkreisen)
        const invW = part.mesh.matrixWorld.clone().invert();
        const centerL = wheelCenter.clone().applyMatrix4(invW);
        wheelMesh.position.copy(centerL).negate();
        const pivot = new THREE.Object3D();
        pivot.position.copy(centerL);
        pivot.add(wheelMesh);
        part.mesh.add(pivot);
        steeringParts.push({
          pivot,
          axisLocal: columnAxisWorld.clone().transformDirection(invW).normalize(),
        });
      }

      // Cockpit-Displays platzieren; wheelCenter/columnAxisWorld für ein Display,
      // das am Lenkrad selbst sitzt und mitdreht
      setupCockpitScreens(eye, carForward, sideVec, wheelCenter, columnAxisWorld);

    }

    // Ausgangszustand der Emission merken
    [...headlightMats, ...taillightMats].forEach((m) => {
      m.userData.baseEmissive = m.emissive ? m.emissive.clone() : new THREE.Color(0x000000);
      m.userData.baseIntensity = m.emissiveIntensity ?? 1;
    });

    // --- Echte Lichtkegel an den Scheinwerfer-Positionen erzeugen ---
    const carBox = new THREE.Box3().setFromObject(car);
    const carCenter = carBox.getCenter(new THREE.Vector3());

    // Modell ohne eigene Leuchten-Materialien: Positionen aus der Karosserie schätzen,
    // damit Scheinwerfer und Rücklichter trotzdem funktionieren (wie beim M4)
    if (headlightBox.isEmpty() && taillightBox.isEmpty()) {
      const halfLen = (lengthAxis === 'x' ? carBox.max.x - carBox.min.x : carBox.max.z - carBox.min.z) / 2;
      headlightBox.expandByPoint(
        carCenter.clone().addScaledVector(carForward, halfLen - 0.3).setY(0.65)
      );
      taillightBox.expandByPoint(
        carCenter.clone().addScaledVector(carForward, -(halfLen - 0.25)).setY(0.75)
      );
    }

    if (!headlightBox.isEmpty()) {
      const hc = headlightBox.getCenter(new THREE.Vector3());
      // Fahrtrichtung: vom Fahrzeugzentrum durch die Scheinwerfer, horizontal
      const dir = new THREE.Vector3(hc.x - carCenter.x, 0, hc.z - carCenter.z).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x); // quer zur Fahrtrichtung

      for (const s of [-0.65, 0.65]) {
        const pos = hc.clone().addScaledVector(side, s).addScaledVector(dir, 0.15);
        const spot = new THREE.SpotLight(0xeaf4ff, 0, 30, Math.PI / 7, 0.45, 1.2);
        spot.position.copy(pos);
        spot.target.position.copy(pos.clone().addScaledVector(dir, 10).setY(0));
        spot.castShadow = false;
        headlightSpots.add(spot, spot.target);
      }
    }

    if (!taillightBox.isEmpty()) {
      const tc = taillightBox.getCenter(new THREE.Vector3());
      const dir = new THREE.Vector3(tc.x - carCenter.x, 0, tc.z - carCenter.z).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);

      for (const s of [-0.6, 0.6]) {
        const pos = tc.clone().addScaledVector(side, s).addScaledVector(dir, 0.1);
        const glow = new THREE.PointLight(0xff1a1a, 0, 4, 2);
        glow.position.copy(pos);
        taillightGlows.add(glow);
      }
    }

    setupFlames(carCenter, carHalf.len); // Auspuffflammen an den Endrohren platzieren

    carGroup.add(car);
    currentCar = car;
    if (prevHeading) setHeading(prevHeading); // Kurs des vorherigen Autos übernehmen
    else alignCarToPitlane();
    // Startbildschirm: Nachtmodus + alle Lichter + Rotation einschalten
    isNight = true;
    headlightsOn = true;
    taillightsOn = true;
    applyMode();
    controls.autoRotate = true;
    loaderEl.classList.add('hidden');
    if (onDone) onDone();
    // Startscreen einblenden (requestAnimationFrame damit CSS-Transition greift)
    else requestAnimationFrame(() => document.getElementById('start-screen').classList.add('visible'));
  },
  (xhr) => {
    if (xhr.total > 0) {
      const pct = Math.min(100, Math.round((xhr.loaded / xhr.total) * 100)); // nie über 100 %
      barEl.style.width = pct + '%';
      pctEl.textContent = `Lade Modell … ${pct}%`;
    }
  },
  (err) => {
    pctEl.textContent = `Modell „${cfg.file}“ konnte nicht geladen werden. `
      + 'Datei vorhanden? Und bitte über einen lokalen Server starten (start.bat).';
    console.error(err);
    if (onError) onError(err);
  }
  );
}

// ---------- Zustand & UI ----------
let isNight = false;
let headlightsOn = false;
let taillightsOn = false;
let braking = false;

const btnDayNight = document.getElementById('btn-daynight');
const btnHead = document.getElementById('btn-headlights');
const btnTail = document.getElementById('btn-taillights');
const btnRotate = document.getElementById('btn-rotate');
const btnGearbox = document.getElementById('btn-gearbox');
const btnSound = document.getElementById('btn-sound');

function applyMode() {
  if (isNight) {
    scene.background = new THREE.Color(0x05070f);
    scene.fog = new THREE.Fog(0x05070f, 200, 3500);
    scene.environmentIntensity = 0.12;
    sun.visible = false;
    moon.visible = true;
    hemi.intensity = 0.12;
    hemi.color.set(0x223355);
    ambient.intensity = 0.1;
    stars.visible = true;
    sunSprite.visible = false;           // nachts keine Sonne
    ground.material.color.set(0x0e1810);
    baseExposure = 0.85; applyExposure();
  } else {
    scene.background = skyTexture;       // blauer Himmel-Verlauf
    scene.fog = new THREE.Fog(0xc6e2f8, 800, 8500);
    scene.environmentIntensity = 1.0;
    sun.visible = true;
    moon.visible = false;
    hemi.intensity = 1.2;
    hemi.color.set(0xbfd9ff);
    ambient.intensity = 0.45;
    stars.visible = false;
    sunSprite.visible = true;
    ground.material.color.set(0x4e7a3a);
    baseExposure = 1.0; applyExposure();
  }
  applyHeadlights();
  applyTaillights();
  applyBotLights();
}

function applyHeadlights() {
  // Lichtkegel nachts deutlich stärker sichtbar
  const spotIntensity = headlightsOn ? (isNight ? 250 : 60) : 0;
  headlightSpots.children.forEach((c) => { if (c.isSpotLight) c.intensity = spotIntensity; });
  headlightMats.forEach((m) => {
    if (headlightsOn) {
      m.emissive.set(0xffffff);
      m.emissiveIntensity = isNight ? 6 : 3;
    } else {
      m.emissive.copy(m.userData.baseEmissive);
      m.emissiveIntensity = m.userData.baseIntensity;
    }
  });
}

function applyTaillights() {
  // Beim Bremsen leuchten die Rücklichter auch ohne eingeschaltetes Licht – und kräftiger
  const on = taillightsOn || braking;
  const boost = braking ? 2 : 1;
  const glowIntensity = on ? (isNight ? 8 : 3) * boost : 0;
  taillightGlows.children.forEach((c) => { c.intensity = glowIntensity; });
  taillightMats.forEach((m) => {
    if (on) {
      m.emissive.set(0xff0000);
      m.emissiveIntensity = (isNight ? 5 : 2.5) * boost;
    } else {
      m.emissive.copy(m.userData.baseEmissive);
      m.emissiveIntensity = m.userData.baseIntensity;
    }
  });
}

btnDayNight.addEventListener('click', () => {
  isNight = !isNight;
  btnDayNight.textContent = isNight ? '☀️ Tagmodus' : '🌙 Nachtmodus';
  btnDayNight.classList.toggle('active', isNight);
  applyMode();
});

btnHead.addEventListener('click', () => {
  headlightsOn = !headlightsOn;
  btnHead.textContent = `💡 Scheinwerfer: ${headlightsOn ? 'AN' : 'AUS'}`;
  btnHead.classList.toggle('active', headlightsOn);
  applyHeadlights();
});

btnTail.addEventListener('click', () => {
  taillightsOn = !taillightsOn;
  btnTail.textContent = `🔴 Rücklichter: ${taillightsOn ? 'AN' : 'AUS'}`;
  btnTail.classList.toggle('active', taillightsOn);
  applyTaillights();
});

btnRotate.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  btnRotate.textContent = `🔄 Auto-Rotation: ${controls.autoRotate ? 'AN' : 'AUS'}`;
});

btnGearbox.addEventListener('click', () => {
  autoGearbox = !autoGearbox;
  btnGearbox.textContent = `⚙️ Getriebe: ${autoGearbox ? 'Automatik' : 'Schaltung'}`;
  btnGearbox.classList.toggle('active', autoGearbox);
});

// Motorsound (synthetisierter Reihensechszylinder). Browser lassen Audio erst nach
// einer Nutzeraktion zu – daher wird der Klang beim ersten Tastendruck/Klick freigeschaltet.
let soundOn = true;
let audioUnlocked = false;
function unlockAudio() {
  // Erst nach dem Spielstart und beim ersten Knopfdruck – der Startbildschirm bleibt stumm
  if (audioUnlocked || !gameStarted) return;
  audioUnlocked = true;
  engineAudio.setEnabled(soundOn);
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

btnSound.addEventListener('click', () => {
  soundOn = !soundOn;
  audioUnlocked = true;
  engineAudio.setEnabled(soundOn);
  btnSound.textContent = `🔊 Motorsound: ${soundOn ? 'AN' : 'AUS'}`;
  btnSound.classList.toggle('active', soundOn);
});

// ---------- Startbildschirm & Modus-Auswahl ----------
let raceMode = false; // false = Training (ohne Gegner), true = Rennen (mit Bots)
{
  const startScreen = document.getElementById('start-screen');
  const modeScreen = document.getElementById('mode-screen');

  // „SPIELEN" → zuerst Streckenauswahl (danach Modus-Auswahl)
  document.getElementById('btn-start').addEventListener('click', () => {
    startScreen.classList.remove('visible');
    startScreen.addEventListener('transitionend', () => { startScreen.style.display = 'none'; }, { once: true });
    showTrackScreen();
  });

  // Spiel im gewählten Modus starten
  function startGame(isRace) {
    raceMode = isRace;
    modeScreen.classList.remove('visible');

    // Auf Tagmodus zurückschalten, Rotation stoppen
    isNight = false;
    headlightsOn = false;
    taillightsOn = false;
    btnDayNight.textContent = '🌙 Nachtmodus';
    btnDayNight.classList.remove('active');
    btnHead.textContent = '💡 Scheinwerfer: AUS';
    btnHead.classList.remove('active');
    btnTail.textContent = '🔴 Rücklichter: AUS';
    btnTail.classList.remove('active');
    applyMode();
    controls.autoRotate = false;
    btnRotate.textContent = '🔄 Auto-Rotation: AUS';

    // Menü schließen und Start-Modus beenden
    uiPanel.classList.add('hidden');
    uiPanel.classList.remove('start-mode');
    btnMenu.classList.remove('active');

    // HUD und Steuerelemente einblenden (Spiel startet im Cockpit → dort zeigen die
    // Fahrzeug-Displays Gang/Drehzahl/Tempo, das DOM-HUD bleibt aus)
    document.getElementById('hud-top').style.display = 'none';
    document.getElementById('hint').style.display = 'none';
    document.getElementById('title').style.display = '';
    document.getElementById('laptimer').style.display = '';

    // Immer in der Cockpit-Sicht ins Spiel starten
    cameraMode = 1;
    applyCameraMode();

    // Zeitfahren ab der ersten Runde scharf schalten
    gameStarted = true;
    armLap();

    // Ghost-Car nur im Training anzeigen
    document.getElementById('btn-ghost').style.display = isRace ? 'none' : '';

    // Rennmodus: erst Qualifikation; Training: kein Rennablauf
    if (raceMode) startRaceQuali(); else raceReset();
  }

  document.getElementById('btn-training').addEventListener('click', () => startGame(false));
  document.getElementById('btn-rennen').addEventListener('click', () => startGame(true));
}

// ---------- Menü ein-/ausblenden (Taste M, Klick auf den Menü-Button, Esc schließt) ----------
const uiPanel = document.getElementById('ui');
const btnMenu = document.getElementById('menu-toggle');
const pauseLabel = document.getElementById('pause-label');
function toggleMenu(show) {
  // Im Startmodus (vor dem Spielstart) ist das Menü nicht bedienbar
  if (!gameStarted) return;
  // ohne Argument umschalten, sonst gezielt öffnen/schließen
  const open = (show === undefined) ? uiPanel.classList.contains('hidden') : show;
  uiPanel.classList.toggle('hidden', !open);
  btnMenu.classList.toggle('active', open);
  // „Spiel pausiert" mittig einblenden, solange das Menü offen ist
  pauseLabel.classList.toggle('visible', open);
  // Controller-Navigation: beim Öffnen erste Option markieren, beim Schließen aufräumen
  if (open) { menuIndex = 0; highlightMenuItem(); }
  else { clearMenuHighlight(); }
}
btnMenu.addEventListener('click', () => toggleMenu());

// ---------- Menü-Navigation per Controller (D-Pad hoch/runter, A wählt aus) ----------
let menuIndex = 0;
function getMenuItems() {
  // nur sichtbare Buttons (ausgeblendete Renn-Knöpfe nicht per D-Pad ansteuern)
  return Array.from(uiPanel.querySelectorAll('.btn')).filter((b) => b.offsetParent !== null);
}
function highlightMenuItem() {
  const items = getMenuItems();
  items.forEach((b, i) => b.classList.toggle('nav-selected', i === menuIndex));
  items[menuIndex]?.scrollIntoView({ block: 'nearest' });
}
function clearMenuHighlight() {
  getMenuItems().forEach((b) => b.classList.remove('nav-selected'));
}
function moveMenuSelection(dir) {
  const items = getMenuItems();
  if (!items.length) return;
  menuIndex = (menuIndex + dir + items.length) % items.length;
  highlightMenuItem();
}

// ---------- Controller-Navigation im Startmenü (Kreuztasten wechseln, A bestätigt) ----------
let startNavIndex = 0;
function getStartItems() {
  // Buttons des aktuell sichtbaren Vor-Spiel-Bildschirms
  const mode = document.getElementById('mode-screen');
  const start = document.getElementById('start-screen');
  if (mode && mode.classList.contains('visible')) {
    return [document.getElementById('btn-training'), document.getElementById('btn-rennen')];
  }
  if (start && start.classList.contains('visible')) {
    return [document.getElementById('btn-start')];
  }
  return [];
}
function highlightStartItem() {
  const items = getStartItems();
  if (startNavIndex >= items.length) startNavIndex = 0;
  items.forEach((b, i) => b && b.classList.toggle('cnav-selected', i === startNavIndex));
}
function moveStartSelection(dir) {
  const items = getStartItems();
  if (!items.length) return;
  startNavIndex = (startNavIndex + dir + items.length) % items.length;
  highlightStartItem();
}

// ---------- Streckenauswahl (vor der Modus-Wahl) ----------
const _trackMapCache = {};
function setTrackMap(track) {
  const pathEl = document.getElementById('track-map-path');
  if (!pathEl) return;
  if (_trackMapCache[track.id]) { pathEl.setAttribute('d', _trackMapCache[track.id]); return; }
  pathEl.setAttribute('d', '');
  fetch(track.file).then((r) => r.text()).then((text) => {
    const rows = text.split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').map(Number));
    const xs = rows.map((r) => r[0]), ys = rows.map((r) => r[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY, scale = 88 / Math.max(w, h);
    const ox = (100 - w * scale) / 2, oy = (100 - h * scale) / 2;
    let d = '';
    for (let i = 0; i < rows.length; i++) {
      // y spiegeln, damit Norden oben ist (SVG-y zeigt nach unten)
      const px = ox + (xs[i] - minX) * scale, py = oy + (maxY - ys[i]) * scale;
      d += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1) + ' ';
    }
    d += 'Z';
    _trackMapCache[track.id] = d;
    if (TRACKS[selectedTrackIndex].id === track.id) pathEl.setAttribute('d', d);
  }).catch(() => {});
}
function renderTrackScreen() {
  const t = TRACKS[selectedTrackIndex];
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('track-name', t.name);
  set('track-country', t.country);
  set('track-length', t.length);
  const bt = bestByTrack[t.id];
  set('track-best', bt != null ? `Bestzeit ${fmtTime(bt)}` : 'Bestzeit —:—');
  setTrackMap(t);
}
function cycleTrack(dir) {
  selectedTrackIndex = (selectedTrackIndex + dir + TRACKS.length) % TRACKS.length;
  renderTrackScreen();
}
function showTrackScreen() {
  renderTrackScreen();
  document.getElementById('track-screen').classList.add('visible');
}
function confirmTrackSelection() {
  const t = TRACKS[selectedTrackIndex];
  // Nach der Strecke kommt die Autoauswahl, erst danach die Modus-Wahl
  const proceed = () => {
    document.getElementById('track-screen').classList.remove('visible');
    showCarScreen();
  };
  if (t.file !== trackLoadedFile) loadTrack(t.file).then(proceed); else proceed();
}
{
  const byId = (id) => document.getElementById(id);
  byId('track-prev')?.addEventListener('click', () => cycleTrack(-1));
  byId('track-next')?.addEventListener('click', () => cycleTrack(1));
  byId('track-confirm')?.addEventListener('click', confirmTrackSelection);
}

// ---------- Autoauswahl (nach der Strecke, vor der Modus-Wahl) ----------
// Zeigt je Auto die Originaldaten aus CARS[i].specs unten rechts an. Die Fahrphysik
// wird beim Laden des Modells aus CARS[i].phys übernommen (siehe applyCarPhysics).
let selectedCarIndex = currentCarIndex;
// Ergebnis der Verfügbarkeitsprüfung je Auto: true = Datei da, false = fehlt, undefined = ungeprüft
const carFileAvailable = {};
let carLoadPending = false; // solange true ist „Weiter" gesperrt (Modell lädt gerade)

// Reihenfolge und Beschriftung der Datenblatt-Zeilen
const SPEC_ROWS = [
  ['klasse', 'Klasse'],
  ['baujahr', 'Baujahr'],
  ['motor', 'Motor'],
  ['leistung', 'Leistung'],
  ['gewicht', 'Gewicht'],
  ['accel', '0–100 km/h'],
  ['vmax', 'Höchstgeschwindigkeit'],
  ['antrieb', 'Antrieb'],
  ['getriebe', 'Getriebe'],
];
// 0–100 und Vmax werden im Datenblatt farbig hervorgehoben
const SPEC_KEY_FIGURES = new Set(['accel', 'vmax']);

function renderCarScreen() {
  const cfg = CARS[selectedCarIndex];
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('car-name', cfg.name);
  set('car-class', cfg.specs.klasse);
  set('car-specs-title', `Originaldaten · ${cfg.short}`);

  // Kachel in den Farben der jeweiligen Marke
  document.getElementById('car-slot')?.classList.toggle('toyota', cfg.id === 'ts030');

  // Datenblatt unten rechts
  const rows = document.getElementById('car-specs-rows');
  if (rows) {
    rows.replaceChildren(...SPEC_ROWS.filter(([k]) => cfg.specs[k]).map(([k, label]) => {
      const row = document.createElement('div');
      row.className = SPEC_KEY_FIGURES.has(k) ? 'spec-row key-figure' : 'spec-row';
      const key = document.createElement('span');
      key.className = 'spec-key';
      key.textContent = label;
      const val = document.createElement('span');
      val.className = 'spec-val';
      val.textContent = cfg.specs[k];
      row.append(key, val);
      return row;
    }));
  }

  // Fehlt die Modelldatei, wird das Auto klar gekennzeichnet und „Weiter" gesperrt
  const missingEl = document.getElementById('car-missing');
  const available = carFileAvailable[cfg.id];
  if (missingEl) {
    const missing = available === false;
    missingEl.style.display = missing ? '' : 'none';
    if (missing) missingEl.textContent = `3D-Modell fehlt: ${cfg.file}`;
  }
  const confirmBtn = document.getElementById('car-confirm');
  if (confirmBtn) {
    confirmBtn.disabled = available === false || carLoadPending;
    confirmBtn.textContent = carLoadPending ? 'Lädt Modell …' : 'Weiter ▸';
  }
}

function cycleCar(dir) {
  if (carLoadPending) return; // während des Ladens nicht umschalten
  selectedCarIndex = (selectedCarIndex + dir + CARS.length) % CARS.length;
  renderCarScreen();
}

function showCarScreen() {
  selectedCarIndex = currentCarIndex;
  carLoadPending = false;
  renderCarScreen();
  document.getElementById('car-screen').classList.add('visible');
  // Einmalig prüfen, welche Modelldateien tatsächlich vorhanden sind
  CARS.forEach((cfg) => {
    if (carFileAvailable[cfg.id] !== undefined) return;
    fetch(cfg.file, { method: 'HEAD' })
      .then((r) => { carFileAvailable[cfg.id] = r.ok; })
      .catch(() => { carFileAvailable[cfg.id] = false; })
      .then(() => { if (CARS[selectedCarIndex].id === cfg.id) renderCarScreen(); });
  });
}

function confirmCarSelection() {
  if (carLoadPending || carFileAvailable[CARS[selectedCarIndex].id] === false) return;
  const toModeScreen = () => {
    carLoadPending = false;
    document.getElementById('car-screen').classList.remove('visible');
    document.getElementById('mode-screen').classList.add('visible');
    startNavIndex = 0; // Modus-Navigation startet bei „Training"
  };
  // Schon geladen? Dann direkt weiter, sonst erst das Modell nachladen.
  if (selectedCarIndex === currentCarIndex && currentCar) { toModeScreen(); return; }
  carLoadPending = true;
  renderCarScreen();
  loadCar(selectedCarIndex, toModeScreen, () => {
    // Laden fehlgeschlagen: im Auswahlbildschirm bleiben und das Auto markieren
    carFileAvailable[CARS[selectedCarIndex].id] = false;
    carLoadPending = false;
    renderCarScreen();
  });
}
{
  const byId = (id) => document.getElementById(id);
  byId('car-prev')?.addEventListener('click', () => cycleCar(-1));
  byId('car-next')?.addEventListener('click', () => cycleCar(1));
  byId('car-confirm')?.addEventListener('click', confirmCarSelection);
}

// ---------- Kameraperspektive umschalten (Taste T, Klick auf den Ansicht-Button) ----------
const btnView = document.getElementById('btn-view');
function applyCameraMode() {
  if (cameraMode === 1) {
    // Cockpit: OrbitControls aus, weiteres Sichtfeld
    controls.enabled = false;
    controls.autoRotate = false;
    camera.fov = COCKPIT_FOV;
    btnRotate.textContent = '🔄 Auto-Rotation: AUS';
  } else {
    // Verfolgerkamera: OrbitControls wieder aktiv, Standard-Sichtfeld
    controls.enabled = true;
    camera.fov = CHASE_FOV;
    camera.up.set(0, 1, 0); // mögliche Cockpit-Neigung zurücksetzen
    prevCarPos.copy(carGroup.position); // kein Sprung beim Zurückschalten
    lookYaw = 0;
    lookPitch = 0;
  }
  camera.updateProjectionMatrix();
  applyExposure(); // Cockpit 15 % gedämmt
  // Im Cockpit zeigen die Fahrzeug-Displays Gang/Drehzahl/Tempo → DOM-HUD nur im Verfolger-Modus
  if (gameStarted) document.getElementById('hud-top').style.display = cameraMode === 1 ? 'none' : '';
  btnView.textContent = `🎥 Ansicht: ${cameraMode === 1 ? 'Cockpit' : 'Verfolger'}`;
  btnView.classList.toggle('active', cameraMode === 1);
}
function toggleCameraMode() {
  cameraMode = cameraMode === 1 ? 0 : 1;
  applyCameraMode();
}
btnView.addEventListener('click', toggleCameraMode);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleMenu();
  else if (e.code === 'Escape') toggleMenu(false);
  else if (e.code === 'KeyT') toggleCameraMode();
});

// Maus-Umsehen in der Cockpit-Sicht (nur bei gehaltener Maustaste)
renderer.domElement.addEventListener('pointermove', (e) => {
  if (cameraMode !== 1 || e.buttons === 0) return;
  lookYaw = THREE.MathUtils.clamp(lookYaw - e.movementX * 0.0035, -Math.PI / 2, Math.PI / 2);
  lookPitch = THREE.MathUtils.clamp(lookPitch - e.movementY * 0.0030, -Math.PI / 4, Math.PI / 5);
});

// ---------- Fahrsteuerung ----------
// W = Gas, A/D = Lenken, Leertaste = Bremse, S = Rückwärts
//
// Alle folgenden Größen gehören zum aktuell gewählten Auto und werden von
// applyCarPhysics() aus CARS[i].phys gesetzt (deshalb `let` statt `const`).
// Beispiel BMW M4 GT3 EVO: 3,0-l-R6-Biturbo, ~590 PS (BoP), ~1300 kg,
// sequenzielles 6-Gang-Getriebe, Rennslicks, große Aero (Abtrieb wächst mit dem Tempo).
let MASS = 1300;                 // kg Fahrzeugmasse
let POWER_WHEEL = 440000 * 0.9;  // W an den Rädern
let F_TRACTION = 16500;          // N Traktionsgrenze beim Start (Slicks)
let ACCEL_BOOST = 1.15;          // Feinabstimmung der Beschleunigung auf die Originaldaten
// Power-Oversteer: Heckantrieb – übersteigt die Antriebskraft die Heck-Haftung,
// drehen die Hinterräder durch und das Heck bricht aus.
let DRIVE_REAR = 1.0;                      // Anteil der Antriebskraft am Heck
let REAR_GRIP = 0.52 * MASS * 9.81 * 1.30; // max. Längskraft am Heck (Achslast · μ)
let OVERSTEER_GAIN = 0.8;                  // wie stark das Heck bei Schlupf eindreht
let BRAKE_DECEL = 17.5;          // m/s² Bremsverzögerung
const RHO_AIR = 1.225;           // kg/m³ Luftdichte (autounabhängig)
let CD_AREA = 0.47 * 2.2;        // cw · Stirnfläche (m²)
let ROLL_RES = 0.013;            // Rollwiderstandsbeiwert
let VMAX = 280 / 3.6;            // m/s Topspeed
const MAX_REVERSE = -20 / 3.6;   // m/s rückwärts (für alle Autos gleich)

// Querdynamik (Einspurmodell): mechanischer Slick-Grip plus Aero-Abtrieb,
// der die Kurvenhaftung mit steigendem Tempo erhöht.
let WHEELBASE   = 2.85;              // m Radstand
let MAX_LAT_ACC = 1.05 * 9.81;       // m/s² mechanische Haftgrenze (ohne Abtrieb)
// Abtriebs-Zuschlag aufs Grip-Budget: wächst quadratisch mit dem Tempo
let aeroGrip = (v) => 1 + Math.min(0.45, v * v * 0.00008);
let MAX_STEER   = 27.2 * Math.PI / 180; // max. Radeinschlag (rad)
let STEER_RATE  = 3.0;               // Lenkgeschwindigkeit
let steerAngle = 0;                    // aktueller Radeinschlag

// Fahrphysik auf das gewählte Auto umstellen. Wird vor jedem Laden eines Modells
// aufgerufen, damit Getriebe, Gewicht und Grip zu den Originaldaten passen.
function applyCarPhysics(cfg) {
  const p = cfg.phys;
  MASS = p.mass;
  POWER_WHEEL = p.powerWheel;
  F_TRACTION = p.fTraction;
  ACCEL_BOOST = p.accelBoost;
  DRIVE_REAR = p.driveRear;
  REAR_GRIP = p.rearGripFrac * p.mass * 9.81 * p.rearGripMu;
  OVERSTEER_GAIN = p.oversteerGain;
  BRAKE_DECEL = p.brakeDecel;
  CD_AREA = p.cdArea;
  ROLL_RES = p.rollRes;
  VMAX = p.vmaxKmh / 3.6;
  WHEELBASE = p.wheelbase;
  MAX_LAT_ACC = p.maxLatG * 9.81;
  aeroGrip = (v) => 1 + Math.min(p.aeroMax, v * v * p.aeroK);
  MAX_STEER = p.maxSteerDeg * Math.PI / 180;
  STEER_RATE = p.steerRate;
  // Getriebe: Gang-Höchsttempo (km/h → m/s) und Zugkraft je Gang
  GEAR_MAX_SPEED = p.gearMaxKmh.map((v) => v / 3.6);
  GEAR_PULL = p.gearPull.slice();
  LEERLAUF = p.leerlauf;
  DREHZAHL_MAX = p.drehzahlMax;
  // Bots fahren dasselbe Auto wie der Spieler → gleiches Tempolimit
  BOT_MAX_SPEED = VMAX;
  // Sitzposition, Lenkrad-Geometrie und Display-Anordnung ans Cockpit anpassen
  Object.assign(COCKPIT_EYE, cfg.cockpitEye);
  Object.assign(STEER_WHEEL, cfg.steerWheel);
  COCKPIT_SCREENS = cfg.cockpit;
}


let speed = 0;
const keys = new Set();
const speedNumEl = document.getElementById('speed-num');
const gearEl = document.getElementById('gear');

// Manuelles 6-Gang-Getriebe: je Gang ein Drehzahllimit (Gang-Höchsttempo) und ein
// Zugkraft-Faktor. Niedriger Gang = viel Zugkraft, wenig Topspeed; hoher Gang
// umgekehrt. Man muss mit RB/E hochschalten, um schneller als das Gang-Limit zu fahren.
// Beide Tabellen gehören zum gewählten Auto und werden von applyCarPhysics() gesetzt.
let GEAR_MAX_SPEED = [0, 60, 100, 140, 180, 225, 300].map((v) => v / 3.6); // km/h → m/s
let GEAR_PULL = [0, 1.0, 0.76, 0.58, 0.48, 0.40, 0.34]; // Zugkraft-Faktor je Gang (höhere Gänge kräftiger → mehr Topspeed-Durchzug)
// Drehzahlbereich des aktuellen Motors (nur für die Anzeige)
let LEERLAUF = 1300, DREHZAHL_MAX = 7300;
let gear = 1; // 0 = Rückwärtsgang (R), 1…6 = Vorwärtsgänge
let prevGearSound = 1; // letzter Gang – für den Schaltsound (Hoch-/Runterschalten)
let autoGearbox = false; // false = Handschaltung, true = Automatikgetriebe
let autoReverse = false; // Automatik: true = Rückwärtsgang (R) gewählt (Tastatur W/S bzw. Controller LB/RB)
// Manuell schalten geht nur bei der Handschaltung – im Automatikmodus übernimmt das Spiel.
const shiftUp = () => { if (!autoGearbox) gear = Math.min(6, gear + 1); };
const shiftDown = () => { if (!autoGearbox) gear = Math.max(0, gear - 1); };

// Automatikgetriebe: wählt Fahrtrichtung (D/R) und Gang selbsttätig nach Tempo.
// Richtung per Tastatur (W/S); der Controller setzt sie über LB/RB direkt (autoReverse).
function autoShiftGear(keyFwd, keyRev) {
  if (!autoGearbox) return;
  const vAbs = Math.abs(speed);
  if (vAbs < 0.5) {
    if (keyFwd && !keyRev) autoReverse = false;        // W → Fahrstufe D
    else if (keyRev && !keyFwd) autoReverse = true;    // S → Rückwärtsgang R
    gear = autoReverse ? 0 : Math.max(gear, 1);
  } else if (gear >= 1) {
    // Vorwärts: kurz vorm Gang-Höchsttempo hoch-, bei zu niedriger Drehzahl runterschalten
    const frac = vAbs / GEAR_MAX_SPEED[gear];
    if (frac >= 0.93 && gear < 6) gear++;
    else if (gear > 1 && vAbs < GEAR_MAX_SPEED[gear - 1] * 0.62) gear--;
  }
}

// Schaltblitz-Anzeige (5 Lichter grün→rot). Sie zeigt die Drehzahl im aktuellen
// Gang: Je näher am Gang-Höchsttempo, desto mehr Lichter. Leuchtet das 5. (rote)
// Licht und blinkt alles, ist die perfekte Drehzahl zum HOCHSCHALTEN erreicht.
// Sind die Touren zu niedrig (nur die grünen blinken), ist RUNTERSCHALTEN dran.
const revLights = [...document.querySelectorAll('#revlights i')];
const REV_TH = [0.45, 0.6, 0.72, 0.83, 0.9]; // Drehzahl-Anteil, ab dem Licht 1…5 angeht

function updateRevLights(spd) {
  const forward = spd > 0.5 && gear >= 1; // im Rückwärtsgang keine Drehzahllichter
  const frac = forward ? Math.min(1, spd / GEAR_MAX_SPEED[gear]) : 0;
  let count = 0;
  let upShift = false;
  let downShift = false;
  if (forward) {
    if (frac >= REV_TH[4]) { count = 5; upShift = gear < 6; } // perfekter Hochschaltpunkt
    else count = REV_TH.filter((t) => frac >= t).length;
    if (frac < 0.22 && gear > 1) downShift = true; // Drehzahl zu niedrig → runterschalten
  }
  for (let i = 0; i < revLights.length; i++) {
    const on = downShift ? i < 2 : i < count;
    revLights[i].classList.toggle('on', on);
    revLights[i].classList.toggle('blink', on && (upShift || downShift));
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault(); // Seite soll nicht scrollen
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyL') shiftUp();   // hochschalten
  if (e.code === 'KeyJ') shiftDown(); // runterschalten
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    // Beim Losfahren die automatische Drehung beenden
    if (controls.autoRotate) {
      controls.autoRotate = false;
      btnRotate.textContent = '🔄 Auto-Rotation: AUS';
    }
  }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

const has = (...codes) => codes.some((c) => keys.has(c));

// ---------- Xbox-Controller (Gamepad-API) ----------
// RT = Gas, LT = Bremse (im Stand: Rückwärts), linker Stick = Lenken,
// X = Scheinwerfer, B = Rücklichter, Y = Tag/Nacht
const padPrev = {};
window.addEventListener('gamepadconnected', (e) => {
  console.log('Controller verbunden:', e.gamepad.id);
  // Steuerungs-Erklärung erscheint nur im Startmenü (#start-keys)
  const startKeys = document.getElementById('start-keys');
  if (startKeys) {
    startKeys.innerHTML =
      '🎮 RT Gas · LT Bremse · L-Stick Lenken · R-Stick Kamera · RB/LB Schalten · X/B Licht · Y Tag/Nacht · ☰ Menü (D-Pad ↑↓ · A wählen) · D-Pad ←/→ Zoom';
  }
});

function readGamepad() {
  if (!navigator.getGamepads) return null;
  for (const p of navigator.getGamepads()) {
    if (p && p.connected) return p;
  }
  return null;
}

// Flankenerkennung: true nur in dem Frame, in dem die Taste neu gedrückt wird
function padPressedOnce(pad, i) {
  const now = !!pad.buttons[i]?.pressed;
  const was = !!padPrev[i];
  padPrev[i] = now;
  return now && !was;
}

// ---------- Kollisionen: Auto gegen Mauern und Gebäude ----------
// Beide Hitboxen sind gedrehte Rechtecke auf dem Boden (2D-OBB). Der Test läuft
// per Separating-Axis-Theorem: Überlappen die Projektionen auf allen vier Achsen,
// liegt eine Kollision vor; die Achse mit der kleinsten Überlappung ist die
// Richtung, in die das Auto herausgeschoben wird.
function obbPushOut(a, b) {
  const axes = [
    [a.ax, a.az], [-a.az, a.ax],
    [b.ax, b.az], [-b.az, b.ax],
  ];
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  let minOverlap = Infinity, nx = 0, nz = 0;

  for (const [ux, uz] of axes) {
    // Halbe Ausdehnung beider Rechtecke entlang der Achse
    const ra = a.halfLen * Math.abs(ux * a.ax + uz * a.az) + a.halfWid * Math.abs(-ux * a.az + uz * a.ax);
    const rb = b.halfLen * Math.abs(ux * b.ax + uz * b.az) + b.halfWid * Math.abs(-ux * b.az + uz * b.ax);
    const d = ux * dx + uz * dz;
    const overlap = ra + rb - Math.abs(d);
    if (overlap <= 0) return null; // Trennachse gefunden → keine Kollision
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const s = d > 0 ? -1 : 1; // vom Hindernis weg zeigen
      nx = ux * s;
      nz = uz * s;
    }
  }
  return { x: nx * minOverlap, z: nz * minOverlap, nx, nz };
}

let botColliders = []; // bewegliche Hitboxen der Gegner-Bots (jede Frame aktualisiert)

// Räumliches Raster über die Banden-Boxen: Szenerie-Strecken liefern zehntausende
// Boxen – pro Frame werden dann nur noch die Zellen rund ums Auto geprüft.
function buildColliderGrid() {
  if (trackColliders.length < 2000) { colliderGrid = null; return; }
  colliderGrid = new Map();
  for (const w of trackColliders) {
    const r = Math.max(w.halfLen, w.halfWid);
    const x0 = Math.floor((w.cx - r) / COLL_CELL), x1 = Math.floor((w.cx + r) / COLL_CELL);
    const z0 = Math.floor((w.cz - r) / COLL_CELL), z1 = Math.floor((w.cz + r) / COLL_CELL);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const k = x + '|' + z;
      let a = colliderGrid.get(k);
      if (!a) colliderGrid.set(k, a = []);
      a.push(w);
    }
  }
}

// Banden-Boxen in Autonähe einsammeln (wiederverwendetes Array, keine Allokation)
const _nearWalls = [];
function collectNearWalls(cx, cz) {
  _nearWalls.length = 0;
  const R = 8; // Auto-Halblänge + Schiebe-Reserve
  const x0 = Math.floor((cx - R) / COLL_CELL), x1 = Math.floor((cx + R) / COLL_CELL);
  const z0 = Math.floor((cz - R) / COLL_CELL), z1 = Math.floor((cz + R) / COLL_CELL);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const a = colliderGrid.get(x + '|' + z);
    if (a) for (const w of a) _nearWalls.push(w);
  }
  return _nearWalls;
}

function resolveCollisions() {
  if (!carForward) return;
  const fwd = carForward.clone().applyAxisAngle(UP, carYaw);
  const car = {
    cx: carGroup.position.x, cz: carGroup.position.z,
    ax: fwd.x, az: fwd.z,
    halfLen: carHalf.len, halfWid: carHalf.wid,
  };

  // getrennt iterieren statt concat (keine Kopie pro Frame); mit Raster nur die Nähe
  const walls = colliderGrid ? collectNearWalls(car.cx, car.cz) : trackColliders;
  for (let li = 0; li < 2; li++) {
  const list = li === 0 ? walls : botColliders;
  for (const w of list) {
    // Grober Abstandstest, bevor das genaue SAT rechnet
    const ddx = w.cx - car.cx, ddz = w.cz - car.cz;
    const reach = car.halfLen + Math.max(w.halfLen, w.halfWid) + 0.5;
    if (ddx * ddx + ddz * ddz > reach * reach) continue;

    const push = obbPushOut(car, w);
    if (!push) continue;

    // Auto aus der Wand herausschieben
    car.cx += push.x;
    car.cz += push.z;
    carGroup.position.x = car.cx;
    carGroup.position.z = car.cz;

    // Der Tempo-Anteil in Richtung Wand geht verloren, der Rest gleitet an ihr
    // entlang (frontal = harter Stopp, schräg = Schrammen mit Tempoverlust)
    const align = fwd.x * push.nx + fwd.z * push.nz;
    if (speed * align < 0) {
      const before = speed;
      const slide = Math.sqrt(Math.max(0, 1 - align * align));
      speed *= slide * 0.9;
      // Crash mit einem Auto (Bot): nicht auf 0, sondern auf das Tempo des anderen abbremsen
      if (w.v !== undefined && before > 0) speed = Math.max(speed, Math.min(before, w.v));
      // Reifen-Bande: Aufprall drückt die getroffenen Reifen weg (nur Optik)
      else if (w.tireFrom !== undefined) damageTireWall(w, before, push);
    }
  }
  }
}

// Reifen-Bande verformen: die Reifen des getroffenen Segments werden nach außen
// (von der Strecke weg) gedrückt und leicht verstreut – bleibender Schaden bis Streckenwechsel.
const _dmgMat = new THREE.Matrix4();
function damageTireWall(w, impactSpeed, push) {
  if (!tireWall || !tireDmg) return;
  const sev = Math.min(1.3, Math.abs(impactSpeed) / 22); // 0…1,3 je nach Aufprallhärte
  if (sev < 0.28) return;                                // sanftes Touchieren beschädigt nichts
  const ox = -push.nx, oz = -push.nz;                    // nach außen (von der Strecke weg)
  const tx = -oz, tz = ox;                               // tangential entlang der Bande
  for (let i = w.tireFrom; i < w.tireTo; i++) {
    const s = sev * (0.6 + Math.random() * 0.8);
    const lat = (Math.random() - 0.5);
    const dx = ox * s * 1.1 + tx * lat * 0.5;
    const dz = oz * s * 1.1 + tz * lat * 0.5;
    const dy = -s * 0.22 - Math.random() * 0.1;          // Reifen kippen/sacken ab
    const b = i * 3;
    tireDmg[b]     = THREE.MathUtils.clamp(tireDmg[b] + dx, -2.5, 2.5);
    tireDmg[b + 1] = THREE.MathUtils.clamp(tireDmg[b + 1] + dy, -0.55, 0.2);
    tireDmg[b + 2] = THREE.MathUtils.clamp(tireDmg[b + 2] + dz, -2.5, 2.5);
    const base = tireWall.base[i];
    tireWall.mesh.getMatrixAt(i, _dmgMat);
    _dmgMat.elements[12] = base.x + tireDmg[b];
    _dmgMat.elements[13] = base.y + tireDmg[b + 1];
    _dmgMat.elements[14] = base.z + tireDmg[b + 2];
    tireWall.mesh.setMatrixAt(i, _dmgMat);
  }
  tireWall.mesh.instanceMatrix.needsUpdate = true;
}

function updateCar(dt) {
  // Tastatur-Eingaben
  let throttle = has('KeyW', 'ArrowUp') ? 1 : 0;
  let reverse = has('KeyS', 'ArrowDown') ? 1 : 0;
  let brakeInput = has('Space') ? 1 : 0;
  let steer = (has('KeyA', 'ArrowLeft') ? 1 : 0) - (has('KeyD', 'ArrowRight') ? 1 : 0);

  // Controller-Eingaben (überstimmen bzw. ergänzen die Tastatur, Trigger sind analog)
  const pad = readGamepad();
  if (pad) {
    const rt = pad.buttons[7]?.value ?? 0; // rechter Trigger
    const lt = pad.buttons[6]?.value ?? 0; // linker Trigger
    const stickX = pad.axes[0] ?? 0;

    // Ton beim ersten Controller-Knopfdruck freischalten (Gamepad löst kein keydown aus)
    if (!audioUnlocked && (rt > 0.02 || lt > 0.02 || Math.abs(stickX) > 0.12 || pad.buttons.some((b) => b?.pressed))) {
      unlockAudio();
    }

    if (rt > 0.02) throttle = Math.max(throttle, rt);
    // LT bremst – in jedem Gang. Im R-Gang treibt RT (Gas) rückwärts (reverseInput nutzt throttle).
    if (lt > 0.02) brakeInput = Math.max(brakeInput, lt);

    const dz = 0.12; // Deadzone gegen Stick-Drift
    if (Math.abs(stickX) > dz) {
      steer = -Math.sign(stickX) * (Math.abs(stickX) - dz) / (1 - dz);
    }

    if (padPressedOnce(pad, 2)) btnHead.click();     // X
    if (padPressedOnce(pad, 1)) btnTail.click();     // B
    if (padPressedOnce(pad, 3)) btnDayNight.click(); // Y
    // RB / LB: Handschaltung = hoch/runter; Automatik = Fahrstufe D (vorwärts) / R (rückwärts)
    if (padPressedOnce(pad, 5)) { if (autoGearbox) { autoReverse = false; gear = Math.max(gear, 1); } else shiftUp(); }
    if (padPressedOnce(pad, 4)) { if (autoGearbox) { autoReverse = true; gear = 0; } else shiftDown(); }
    if (padPressedOnce(pad, 9)) toggleMenu();        // ☰ Menü-Button (drei Striche)

    // Menü-Navigation: D-Pad hoch/runter bewegt die Auswahl, A löst sie aus
    // (nur nach dem Start – im Startmodus ist das Menü nicht bedienbar)
    const menuOpen = gameStarted && !uiPanel.classList.contains('hidden');
    if (menuOpen) {
      if (padPressedOnce(pad, 12)) moveMenuSelection(-1); // D-Pad hoch
      if (padPressedOnce(pad, 13)) moveMenuSelection(1);  // D-Pad runter
      if (padPressedOnce(pad, 0)) getMenuItems()[menuIndex]?.click(); // A = auswählen
    }

    // Startmenü (vor dem Spielstart): Kreuztasten wechseln, A bestätigt
    if (!gameStarted) {
      const trackScr = document.getElementById('track-screen');
      const carScr = document.getElementById('car-screen');
      if (trackScr && trackScr.classList.contains('visible')) {
        // Streckenauswahl: Kreuztasten wechseln die Strecke, A bestätigt
        if (padPressedOnce(pad, 14) || padPressedOnce(pad, 12)) cycleTrack(-1);
        if (padPressedOnce(pad, 15) || padPressedOnce(pad, 13)) cycleTrack(1);
        if (padPressedOnce(pad, 0)) confirmTrackSelection();
      } else if (carScr && carScr.classList.contains('visible')) {
        // Autoauswahl: Kreuztasten wechseln das Auto, A bestätigt
        if (padPressedOnce(pad, 14) || padPressedOnce(pad, 12)) cycleCar(-1);
        if (padPressedOnce(pad, 15) || padPressedOnce(pad, 13)) cycleCar(1);
        if (padPressedOnce(pad, 0)) confirmCarSelection();
      } else {
        const startItems = getStartItems();
        if (startItems.length) {
          highlightStartItem(); // Auswahl sichtbar halten (auch ohne Eingabe)
          if (padPressedOnce(pad, 14) || padPressedOnce(pad, 12)) moveStartSelection(-1); // links / hoch
          if (padPressedOnce(pad, 15) || padPressedOnce(pad, 13)) moveStartSelection(1);  // rechts / runter
          if (padPressedOnce(pad, 0)) startItems[startNavIndex]?.click();                 // A = bestätigen
        }
      }
    }

    if ((throttle > 0 || brakeInput > 0 || Math.abs(stickX) > dz) && controls.autoRotate) {
      controls.autoRotate = false;
      btnRotate.textContent = '🔄 Auto-Rotation: AUS';
    }
  }

  // Bei geöffnetem Menü pausieren: Auto an Ort und Stelle einfrieren – das Tempo bleibt
  // erhalten, beim Schließen geht es nahtlos mit gleicher Geschwindigkeit weiter.
  // Die Menü-Bedienung (oben verarbeitet) bleibt aktiv.
  if (gamePaused()) {
    const gearForRev = gear >= 1 ? gear : 1;
    engineAudio.update(Math.min(1, Math.abs(speed) / GEAR_MAX_SPEED[gearForRev]), 0, dt);
    return;
  }

  // Bremslichter folgen dem Bremszustand (Tastatur wie Controller)
  const wantBrake = brakeInput > 0.05;
  if (wantBrake !== braking) {
    braking = wantBrake;
    applyTaillights();
  }

  // Untergrund-Grip: Gras am wenigsten Haftung, Kies dazwischen, Strecke voll.
  // overMul steuert, wie leicht das Heck ausbricht (→ Drehen um die eigene Achse).
  const onGrass = carOnGrass();
  const onGravelSurf = !onGrass && carOnGravel();
  const surfaceGrip = onGrass ? 0.315 : (onGravelSurf ? 0.55 : 1.0); // Standard-Grip (Gras bremst ~5 % weniger)
  // Automatisches Ausbrechen nur auf Gras/Kies – auf der Strecke greift es normal (kein Übersteuer-Zusatz).
  const overMul = onGrass ? 0.4 : (onGravelSurf ? 0.3 : 0);

  // Längsdynamik: Kräftebilanz aus Antrieb, Luft- und Rollwiderstand
  const v = Math.abs(speed);
  const fDrag = 0.5 * RHO_AIR * CD_AREA * v * v;          // Luftwiderstand
  const fRoll = v > 0.1 ? MASS * 9.81 * ROLL_RES : 0;      // Rollwiderstand
  let accel = 0;
  let slipTarget = 0; // angeforderter Heck-Schlupf dieses Frames (für den Oversteer)
  let longUse = 0;    // genutzte Längs-Haftung (Reibkreis): Gas/Bremse zehrt am Kurven-Grip

  // Automatikgetriebe wählt Gang/Richtung, bevor der Antrieb berechnet wird.
  // Richtungswahl per Tastatur nur über W/S (nicht über den RT-Gashebel des Controllers).
  autoShiftGear(has('KeyW', 'ArrowUp') ? 1 : 0, reverse);

  // Im Rückwärtsgang (R = Gang 0) fährt Gas rückwärts; sonst zählt die S/LT-Taste
  const reverseInput = gear === 0 ? Math.max(throttle, reverse) : reverse;

  if (braking) {
    accel = -Math.sign(speed) * (BRAKE_DECEL * brakeInput * surfaceGrip + (fDrag + fRoll) / MASS);
    longUse = BRAKE_DECEL * brakeInput * surfaceGrip;   // Bremskraft belegt Längs-Haftung
    // nicht über den Nullpunkt hinaus bremsen
    if (Math.abs(accel * dt) >= v) { speed = 0; accel = 0; }
  } else if (gear >= 1 && throttle) {
    // Antrieb über das gewählte Getriebe: Zugkraft sinkt mit steigendem Gang und
    // fällt im Gang gegen das Drehzahllimit (Gang-Höchsttempo) auf null ab.
    const vmaxGear = GEAR_MAX_SPEED[gear];
    if (v < vmaxGear) {
      const pull = F_TRACTION * GEAR_PULL[gear];
      const fade = Math.max(0, 1 - Math.pow(v / vmaxGear, 9)); // Renn-Drehband: Zugkraft bleibt bis kurz vor den Begrenzer voll da
      // weiterhin leistungsbegrenzt (P = F·v), beim Anfahren traktionsbegrenzt
      const fDrive = Math.min(pull, POWER_WHEEL / Math.max(v, 3)) * throttle * fade * ACCEL_BOOST;
      // Überschreitet der Heck-Anteil (90 %) die Heck-Haftung, drehen die Räder durch
      slipTarget = Math.max(0, (fDrive * DRIVE_REAR - REAR_GRIP) / REAR_GRIP);
      const grip = 1 - 0.12 * Math.min(1, slipTarget); // durchdrehende Reifen ziehen etwas schlechter
      // Untergrund: auf Gras/Kies greift der Antrieb nur anteilig (Gras = 30 %)
      accel = (fDrive * grip * surfaceGrip - fDrag - fRoll) / MASS;
      longUse = (fDrive * surfaceGrip) / MASS;          // Antriebskraft belegt Längs-Haftung
    } else {
      accel = -(fDrag + fRoll) / MASS; // Drehzahlbegrenzer: nur noch Fahrwiderstände
    }
  } else if (reverseInput) {
    accel = speed > 0
      ? -(BRAKE_DECEL * 0.6)                               // erst abbremsen …
      : -(Math.min(F_TRACTION, POWER_WHEEL / 5) - fDrag - fRoll) / MASS * 0.25 * reverseInput; // … dann rückwärts
  } else {
    // Ausrollen: nur Fahrwiderstände + leichte Motorbremse
    const d = (fDrag + fRoll) / MASS + 0.6;
    speed = v <= d * dt ? 0 : speed - Math.sign(speed) * d * dt;
  }

  speed += accel * dt;
  speed = Math.min(Math.max(speed, MAX_REVERSE), VMAX); // Abregelung

  // Lenkwinkel weich zum Zieleinschlag führen; Achsschaden macht die Lenkung schwammiger
  const steerTarget = steer * MAX_STEER;
  const rate = (steer === 0 ? STEER_RATE * 2 : STEER_RATE) * MAX_STEER * dt;
  steerAngle += THREE.MathUtils.clamp(steerTarget - steerAngle, -rate, rate);

  // Einspurmodell: Gierrate aus Radstand und Radeinschlag (ω = v/L · tan δ).
  // Vorzeichen von v dreht beim Rückwärtsfahren die Lenkung automatisch um.
  if (Math.abs(speed) > 0.05 && Math.abs(steerAngle) > 0.0005) {
    let omega = (speed / WHEELBASE) * Math.tan(steerAngle);

    // Reibkreis (Kammscher Kreis): das Reifen-Grip-Budget teilt sich auf Längs-
    // (Gas/Bremse) und Querkräfte auf. GT3: der mechanische Grip fällt mit dem Tempo
    // nur leicht ab, der Aero-Abtrieb ERHÖHT die Kurvenhaftung dafür deutlich –
    // schnelle Kurven haben mehr Grip als langsame (typisches Rennwagen-Verhalten).
    const speedGrip = THREE.MathUtils.clamp(1 - Math.max(0, v - 15) * 0.005, 0.72, 1) * aeroGrip(v);
    // Beim Gasgeben in der Kurve etwas mehr Grip (+10 % bei Vollgas) – stabilerer Kurvenausgang
    const throttleGrip = 1 + 0.1 * Math.min(1, throttle);
    const aMax = MAX_LAT_ACC * surfaceGrip * speedGrip * throttleGrip; // gesamtes Grip-Budget
    const longShare = Math.min(longUse, aMax);                 // davon längs belegt
    const latMax = Math.max(0.1 * aMax, Math.sqrt(aMax * aMax - longShare * longShare));

    const aLat = Math.abs(speed * omega);
    let slide = rearSlip;                       // Antriebs-Schlupf (durchdrehendes Heck)
    if (aLat > latMax) {
      slide += (aLat - latMax) / latMax;        // seitliches Wegrutschen am Grenzbereich
      omega *= latMax / aLat;
      speed -= Math.sign(speed) * Math.min(2 * dt, Math.abs(speed));
    }

    // Übersteuern: das ausbrechende Heck dreht das Auto zusätzlich um die Hochachse.
    // Auf Gras stark, auf Kies mittel, auf der Strecke nur leicht (mehr Grip).
    const overshoot = OVERSTEER_GAIN * overMul * Math.min(slide, 2) * Math.min(1, Math.abs(speed) / 6);
    omega += Math.sign(steerAngle) * Math.sign(speed) * overshoot;

    carYaw += omega * dt;
  }

  // Heck-Schlupf glätten
  rearSlip += (slipTarget - rearSlip) * Math.min(1, dt * 8);

  // Bewegung in Fahrtrichtung der Fahrzeugfront
  if (speed !== 0 && carForward) {
    const fwd = carForward.clone().applyAxisAngle(UP, carYaw);
    carGroup.position.addScaledVector(fwd, speed * dt);
  }

  // Kollisionen mit Mauern und Gebäuden auflösen
  resolveCollisions();

  // Höhenprofil der Szenerie folgen (z. B. Eau Rouge bergauf) + Nick-Winkel am Hang
  if (sceneryHeight && carForward) {
    const px = carGroup.position.x, pz = carGroup.position.z;
    carGroup.position.y = groundY(px, pz) + 0.05;
    const fwd = carForward.clone().applyAxisAngle(UP, carYaw);
    const hA = groundY(px + fwd.x * 2.5, pz + fwd.z * 2.5);
    const hB = groundY(px - fwd.x * 2.5, pz - fwd.z * 2.5);
    const target = Math.atan2(hA - hB, 5);
    carPitch += (target - carPitch) * Math.min(1, dt * 8);
  } else if (carPitch !== 0) {
    carPitch = 0;
  }

  // Seitenneigung auf Randsteinen bestimmen und Auto-Ausrichtung (Yaw + Roll) setzen
  updateCurbTilt(dt);
  applyCarOrientation();

  // Räder: Abrollen passend zum Tempo (ω = v/r), Vorderräder lenken sichtbar mit
  for (const w of wheels) {
    if (speed !== 0) w.spin.rotateOnAxis(w.axisLocal, (speed / w.radius) * dt);
    if (w.steer) w.steer.quaternion.setFromAxisAngle(w.upLocal, steerAngle);
  }

  // Cockpit-Lenkrad dreht mit – proportional zum Lenkeinschlag (analog per Stick),
  // übersetzt wie ein echtes Lenkrad (~120° Lenkradwinkel bei vollem Einschlag)
  for (const p of steeringParts) {
    // Volleinschlag (27,2° Radwinkel) ≈ 135° Lenkradwinkel
    p.pivot.quaternion.setFromAxisAngle(p.axisLocal, -steerAngle * (135 / 27.2));
  }


  speedNumEl.textContent = Math.round(Math.abs(speed) * 3.6);
  gearEl.innerHTML = `<span>GANG${autoGearbox ? ' · A' : ''}</span> ${gear === 0 ? 'R' : gear}`;
  updateRevLights(speed);

  // Schaltsound bei Gangwechsel (gilt für Hand- wie Automatikgetriebe; R bleibt stumm)
  if (gear !== prevGearSound) {
    if (gear >= 1 && prevGearSound >= 1) {
      if (gear > prevGearSound) {
        engineAudio.upshift();
        triggerFlames(1);            // Schaltknall → Flammen aus den Endrohren
      } else {
        engineAudio.downshift();
        triggerFlames(0.6);          // Zwischengas → kleinerer Feuerstoß
      }
    }
    prevGearSound = gear;
  }

  // Motorsound: Drehzahl aus dem Tempo im aktuellen Gang ableiten
  const gearForRev = gear >= 1 ? gear : 1;
  const rev = Math.min(1, Math.abs(speed) / GEAR_MAX_SPEED[gearForRev]);

  // Auspuff-Crackles: Gas bei hoher Drehzahl schlagartig wegnehmen → Knistern + Flammen
  if (prevThrottleIn > 0.55 && throttle < 0.1 && rev > 0.45 && crackleBurst <= 0) {
    engineAudio.crackle();
    crackleBurst = 0.45 + Math.random() * 0.3;
  }
  prevThrottleIn = throttle;

  engineAudio.update(rev, throttle, dt);
}
let prevThrottleIn = 0; // Gaspedal des Vorframes (für die Crackle-Erkennung)

// Sonne/Mond samt Schattenbereich folgen dem Auto
scene.add(sun.target, moon.target);
function updateLightsFollow() {
  const p = carGroup.position;
  sun.position.set(p.x + 90, 130, p.z + 60);
  sun.target.position.set(p.x, 0, p.z);
  moon.position.set(p.x - 80, 120, p.z - 50);
  moon.target.position.set(p.x, 0, p.z);
}

// ---------- Zeitfahren & Ghost-Car ----------
// Eine Runde wird gemessen, sobald das Auto die Start/Ziel-Linie (Mittellinienpunkt 0)
// vorwärts überfährt. Die schnellste Runde wird aufgezeichnet und in den folgenden
// Runden als halbtransparentes, durchfahrbares Ghost-Car synchron abgespielt.
let gameStarted = false;
let centerline = null; // { P, s, total, n }

// Spiel ist pausiert, solange das Menü während der Fahrt geöffnet ist
function gamePaused() {
  return gameStarted && !uiPanel.classList.contains('hidden');
}

function buildCenterline(cd) {
  const P = cd.pts, n = P.length;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    s[i] = s[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
  }
  const total = s[n - 1] + Math.hypot(P[0].x - P[n - 1].x, P[0].z - P[n - 1].z);
  centerline = { P, s, total, n };
}

// Kurze Bildschirmmeldung (z. B. „Zeitmessung gestartet!")
let raceMsgTimer = null;
const raceMsgEl = document.getElementById('race-msg');
function showRaceMsg(text, color) {
  raceMsgEl.textContent = text;
  raceMsgEl.style.color = color || '#ff5252';
  raceMsgEl.classList.add('visible');
  clearTimeout(raceMsgTimer);
  raceMsgTimer = setTimeout(() => raceMsgEl.classList.remove('visible'), 2600);
}

const ghost = {
  enabled: true,
  timing: false,
  lapElapsed: 0,
  prevProgress: 0,
  hasProgress: false,
  lastLap: null,
  bestLap: Infinity,
  recording: [],   // Samples der laufenden Runde: {t,x,y,z,yaw,roll}
  best: null,      // Samples der bisher schnellsten Runde
  bestDur: 0,
  mesh: null,      // Ghost-Objekt in der Szene
  cursor: 0,       // Abspiel-Cursor in best[]
  maxProgress: 0,  // höchster Streckenfortschritt der laufenden Runde (gegen Fehl-Überfahrten)
  offTrack: false, // alle vier Reifen abseits der Strecke (entprellt die Meldung)
};

// Startet als Aus-Runde (Warm-up): Die Zeit wird erst ab dem ersten Überfahren der
// Start/Ziel-Linie gezählt.
function armLap() {
  ghost.timing = false;
  ghost.lapElapsed = 0;
  ghost.recording = [];
  ghost.cursor = 0;
  ghost.hasProgress = false;
  ghost.prevProgress = 0;
  ghost.maxProgress = 0;
  ghost.offTrack = false;
}

// True, wenn alle vier Reifen abseits der Strecke sind (jenseits der äußeren
// Randstein-Kante – also komplett im Grünen/Auslauf, nicht nur auf dem Curb).
function allWheelsOffTrack(px, pz) {
  // Szenerie-Strecken: die echte Fahrbahn ist breiter als die extrahierte Linie –
  // Track-Limits würden ständig fälschlich auslösen und die Zeitmessung abbrechen
  if (sceneryTrack) return false;
  if (!curbData) return false;
  const P = curbData.pts;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < P.length; i++) {
    const dx = px - P[i].x, dz = pz - P[i].z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  const c = P[best], nv = curbData.nrm[best];
  const lat = (px - c.x) * nv.x + (pz - c.z) * nv.z; // seitl. Abstand zur Mitte (links = +)
  const hw = carHalf.wid, w = curbData.width;
  const innerLeft = lat - hw;   // das am weitesten innen liegende Rad bei Abflug nach links
  const innerRight = lat + hw;  // das am weitesten innen liegende Rad bei Abflug nach rechts
  // Komplett links jenseits des Curbs ODER komplett rechts jenseits des Curbs
  return innerLeft > curbData.wl[best] + w || innerRight < -(curbData.wr[best] + w);
}

const ltCur = document.getElementById('lt-cur');
const ltLast = document.getElementById('lt-last');
const ltBest = document.getElementById('lt-best');
const _gYawQ = new THREE.Quaternion();
const _gRollQ = new THREE.Quaternion();

function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function lerpAngle(a, b, f) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d)); // kürzester Drehweg
  return a + d * f;
}

// Bogenlängen-Position des nächstgelegenen Mittellinienpunkts (= Streckenfortschritt)
function trackProgress(px, pz) {
  const P = centerline.P, n = centerline.n;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = px - P[i].x, dz = pz - P[i].z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return centerline.s[best];
}

function disposeGhostMaterials() {
  if (!ghost.mesh) return;
  ghost.mesh.traverse((node) => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach((m) => m.dispose()); // nur die Material-Klone, Geometrie bleibt geteilt
  });
}

// Baut das Ghost-Car als halbtransparenten Klon des aktuellen Autos (ohne Kollision)
function buildGhostMesh() {
  if (ghost.mesh) { scene.remove(ghost.mesh); disposeGhostMaterials(); ghost.mesh = null; }
  if (!currentCar) return;
  const clone = currentCar.clone(true); // teilt Geometrie, Hierarchie wird kopiert
  clone.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = false;
    node.receiveShadow = false;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    const ghosted = mats.map((m) => {
      const gm = m.clone();
      gm.transparent = true;
      gm.opacity = 0.32;
      gm.depthWrite = false;
      if ('emissive' in gm) { gm.emissive = new THREE.Color(0x3a6cff); gm.emissiveIntensity = 0.5; }
      return gm;
    });
    node.material = Array.isArray(node.material) ? ghosted : ghosted[0];
  });
  // currentCar trägt die zentrierende/skalierende Lokal-Transform; der Klon übernimmt sie.
  // Die äußere Gruppe spiegelt Position + Quaternion der carGroup.
  const g = new THREE.Group();
  g.add(clone);
  g.renderOrder = 1;
  ghost.mesh = g;
  scene.add(g);
}

function updateGhost() {
  const g = ghost.mesh;
  if (!g) return;
  // Im Rennmodus kein Ghost-Car (nur im Training/Zeitfahren)
  if (raceMode || !ghost.enabled || !ghost.best || !ghost.timing) { g.visible = false; return; }
  const t = ghost.lapElapsed;
  const rec = ghost.best;
  if (t > ghost.bestDur || rec.length < 2) { g.visible = false; return; } // Ghost ist im Ziel
  // Cursor monoton zum Sample bei Zeit t vorrücken
  let i = ghost.cursor;
  while (i < rec.length - 1 && rec[i + 1].t <= t) i++;
  ghost.cursor = i;
  const a = rec[i], b = rec[Math.min(i + 1, rec.length - 1)];
  const span = (b.t - a.t) || 1;
  const f = THREE.MathUtils.clamp((t - a.t) / span, 0, 1);
  g.position.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
  const yaw = lerpAngle(a.yaw, b.yaw, f);
  const roll = a.roll + (b.roll - a.roll) * f;
  _gYawQ.setFromAxisAngle(UP, yaw);
  if (carForward && roll !== 0) {
    _gRollQ.setFromAxisAngle(carForward, roll);
    g.quaternion.copy(_gYawQ).multiply(_gRollQ);
  } else {
    g.quaternion.copy(_gYawQ);
  }
  g.visible = true;
}

function updateLapHud() {
  ltCur.textContent = ghost.timing ? fmtTime(ghost.lapElapsed) : '--:--';
  ltLast.textContent = fmtTime(ghost.lastLap);
  ltBest.textContent = fmtTime(ghost.bestLap === Infinity ? null : ghost.bestLap);
}

function updateTimeAttack(dt) {
  if (!centerline || !carForward || !gameStarted) return;
  const px = carGroup.position.x, pz = carGroup.position.z;
  const progress = trackProgress(px, pz);
  const total = centerline.total;

  const prev = ghost.prevProgress;
  const hadProgress = ghost.hasProgress;

  // Vorwärts-Überfahrt der Start/Ziel-Linie: Fortschritt springt von ~Ende auf ~Anfang.
  // maxProgress-Guard verhindert Fehl-Überfahrten durch Springen des Fortschritts an der Linie.
  if (hadProgress && prev > total * 0.7 && progress < total * 0.3 && ghost.maxProgress > total * 0.5) {
    if (ghost.timing) {
      // Abgeschlossene gemessene Runde (Training/Quali-Zeit + Ghost-Aufzeichnung)
      ghost.lastLap = ghost.lapElapsed;
      const prevBest = ghost.bestLap;
      const improved = ghost.lapElapsed < ghost.bestLap;
      if (improved) {
        ghost.bestLap = ghost.lapElapsed;
        ghost.best = ghost.recording;
        ghost.bestDur = ghost.lapElapsed;
        buildGhostMesh();
        bestByTrack[currentTrackId] = ghost.lapElapsed; // persönliche Bestzeit dieser Strecke merken
        saveBestTimes();
      }
      // Training: bei neuer Bestzeit oben die Verbesserung in Sekunden anzeigen
      if (!raceMode && improved && isFinite(prevBest)) {
        const delta = (prevBest - ghost.lapElapsed).toFixed(2).replace('.', ',');
        showRaceMsg(`Bestzeit ${fmtTime(ghost.lapElapsed)} — ${delta} s schneller`, '#69f0ae');
      } else if (!raceMode || race.phase !== 'go') {
        showRaceMsg(`Runde: ${fmtTime(ghost.lapElapsed)}`, '#69f0ae');
      }
      // Rennmodus: erste gültige Runde ist die Quali-Zeit → „Rennen starten" anbieten
      if (raceMode && race.phase === 'quali') {
        race.qualiTime = ghost.lapElapsed;
        race.phase = 'qualiDone';
        setRaceStartVisible(true);
        setRaceInfo(`Quali: ${fmtTime(race.qualiTime)} — bereit? „Rennen starten" drücken`);
      }
    } else if (!(raceMode && race.phase === 'go')) {
      // Erste Linienüberfahrt (außerhalb des laufenden Rennens): ab jetzt wird die Zeit gemessen
      showRaceMsg('Zeitmessung gestartet!', '#69f0ae');
    }
    ghost.timing = true;
    ghost.lapElapsed = 0;
    ghost.recording = [];
    ghost.cursor = 0;
    ghost.maxProgress = 0;

    // Rennrunden zählen – unabhängig von den Track-Limits (Abkürzen/Gras macht die
    // gefahrene Rundenzeit zwar ungültig fürs Ghost-Car, der Rundenzähler läuft aber weiter).
    if (raceMode && race.phase === 'go') {
      if (race.crossings >= 1) {                 // eine echte Runde abgeschlossen (nicht die Startlinie)
        race.lapTimes.push(race.lapClock);
        showRaceMsg(`Runde ${race.crossings}: ${fmtTime(race.lapClock)}`, '#69f0ae');
      }
      race.lapClock = 0;
      race.crossings++;                          // 1. Überfahrt = Startlinie (Runde 1), danach je Runde +1
      if (race.crossings > RACE_LAPS) finishRace();
      else setRaceInfo(`Runde ${race.crossings}/${RACE_LAPS}`);
    }
  }
  ghost.prevProgress = progress;
  ghost.hasProgress = true;
  ghost.maxProgress = Math.max(ghost.maxProgress, progress);

  // Track-Limits: Sind alle vier Reifen abseits der Strecke, ist die laufende
  // Zeit ungültig. Sie wird verworfen und es geht zurück in die Aus-Runde –
  // gemessen wird erst wieder ab der nächsten Start/Ziel-Überfahrt.
  const off = allWheelsOffTrack(px, pz);
  if (off && !ghost.offTrack && ghost.timing) {
    showRaceMsg('Zeit ist ungültig');
    ghost.timing = false;
    ghost.lapElapsed = 0;
    ghost.recording = [];
    ghost.cursor = 0;
    ghost.maxProgress = ghost.prevProgress; // Fortschritt halten, kein Fehl-Rundenzähler
  }
  ghost.offTrack = off;

  if (ghost.timing) {
    ghost.lapElapsed += dt;
    ghost.recording.push({ t: ghost.lapElapsed, x: px, y: carGroup.position.y, z: pz, yaw: carYaw, roll: carRoll });
  }

  updateGhost();
  updateLapHud();
}

const btnGhost = document.getElementById('btn-ghost');
btnGhost.addEventListener('click', () => {
  ghost.enabled = !ghost.enabled;
  btnGhost.textContent = `👻 Ghost-Car: ${ghost.enabled ? 'AN' : 'AUS'}`;
  btnGhost.classList.toggle('active', ghost.enabled);
  if (ghost.mesh && !ghost.enabled) ghost.mesh.visible = false;
});

// Zeit löschen: Bestzeit, letzte Runde und Ghost-Car verwerfen, Messung neu starten
const btnResetTime = document.getElementById('btn-reset-time');
btnResetTime.addEventListener('click', () => {
  if (ghost.mesh) { scene.remove(ghost.mesh); disposeGhostMaterials(); ghost.mesh = null; }
  ghost.timing = false;
  ghost.lapElapsed = 0;
  ghost.lastLap = null;
  ghost.bestLap = Infinity;
  ghost.best = null;
  ghost.bestDur = 0;
  ghost.recording = [];
  ghost.cursor = 0;
  ghost.hasProgress = false;
  ghost.prevProgress = 0;
  ghost.maxProgress = 0;
  delete bestByTrack[currentTrackId]; // gespeicherte Bestzeit dieser Strecke ebenfalls löschen
  saveBestTimes();
  updateLapHud();
});

// Zurück in die Boxengasse: Auto an den Startplatz zurücksetzen (Tempo/Lenkung/Gang zurück)
const btnPit = document.getElementById('btn-pit');
btnPit.addEventListener('click', () => {
  carGroup.position.set(0, 0.05, 0);
  speed = 0;
  steerAngle = 0;
  carRoll = 0;
  gear = 1;
  autoReverse = false;
  prevGearSound = 1;
   alignCarToPitlane();                 // in Fahrtrichtung der Boxengasse ausrichten
  prevCarPos.copy(carGroup.position);  // keinen Kamerasprung erzeugen
  armLap();                            // frische, gemessene Runde ab der Box
  updateLapHud();
});

// Zurück zum Start: laufendes Spiel beenden und den Startbildschirm wieder zeigen
const btnHome = document.getElementById('btn-home');
btnHome.addEventListener('click', () => {
  gameStarted = false;
  raceMode = false;
  removeBots();
  raceReset();

  // Auto an den Startplatz, Tempo/Gang zurück
  carGroup.position.set(0, 0.05, 0);
  speed = 0; steerAngle = 0; carRoll = 0; gear = 1; autoReverse = false; prevGearSound = 1;  alignCarToPitlane();
  prevCarPos.copy(carGroup.position);

  // Ton stumm – beim nächsten Start wieder ab erstem Knopfdruck
  engineAudio.setEnabled(false);
  audioUnlocked = false;

  // HUD/Pause aus, Menü zurück in den (nicht bedienbaren) Startmodus-Deko-Zustand
  document.getElementById('btn-ghost').style.display = '';
  uiPanel.classList.remove('hidden');
  uiPanel.classList.add('start-mode');
  btnMenu.classList.remove('active');
  pauseLabel.classList.remove('visible');
  document.getElementById('hud-top').style.display = 'none';
  document.getElementById('laptimer').style.display = 'none';
  document.getElementById('title').style.display = 'none';

  // Startbildschirm-Optik: Verfolgerkamera mit Auto-Rotation, Nachtmodus + Lichter
  cameraMode = 0;
  applyCameraMode();
  controls.autoRotate = true;
  btnRotate.textContent = '🔄 Auto-Rotation: AN';
  isNight = true; headlightsOn = true; taillightsOn = true;
  applyMode();

  // Modus-, Strecken- und Autoauswahl sicher aus, Startbildschirm wieder einblenden
  document.getElementById('mode-screen').classList.remove('visible');
  document.getElementById('track-screen').classList.remove('visible');
  document.getElementById('car-screen').classList.remove('visible');
  const ss = document.getElementById('start-screen');
  ss.style.display = '';
  requestAnimationFrame(() => ss.classList.add('visible'));
});

// ---------- Gegner-Bots ----------
// Immer aktive KI-Autos (nicht abschaltbar). Sie fahren das gleiche Modell wie der
// Spieler entlang der Streckenmittellinie und haben eine Hitbox (Kollision mit dem Spieler).
const BOT_COUNT = 5;            // 5 Gegner + Spieler = 6 Autos
let BOT_MAX_SPEED = 280 / 3.6;  // m/s – wird von applyCarPhysics() auf den Topspeed des gewählten Autos gesetzt
const BOT_MIN_SPEED = 16;       // m/s Mindesttempo in engen Kurven (wie der Spieler dort)
// (Kurven-Grip der Bots = Spieler-Querhaftung MAX_LAT_ACC, siehe botTargetSpeed)
const BOT_ACCEL = 8;            // m/s² Längsbeschleunigung am Start
const BOT_BRAKE = 24;           // m/s² Bremsverzögerung vor Kurven
const BOT_GRIP = 0.9;           // Bots haben in allen Bereichen 10 % weniger Grip als der Spieler
const bots = [];                // { group, s, offset }
const _botFwd = new THREE.Vector3();

// Position + (normierte) Tangente an einer Bogenlänge der Mittellinie
function centerlineAt(arc) {
  const { P, s, total, n } = centerline;
  const a = ((arc % total) + total) % total;
  // Segment per Binärsuche in der kumulierten Bogenlänge finden
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= a) lo = mid; else hi = mid - 1; }
  const i = lo, j = (i + 1) % n;
  const sj = j === 0 ? total : s[j];
  const f = (a - s[i]) / ((sj - s[i]) || 1);
  const x = P[i].x + (P[j].x - P[i].x) * f;
  const z = P[i].z + (P[j].z - P[i].z) * f;
  let tx = P[j].x - P[i].x, tz = P[j].z - P[i].z;
  const tl = Math.hypot(tx, tz) || 1;
  return { x, z, tx: tx / tl, tz: tz / tl };
}

// Empfohlenes Bot-Tempo an Bogenlänge `s`: hoch auf Geraden, in Kurven nach dem
// Kurvenradius begrenzt (v = sqrt(seitl.Beschl. · Radius)).
function botTargetSpeed(s) {
  const L = 28;
  const p0 = centerlineAt(s), p1 = centerlineAt(s + L), p2 = centerlineAt(s + 2 * L);
  let d1x = p1.x - p0.x, d1z = p1.z - p0.z; const l1 = Math.hypot(d1x, d1z) || 1; d1x /= l1; d1z /= l1;
  let d2x = p2.x - p1.x, d2z = p2.z - p1.z; const l2 = Math.hypot(d2x, d2z) || 1; d2x /= l2; d2z /= l2;
  let cosA = d1x * d2x + d1z * d2z; cosA = Math.max(-1, Math.min(1, cosA));
  const kappa = Math.acos(cosA) / L; // Krümmung (Richtungsänderung pro Meter)
  if (kappa < 1e-4) return BOT_MAX_SPEED;
  // Gleiche Querhaftung wie der Spieler: 1,25 g mechanisch + Aero-Abtrieb
  // (schnelle Kurven = MEHR Grip). v² = aLat(v)·Radius, iterativ gelöst.
  let v = 45;
  for (let it = 0; it < 6; it++) {
    const sg = Math.max(0.72, Math.min(1, 1 - Math.max(0, v - 15) * 0.005)) * aeroGrip(v); // wie speedGrip beim Spieler (inkl. Aero)
    v = 0.5 * v + 0.5 * Math.sqrt((MAX_LAT_ACC * sg * BOT_GRIP) / kappa);
  }
  return Math.max(BOT_MIN_SPEED, Math.min(BOT_MAX_SPEED, v));
}

// Längsbeschleunigung bei Vollgas (Automatik) – dasselbe Kraftmodell wie beim
// Spieler, damit die Bots GENAU die gleiche Beschleunigung haben wie der Spieler.
function engineAccel(v) {
  let g = 1;
  while (g < 6 && v >= 0.93 * GEAR_MAX_SPEED[g]) g++;
  const vmax = GEAR_MAX_SPEED[g];
  const fDrag = 0.5 * RHO_AIR * CD_AREA * v * v;
  const fRoll = v > 0.1 ? MASS * 9.81 * ROLL_RES : 0;
  if (v >= vmax) return -(fDrag + fRoll) / MASS; // im Gang abgeregelt
  const pull = F_TRACTION * GEAR_PULL[g];
  const fade = Math.max(0, 1 - Math.pow(v / vmax, 9)); // wie beim Spieler (Renn-Drehband)
  const fDrive = Math.min(pull, POWER_WHEEL / Math.max(v, 3)) * fade * ACCEL_BOOST;
  const slip = Math.max(0, (fDrive * DRIVE_REAR - REAR_GRIP) / REAR_GRIP);
  const grip = 1 - 0.12 * Math.min(1, slip);
  return (fDrive * grip - fDrag - fRoll) / MASS;
}

// Kind-Index-Pfad von root zu target (für das Wiederfinden der Rad-Pivots in Klonen)
function nodeIndexPath(root, target) {
  const path = [];
  let found = false;
  (function dfs(node) {
    if (found) return;
    if (node === target) { found = true; return; }
    for (let i = 0; i < node.children.length && !found; i++) { path.push(i); dfs(node.children[i]); if (!found) path.pop(); }
  })(root);
  return found ? path.slice() : null;
}
function resolveNodePath(root, path) {
  let n = root;
  for (const i of path) { n = n && n.children[i]; }
  return n || null;
}

function createBots() {
  // Pfade zu den Rad-Drehpivots im Spielermodell ermitteln, um sie in den Klonen mitzudrehen
  const wheelPaths = wheels
    .map((w) => ({ path: nodeIndexPath(currentCar, w.spin), axisLocal: w.axisLocal, radius: w.radius }))
    .filter((w) => w.path);
  const tailSet = new Set(taillightMats); // Rücklicht-Materialien des Spielers
  const headSet = new Set(headlightMats); // Scheinwerfer-Materialien des Spielers
  for (let k = 0; k < BOT_COUNT; k++) {
    const clone = currentCar.clone(true); // gleiches Auto-Modell wie der Spieler
    // WICHTIG: clone(true) teilt die Materialien mit dem Spieler. Eigene Materialien
    // klonen, sonst leuchten beim Bremsen/Licht des Spielers auch die Bot-Lichter mit.
    const tailMats = [];
    const headMats = [];
    clone.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      const cloned = mats.map((m) => {
        const c = m.clone();
        if (tailSet.has(m)) { c.emissive = new THREE.Color(0x000000); c.emissiveIntensity = 1; tailMats.push(c); }
        else if (headSet.has(m)) { c.emissive = new THREE.Color(0x000000); c.emissiveIntensity = 1; headMats.push(c); }
        return c;
      });
      node.material = Array.isArray(node.material) ? cloned : cloned[0];
    });
    const group = new THREE.Group();
    group.add(clone);
    scene.add(group);
    const wheelsClone = wheelPaths
      .map((w) => ({ spin: resolveNodePath(clone, w.path), axisLocal: w.axisLocal, radius: w.radius }))
      .filter((w) => w.spin);
    bots.push({ group, s: 0, offset: 0, wheels: wheelsClone, tailMats, headMats });
  }
  applyBotLights(); // Scheinwerfer je nach Tag/Nacht setzen
}

// Scheinwerfer der KI-Fahrzeuge: nachts an (leuchten), tagsüber aus.
function applyBotLights() {
  for (const bot of bots) {
    if (!bot.headMats) continue;
    for (const m of bot.headMats) {
      m.emissive.setHex(isNight ? 0xffffff : 0x000000);
      m.emissiveIntensity = isNight ? 6 : 1;
    }
  }
}

// Setzt einen Bot an seine Bogenlänge/seitl. Versatz; gibt Welt-Pos + Tangente zurück.
// Die Blickrichtung kommt aus einer Vorausschau und wird zusätzlich weich nachgeführt,
// damit die Front an den Segmentgrenzen der Mittellinie nicht springt (kein Rucken).
// dt fehlt → sofort ausrichten (z. B. beim Setzen in die Startaufstellung).
function positionBot(bot, dt) {
  const c = centerlineAt(bot.s);
  const a = centerlineAt(bot.s + 8);
  let dx = a.x - c.x, dz = a.z - c.z;
  const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const nx = -dz, nz = dx; // Quernormale für den seitlichen Versatz
  const x = c.x + nx * bot.offset, z = c.z + nz * bot.offset;
  bot.group.position.set(x, sceneryHeight ? groundY(x, z) + 0.05 : carGroup.position.y, z);
  // Blickrichtung exponentiell glätten (gegen Rucken)
  const k = dt ? 1 - Math.exp(-9 * dt) : 1;
  if (bot.fx === undefined) { bot.fx = dx; bot.fz = dz; }
  else { bot.fx += (dx - bot.fx) * k; bot.fz += (dz - bot.fz) * k; }
  const fl = Math.hypot(bot.fx, bot.fz) || 1;
  const ftx = bot.fx / fl, ftz = bot.fz / fl;
  _botFwd.set(ftx, 0, ftz);
  bot.group.quaternion.setFromUnitVectors(carForward, _botFwd);
  return { x, z, tx: ftx, tz: ftz };
}

function updateBots(dt) {
  if (!centerline || !currentCar || !carForward || !bots.length) return;
  botColliders = [];
  const total = centerline.total;
  for (const bot of bots) {
    let braking = false;
    if (race.phase === 'go') {
      bot.launchTimer += dt;
      if (bot.launchTimer >= bot.reaction) {        // erst nach eigener Reaktionszeit losfahren
        // Jeder Bot fährt für sich: eigenes Kurventempo (cornerF = später/früher bremsen)
        // und eigene Beschleunigung (accelF). cornerF>1 = mutiger, bremst später.
        const look = 14 * (bot.cornerF || 1);       // mutigere Bots schauen kürzer voraus → bremsen später
        let target = Math.min(BOT_MAX_SPEED, botTargetSpeed(bot.s + look) * (bot.cornerF || 1));
        // Auffahrschutz: dichter, gleichspuriger Gegner voraus → Tempo angleichen (nicht reinfahren)
        for (const o of bots) {
          if (o === bot) continue;
          const ds = ((o.s - bot.s) % total + total) % total;
          const dLat = Math.abs((bot.offset || 0) - (o.offset || 0));
          if (ds > 0 && ds < 7 && dLat < 2.2) target = Math.min(target, Math.max(0, o.v - (7 - ds) * 1.2));
        }
        // Totband um die Zieldrehzahl: kein Hin-und-Her zwischen Gas und Bremse (kein Rucken/Flackern)
        if (bot.v < target - 0.4) {
          const a = Math.max(0, engineAccel(bot.v)); // exakt dieselbe Beschleunigung wie der Spieler
          bot.v = Math.min(target, bot.v + a * dt);
        } else if (bot.v > target + 0.4) {
          bot.v = Math.max(target, bot.v - BOT_BRAKE * BOT_GRIP * dt);   // Bremse vor Kurven (10 % schwächer)
          braking = true;
        }
        const ps = bot.s;
        bot.s = (bot.s + bot.v * dt) % total;
        if (bot.s < ps - total * 0.5) bot.crossings = (bot.crossings || 0) + 1; // Start/Ziel überfahren

        // Überholen mit Hysterese: dicht hinter einem langsameren Bot seitlich ausweichen.
        // Die Seite bleibt während des Manövers fest (kein seitliches Zittern), erst wenn
        // der Vordermann >20 m entfernt ist, kehrt der Bot zur eigenen Linie zurück.
        let block = false;
        for (const o of bots) {
          if (o === bot) continue;
          const ds = ((o.s - bot.s) % total + total) % total;
          if (ds > 0 && ds < 20 && o.v < bot.v - 0.5 && (ds < 14 || bot.ovSide)) {
            if (!bot.ovSide) bot.ovSide = (bot.lineOffset >= (o.offset || 0)) ? 1 : -1;
            block = true; break;
          }
        }
        if (!block) bot.ovSide = 0;
        let desired = (bot.lineOffset || 0) + (bot.ovSide || 0) * 2.4;
        // Seitlich auf Abstand bleiben: überlappt ein Gegner längs, zur Seite drücken
        for (const o of bots) {
          if (o === bot) continue;
          let ds = ((o.s - bot.s) % total + total) % total; ds = Math.min(ds, total - ds);
          if (ds < 4.6) {
            const off = (bot.offset || 0) - (o.offset || 0);
            const dir = off !== 0 ? Math.sign(off) : (bots.indexOf(bot) < bots.indexOf(o) ? 1 : -1);
            if (Math.abs(off) < 2.2) desired += dir * 1.6; // auseinanderdrücken
          }
        }
        desired = Math.max(-5, Math.min(5, desired));         // auf der Strecke bleiben
        bot.offset += (desired - bot.offset) * Math.min(1, dt * 1.4);

        for (const w of bot.wheels) w.spin.rotateOnAxis(w.axisLocal, (bot.v / w.radius) * dt); // Räder drehen
      }
    }
    // Eigene Rücklichter des Bots (unabhängig vom Spieler): nachts an, beim Bremsen heller
    if (bot.tailMats) {
      const on = isNight || braking;
      for (const m of bot.tailMats) {
        m.emissive.setHex(on ? 0xff0000 : 0x000000);
        m.emissiveIntensity = braking ? 3 : (isNight ? 1.6 : 1);
      }
    }
    const p = positionBot(bot, dt);
    // Hitbox etwas großzügiger, damit auch Seiten-/Streifkontakt sicher zählt
    botColliders.push({ cx: p.x, cz: p.z, ax: p.tx, az: p.tz, halfLen: carHalf.len + 0.2, halfWid: carHalf.wid + 0.45, v: bot.v });
  }
}

function removeBots() {
  for (const bot of bots) scene.remove(bot.group);
  bots.length = 0;
  botColliders = [];
}

// ---------- Rennmodus: Quali → Startaufstellung → F1-Ampel → Frühstart-Strafe ----------
const BOT_QUALI_FACTOR = [0.94, 0.98, 1.03, 1.08, 1.13]; // Bot-Quali-Zeiten relativ zur Spielerzeit
const RACE_LAPS = 5;  // Renndistanz: 5 Runden
const race = {
  phase: 'off',     // 'off' | 'quali' | 'qualiDone' | 'lights' | 'go' | 'finished'
  qualiTime: null,
  playerGrid: 0,
  lightT: 0,
  litCount: -1,
  holdAfter: 2,
  jumpStart: false,
  penalty: 0,       // verbleibende Strafzeit (Sek), >0 = noch abzusitzen
  skipped: false,   // Quali übersprungen → Start ganz hinten
  crossings: 0,     // Start/Ziel-Überfahrten des Spielers (1. = Startlinie, dann je Runde +1)
  lapClock: 0,      // Zeit der laufenden Rennrunde (läuft unabhängig von den Track-Limits)
  lapTimes: [],     // Zeit je abgeschlossener Rennrunde (für die Ergebnisliste)
};
const lightsEl = document.getElementById('start-lights');
const raceStartBtn = document.getElementById('race-start-btn');
const raceSkipBtn = document.getElementById('race-skip-btn');
const btnRaceStartMenu = document.getElementById('btn-race-start');
const btnRaceSkipMenu = document.getElementById('btn-race-skip');
const raceInfoEl = document.getElementById('race-info');

// „Rennen starten"/„Quali überspringen" gibt es als Bildschirm-Einblendung UND im ☰-Menü
function setRaceStartVisible(v) {
  raceStartBtn.classList.toggle('visible', v);
  btnRaceStartMenu.style.display = v ? '' : 'none';
}
function setRaceSkipVisible(v) {
  raceSkipBtn.classList.toggle('visible', v);
  btnRaceSkipMenu.style.display = v ? '' : 'none';
}
const penaltyEl = document.getElementById('penalty-msg');
const _hd = new THREE.Vector3();

// Strafmeldung im roten Rahmen unten – nur ~10 Sek sichtbar
let penaltyMsgTimer = null;
function showPenaltyMsg(text) {
  penaltyEl.textContent = text;
  penaltyEl.classList.add('visible');
  clearTimeout(penaltyMsgTimer);
  penaltyMsgTimer = setTimeout(() => penaltyEl.classList.remove('visible'), 10000);
}

function setRaceInfo(text) {
  if (!text) { raceInfoEl.classList.remove('visible'); return; }
  raceInfoEl.textContent = text;
  raceInfoEl.classList.add('visible');
}

// Rennen beendet (Spieler hat RACE_LAPS Runden voll): Platzierung nach
// zurückgelegter Gesamtstrecke (Überfahrten · Streckenlänge + aktuelle Bogenlänge).
function finishRace() {
  const total = centerline.total;
  const playerDist = race.crossings * total + trackProgress(carGroup.position.x, carGroup.position.z);
  let ahead = 0;
  for (const b of bots) if ((b.crossings || 0) * total + b.s > playerDist) ahead++;
  const pos = ahead + 1;
  race.phase = 'finished';
  setRaceInfo(`🏁 Rennen beendet — Platz ${pos} von ${BOT_COUNT + 1}`);
  showResultScreen(pos);
}

// Ergebnis-Rangliste: Platzierung + Zeit jeder gefahrenen Runde (schnellste hervorgehoben)
const resultScreenEl = document.getElementById('result-screen');
const resultListEl = document.getElementById('result-list');
function showResultScreen(pos) {
  const laps = race.lapTimes;
  const best = laps.length ? Math.min(...laps) : Infinity;
  const totalTime = laps.reduce((a, b) => a + b, 0);
  let rows = `<div class="grid-row me"><span class="pos">🏁</span><span class="nm">Platz ${pos} von ${BOT_COUNT + 1}</span><span class="tm"></span></div>`;
  rows += laps.map((t, i) =>
    `<div class="grid-row${t === best ? ' me' : ''}"><span class="pos">R${i + 1}</span><span class="nm">Runde ${i + 1}${t === best ? ' ⚡' : ''}</span><span class="tm">${fmtTime(t)}</span></div>`
  ).join('');
  if (laps.length) rows += `<div class="grid-row"><span class="pos">Σ</span><span class="nm">Gesamt</span><span class="tm">${fmtTime(totalTime)}</span></div>`;
  resultListEl.innerHTML = rows;
  resultScreenEl.classList.add('visible');
}
document.getElementById('result-close').addEventListener('click', () => {
  resultScreenEl.classList.remove('visible');
});
function renderLights(n) {
  const els = lightsEl.children;
  for (let i = 0; i < els.length; i++) els[i].classList.toggle('on', i < n);
}

// Beginn des Rennmodus: erst Qualifikation (eine schnelle Runde)
function startRaceQuali() {
  race.phase = 'quali';
  race.qualiTime = null;
  race.crossings = 0; race.lapClock = 0; race.lapTimes = [];
  if (resultScreenEl) resultScreenEl.classList.remove('visible');
  race.skipped = false;
  race.jumpStart = false;
  race.penalty = 0;
  race.litCount = -1;
  setRaceStartVisible(false);
  setRaceSkipVisible(true);
  lightsEl.classList.remove('visible');
  renderLights(0);
  setRaceInfo('QUALIFIKATION — fahre eine schnelle Runde (oder „Sofort starten")');
}

function raceReset() {
  race.phase = 'off';
  race.qualiTime = null;
  race.skipped = false;
  race.jumpStart = false;
  race.penalty = 0;
  race.crossings = 0;
  race.lapClock = 0;
  race.lapTimes = [];
  if (resultScreenEl) resultScreenEl.classList.remove('visible');
  setRaceStartVisible(false);
  setRaceSkipVisible(false);
  lightsEl.classList.remove('visible');
  penaltyEl.classList.remove('visible');
  renderLights(0);
  setRaceInfo('');
}

const gridArc = (i) => centerline.total - 10 - i * 7;       // Startplätze hinter der Linie
const gridOffset = (i) => (i % 2 === 0 ? 3 : -3);           // gestaffelt links/rechts

// Startreihenfolge aus den Quali-Zeiten (Spieler + Bots), schnellste Zeit = Pole.
// Quali übersprungen → Spieler startet ganz hinten (Zeit = Unendlich).
function computeGridEntries() {
  const baseRef = (race.qualiTime != null && isFinite(race.qualiTime)) ? race.qualiTime : 90;
  const playerTime = race.skipped ? Infinity : race.qualiTime;
  const entries = [{ who: 'player', time: playerTime }];
  for (let k = 0; k < BOT_COUNT; k++) entries.push({ who: k, time: baseRef * BOT_QUALI_FACTOR[k] });
  entries.sort((a, b) => a.time - b.time);
  return entries;
}

// Startaufstellung mit Quali-Zeiten anzeigen (nach „Rennen starten"), bevor die Ampel startet
function showGridLineup() {
  if (!centerline || (race.qualiTime == null && !race.skipped)) return;
  const entries = computeGridEntries();
  gridListEl.innerHTML = entries.map((e, i) => {
    const me = e.who === 'player';
    const name = me ? 'DU' : `GEGNER ${e.who + 1}`;
    const t = isFinite(e.time) ? fmtTime(e.time) : '—';
    return `<div class="grid-row${me ? ' me' : ''}"><span class="pos">P${i + 1}</span><span class="nm">${name}</span><span class="tm">${t}</span></div>`;
  }).join('');
  gridScreenEl.classList.add('visible');
  setRaceStartVisible(false);
  setRaceSkipVisible(false);
}

function setupGrid() {
  if (!centerline || (race.qualiTime == null && !race.skipped)) return;
  const entries = computeGridEntries();

  if (!bots.length) createBots();
  race.crossings = 0;        // Rundenzähler des Spielers zurücksetzen
  race.lapClock = 0; race.lapTimes = []; // Rundenzeiten fürs Ergebnis zurücksetzen
  const total = centerline.total;
  entries.forEach((e, i) => {
    const arc = ((gridArc(i) % total) + total) % total;
    if (e.who === 'player') {
      race.playerGrid = i;
      const c = centerlineAt(arc);
      const nx = -c.tz, nz = c.tx;
      carGroup.position.set(c.x + nx * gridOffset(i), carGroup.position.y, c.z + nz * gridOffset(i));
      _hd.set(c.tx, 0, c.tz);
      setHeading(_hd);
      prevCarPos.copy(carGroup.position);
      speed = 0; gear = 1; autoReverse = false; prevGearSound = 1;
    } else {
      const bot = bots[e.who];
      bot.s = arc; bot.offset = gridOffset(i);    // Startaufstellung gestaffelt
      bot._prevS = arc; bot.crossings = 0;        // Rundenzählung (Wrap der Bogenlänge)
      bot.v = 0;                                  // startet aus dem Stand
      bot.launchTimer = 0;
      bot.reaction = 0.200 + Math.random() * 0.150; // eigene Reaktionszeit 0,200…0,350 s
      // eigene Ideallinie (seitlicher Versatz, je Bot unterschiedlich)
      bot.lineOffset = (e.who - (BOT_COUNT - 1) / 2) * 1.7 + (Math.random() - 0.5) * 1.2;
      // eigene Fahr-Charakteristik: Kurvenmut (später/früher bremsen) + Beschleunigung
      bot.cornerF = 0.96 + Math.random() * 0.08;   // 0,96…1,04 → kleine Streuung um Spieler-Grip
      bot.accelF = 0.96 + Math.random() * 0.1;     // 0,96…1,06 → früher/später am Gas
      bot.ovSide = 0;                              // kein Überholmanöver aktiv
      positionBot(bot);                            // sofort ausrichten (ohne dt)
    }
  });

  armLap(); // Rundenmessung sauber zurücksetzen (kein Fehl-Lap durch das Umsetzen)

  // F1-Ampelsequenz starten
  race.phase = 'lights';
  race.lightT = 0;
  race.litCount = -1;
  race.holdAfter = 2 + Math.random() * 6; // Gesamtdauer der Ampel = 5 s + 2…8 s = 7…13 s
  renderLights(0);
  lightsEl.classList.add('visible');
  setRaceStartVisible(false);
  setRaceSkipVisible(false);
  setRaceInfo(`Startplatz ${race.playerGrid + 1} von ${BOT_COUNT + 1} — warte auf die Ampel`);
}

// Grobe Erkennung „in der Boxengasse" (zum Absitzen der Strafe): nahe Start, ~15 m seitlich neben der Ideallinie
function inPitZone() {
  if (!centerline) return false;
  const px = carGroup.position.x, pz = carGroup.position.z;
  const P = centerline.P, n = centerline.n;
  let bi = 0, bd = Infinity;
  for (let i = 0; i < n; i++) { const dx = px - P[i].x, dz = pz - P[i].z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
  const prog = centerline.s[bi];
  const c = centerlineAt(prog);
  const lat = (px - c.x) * c.tz + (pz - c.z) * (-c.tx); // Abstand in der Boxengassen-Querachse
  const nearStart = prog < 380 || prog > centerline.total - 380;
  return nearStart && Math.abs(Math.abs(lat) - 15) < 7;
}

function updateRace(dt) {
  if (!raceMode) return;
  if (race.phase === 'lights') {
    race.lightT += dt;
    const lit = Math.min(5, Math.floor(race.lightT)); // je Sekunde eine Ampel an
    if (lit !== race.litCount) { race.litCount = lit; renderLights(lit); }
    // Frühstart: Bewegung vor „Lichter aus"
    if (!race.jumpStart && Math.abs(speed) > 0.8) {
      race.jumpStart = true;
      race.penalty = 15;
      showPenaltyMsg('⚠ FRÜHSTART — 15 Sek Zeitstrafe in der Boxengasse absitzen');
    }
    if (race.lightT >= 5 + race.holdAfter) {
      race.phase = 'go';
      renderLights(0);
      lightsEl.classList.remove('visible');
      setRaceInfo(`Runde 1/${RACE_LAPS}`);
      showRaceMsg('LOS!', '#69f0ae');
    }
  } else if (race.phase === 'go') {
    race.lapClock += dt; // Zeit der laufenden Rennrunde
    if (race.penalty > 0) {
      if (inPitZone() && Math.abs(speed) < 2) race.penalty = Math.max(0, race.penalty - dt);
    } else if (race.jumpStart) {
      race.jumpStart = false;
      showRaceMsg('Strafe abgesessen – freie Fahrt', '#69f0ae');
    }
  }
}

// „Rennen starten" zeigt zuerst die Startaufstellung mit den Quali-Zeiten
const gridScreenEl = document.getElementById('grid-screen');
const gridListEl = document.getElementById('grid-list');
raceStartBtn.addEventListener('click', showGridLineup);
raceSkipBtn.addEventListener('click', () => {
  race.skipped = true; // Quali übersprungen ⇒ Start ganz hinten
  showGridLineup();
});
// gleiche Aktionen auch über das ☰-Menü; Menü dabei schließen, damit es weitergeht
btnRaceStartMenu.addEventListener('click', () => { showGridLineup(); toggleMenu(false); });
btnRaceSkipMenu.addEventListener('click', () => { race.skipped = true; showGridLineup(); toggleMenu(false); });
// aus der Startaufstellung ins Rennen (Autos setzen + Ampel)
document.getElementById('grid-go').addEventListener('click', () => {
  gridScreenEl.classList.remove('visible');
  setupGrid();
});

// ---------- Startboxen: aufgemalte Grid-Markierungen an den Startplätzen ----------
let gridBoxes = null;
function buildGridBoxes() {
  gridBoxes = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const L = 5, W = 2.6, th = 0.16;
  const total = centerline.total;
  // eine Linie (flaches weißes Band) bei (cx,cz), ausgerichtet nach ang; len=Länge entlang Strecke, wid=quer
  const line = (cx, cz, ang, len, wid) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(wid, 0.04, len), mat);
    m.position.set(cx, sceneryHeight ? groundY(cx, cz) + 0.08 : carGroup.position.y + 0.03, cz);
    m.rotation.y = ang; gridBoxes.add(m);
  };
  for (let i = 0; i <= BOT_COUNT; i++) {
    const arc = ((gridArc(i) % total) + total) % total;
    const c = centerlineAt(arc);
    const ang = Math.atan2(c.tx, c.tz);
    const nx = -c.tz, nz = c.tx, off = gridOffset(i);
    const cx = c.x + nx * off, cz = c.z + nz * off;
    line(cx + nx * (W / 2), cz + nz * (W / 2), ang, L, th);          // rechte Längslinie
    line(cx - nx * (W / 2), cz - nz * (W / 2), ang, L, th);          // linke Längslinie
    line(cx + c.tx * (L / 2), cz + c.tz * (L / 2), ang, th, W + th); // vordere Startlinie (Box hinten offen, wie in der F1)
  }
  scene.add(gridBoxes);
}

// ---------- Boxengasse: geparkte Autos + animierte Boxencrew (Reifenwechsel) ----------
let pitScene = null;
const pitCrew = [];   // { mesh, baseY, phase }
let pitClock = 0;

function makeCrewMember(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.8, 0.32),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  body.position.y = 0.55; body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 })); // Helm
  head.position.y = 1.05;
  // „Schlagschrauber"-Arm, der sich beim Arbeiten bewegt
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.12, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6 }));
  arm.position.set(0.3, 0.55, 0.18);
  g.add(body, head, arm);
  g.userData.arm = arm;
  return g;
}

const _bayFwd = new THREE.Vector3();
function buildPitScene() {
  pitScene = new THREE.Group();

  // BMW M4 (Spielerauto) in jeden gefüllten Garagen-Stellplatz stellen
  for (const b of garageBays) {
    const carG = new THREE.Group();
    carG.add(currentCar.clone(true));
    carG.position.set(b.x, carGroup.position.y, b.z);
    _bayFwd.set(b.fx, 0, b.fz);
    carG.quaternion.setFromUnitVectors(carForward, _bayFwd); // Front zur Gasse
    pitScene.add(carG);
  }

  // Boxenstopp-Szene (Crew + Reifenstapel) entfernt – nur noch die M4 in den Garagen
  scene.add(pitScene);
}

function updatePitScene(dt) {
  pitClock += dt;
  for (const c of pitCrew) {
    // leichtes Auf-/Ab + „Schrauben" am Reifen
    c.mesh.position.y = c.baseY + Math.abs(Math.sin(pitClock * 5 + c.phase)) * 0.14;
    const arm = c.mesh.userData.arm;
    if (arm) arm.rotation.z = Math.sin(pitClock * 18 + c.phase) * 0.5;
  }
}

// ---------- Untergrund-Erkennung: Gras + Kiesbett ----------
function _nearestTrackPoint(px, pz) {
  if (!curbData) return -1;
  const P = curbData.pts;
  let bi = 0, bd = Infinity;
  for (let i = 0; i < P.length; i++) { const dx = px - P[i].x, dz = pz - P[i].z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
  return bi;
}

function _carNearPitLane(px, pz) {
  if (!curbData || !curbData.pitPts) return false;
  const hw = (curbData.pitHalfWidth || 3.5) + 1; // +1 m Puffer
  const lim = hw * hw;
  for (const p of curbData.pitPts) {
    const dx = px - p.x, dz = pz - p.z;
    if (dx * dx + dz * dz < lim) return true;
  }
  return false;
}

function carOnGrass() {
  // Szenerie-Strecken: Kies-/Gras-Zonen des Generators passen nicht zum Modell → keine Grip-Zonen
  if (sceneryTrack) return false;
  if (!curbData) return false;
  const px = carGroup.position.x, pz = carGroup.position.z;
  if (_carNearPitLane(px, pz)) return false;
  const bi = _nearestTrackPoint(px, pz);
  const nv = curbData.nrm[bi];
  const lat = (px - curbData.pts[bi].x) * nv.x + (pz - curbData.pts[bi].z) * nv.z;
  const w = curbData.width;
  const gwL = curbData.grassL ? (curbData.grassL[bi] || 0) : 50;
  const gwR = curbData.grassR ? (curbData.grassR[bi] || 0) : 50;
  const gl = curbData.wl[bi] + w, gr = curbData.wr[bi] + w;
  return (lat > gl && lat < gl + gwL) || (lat < -gr && lat > -(gr + gwR));
}

function carOnGravel() {
  if (sceneryTrack) return false; // s. carOnGrass()
  if (!curbData) return false;
  const px = carGroup.position.x, pz = carGroup.position.z;
  if (_carNearPitLane(px, pz)) return false;
  const bi = _nearestTrackPoint(px, pz);
  const nv = curbData.nrm[bi];
  const lat = (px - curbData.pts[bi].x) * nv.x + (pz - curbData.pts[bi].z) * nv.z;
  const w = curbData.width;
  const gwL = curbData.grassL ? (curbData.grassL[bi] || 0) : 50;
  const gwR = curbData.grassR ? (curbData.grassR[bi] || 0) : 50;
  const gL = curbData.gravelL ? (curbData.gravelL[bi] || 0) : 0;
  const gR = curbData.gravelR ? (curbData.gravelR[bi] || 0) : 0;
  const gl = curbData.wl[bi] + w + gwL, gr = curbData.wr[bi] + w + gwR;
  return (lat > gl && lat < gl + gL) || (lat < -gr && lat > -(gr + gR));
}

const DUST_N = 140;
let dustPoints = null, dustPos = null;
const dustVel = [], dustLife = [];
let dustNext = 0;
function initDust() {
  dustPos = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N; i++) { dustPos[i * 3 + 1] = -9999; dustVel.push(new THREE.Vector3()); dustLife.push(0); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xcdbb95, size: 0.8, transparent: true, opacity: 0.55, depthWrite: false });
  dustPoints = new THREE.Points(geo, mat);
  dustPoints.frustumCulled = false;
  scene.add(dustPoints);
}
function spawnDust(x, z) {
  const i = dustNext; dustNext = (dustNext + 1) % DUST_N;
  dustPos[i * 3] = x; dustPos[i * 3 + 1] = carGroup.position.y + 0.2; dustPos[i * 3 + 2] = z;
  dustVel[i].set((Math.random() - 0.5) * 2, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 2);
  dustLife[i] = 0.8 + Math.random() * 0.7;
}
function updateDust(dt) {
  if (!dustPoints) initDust();
  if (carOnGravel() && Math.abs(speed) > 4) {
    for (let k = 0; k < 3; k++) spawnDust(carGroup.position.x + (Math.random() - 0.5) * 1.6, carGroup.position.z + (Math.random() - 0.5) * 1.6);
    speed -= Math.sign(speed) * Math.min(Math.abs(speed), 12 * dt); // Kies bremst
  }
  for (let i = 0; i < DUST_N; i++) {
    if (dustLife[i] <= 0) continue;
    dustLife[i] -= dt;
    if (dustLife[i] <= 0) { dustPos[i * 3 + 1] = -9999; continue; }
    dustPos[i * 3] += dustVel[i].x * dt;
    dustPos[i * 3 + 1] += dustVel[i].y * dt;
    dustPos[i * 3 + 2] += dustVel[i].z * dt;
    dustVel[i].y -= 1.6 * dt;
  }
  dustPoints.geometry.attributes.position.needsUpdate = true;
}

// ---------- Resize & Render-Loop ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
const prevCarPos = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  // Boxengasse einmal aufbauen, sobald Auto + Strecke geladen sind; Crew animieren
  if (!pitScene && currentCar && centerline && carForward) buildPitScene();
  // Aufgemalte Startgitter-Markierungen nur auf den CSV-Strecken – die Szenerie-
  // Strecken (Austin, Spa) bringen ihre eigene Start/Ziel-Markierung mit
  if (!gridBoxes && centerline && !sceneryTrack) buildGridBoxes();
  if (pitScene) updatePitScene(dt);

  // Rennablauf (Ampel/Strafe) + Bots, vor dem Auto, damit die Kollision aktuelle Positionen nutzt
  if (gameStarted && raceMode && !gamePaused()) { updateRace(dt); updateBots(dt); }

  updateCar(dt);
  if (!gamePaused()) { updateDust(dt); updateFlames(dt); }
  updateLightsFollow();

  // Bei offenem Menü pausiert nur die Fahrphysik & die Rundenuhr (das Auto behält sein Tempo).
  // Kamera und Anzeige laufen weiter, damit Menüaktionen (z. B. Ansicht wechseln) sofort
  // sichtbar werden, statt erst beim Schließen des Menüs.
  if (!gamePaused()) updateTimeAttack(dt);

  if (cameraMode === 0) {
    // ===== Verfolgerkamera (Außenansicht) =====
    // Kamera folgt dem Auto, bleibt aber frei dreh- und zoombar
    const delta = carGroup.position.clone().sub(prevCarPos);
    camera.position.add(delta);
    controls.target.set(carGroup.position.x, carGroup.position.y + 0.6, carGroup.position.z);
    prevCarPos.copy(carGroup.position);

    // Rechter Stick: Kamera frei um das Auto drehen (horizontal + Höhe)
    let camOrbiting = false;
    const padCam = readGamepad();
    if (padCam) {
      const dz = 0.15; // Deadzone gegen Stick-Drift
      const rx = Math.abs(padCam.axes[2] ?? 0) > dz ? padCam.axes[2] : 0;
      const ry = Math.abs(padCam.axes[3] ?? 0) > dz ? padCam.axes[3] : 0;
      if (rx || ry) {
        camOrbiting = true;
        const offset = camera.position.clone().sub(controls.target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        sph.theta -= rx * 2.2 * dt;                                       // herumdrehen
        sph.phi = THREE.MathUtils.clamp(sph.phi + ry * 1.6 * dt, 0.2, 1.45); // höher/tiefer
        sph.makeSafe();
        offset.setFromSpherical(sph);
        camera.position.copy(controls.target).add(offset);
      }

      // D-Pad links: reinzoomen, D-Pad rechts: rauszoomen
      const zoomIn = padCam.buttons[14]?.pressed;  // links
      const zoomOut = padCam.buttons[15]?.pressed; // rechts
      if (zoomIn || zoomOut) {
        const off = camera.position.clone().sub(controls.target);
        const factor = zoomIn ? Math.exp(-1.8 * dt) : Math.exp(1.8 * dt);
        const dist = THREE.MathUtils.clamp(off.length() * factor, controls.minDistance, controls.maxDistance);
        off.setLength(dist);
        camera.position.copy(controls.target).add(off);
      }
    }

    // Während der Fahrt dreht sich die Kamera sanft hinter die FAHRTRICHTUNG
    // (rückwärts also nach hinten). Zoom und Neigungswinkel des Spielers bleiben erhalten.
    if (carForward && Math.abs(speed) > 0.5 && !camOrbiting && !gamePaused()) {
      const fwd = carForward.clone().applyAxisAngle(UP, carYaw);
      const dir = speed >= 0 ? fwd : fwd.clone().negate(); // beim Rückwärtsfahren umkehren
      const desiredAzimuth = Math.atan2(-dir.x, -dir.z);
      const offset = camera.position.clone().sub(controls.target);
      const currentAzimuth = Math.atan2(offset.x, offset.z);
      let diff = desiredAzimuth - currentAzimuth;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // kürzester Drehweg
      const k = (1 - Math.exp(-3.0 * dt)) * Math.min(1, Math.abs(speed) / 8);
      offset.applyAxisAngle(UP, diff * k);
      camera.position.copy(controls.target).add(offset);
    }

    controls.update();
  } else if (carForward) {
    // ===== Cockpit / Fahrersicht =====
    // Umsehen mit rechtem Stick; ohne Eingabe zentriert sich der Blick wieder nach vorne.
    let lookInput = false;
    const padCam = readGamepad();
    if (padCam) {
      const dz = 0.15;
      const rx = Math.abs(padCam.axes[2] ?? 0) > dz ? padCam.axes[2] : 0;
      const ry = Math.abs(padCam.axes[3] ?? 0) > dz ? padCam.axes[3] : 0;
      if (rx || ry) {
        lookInput = true;
        lookYaw = THREE.MathUtils.clamp(lookYaw - rx * 1.8 * dt, -Math.PI / 2, Math.PI / 2);
        lookPitch = THREE.MathUtils.clamp(lookPitch - ry * 1.4 * dt, -Math.PI / 4, Math.PI / 5);
      }
    }
    // Maus-Umsehen setzt lookYaw/lookPitch im pointermove-Handler. Ohne Eingabe sanft zentrieren.
    if (!lookInput) {
      const recenter = 1 - Math.exp(-4 * dt);
      lookYaw -= lookYaw * recenter;
      lookPitch -= lookPitch * recenter;
    }

    // Welt-Fahrtrichtung und Seitwärtsrichtung (nach links) des Autos
    _camFwd.copy(carForward).applyAxisAngle(UP, carYaw).normalize();
    _camSide.crossVectors(UP, _camFwd).normalize();
    // Augposition: Fahrersitz – etwas hinter der Fahrzeugmitte, seitlich versetzt, auf Sitzhöhe
    _eye.copy(carGroup.position)
      .addScaledVector(_camFwd, -COCKPIT_EYE.back - COCKPIT_CAM_BACK)
      .addScaledVector(_camSide, COCKPIT_EYE.side)
      .addScaledVector(UP, COCKPIT_EYE.height - COCKPIT_CAM_DROP);
    camera.position.copy(_eye);

    // Blickrichtung = Fahrtrichtung, um Umseh-Yaw (um Hochachse) und -Pitch (um Seitenachse) gedreht
    _lookAt.copy(_camFwd).applyAxisAngle(UP, lookYaw);
    _camSide.applyAxisAngle(UP, lookYaw);
    _lookAt.applyAxisAngle(_camSide, lookPitch);
    // Curb-Neigung des Autos auf die Kamera übertragen (rollt mit)
    camera.up.set(0, 1, 0).applyAxisAngle(_camFwd, carRoll);
    _lookAt.multiplyScalar(10).add(_eye);
    camera.lookAt(_lookAt);
  }

  // Cockpit-Displays: nur in der Ego-Sicht – linkes Display zeichnen,
  // Rückspiegelbild ins rechte Center-Display rendern (vor dem Hauptbild!)
  cockpitScreens.visible = cameraMode === 1 && gameStarted;
  if (cockpitScreens.visible && carForward) {
    updateDashScreen();
    if (centerScreenMesh) {
      const fwdW = carForward.clone().applyAxisAngle(UP, carYaw);
      const px = carGroup.position.x, py = carGroup.position.y, pz = carGroup.position.z;
      mirrorCam.position.set(px, py + 1.6, pz); // knapp über dem Dach, Blick nach hinten
      mirrorCam.up.set(0, 1, 0);
      mirrorCam.lookAt(px - fwdW.x * 14, py + 0.4, pz - fwdW.z * 14);
      mirrorCam.aspect = 16 / 9; mirrorCam.updateProjectionMatrix();
      centerScreenMesh.visible = false;         // eigene Textur nicht mitrendern (Feedback)
      renderer.setRenderTarget(mirrorRT);
      renderer.render(scene, mirrorCam);
      renderer.setRenderTarget(null);
      centerScreenMesh.visible = true;
    }
  }

  updateSunGlare(); // Blenden, wenn man in die Sonne schaut
  renderer.render(scene, camera);
});

// ---------- Startauto laden ----------
// Bewusst am Dateiende: loadCar() ruft applyCarPhysics() auf, und das setzt unter
// anderem GEAR_MAX_SPEED/GEAR_PULL/BOT_MAX_SPEED – die weiter unten deklariert sind.
loadCar(currentCarIndex);
