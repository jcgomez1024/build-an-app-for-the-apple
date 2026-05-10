/**
 * avatar-elvi.js  v4 — high-fidelity Pixar-style render + lifelike motion
 *
 * Upgrades over v2:
 *  • Much larger eyes with skin upper-eyelid domes (no more robot look)
 *  • Smooth TubeGeometry braids along Catmull-Rom curves (no lumpy spheres)
 *  • Curved arch brows via TubeGeometry on a Bezier path
 *  • Warm skin with sheen + clearcoat (SSS approximation)
 *  • Glossy hair material with slight metalness
 *  • 5-point studio lighting  (key / fill / bounce / rim / ambient)
 *  • Tighter portrait camera (FOV 28, like an 85 mm lens)
 *  • Eye saccades + focus drift for more human gaze
 *  • Speaking micro-nods + subtle torso/shoulder follow-through
 *  • Secondary hair lag for natural motion inertia
 *
 * States: idle | talking_neutral | happy | listening
 * API:
 *   const elvi = mountElviAvatar(canvas);
 *   elvi.setState("talking_neutral");
 *   elvi.queueVisemes([ { atMs, viseme, value }, … ]);
 */

import * as THREE from "https://unpkg.com/three@0.177.0/build/three.module.js";

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  skin:   0xe6b18c,
  skinDk: 0xcf9368,
  hair:   0x100a06,
  red:    0xcc2222,
  green:  0x1e6622,
  cream:  0xf4f0e0,
  white:  0xf6f2ea,
  pearl:  0xeeeadc,
  dark:   0x0e0808,
  eye:    0x4a2a14,
  rosy:   0xf4a090,
  lip:    0xc68470,
  tooth:  0xfaf8f4,
};

const VISEME_OPEN = {
  viseme_aa: 0.90, viseme_E: 0.65, viseme_I: 0.42,
  viseme_O:  0.82, viseme_U: 0.52, viseme_FF: 0.25,
  viseme_TH: 0.30, viseme_DD: 0.38, viseme_kk: 0.34,
  viseme_CH: 0.46, viseme_SS: 0.22, viseme_nn: 0.20,
  viseme_RR: 0.38, viseme_PP: 0.08, viseme_sil: 0.0,
};

// ── Shared materials ──────────────────────────────────────────────────────
const SKIN_MAT = new THREE.MeshPhysicalMaterial({
  color: C.skin,
  roughness: 0.52, metalness: 0,
  clearcoat: 0.30, clearcoatRoughness: 0.44,
  sheen: 0.18, sheenRoughness: 0.80,
  sheenColor: new THREE.Color(0xffcca8),
  emissive: new THREE.Color(0x1e0900), emissiveIntensity: 0.065,
});

const HAIR_MAT = new THREE.MeshPhysicalMaterial({
  color: C.hair,
  roughness: 0.42, metalness: 0.06,
  clearcoat: 0.45, clearcoatRoughness: 0.36,
  emissive: new THREE.Color(0x040200), emissiveIntensity: 0.02,
});

const SCLERA_MAT = new THREE.MeshPhysicalMaterial({
  color: 0xfefbf7,
  roughness: 0.04, metalness: 0,
  clearcoat: 0.98, clearcoatRoughness: 0.06,
});

const IRIS_MAT = new THREE.MeshPhysicalMaterial({
  color: C.eye,
  roughness: 0.14, metalness: 0,
  clearcoat: 0.92, clearcoatRoughness: 0.08,
});

const LIP_MAT = new THREE.MeshPhysicalMaterial({
  color: C.lip,
  roughness: 0.30, metalness: 0,
  clearcoat: 0.65, clearcoatRoughness: 0.22,
});

// ── Geometry helpers ──────────────────────────────────────────────────────
function M(hex, roughness = 0.66, metalness = 0, transparent = false, opacity = 1) {
  return new THREE.MeshPhysicalMaterial({ color: hex, roughness, metalness, transparent, opacity });
}
function Sphere(r, mat, ws = 28, hs = 28) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat);
}
function Box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
function Cyl(rt, rb, h, mat, segs = 28) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), mat);
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function rnd(a, b)  { return a + Math.random() * (b - a); }

// ── Skirt ─────────────────────────────────────────────────────────────────
function makeSkirt() {
  const g    = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.88, 1.76, 52, 1, true), M(C.red, 0.80));
  g.add(cone);
  for (const sx of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 1.48), M(0xb32020, 0.76));
    panel.position.set(sx * 0.62, -0.02, 0.03);
    panel.rotation.y = sx * -0.32;
    g.add(panel);
  }
  const hem  = Cyl(0.875, 0.868, 0.04, M(0xaa1c1c, 0.82));
  hem.position.y = -0.86;
  g.add(hem);
  return g;
}

// ── Apron ─────────────────────────────────────────────────────────────────
function makeApron() {
  const g    = new THREE.Group();
  const body = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.90), M(C.green, 0.76));
  const band = Box(0.76, 0.056, 0.014, M(0x175218, 0.72));
  band.position.y = 0.440;
  g.add(body, band);
  return g;
}

// ── Torso ─────────────────────────────────────────────────────────────────
function makeTorso() {
  const g = new THREE.Group();
  g.add(Cyl(0.36, 0.47, 1.20, M(C.white, 0.70)));
  for (const sx of [-1, 1]) {
    const puff = Sphere(0.15, M(C.white, 0.64), 18, 18);
    puff.scale.set(1.0, 0.74, 0.82);
    puff.position.set(sx * 0.38, 0.42, 0.05);
    g.add(puff);
  }
  for (const sx of [-0.12, 0.12]) {
    const b = Sphere(0.22, M(C.white, 0.68), 18, 18);
    b.scale.set(1.0, 0.80, 0.74);
    b.position.set(sx, 0.28, 0.16);
    g.add(b);
  }
  return g;
}

// ── Arms ──────────────────────────────────────────────────────────────────
function makeArm(side) {
  const g    = new THREE.Group();
  const up   = Cyl(0.106, 0.114, 0.54, SKIN_MAT);
  up.position.set(side * 0.45, 0.26, 0);
  up.rotation.z = side * 0.28;
  const fore = Cyl(0.092, 0.080, 0.46, SKIN_MAT);
  fore.position.set(side * 0.56, -0.03, 0.05);
  fore.rotation.set(0.25, 0, side * 0.42);
  const hand = Sphere(0.090, SKIN_MAT, 14, 14);
  hand.scale.set(0.90, 0.78, 0.70);
  hand.position.set(side * 0.61, -0.29, 0.09);
  g.add(up, fore, hand);
  return g;
}

// ── Neck ──────────────────────────────────────────────────────────────────
function makeNeck() { return Cyl(0.124, 0.152, 0.26, SKIN_MAT); }

// ── Pearl necklace ────────────────────────────────────────────────────────
function makeNecklace() {
  const g     = new THREE.Group();
  const pMat  = M(C.pearl, 0.26, 0.20);
  const COUNT = 20, RX = 0.196, RY = 0.064;
  for (let i = 0; i < COUNT; i++) {
    const t = i / (COUNT - 1);
    const a = THREE.MathUtils.lerp(-Math.PI * 0.58, Math.PI * 0.58, t);
    const b = Sphere(0.022, pMat, 10, 10);
    b.position.set(Math.sin(a) * RX, Math.cos(a) * RY - RY * 0.5, 0.096);
    g.add(b);
  }
  return g;
}

// ── Tricolor bow (Mexican flag: green / white / red) ──────────────────────
function makeBow() {
  const g      = new THREE.Group();
  const STRIPE = [C.green, C.cream, C.red];
  for (const sx of [-1, 1]) {
    for (let ci = 0; ci < 3; ci++) {
      const stripe = Box(0.090, 0.018, 0.022, M(STRIPE[ci], 0.58));
      stripe.position.set(sx * 0.042, (ci - 1) * 0.020, 0);
      stripe.rotation.z = sx * 0.26;
      g.add(stripe);
    }
  }
  g.add(Sphere(0.020, M(C.cream, 0.48), 10, 10));
  const tL = Box(0.012, 0.044, 0.010, M(C.green, 0.62));
  tL.position.set(-0.015, -0.034, 0);
  const tR = Box(0.012, 0.044, 0.010, M(C.red, 0.62));
  tR.position.set( 0.015, -0.034, 0);
  g.add(tL, tR);
  return g;
}

// ── Curved arch brow via TubeGeometry ─────────────────────────────────────
function makeBrow(sx) {
  const raw = [
    new THREE.Vector3(-0.060,  0.000, 0),
    new THREE.Vector3(-0.022,  0.014, 0),
    new THREE.Vector3( 0.005,  0.016, 0),
    new THREE.Vector3( 0.030,  0.010, 0),
    new THREE.Vector3( 0.056, -0.004, 0),
  ];
  // Mirror for right side
  const pts = sx > 0 ? raw.map(p => new THREE.Vector3(-p.x, p.y, p.z)) : raw;
  const geo  = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0108, 7, false);
  const mesh = new THREE.Mesh(geo, HAIR_MAT);
  mesh.position.set(sx * 0.144, 0.224, 0.372);
  mesh.rotation.set(-0.05, sx * -0.08, 0);
  return mesh;
}

// ── Smooth tube braid with braiding rings ──────────────────────────────────
function makeBraidGroup(sx, startY) {
  const g = new THREE.Group();
  const STEPS = 24;
  const pathPts = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    pathPts.push(new THREE.Vector3(
      sx * (0.308 + t * 0.034) + Math.sin(t * Math.PI * 5.0) * sx * 0.010,
      startY - t * 1.40,
      Math.cos(t * Math.PI * 5.0) * 0.008
    ));
  }
  const fullCurve = new THREE.CatmullRomCurve3(pathPts);

  // Two tube segments — tapers from thick to thin
  const tubeTop = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pathPts.slice(0, 13)), 52, 0.058, 9, false),
    HAIR_MAT
  );
  const tubeBot = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pathPts.slice(12)), 52, 0.044, 9, false),
    HAIR_MAT
  );
  g.add(tubeTop, tubeBot);

  // Braiding rings for texture / depth
  const ringMat = M(0x1a0e08, 0.52, 0.04);
  const ringPts = fullCurve.getPoints(14);
  const up      = new THREE.Vector3(0, 0, 1);
  for (let i = 1; i < ringPts.length - 1; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.052 - i * 0.0008, 0.006, 5, 14), ringMat
    );
    ring.position.copy(ringPts[i]);
    if (ringPts[i + 1]) {
      const dir = new THREE.Vector3().subVectors(ringPts[i + 1], ringPts[i]).normalize();
      if (Math.abs(dir.dot(up)) < 0.999) {
        ring.quaternion.setFromUnitVectors(up, dir);
      }
    }
    g.add(ring);
  }
  return g;
}

// ── Hair cap + braids ──────────────────────────────────────────────────────
function makeHair(headLocalY) {
  const g = new THREE.Group();

  // Top / back cap
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.428, 44, 44, 0, Math.PI * 2, 0, Math.PI * 0.50),
    HAIR_MAT
  );
  cap.scale.set(1.0, 0.96, 0.88);
  cap.position.y = headLocalY + 0.080;
  g.add(cap);

  // Side panels
  for (const sx of [-1, 1]) {
    const panel = Sphere(0.26, HAIR_MAT, 16, 16);
    panel.scale.set(0.42, 0.72, 0.40);
    panel.position.set(sx * 0.390, headLocalY - 0.110, -0.025);
    g.add(panel);
  }

  // Braids and bows
  for (const sx of [-1, 1]) {
    g.add(makeBraidGroup(sx, headLocalY - 0.08));
    for (let b = 0; b < 2; b++) {
      const bow = makeBow();
      bow.position.set(sx * 0.346, headLocalY - 0.010 - b * 0.66, 0.066);
      bow.rotation.z = sx * 0.14;
      bow.scale.setScalar(b === 0 ? 1.15 : 0.88);
      g.add(bow);
    }
  }
  return g;
}

// ── Head ──────────────────────────────────────────────────────────────────
function makeHead() {
  const g = new THREE.Group();

  // Skull — oval, slightly flat at back
  const skull = Sphere(0.408, SKIN_MAT, 64, 64);
  skull.scale.set(1.0, 0.99, 0.86);
  g.add(skull);

  // Chin definition
  const chin = Sphere(0.118, SKIN_MAT, 16, 16);
  chin.scale.set(0.86, 0.60, 0.72);
  chin.position.set(0, -0.390, 0.092);
  g.add(chin);

  // Fuller cheeks
  for (const sx of [-1, 1]) {
    const cheek = Sphere(0.198, SKIN_MAT, 16, 16);
    cheek.scale.set(0.82, 0.60, 0.46);
    cheek.position.set(sx * 0.264, -0.066, 0.264);
    g.add(cheek);
  }

  for (const sx of [-1, 1]) {
    const ear = Sphere(0.068, SKIN_MAT, 16, 16);
    ear.scale.set(0.65, 0.90, 0.44);
    ear.position.set(sx * 0.382, 0.020, 0.03);
    g.add(ear);
  }

  // Blush discs
  for (const sx of [-1, 1]) {
    const blush = new THREE.Mesh(
      new THREE.CircleGeometry(0.092, 36),
      M(C.rosy, 1.0, 0, true, 0.28)
    );
    blush.position.set(sx * 0.266, -0.072, 0.354);
    blush.rotation.y = sx * 0.28;
    g.add(blush);
  }

  // ── Eyes ──────────────────────────────────────────────────────────────
  const eyeGroups = {};
  for (const sx of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(sx * 0.138, 0.098, 0.354);

    // Large sclera
    const sclera = Sphere(0.086, SCLERA_MAT, 36, 36);

    // Glossy iris
    const iris = Sphere(0.060, IRIS_MAT, 28, 28);
    iris.position.z = 0.038;

    // Limbal ring
    const limbal = new THREE.Mesh(
      new THREE.TorusGeometry(0.058, 0.006, 8, 32), M(0x080404, 0.80)
    );
    limbal.position.z = 0.034;

    // Pupil
    const pupil = Sphere(0.032, M(C.dark), 18, 18);
    pupil.position.z = 0.052;

    // Subtle corneal sheen
    const cornea = Sphere(0.066, new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0, metalness: 0,
      transparent: true, opacity: 0.06,
      clearcoat: 1.0, clearcoatRoughness: 0.0,
    }), 24, 24);
    cornea.position.z = 0.038;

    // Catchlights
    const hi1 = Sphere(0.016, M(0xffffff, 0.0), 8, 8);
    hi1.position.set(0.020, 0.020, 0.064);
    const hi2 = Sphere(0.009, M(0xe0eeff, 0.0), 6, 6);
    hi2.position.set(-0.016, 0.010, 0.064);

    // Upper lashes — thick arc
    const lash = new THREE.Mesh(
      new THREE.TorusGeometry(0.070, 0.008, 8, 34, Math.PI * 1.08), M(0x060202, 0.70)
    );
    lash.rotation.z = Math.PI;
    lash.position.z = 0.076;
    lash.rotation.x = 0.08;

    // Lower lashes — thin
    const lashLo = new THREE.Mesh(
      new THREE.TorusGeometry(0.068, 0.0034, 6, 28, Math.PI * 0.55), M(0x0c0606, 0.70)
    );
    lashLo.position.z = 0.072;

    // Upper eyelid — skin dome covers top ~35% of sclera (key realism upgrade)
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.094, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.36),
      SKIN_MAT
    );
    lid.position.set(0, 0.030, 0.005);

    // Happy squint crescent
    const squintArc = new THREE.Mesh(
      new THREE.TorusGeometry(0.074, 0.018, 8, 30, Math.PI), HAIR_MAT
    );
    squintArc.rotation.z = Math.PI;
    squintArc.position.z = 0.080;
    squintArc.visible = false;

    eg.add(sclera, iris, limbal, pupil, cornea, hi1, hi2, lashLo, lash, lid, squintArc);
    g.add(eg);
    eyeGroups[sx < 0 ? "L" : "R"] = { group: eg, sclera, iris, limbal, pupil, squintArc };
  }

  // ── Brows ──────────────────────────────────────────────────────────────
  const browL = makeBrow(-1);
  const browR = makeBrow( 1);
  g.add(browL, browR);
  const BROW_BASE_Y = browL.position.y;

  // ── Nose ──────────────────────────────────────────────────────────────
  const noseTip = Sphere(0.044, M(C.skinDk, 0.74), 14, 14);
  noseTip.scale.set(0.82, 0.62, 0.72);
  noseTip.position.set(0, -0.042, 0.398);
  for (const sx of [-1, 1]) {
    const wing = Sphere(0.030, M(C.skinDk, 0.78), 10, 10);
    wing.scale.set(0.80, 0.62, 0.64);
    wing.position.set(sx * 0.036, -0.054, 0.388);
    g.add(wing);
  }
  g.add(noseTip);

  // ── Mouth (viseme-animated) ────────────────────────────────────────────
  const mouthRoot = new THREE.Group();
  mouthRoot.position.set(0, -0.180, 0.368);

  const closedLips = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.010, 0.124, 4, 10), LIP_MAT
  );
  closedLips.rotation.z = Math.PI / 2;
  closedLips.position.y = 0.002;

  const upperLip = new THREE.Mesh(
    new THREE.TorusGeometry(0.068, 0.012, 10, 36, Math.PI), LIP_MAT
  );
  upperLip.rotation.z = Math.PI;
  upperLip.position.y = 0.009;
  upperLip.visible = false;

  const jawGroup = new THREE.Group();
  jawGroup.position.y = -0.018;

  const lowerLip = new THREE.Mesh(
    new THREE.TorusGeometry(0.078, 0.016, 10, 36, Math.PI), LIP_MAT
  );
  const innerMouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.068, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
    M(C.dark, 1.0)
  );
  innerMouth.rotation.x = -Math.PI / 2;
  innerMouth.position.y = -0.008;
  innerMouth.visible = false;

  const teeth = Box(0.102, 0.026, 0.028, M(C.tooth));
  teeth.position.set(0, 0.004, 0.020);
  teeth.visible = false;

  jawGroup.add(lowerLip, innerMouth, teeth);
  mouthRoot.add(closedLips, upperLip, jawGroup);
  g.add(mouthRoot);

  // ── Happy: wide smile + lifted cheeks ─────────────────────────────────
  const happySmile = new THREE.Mesh(
    new THREE.TorusGeometry(0.118, 0.018, 10, 48, Math.PI), LIP_MAT
  );
  happySmile.rotation.z = Math.PI;
  happySmile.position.set(0, -0.176, 0.368);
  happySmile.visible = false;

  const happyCheeks = new THREE.Group();
  for (const sx of [-1, 1]) {
    const hc = Sphere(0.090, M(C.rosy, 1.0, 0, true, 0.48), 14, 14);
    hc.scale.set(1.0, 0.62, 0.52);
    hc.position.set(sx * 0.244, -0.072, 0.350);
    happyCheeks.add(hc);
  }
  happyCheeks.visible = false;

  // ── Listening: subtle asymmetric soft smile ────────────────────────────
  const listenSmile = new THREE.Mesh(
    new THREE.TorusGeometry(0.076, 0.010, 8, 36, Math.PI * 0.66), LIP_MAT
  );
  listenSmile.rotation.z = Math.PI + 0.20;
  listenSmile.position.set(-0.022, -0.184, 0.370);
  listenSmile.visible = false;

  g.add(happySmile, happyCheeks, listenSmile);

  return {
    group: g,
    jawGroup, mouthRoot, closedLips, upperLip, teeth, innerMouth,
    happySmile, happyCheeks, listenSmile,
    eyeGroups, browL, browR, BROW_BASE_Y,
  };
}

// ── Main mount ─────────────────────────────────────────────────────────────
export function mountElviAvatar(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.24;

  const scene  = new THREE.Scene();

  // 85 mm portrait-lens equivalent — no wide-angle distortion
  const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 100);
  camera.position.set(0, 0.76, 4.05);
  camera.lookAt(0, 0.58, 0);

  // 5-point studio lighting
  const key    = new THREE.DirectionalLight(0xfff8ee, 2.20);   // warm key, upper-left
  key.position.set(-1.4, 3.4, 2.8);
  const fill   = new THREE.DirectionalLight(0xddeeff, 0.78);   // cool fill, right
  fill.position.set(2.6, 1.0, 1.8);
  const bounce = new THREE.DirectionalLight(0xffe8d0, 0.32);   // warm bounce from below
  bounce.position.set(0, -2.4, 2.2);
  const rim    = new THREE.PointLight(0x90c0e0, 1.35, 10);     // cold rim for hair depth
  rim.position.set(0.6, 2.6, -2.8);
  const amb    = new THREE.AmbientLight(0xfff5e8, 0.48);
  scene.add(key, fill, bounce, rim, amb);

  // ── Build avatar ──────────────────────────────────────────────────────
  const root = new THREE.Group();
  root.position.set(0, -0.54, 0);

  const skirt = makeSkirt();
  skirt.position.y = -0.72;

  const torsoG = new THREE.Group();
  torsoG.position.y = 0.22;
  const armL = makeArm(-1);
  const armR = makeArm(1);
  torsoG.add(makeTorso(), armL, armR);

  const apron = makeApron();
  apron.position.set(0, 0.20, 0.456);

  const neck = makeNeck();
  neck.position.y = 0.94;

  const necklace = makeNecklace();
  necklace.position.set(0, 1.098, 0.024);

  const HEAD_Y    = 1.34;
  const headParts = makeHead();
  headParts.group.position.y = HEAD_Y;

  const hair = makeHair(HEAD_Y);

  root.add(skirt, torsoG, apron, neck, necklace, headParts.group, hair);
  scene.add(root);

  // ── Resize ────────────────────────────────────────────────────────────
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w    = Math.max(1, rect.width);
    const h    = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ── Runtime state ─────────────────────────────────────────────────────
  let avatarState  = "idle";
  let mouthCur     = 0;
  let mouthTarget  = 0;
  let blinkTimer   = rnd(2, 5);
  let blinkT       = 0;
  let isBlinking   = false;
  let headSwayT    = Math.random() * Math.PI * 2;
  let visemeQueue  = [];
  let prevRAF      = 0;
  let baseTiltZ    = 0;
  let targetTiltZ  = 0;
  let targetBrowLY = headParts.BROW_BASE_Y;
  let targetBrowRY = headParts.BROW_BASE_Y;
  let hairRotY     = 0;
  let hairRotZ     = 0;
  let gazeTimer    = rnd(0.35, 1.4);
  const gazeTarget = new THREE.Vector2(0, 0);
  const gazeCur    = new THREE.Vector2(0, 0);

  // ── setState ──────────────────────────────────────────────────────────
  function setState(newState) {
    avatarState = newState;
    const happy     = newState === "happy";
    const listening = newState === "listening";

    headParts.mouthRoot.visible   = !happy;
    headParts.happySmile.visible  =  happy;
    headParts.happyCheeks.visible =  happy;
    headParts.listenSmile.visible =  listening;

    const squintY = happy ? 0.32 : 1.0;
    for (const k of ["L", "R"]) {
      headParts.eyeGroups[k].sclera.scale.y   = squintY;
      headParts.eyeGroups[k].squintArc.visible = happy;
    }

    if (happy) {
      targetBrowLY = headParts.BROW_BASE_Y + 0.026;
      targetBrowRY = headParts.BROW_BASE_Y + 0.026;
      targetTiltZ  = 0;
    } else if (listening) {
      targetBrowLY = headParts.BROW_BASE_Y + 0.014;
      targetBrowRY = headParts.BROW_BASE_Y;
      targetTiltZ  = 0.062;
    } else {
      targetBrowLY = headParts.BROW_BASE_Y;
      targetBrowRY = headParts.BROW_BASE_Y;
      targetTiltZ  = 0;
    }
  }

  // ── queueVisemes ──────────────────────────────────────────────────────
  function queueVisemes(input) {
    const now = performance.now();
    visemeQueue = Array.isArray(input)
      ? input.map(v => ({
          at:     now + Number(v.atMs || 0),
          viseme: String(v.viseme  || "viseme_aa"),
          value:  Number(v.value   || 0.65),
        }))
      : [];
  }

  // ── Render loop ───────────────────────────────────────────────────────
  function tick(ts) {
    requestAnimationFrame(tick);
    const dt = prevRAF ? Math.min((ts - prevRAF) * 0.001, 0.05) : 0.016;
    prevRAF = ts;

    // Gentle idle sway
    headSwayT += dt;
    const swayY = Math.sin(headSwayT * 0.44) * 0.052;
    const swayZ = Math.sin(headSwayT * 0.32) * 0.020;

    baseTiltZ = THREE.MathUtils.lerp(baseTiltZ, targetTiltZ, 0.06);

    // Micro emphasis while speaking makes mouth animation feel embodied.
    const isTalking = avatarState === "talking_neutral";
    const talkNod = isTalking ? Math.sin(headSwayT * 7.5) * mouthCur * 0.020 : 0;
    const talkYaw = isTalking ? Math.sin(headSwayT * 4.4) * mouthCur * 0.015 : 0;
    const finalHeadY = swayY + talkYaw;
    const finalHeadZ = baseTiltZ + swayZ;

    headParts.group.rotation.x = talkNod;
    headParts.group.rotation.y = finalHeadY;
    headParts.group.rotation.z = finalHeadZ;

    // Hair follows head with slight lag/inertia for more realism.
    hairRotY = THREE.MathUtils.lerp(hairRotY, finalHeadY * 0.86, 0.11);
    hairRotZ = THREE.MathUtils.lerp(hairRotZ, finalHeadZ * 0.86, 0.11);
    hair.rotation.y = hairRotY;
    hair.rotation.z = hairRotZ;

    // Breathing + torso follow-through for less mannequin-like posture.
    const breath = Math.sin(headSwayT * 0.40) * 0.0070;
    torsoG.position.y = 0.22 + breath;
    torsoG.scale.y = 1 + Math.sin(headSwayT * 0.40 + 0.2) * 0.005;
    torsoG.rotation.y = finalHeadY * 0.22;
    torsoG.rotation.z = finalHeadZ * 0.16;
    armL.rotation.z = THREE.MathUtils.lerp(armL.rotation.z, -0.03 + Math.sin(headSwayT * 0.9) * 0.012, 0.10);
    armR.rotation.z = THREE.MathUtils.lerp(armR.rotation.z, 0.03 - Math.sin(headSwayT * 0.9) * 0.012, 0.10);

    // Smooth brow animation
    headParts.browL.position.y = THREE.MathUtils.lerp(headParts.browL.position.y, targetBrowLY, 0.08);
    headParts.browR.position.y = THREE.MathUtils.lerp(headParts.browR.position.y, targetBrowRY, 0.08);

    // Eye saccades/focus behavior.
    gazeTimer -= dt;
    if (gazeTimer <= 0) {
      const range = avatarState === "listening" ? 0.07 : avatarState === "happy" ? 0.06 : 0.08;
      gazeTarget.x = rnd(-range, range);
      gazeTarget.y = rnd(-range * 0.7, range * 0.55);
      gazeTimer = rnd(0.35, avatarState === "listening" ? 1.0 : 1.45);
    }
    const gazeLerp = avatarState === "listening" ? 0.17 : 0.12;
    gazeCur.lerp(gazeTarget, gazeLerp);
    const eyePitch = -gazeCur.y;
    const eyeYaw = gazeCur.x;
    headParts.eyeGroups.L.group.rotation.x = eyePitch;
    headParts.eyeGroups.R.group.rotation.x = eyePitch;
    headParts.eyeGroups.L.group.rotation.y = eyeYaw;
    headParts.eyeGroups.R.group.rotation.y = eyeYaw;

    // Viseme queue
    const nv = visemeQueue[0];
    if (nv && ts >= nv.at) {
      visemeQueue.shift();
      mouthTarget = Math.max(mouthTarget, (VISEME_OPEN[nv.viseme] ?? 0.35) * clamp01(nv.value));
    }
    mouthCur    = THREE.MathUtils.lerp(mouthCur, mouthTarget, 0.24);
    mouthTarget *= 0.80;

    if (headParts.mouthRoot.visible) {
      headParts.jawGroup.rotation.x = mouthCur * 0.52;
      headParts.teeth.visible       = mouthCur > 0.08;
      headParts.innerMouth.visible  = mouthCur > 0.06;
      headParts.closedLips.visible  = mouthCur < 0.05;
      headParts.upperLip.visible    = mouthCur >= 0.05;
    }

    // Blink
    blinkTimer -= dt;
    if (blinkTimer <= 0 && !isBlinking) { isBlinking = true; blinkT = 0; }
    if (isBlinking) {
      blinkT += dt * 6.5;
      const phase     = blinkT < 1 ? blinkT : 2 - blinkT;
      const happyBase = avatarState === "happy" ? 0.32 : 1.0;
      const eyeY      = Math.max(0.06, 1 - clamp01(phase) * 0.96) * happyBase;
      headParts.eyeGroups.L.sclera.scale.y = eyeY;
      headParts.eyeGroups.R.sclera.scale.y = eyeY;
      if (blinkT >= 2) {
        isBlinking = false;
        blinkTimer = rnd(2.5, 6);
        const base = avatarState === "happy" ? 0.32 : 1.0;
        headParts.eyeGroups.L.sclera.scale.y = base;
        headParts.eyeGroups.R.sclera.scale.y = base;
      }
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(tick);
  return { setState, queueVisemes };
}
