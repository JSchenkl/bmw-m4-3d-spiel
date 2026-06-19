import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSpaTrack } from './track.js';
import * as engineAudio from './audio.js';

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
let lookYaw = 0;   // Umsehen in der Cockpit-Sicht (horizontal, recentert zu 0)
let lookPitch = 0; // Umsehen in der Cockpit-Sicht (vertikal)
const CHASE_FOV = 45;   // Sichtfeld der Verfolgerkamera
const COCKPIT_FOV = 72; // weiteres Sichtfeld im Cockpit für mehr Immersion
// Position des Fahrerauges relativ zur Fahrzeugmitte (für Cockpit-Kamera UND Lenkrad-Suche)
const COCKPIT_EYE = { back: 0.30, side: 0.32, height: 1.12 };
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

// ---------- Rennstrecke: Spa-Francorchamps ----------
let pitDirection = null; // Fahrtrichtung in der Boxengasse (für die Auto-Ausrichtung)
let trackColliders = []; // Kollisionsboxen der Mauern und Gebäude
let curbData = null;     // Mittellinie + Breiten für die Curb-Neigung
createSpaTrack()
  .then(({ group, pitDirection: dir, colliders, curbData: cd }) => {
    scene.add(group);
    pitDirection = dir;
    trackColliders = colliders;
    curbData = cd;
    alignCarToPitlane();
  })
  .catch((err) => console.error('Strecke konnte nicht geladen werden:', err));

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

// Verfügbare Autos. Beide fahren mit derselben Physik (siehe Fahrsteuerung unten);
// die Regexe beschreiben, wie Leuchten/Felgen/Scheiben im jeweiligen Modell heißen.
const CARS = [
  {
    id: 'm4',
    name: 'BMW M4 COMPETITION',
    short: 'BMW M4',
    subtitle: 'M Package · 3D Viewer',
    file: 'models/bmw_m4.glb',
    length: 4.8,            // reale Fahrzeuglänge in Metern
    lightRe: /headlight|redlight|tail|led|light/,
    redRe: /redlight|tail/,
    rimRe: /rim/,
    windowRe: /windows/,
    forward: null,          // Fahrtrichtung wird aus den Rücklichtern bestimmt
  },
];
// Start-Auto per URL wählbar (?car=sls), Standard ist der M4
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
  debug: true,   // true = herausgelöster Bereich wird ROT eingefärbt (zum Justieren)
  ahead: 0.42,   // Meter vor dem Auge (Lenkrad-Mitte)
  drop: 0.05,    // Meter unter dem Auge
  side: 0.18,    // Meter weiter zur Fahrerseite als das Auge
  rad: 0.22,     // halbe Box-Größe quer & hoch (Meter)
  depth: 0.18,   // halbe Box-Tiefe in Längsrichtung (Meter, dünn → Armaturen dahinter bleiben verschont)
  tilt: 0.40,    // Neigung der Lenksäule (rad, ~23°)
  sign: 1,       // Drehrichtung des Lenkrads (umdrehen, falls verkehrt herum)
};

let carYaw = 0; // aktueller Drehwinkel des Autos um die Hochachse
let carRoll = 0; // aktuelle Seitenneigung (Roll) – z. B. wenn ein Rad auf dem Curb steht
let rearSlip = 0; // geglätteter Heck-Schlupf (0 = Grip, >0 = Räder drehen durch → Heck bricht aus)
const UP = new THREE.Vector3(0, 1, 0);
const CURB_TILT = 0.056; // max. Neigung auf dem Randstein (rad, ~3,2°; 20 % flacher)
const _yawQ = new THREE.Quaternion();
const _rollQ = new THREE.Quaternion();

// Hitbox des Autos: halbe Länge/Breite, wird beim Laden aus dem Modell bestimmt
const carHalf = { len: 2.4, wid: 0.95 };

// Setzt die Auto-Ausrichtung aus Gierwinkel (Lenken) und Roll (Curb-Neigung).
// Der Roll dreht um die lokale Längsachse des Autos, der Yaw um die Hochachse.
function applyCarOrientation() {
  _yawQ.setFromAxisAngle(UP, carYaw);
  if (carForward && carRoll !== 0) {
    _rollQ.setFromAxisAngle(carForward, carRoll);
    carGroup.quaternion.copy(_yawQ).multiply(_rollQ);
  } else {
    carGroup.quaternion.copy(_yawQ);
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
    if (onLeft && !onRight) target = CURB_TILT;       // linke Räder hoch → Auto neigt sich
    else if (onRight && !onLeft) target = -CURB_TILT; // rechte Räder hoch
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

function loadCar(index) {
  const cfg = CARS[index];

  // Beim Wechsel behält das neue Auto Position und Fahrtrichtung des alten
  const prevHeading = (carForward && currentCar)
    ? carForward.clone().applyAxisAngle(UP, carYaw)
    : null;

  if (currentCar) carGroup.remove(currentCar);
  currentCar = null;
  headlightSpots.clear();
  taillightGlows.clear();
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

  new GLTFLoader().load(
  cfg.file,
  (gltf) => {
    const car = gltf.scene;

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
        node.material.opacity = Math.min(node.material.opacity, 0.4);
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

      const invW = mesh.matrixWorld.clone().invert();
      const material = mesh.material;
      mesh.geometry = new THREE.BufferGeometry(); // Original rendert nichts mehr

      for (const { idx, box: wBox } of clusters.values()) {
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
          radius: Math.max((wBox.max.y - wBox.min.y) / 2, 0.2),
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

      // Drehachse = Lenksäule: Fahrtrichtung, um die Querachse nach unten geneigt
      const sideAxis = new THREE.Vector3();
      sideAxis[widthAxis] = 1;
      const columnAxisWorld = carForward.clone().applyAxisAngle(sideAxis, STEER_WHEEL.tilt).normalize();

      // ALLE Teile prüfen – das Lenkrad besteht aus mehreren Materialien (schwarz, Logo, M-Streifen),
      // nicht nur aus „interior". Die Box vor dem Fahrer entscheidet, was zum Lenkrad gehört.
      const interiorMeshes = [];
      car.traverse((n) => { if (n.isMesh && n.geometry.getAttribute('position')) interiorMeshes.push(n); });

      const _c = new THREE.Vector3();
      const _t = new THREE.Vector3();
      for (const mesh of interiorMeshes) {
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
          if (region.containsPoint(_c)) grabbedIdx.push(i, i + 1, i + 2);
          else keptIdx.push(i, i + 1, i + 2);
        }
        if (!grabbedIdx.length) continue;

        const makeGeo = (idx) => {
          const out = new THREE.BufferGeometry();
          for (const name of Object.keys(geo.attributes)) out.setAttribute(name, geo.attributes[name]);
          out.setIndex(idx);
          return out;
        };
        mesh.geometry = makeGeo(keptIdx); // der Rest des Innenraums bleibt stehen

        const invW = mesh.matrixWorld.clone().invert();
        const centerL = center.clone().applyMatrix4(invW);
        const axisL = columnAxisWorld.clone().transformDirection(invW).normalize();

        const mat = STEER_WHEEL.debug
          ? new THREE.MeshStandardMaterial({ color: 0xff1010, emissive: 0xaa0000, emissiveIntensity: 1 })
          : mesh.material;
        const wheelMesh = new THREE.Mesh(makeGeo(grabbedIdx), mat);
        wheelMesh.castShadow = true;
        wheelMesh.position.copy(centerL).negate(); // Geometrie bleibt am Platz, dreht aber um den Pivot
        const pivot = new THREE.Object3D();
        pivot.position.copy(centerL);
        pivot.add(wheelMesh);
        mesh.add(pivot);
        steeringParts.push({ pivot, axisLocal: axisL });
      }
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

    carGroup.add(car);
    currentCar = car;
    if (prevHeading) setHeading(prevHeading); // Kurs des vorherigen Autos übernehmen
    else alignCarToPitlane();
    applyMode();
    loaderEl.classList.add('hidden');
  },
  (xhr) => {
    if (xhr.total > 0) {
      const pct = Math.round((xhr.loaded / xhr.total) * 100);
      barEl.style.width = pct + '%';
      pctEl.textContent = `Lade Modell … ${pct}%`;
    }
  },
  (err) => {
    pctEl.textContent = 'Fehler beim Laden des Modells. Bitte über einen lokalen Server starten (start.bat).';
    console.error(err);
  }
  );
}

loadCar(currentCarIndex);

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
    stars.visible = true;
    ground.material.color.set(0x0e1810);
    renderer.toneMappingExposure = 0.85;
  } else {
    scene.background = new THREE.Color(0xa8c8e8);
    scene.fog = new THREE.Fog(0xa8c8e8, 600, 8000);
    scene.environmentIntensity = 1.0;
    sun.visible = true;
    moon.visible = false;
    hemi.intensity = 1.2;
    hemi.color.set(0xbfd9ff);
    stars.visible = false;
    ground.material.color.set(0x4e7a3a);
    renderer.toneMappingExposure = 1.0;
  }
  applyHeadlights();
  applyTaillights();
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
  if (audioUnlocked) return;
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

// ---------- Menü ein-/ausblenden (Taste M, Klick auf den Menü-Button, Esc schließt) ----------
const uiPanel = document.getElementById('ui');
const btnMenu = document.getElementById('menu-toggle');
function toggleMenu(show) {
  // ohne Argument umschalten, sonst gezielt öffnen/schließen
  const open = (show === undefined) ? uiPanel.classList.contains('hidden') : show;
  uiPanel.classList.toggle('hidden', !open);
  btnMenu.classList.toggle('active', open);
}
btnMenu.addEventListener('click', () => toggleMenu());

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
// Längsdynamik nach echten Daten des BMW M4 Competition xDrive (G82),
// Quelle: auto-data.net / BMW-Datenblatt:
//   510 PS (375 kW), 650 Nm, 1775 kg, 0–100 km/h in 3,5 s,
//   cw = 0,34, Vmax 250 km/h (mit M Driver's Package 290 km/h)
const MASS = 1775;                 // kg Leergewicht
const POWER_WHEEL = 375000 * 0.85 * 1.05 * 1.1; // W an den Rädern (~15 % Verlust, +5 % Tuning, +10 % Durchzug)
const F_TRACTION = 17800 * 1.05;          // N Traktionsgrenze beim Start (+5 % Tuning)
const ACCEL_BOOST = 1.32;                  // +32 % Beschleunigung (1,1 × 1,2: zusätzlich +20 % aus Kurven und im Fahren)
// Power-Oversteer (heckgetriebener M4, 650 Nm @ 2750 min⁻¹, ~50:50-Gewichtsverteilung):
// Übersteigt die angeforderte Antriebskraft die Längs-Haftung am Heck, drehen die
// Hinterräder durch und das Heck bricht aus. Eckdaten: automobile-catalog / auto-data.net
// (BMW M4 Competition, 3,0-l-R6, 650 Nm, ~1775 kg).
const REAR_GRIP = 0.5 * MASS * 9.81 * 1.05; // max. Längskraft am Heck (~50 % Achslast, μ≈1.05)
const OVERSTEER_GAIN = 0.8;                  // wie stark das Heck bei Schlupf eindreht
const BRAKE_DECEL = 13.5;          // m/s² (M-Sportbremse +15 %, 100–0 in ~29 m)
const RHO_AIR = 1.225;             // kg/m³ Luftdichte
const CD_AREA = 0.34 * 2.25;       // cw · Stirnfläche (m²)
const ROLL_RES = 0.012;            // Rollwiderstandsbeiwert
const VMAX = 290 / 3.6;            // m/s, elektronische Abregelung (M Driver's Package)
const MAX_REVERSE = -20 / 3.6;     // m/s rückwärts

// Querdynamik (Einspurmodell), ebenfalls nach echten Daten:
//   Radstand 2857 mm (BMW-Datenblatt), max. Querbeschleunigung
//   1,07 g im Edmunds-Skidpad-Test des M4 Competition
const WHEELBASE = 2.857;             // m
const MAX_LAT_ACC = 1.07 * 9.81;     // m/s² Haftgrenze der Reifen
const MAX_STEER = 32 * Math.PI / 180; // max. Radeinschlag (rad)
const STEER_RATE = 2.5;              // Lenkgeschwindigkeit (Volleinschläge pro Sekunde)
let steerAngle = 0;                  // aktueller Radeinschlag

let speed = 0;
const keys = new Set();
const speedNumEl = document.getElementById('speed-num');
const gearEl = document.getElementById('gear');

// Manuelles 6-Gang-Getriebe: je Gang ein Drehzahllimit (Gang-Höchsttempo) und ein
// Zugkraft-Faktor. Niedriger Gang = viel Zugkraft, wenig Topspeed; hoher Gang
// umgekehrt. Man muss mit RB/E hochschalten, um schneller als das Gang-Limit zu fahren.
const GEAR_MAX_SPEED = [0, 55, 95, 140, 190, 240, 290].map((v) => v / 3.6); // km/h → m/s
const GEAR_PULL = [0, 1.0, 0.72, 0.52, 0.4, 0.31, 0.25]; // Zugkraft-Faktor je Gang
let gear = 1; // 0 = Rückwärtsgang (R), 1…6 = Vorwärtsgänge
let prevGearSound = 1; // letzter Gang – für den Schaltsound (Hoch-/Runterschalten)
let autoGearbox = false; // false = Handschaltung, true = Automatikgetriebe
// Manuell schalten geht nur bei der Handschaltung – im Automatikmodus übernimmt das Spiel.
const shiftUp = () => { if (!autoGearbox) gear = Math.min(6, gear + 1); };
const shiftDown = () => { if (!autoGearbox) gear = Math.max(0, gear - 1); };

// Automatikgetriebe: wählt Fahrtrichtung (D/R) und Gang selbsttätig nach Tempo.
function autoShiftGear(throttle, reverse) {
  if (!autoGearbox) return;
  const vAbs = Math.abs(speed);
  if (vAbs < 0.5 && !braking) {
    // Im Stand wie bei einer Automatik die Richtung wählen
    if (throttle) gear = Math.max(gear, 1);      // W → Fahrstufe D (1. Gang)
    else if (reverse) gear = 0;                  // S → Rückwärtsgang R
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
  if (e.code === 'KeyE') shiftUp();   // hochschalten
  if (e.code === 'KeyQ') shiftDown(); // runterschalten
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
  document.getElementById('hint').innerHTML =
    '🎮 <b>RT</b> Gas · <b>LT</b> Bremse · <b>L-Stick</b> Lenken · <b>R-Stick</b> Kamera · <b>RB</b>/<b>LB</b> Schalten (LB bis <b>R</b>) · <b>X</b>/<b>B</b> Licht · <b>Y</b> Tag/Nacht<br>' +
    'Tastatur: <b>W</b> Gas · <b>A</b>/<b>D</b> Lenken · <b>Leertaste</b> Bremse · <b>S</b> Rückwärts · <b>E</b>/<b>Q</b> Schalten';
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

function resolveCollisions() {
  if (!carForward || !trackColliders.length) return;
  const fwd = carForward.clone().applyAxisAngle(UP, carYaw);
  const car = {
    cx: carGroup.position.x, cz: carGroup.position.z,
    ax: fwd.x, az: fwd.z,
    halfLen: carHalf.len, halfWid: carHalf.wid,
  };

  for (const w of trackColliders) {
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
      const slide = Math.sqrt(Math.max(0, 1 - align * align));
      speed *= slide * 0.9;
    }
  }
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

    if (rt > 0.02) throttle = Math.max(throttle, rt);
    // LT bremst nur noch – in jedem Gang. Rückwärts fährt man über den R-Gang.
    if (lt > 0.02) brakeInput = Math.max(brakeInput, lt);

    const dz = 0.12; // Deadzone gegen Stick-Drift
    if (Math.abs(stickX) > dz) {
      steer = -Math.sign(stickX) * (Math.abs(stickX) - dz) / (1 - dz);
    }

    if (padPressedOnce(pad, 2)) btnHead.click();     // X
    if (padPressedOnce(pad, 1)) btnTail.click();     // B
    if (padPressedOnce(pad, 3)) btnDayNight.click(); // Y
    if (padPressedOnce(pad, 5)) shiftUp();           // RB = hochschalten
    if (padPressedOnce(pad, 4)) shiftDown();         // LB = runterschalten

    if ((throttle > 0 || brakeInput > 0 || Math.abs(stickX) > dz) && controls.autoRotate) {
      controls.autoRotate = false;
      btnRotate.textContent = '🔄 Auto-Rotation: AUS';
    }
  }

  // Bremslichter folgen dem Bremszustand (Tastatur wie Controller)
  const wantBrake = brakeInput > 0.05;
  if (wantBrake !== braking) {
    braking = wantBrake;
    applyTaillights();
  }

  // Längsdynamik: Kräftebilanz aus Antrieb, Luft- und Rollwiderstand
  const v = Math.abs(speed);
  const fDrag = 0.5 * RHO_AIR * CD_AREA * v * v;          // Luftwiderstand
  const fRoll = v > 0.1 ? MASS * 9.81 * ROLL_RES : 0;      // Rollwiderstand
  let accel = 0;
  let slipTarget = 0; // angeforderter Heck-Schlupf dieses Frames (für den Oversteer)

  // Automatikgetriebe wählt Gang/Richtung, bevor der Antrieb berechnet wird
  autoShiftGear(throttle, reverse);

  // Im Rückwärtsgang (R = Gang 0) fährt Gas rückwärts; sonst zählt die S/LT-Taste
  const reverseInput = gear === 0 ? Math.max(throttle, reverse) : reverse;

  if (braking) {
    accel = -Math.sign(speed) * (BRAKE_DECEL * brakeInput + (fDrag + fRoll) / MASS);
    // nicht über den Nullpunkt hinaus bremsen
    if (Math.abs(accel * dt) >= v) { speed = 0; accel = 0; }
  } else if (gear >= 1 && throttle) {
    // Antrieb über das gewählte Getriebe: Zugkraft sinkt mit steigendem Gang und
    // fällt im Gang gegen das Drehzahllimit (Gang-Höchsttempo) auf null ab.
    const vmaxGear = GEAR_MAX_SPEED[gear];
    if (v < vmaxGear) {
      const pull = F_TRACTION * GEAR_PULL[gear];
      const fade = Math.max(0, 1 - Math.pow(v / vmaxGear, 2.2)); // am Limit kein Vortrieb mehr
      // weiterhin leistungsbegrenzt (P = F·v), beim Anfahren traktionsbegrenzt
      const fDrive = Math.min(pull, POWER_WHEEL / Math.max(v, 3)) * throttle * fade * ACCEL_BOOST;
      // Überschreitet die Antriebskraft die Heck-Haftung, drehen die Räder durch
      slipTarget = Math.max(0, (fDrive - REAR_GRIP) / REAR_GRIP);
      const grip = 1 - 0.12 * Math.min(1, slipTarget); // durchdrehende Reifen ziehen etwas schlechter
      accel = (fDrive * grip - fDrag - fRoll) / MASS;
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
  speed = Math.min(Math.max(speed, MAX_REVERSE), VMAX); // elektronische Abregelung

  // Lenkwinkel weich zum Zieleinschlag führen (sanftes Ein- und Auslenken per Tastatur)
  const steerTarget = steer * MAX_STEER;
  const rate = (steer === 0 ? STEER_RATE * 2 : STEER_RATE) * MAX_STEER * dt;
  steerAngle += THREE.MathUtils.clamp(steerTarget - steerAngle, -rate, rate);

  // Einspurmodell: Gierrate aus Radstand und Radeinschlag (ω = v/L · tan δ).
  // Vorzeichen von v dreht beim Rückwärtsfahren die Lenkung automatisch um.
  if (Math.abs(speed) > 0.05 && Math.abs(steerAngle) > 0.0005) {
    let omega = (speed / WHEELBASE) * Math.tan(steerAngle);

    // Kammscher Kreis: wer stark bremst oder beschleunigt, hat weniger Seitengrip
    // (Untergrenze 30 %, da das ABS Lenkfähigkeit erhält)
    const usedLong = Math.min(Math.abs(accel) / MAX_LAT_ACC, 0.9);
    const latMax = Math.max(0.3 * MAX_LAT_ACC, MAX_LAT_ACC * Math.sqrt(1 - usedLong * usedLong));

    const aLat = Math.abs(speed * omega);
    if (aLat > latMax) {
      omega *= latMax / aLat;                                        // Untersteuern: das Auto schiebt
      speed -= Math.sign(speed) * Math.min(2 * dt, Math.abs(speed)); // Reifen schrubben Tempo ab
    }

    carYaw += omega * dt;
  }

  // Power-Oversteer: drehen die Hinterräder durch (zu viel Gas), schwenkt das Heck
  // zusätzlich in Lenkrichtung herum. Gegenlenken dreht die Richtung um und fängt den
  // Drift wieder ein – wie beim echten heckgetriebenen M4.
  rearSlip += (slipTarget - rearSlip) * Math.min(1, dt * 8);
  if (rearSlip > 0.02 && speed > 1.5 && Math.abs(steerAngle) > 0.01) {
    const dir = Math.sign(steerAngle);
    const spd = Math.min(1, speed / 6); // bei mehr Tempo bricht das Heck leichter aus
    carYaw += dir * Math.min(1, rearSlip) * spd * OVERSTEER_GAIN * dt;
  }

  // Bewegung in Blickrichtung der Fahrzeugfront
  if (speed !== 0 && carForward) {
    const fwd = carForward.clone().applyAxisAngle(UP, carYaw);
    carGroup.position.addScaledVector(fwd, speed * dt);
  }

  // Kollisionen mit Mauern und Gebäuden auflösen
  resolveCollisions();

  // Seitenneigung auf Randsteinen bestimmen und Auto-Ausrichtung (Yaw + Roll) setzen
  updateCurbTilt(dt);
  applyCarOrientation();

  // Räder: Abrollen passend zum Tempo (ω = v/r), Vorderräder lenken sichtbar mit
  for (const w of wheels) {
    if (speed !== 0) w.spin.rotateOnAxis(w.axisLocal, (speed / w.radius) * dt);
    if (w.steer) w.steer.quaternion.setFromAxisAngle(w.upLocal, steerAngle);
  }

  // Lenkrad dreht mit (stärker als die Räder, je nach Lenkübersetzung)
  const wheelAngle = steerAngle * STEER_RATIO * STEER_WHEEL.sign;
  for (const sp of steeringParts) sp.pivot.quaternion.setFromAxisAngle(sp.axisLocal, wheelAngle);

  speedNumEl.textContent = Math.round(Math.abs(speed) * 3.6);
  gearEl.innerHTML = `<span>GANG${autoGearbox ? ' · A' : ''}</span> ${gear === 0 ? 'R' : gear}`;
  updateRevLights(speed);

  // Schaltsound bei Gangwechsel (gilt für Hand- wie Automatikgetriebe; R bleibt stumm)
  if (gear !== prevGearSound) {
    if (gear >= 1 && prevGearSound >= 1) {
      if (gear > prevGearSound) engineAudio.upshift();
      else engineAudio.downshift();
    }
    prevGearSound = gear;
  }

  // Motorsound: Drehzahl aus dem Tempo im aktuellen Gang ableiten
  const gearForRev = gear >= 1 ? gear : 1;
  const rev = Math.min(1, Math.abs(speed) / GEAR_MAX_SPEED[gearForRev]);
  engineAudio.update(rev, throttle, dt);
}

// Sonne/Mond samt Schattenbereich folgen dem Auto
scene.add(sun.target, moon.target);
function updateLightsFollow() {
  const p = carGroup.position;
  sun.position.set(p.x + 90, 130, p.z + 60);
  sun.target.position.set(p.x, 0, p.z);
  moon.position.set(p.x - 80, 120, p.z - 50);
  moon.target.position.set(p.x, 0, p.z);
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

  updateCar(dt);
  updateLightsFollow();

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
    }

    // Während der Fahrt dreht sich die Kamera sanft hinter die FAHRTRICHTUNG
    // (rückwärts also nach hinten). Zoom und Neigungswinkel des Spielers bleiben erhalten.
    if (carForward && Math.abs(speed) > 0.5 && !camOrbiting) {
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
      .addScaledVector(_camFwd, -COCKPIT_EYE.back)
      .addScaledVector(_camSide, COCKPIT_EYE.side)
      .addScaledVector(UP, COCKPIT_EYE.height);
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

  renderer.render(scene, camera);
});
