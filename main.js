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
    buildCenterline(cd);
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
  debug: false,  // true = herausgelöster Bereich wird ROT eingefärbt (zum Justieren)
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
    // Startbildschirm: Nachtmodus + alle Lichter + Rotation einschalten
    isNight = true;
    headlightsOn = true;
    taillightsOn = true;
    applyMode();
    controls.autoRotate = true;
    loaderEl.classList.add('hidden');
    // Startscreen einblenden (requestAnimationFrame damit CSS-Transition greift)
    requestAnimationFrame(() => document.getElementById('start-screen').classList.add('visible'));
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

  // „SPIELEN" → Modus-Auswahl (Training / Rennen) zeigen
  document.getElementById('btn-start').addEventListener('click', () => {
    startScreen.classList.remove('visible');
    startScreen.addEventListener('transitionend', () => { startScreen.style.display = 'none'; }, { once: true });
    modeScreen.classList.add('visible');
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

    // HUD und Steuerelemente einblenden (Steuerungs-Hinweis bleibt nur im Startmenü)
    document.getElementById('hud-top').style.display = '';
    document.getElementById('hint').style.display = 'none';
    document.getElementById('title').style.display = '';
    document.getElementById('laptimer').style.display = '';

    // Immer in der Cockpit-Sicht ins Spiel starten
    cameraMode = 1;
    applyCameraMode();

    // Zeitfahren ab der ersten Runde scharf schalten
    gameStarted = true;
    armLap();

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
// Power-Oversteer (xDrive AWD, 10 % vorne / 90 % hinten, 650 Nm @ 2750 min⁻¹):
// Übersteigt der Heck-Anteil (90 %) die Längs-Haftung am Heck, drehen die
// Hinterräder durch und das Heck bricht aus. Eckdaten: automobile-catalog / auto-data.net
// (BMW M4 Competition, 3,0-l-R6, 650 Nm, ~1775 kg).
const DRIVE_REAR = 0.90;                     // 90 % Antrieb hinten, 10 % vorne
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
const WHEELBASE   = 2.857;             // m
const MAX_LAT_ACC = 1.07 * 9.81;       // m/s² Haftgrenze der Reifen
const MAX_STEER   = 32 * Math.PI / 180; // max. Radeinschlag (rad)
const STEER_RATE  = 2.5;               // Lenkgeschwindigkeit (Volleinschläge pro Sekunde)
let steerAngle = 0;                    // aktueller Radeinschlag

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

function resolveCollisions() {
  if (!carForward) return;
  const fwd = carForward.clone().applyAxisAngle(UP, carYaw);
  const car = {
    cx: carGroup.position.x, cz: carGroup.position.z,
    ax: fwd.x, az: fwd.z,
    halfLen: carHalf.len, halfWid: carHalf.wid,
  };

  for (const w of trackColliders.concat(botColliders)) {
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

    // Ton beim ersten Controller-Knopfdruck freischalten (Gamepad löst kein keydown aus)
    if (!audioUnlocked && (rt > 0.02 || lt > 0.02 || Math.abs(stickX) > 0.12 || pad.buttons.some((b) => b?.pressed))) {
      unlockAudio();
    }

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
    if (padPressedOnce(pad, 9)) toggleMenu();        // ☰ Menü-Button (drei Striche)

    // Menü-Navigation: D-Pad hoch/runter bewegt die Auswahl, A löst sie aus
    // (nur nach dem Start – im Startmodus ist das Menü nicht bedienbar)
    const menuOpen = gameStarted && !uiPanel.classList.contains('hidden');
    if (menuOpen) {
      if (padPressedOnce(pad, 12)) moveMenuSelection(-1); // D-Pad hoch
      if (padPressedOnce(pad, 13)) moveMenuSelection(1);  // D-Pad runter
      if (padPressedOnce(pad, 0)) getMenuItems()[menuIndex]?.click(); // A = auswählen
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
      // Überschreitet der Heck-Anteil (90 %) die Heck-Haftung, drehen die Räder durch
      slipTarget = Math.max(0, (fDrive * DRIVE_REAR - REAR_GRIP) / REAR_GRIP);
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
    const usedLong = Math.min(Math.abs(accel) / MAX_LAT_ACC, 0.9);
    const latMax = Math.max(0.3 * MAX_LAT_ACC, MAX_LAT_ACC * Math.sqrt(1 - usedLong * usedLong));

    const aLat = Math.abs(speed * omega);
    if (aLat > latMax) {
      omega *= latMax / aLat;
      speed -= Math.sign(speed) * Math.min(2 * dt, Math.abs(speed));
    }

    carYaw += omega * dt;
  }

  // Heck-Schlupf glätten
  rearSlip += (slipTarget - rearSlip) * Math.min(1, dt * 8);

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
      // Abgeschlossene gemessene Runde
      ghost.lastLap = ghost.lapElapsed;
      if (ghost.lapElapsed < ghost.bestLap) {
        ghost.bestLap = ghost.lapElapsed;
        ghost.best = ghost.recording;
        ghost.bestDur = ghost.lapElapsed;
        buildGhostMesh();
      }
      showRaceMsg(`Runde: ${fmtTime(ghost.lapElapsed)}`, '#69f0ae');
      // Rennmodus: erste gültige Runde ist die Quali-Zeit → „Rennen starten" anbieten
      if (raceMode && race.phase === 'quali') {
        race.qualiTime = ghost.lapElapsed;
        race.phase = 'qualiDone';
        setRaceStartVisible(true);
        setRaceInfo(`Quali: ${fmtTime(race.qualiTime)} — bereit? „Rennen starten" drücken`);
      }
    } else {
      // Erste Linienüberfahrt: Aus-Runde beendet, ab jetzt wird die Zeit gemessen
      showRaceMsg('Zeitmessung gestartet!', '#69f0ae');
    }
    ghost.timing = true;
    ghost.lapElapsed = 0;
    ghost.recording = [];
    ghost.cursor = 0;
    ghost.maxProgress = 0;
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
  speed = 0; steerAngle = 0; carRoll = 0; gear = 1; prevGearSound = 1;
  alignCarToPitlane();
  prevCarPos.copy(carGroup.position);

  // Ton stumm – beim nächsten Start wieder ab erstem Knopfdruck
  engineAudio.setEnabled(false);
  audioUnlocked = false;

  // HUD/Pause aus, Menü zurück in den (nicht bedienbaren) Startmodus-Deko-Zustand
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

  // Modus-Screen sicher aus, Startbildschirm wieder einblenden
  document.getElementById('mode-screen').classList.remove('visible');
  const ss = document.getElementById('start-screen');
  ss.style.display = '';
  requestAnimationFrame(() => ss.classList.add('visible'));
});

// ---------- Gegner-Bots ----------
// Immer aktive KI-Autos (nicht abschaltbar). Sie fahren das gleiche Modell wie der
// Spieler entlang der Streckenmittellinie und haben eine Hitbox (Kollision mit dem Spieler).
const BOT_COUNT = 5;            // 5 Gegner + Spieler = 6 Autos
const BOT_SPEED = 28;           // m/s (~100 km/h) konstantes Reisetempo der Bots
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
  for (let k = 0; k < BOT_COUNT; k++) {
    const clone = currentCar.clone(true); // gleiches Auto-Modell wie der Spieler
    const group = new THREE.Group();
    group.add(clone);
    scene.add(group);
    const wheelsClone = wheelPaths
      .map((w) => ({ spin: resolveNodePath(clone, w.path), axisLocal: w.axisLocal, radius: w.radius }))
      .filter((w) => w.spin);
    bots.push({ group, s: 0, offset: 0, wheels: wheelsClone });
  }
}

// Setzt einen Bot an seine aktuelle Bogenlänge/seitl. Versatz; gibt Welt-Pos + Tangente zurück.
// Die Ausrichtung kommt aus einer Vorausschau (~6 m), damit die Front nicht an jeder
// Segmentgrenze springt (kein Ruckeln).
function positionBot(bot) {
  const c = centerlineAt(bot.s);
  const a = centerlineAt(bot.s + 6);
  let dx = a.x - c.x, dz = a.z - c.z;
  const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const nx = -dz, nz = dx; // Quernormale für den seitlichen Versatz
  const x = c.x + nx * bot.offset, z = c.z + nz * bot.offset;
  bot.group.position.set(x, carGroup.position.y, z);
  _botFwd.set(dx, 0, dz);
  bot.group.quaternion.setFromUnitVectors(carForward, _botFwd); // Front entlang der Strecke
  return { x, z, tx: dx, tz: dz };
}

function updateBots(dt) {
  if (!centerline || !currentCar || !carForward || !bots.length) return;
  botColliders = [];
  for (const bot of bots) {
    if (race.phase === 'go') {
      bot.s = (bot.s + BOT_SPEED * dt) % centerline.total; // fahren erst nach dem Start
      for (const w of bot.wheels) w.spin.rotateOnAxis(w.axisLocal, (BOT_SPEED / w.radius) * dt); // Räder drehen
    }
    const p = positionBot(bot);
    botColliders.push({ cx: p.x, cz: p.z, ax: p.tx, az: p.tz, halfLen: carHalf.len, halfWid: carHalf.wid });
  }
}

function removeBots() {
  for (const bot of bots) scene.remove(bot.group);
  bots.length = 0;
  botColliders = [];
}

// ---------- Rennmodus: Quali → Startaufstellung → F1-Ampel → Frühstart-Strafe ----------
const BOT_QUALI_FACTOR = [0.94, 0.98, 1.03, 1.08, 1.13]; // Bot-Quali-Zeiten relativ zur Spielerzeit
const race = {
  phase: 'off',     // 'off' | 'quali' | 'qualiDone' | 'lights' | 'go'
  qualiTime: null,
  playerGrid: 0,
  lightT: 0,
  litCount: -1,
  holdAfter: 2,
  jumpStart: false,
  penalty: 0,       // verbleibende Strafzeit (Sek), >0 = noch abzusitzen
  skipped: false,   // Quali übersprungen → Start ganz hinten
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
function renderLights(n) {
  const els = lightsEl.children;
  for (let i = 0; i < els.length; i++) els[i].classList.toggle('on', i < n);
}

// Beginn des Rennmodus: erst Qualifikation (eine schnelle Runde)
function startRaceQuali() {
  race.phase = 'quali';
  race.qualiTime = null;
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
  setRaceStartVisible(false);
  setRaceSkipVisible(false);
  lightsEl.classList.remove('visible');
  penaltyEl.classList.remove('visible');
  renderLights(0);
  setRaceInfo('');
}

const gridArc = (i) => centerline.total - 10 - i * 7;       // Startplätze hinter der Linie
const gridOffset = (i) => (i % 2 === 0 ? 3 : -3);           // gestaffelt links/rechts

function setupGrid() {
  if (!centerline || (race.qualiTime == null && !race.skipped)) return;
  // Reihenfolge aus Quali-Zeiten (Spieler + Bots), schnellste Zeit = Pole.
  // Quali übersprungen → Spieler startet ganz hinten (Zeit = Unendlich).
  const baseRef = (race.qualiTime != null && isFinite(race.qualiTime)) ? race.qualiTime : 90;
  const playerTime = race.skipped ? Infinity : race.qualiTime;
  const entries = [{ who: 'player', time: playerTime }];
  for (let k = 0; k < BOT_COUNT; k++) entries.push({ who: k, time: baseRef * BOT_QUALI_FACTOR[k] });
  entries.sort((a, b) => a.time - b.time);

  if (!bots.length) createBots();
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
      speed = 0; gear = 1; prevGearSound = 1;
    } else {
      const bot = bots[e.who];
      bot.s = arc; bot.offset = gridOffset(i);
      positionBot(bot);
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
      setRaceInfo('');
      showRaceMsg('LOS!', '#69f0ae');
    }
  } else if (race.phase === 'go') {
    if (race.penalty > 0) {
      if (inPitZone() && Math.abs(speed) < 2) race.penalty = Math.max(0, race.penalty - dt);
    } else if (race.jumpStart) {
      race.jumpStart = false;
      showRaceMsg('Strafe abgesessen – freie Fahrt', '#69f0ae');
    }
  }
}

raceStartBtn.addEventListener('click', setupGrid);
raceSkipBtn.addEventListener('click', () => {
  race.skipped = true; // Quali übersprungen ⇒ Start ganz hinten
  setupGrid();
});
// gleiche Aktionen auch über das ☰-Menü; Menü dabei schließen, damit es weitergeht
btnRaceStartMenu.addEventListener('click', () => { setupGrid(); toggleMenu(false); });
btnRaceSkipMenu.addEventListener('click', () => { race.skipped = true; setupGrid(); toggleMenu(false); });

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

function buildPitScene() {
  pitScene = new THREE.Group();
  const total = centerline.total;
  const team = [0x2aa6e0, 0xe2001a, 0xf0f0f0];
  const arcs = [total - 70, total - 120, total - 170]; // drei Boxen-Plätze vor der Linie
  arcs.forEach((arc, idx) => {
    const c = centerlineAt(arc);
    const tx = c.tx, tz = c.tz;
    const lnx = tz, lnz = -tx;                 // Quernormale (Boxengassen-Seite)
    const px = c.x + lnx * -15, pz = c.z + lnz * -15;
    const fwd = new THREE.Vector3(tx, 0, tz);

    // geparktes Auto (gleiches Modell)
    const carG = new THREE.Group();
    carG.add(currentCar.clone(true));
    carG.position.set(px, carGroup.position.y, pz);
    carG.quaternion.setFromUnitVectors(carForward, fwd);
    pitScene.add(carG);

    // Reifenstapel neben der Box
    for (let t = 0; t < 3; t++) {
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16),
        new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }));
      tire.position.set(px + tx * 2.2 + lnx * -2.6, 0.12 + t * 0.24, pz + tz * 2.2 + lnz * -2.6);
      pitScene.add(tire);
    }

    // 4 Crew-Mitglieder an den Radpositionen
    const wheels = [[2, 0.9], [2, -0.9], [-2, 0.9], [-2, -0.9]];
    wheels.forEach(([lon, lat], wi) => {
      const m = makeCrewMember(team[idx % team.length]);
      m.position.set(px + tx * lon + lnx * lat, carGroup.position.y, pz + tz * lon + lnz * lat);
      m.rotation.y = Math.atan2(tx, tz);
      pitScene.add(m);
      pitCrew.push({ mesh: m, baseY: carGroup.position.y, phase: idx * 4 + wi });
    });
  });
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
  if (pitScene) updatePitScene(dt);

  // Rennablauf (Ampel/Strafe) + Bots, vor dem Auto, damit die Kollision aktuelle Positionen nutzt
  if (gameStarted && raceMode && !gamePaused()) { updateRace(dt); updateBots(dt); }

  updateCar(dt);
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
