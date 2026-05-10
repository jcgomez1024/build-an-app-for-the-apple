import * as THREE from "https://unpkg.com/three@0.177.0/build/three.module.js?module";
import { GLTFLoader } from "https://unpkg.com/three@0.177.0/examples/jsm/loaders/GLTFLoader.js?module";
import { clone as cloneSkinned } from "https://unpkg.com/three@0.177.0/examples/jsm/utils/SkeletonUtils.js?module";

// Production-ready Realistic avatar models only (May 9, 2026)
const REALISTIC_IDLE_URL = "/avatar/elvis-avatar_Idle_11_withSkin-Realistic.glb";
const REALISTIC_HAPPY_URL = "/avatar/elvis-avatar_Happy_jump_f_withSkin-Realistic.glb";
const KITCHEN_ENV_URL = "/avatar/elvis-kitchen_Cocina_Elvis_commercial_background.glb";

const STATE_TO_GLB = {
  idle: REALISTIC_IDLE_URL,
  happy: REALISTIC_HAPPY_URL,
  excited: REALISTIC_IDLE_URL,
  listening: REALISTIC_IDLE_URL,
  questioning: REALISTIC_IDLE_URL,
  talking_neutral: REALISTIC_IDLE_URL,
  frustrated: REALISTIC_IDLE_URL,
  error: REALISTIC_IDLE_URL
};

const TARGET_AVATAR_HEIGHT = 1.3608;
const MIN_NORMALIZED_SCALE = 0.72;
const MAX_NORMALIZED_SCALE = 0.96;
const CAMERA_DISTANCE_PADDING = 1.08;
const CAMERA_MIN_FIT_HEIGHT = 1.85;
const CAMERA_DISTANCE_MULTIPLIER = 1.18;

const ANCHOR_POSITIONS = {
  idle: new THREE.Vector3(0, 0, 0),
  kitchen_work: new THREE.Vector3(-0.9, 0, -0.55),
  serve_position: new THREE.Vector3(0.62, 0, 0.22)
};

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VISEME_TO_KEYS = {
  viseme_aa:  ["aa", "a", "jawopen", "mouthopen", "vowel_a", "mouth_a"],
  viseme_E:   ["ee", "e", "vowel_e", "mouth_e"],
  viseme_I:   ["ih", "i", "vowel_i", "mouth_i"],
  viseme_O:   ["oh", "o", "vowel_o", "mouth_o"],
  viseme_U:   ["ou", "u", "vowel_u", "mouth_u"],
  viseme_FF:  ["f", "v", "ff", "vv"],
  viseme_TH:  ["th", "tongue"],
  viseme_DD:  ["d", "t", "l", "n", "dd", "tt", "alveolar"],
  viseme_kk:  ["k", "g", "kk", "gg", "velar"],
  viseme_CH:  ["ch", "sh", "j", "postalveolar"],
  viseme_SS:  ["s", "z", "ss", "zz", "sibilant"],
  viseme_nn:  ["n", "ng", "nasal"],
  viseme_RR:  ["r", "rr"],
  viseme_PP:  ["p", "b", "m", "pp", "bb", "mm", "labial"],
  viseme_sil: ["rest", "neutral", "closed"]
};

function findBone(root, names) {
  const set = names.map((n) => n.toLowerCase());
  let found = null;
  root.traverse((obj) => {
    if (found || !obj.isBone) return;
    const name = String(obj.name || "").toLowerCase();
    if (set.some((n) => name.includes(n))) found = obj;
  });
  return found;
}

function toneMaterialsDown(object) {
  object.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of mats) {
      if (mat.metalness !== undefined)      mat.metalness      = Math.max(0, mat.metalness * 0.3);
      if (mat.roughness !== undefined)      mat.roughness      = Math.min(1, mat.roughness * 1.4 + 0.2);
      if (mat.emissive !== undefined)       mat.emissive.multiplyScalar(0.4);
      if (mat.envMapIntensity !== undefined) mat.envMapIntensity = Math.max(0, mat.envMapIntensity * 0.5);
      mat.needsUpdate = true;
    }
  });
}

export function mountElviAvatar(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 100);
  camera.position.set(0, 1.2, 4.1);
  camera.lookAt(0, 1.0, 0);
  const avatarRig = new THREE.Group();
  scene.add(avatarRig);

  // Lighting rig
  const key    = new THREE.DirectionalLight(0xfff7ef, 2.0);  key.position.set(-1.8, 3.2, 2.2);
  const fill   = new THREE.DirectionalLight(0xdde8ff, 0.85); fill.position.set(2.4, 1.1, 2.1);
  const rim    = new THREE.PointLight(0x8fb7df, 1.2, 12);    rim.position.set(0.9, 2.6, -2.6);
  const bounce = new THREE.DirectionalLight(0xffe5cf, 0.30); bounce.position.set(0, -2.0, 2.0);
  const ambient = new THREE.AmbientLight(0xfff2df, 0.42);
  scene.add(key, fill, rim, bounce, ambient);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // Runtime state
  let avatarState  = "idle";
  let mountedGlbUrl = null;
  let pendingGlbUrl = null;
  let modelRoot    = null;
  let environmentRoot = null;
  let mixer        = null;
  let activeAction = null;
  let headBone = null, neckBone = null, spineBone = null, jawBone = null;
  let morphMeshes  = [];
  const visemeQueue = [];
  let activeViseme = "viseme_sil";
  let mouthCur = 0, mouthTarget = 0;
  let prevTs = 0;
  let motionT = Math.random() * Math.PI * 2;
  let loadingGlb = false;
  let loadNonce = 0;
  let movementTarget = null;
  let movementSpeed = 1.35;
  let movementToken = 0;
  let presentationToken = 0;
  let buildToken = 0;

  // GLB cache so each file is only downloaded once
  const glbCache = new Map();
  const loader   = new GLTFLoader();

  function loadGlb(url, onReady) {
    if (glbCache.has(url)) { onReady(glbCache.get(url)); return; }
    loader.load(url, (gltf) => { glbCache.set(url, gltf); onReady(gltf); },
      undefined,
      (err) => { console.warn(`Failed to load GLB (${url}):`, err); loadingGlb = false; });
  }

  function mountKitchenEnvironment(gltf) {
    if (environmentRoot) {
      scene.remove(environmentRoot);
      environmentRoot = null;
    }

    environmentRoot = gltf.scene.clone(true);
    scene.add(environmentRoot);

    const rawBox = new THREE.Box3().setFromObject(environmentRoot);
    const rawSize = rawBox.getSize(new THREE.Vector3());
    const span = Math.max(rawSize.x, rawSize.z, 0.001);
    const scale = THREE.MathUtils.clamp(8.8 / span, 0.35, 2.6);
    environmentRoot.scale.setScalar(scale);

    const box = new THREE.Box3().setFromObject(environmentRoot);
    const center = box.getCenter(new THREE.Vector3());
    environmentRoot.position.x -= center.x;
    environmentRoot.position.y -= box.min.y;
    environmentRoot.position.z -= center.z + 1.8;

    environmentRoot.traverse((node) => {
      if (!node.isMesh) return;
      node.frustumCulled = false;
      node.renderOrder = -1;
    });
  }

  function pickClipForState(animations, stateName) {
    if (!Array.isArray(animations) || animations.length === 0) {
      return null;
    }

    const clipMatchers = {
      happy: /(happy|joy|smile|jump)/i,
      listening: /(idle|listen|stand)/i,
      questioning: /(question|ask|talking_angry|angry)/i,
      talking_neutral: /(talk|chat|speak|stand_and_chat)/i,
      excited: /(excited|walk|move)/i,
      frustrated: /(angry|frustrat)/i,
      error: /(angry|frustrat)/i,
      idle: /(idle|stand|rest)/i
    };

    const matcher = clipMatchers[stateName] || clipMatchers.idle;
    const matched = animations.find((clip) => matcher.test(String(clip.name || "")));
    return matched || animations[0] || null;
  }

  function mountGltf(gltf, sourceUrl) {
    // Tear down previous model
    if (modelRoot) {
      if (mixer) { mixer.stopAllAction(); mixer = null; }
      avatarRig.remove(modelRoot);
      morphMeshes = [];
      headBone = neckBone = spineBone = jawBone = activeAction = null;
    }

    modelRoot = cloneSkinned(gltf.scene);
    avatarRig.add(modelRoot);

    // Keep pose sizes closer together without letting bad bounds push the model off-screen.
    const rawBox = new THREE.Box3().setFromObject(modelRoot);
    const rawSize = rawBox.getSize(new THREE.Vector3());
    const safeHeight = Math.max(rawSize.y, 0.001);
    const normalizedScale = THREE.MathUtils.clamp(
      TARGET_AVATAR_HEIGHT / safeHeight,
      MIN_NORMALIZED_SCALE,
      MAX_NORMALIZED_SCALE
    );
    modelRoot.scale.setScalar(normalizedScale);

    const box    = new THREE.Box3().setFromObject(modelRoot);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    modelRoot.position.x -= center.x;
    modelRoot.position.y -= box.min.y;
    modelRoot.position.z -= center.z;

    const maxSpan = Math.max(size.y || 1, size.x || 1, size.z || 1);
    const fitHeight = Math.max(size.y * 1.34, CAMERA_MIN_FIT_HEIGHT);
    const dist = (fitHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)))) * CAMERA_DISTANCE_MULTIPLIER;
    camera.position.set(0, Math.max(size.y * 0.44, 0.92), dist + maxSpan * CAMERA_DISTANCE_PADDING);
    camera.lookAt(0, Math.max(size.y * 0.38, 0.78), 0);

    // Bones & morph meshes
    headBone  = findBone(modelRoot, ["head"]);
    neckBone  = findBone(modelRoot, ["neck"]);
    spineBone = findBone(modelRoot, ["spine", "chest", "upperchest"]);
    jawBone   = findBone(modelRoot, ["jaw", "mandible"]);

    modelRoot.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      if (obj.morphTargetDictionary && Array.isArray(obj.morphTargetInfluences)) {
        morphMeshes.push(obj);
      }
    });

    toneMaterialsDown(modelRoot);

    // Debug morph targets
    if (morphMeshes.length > 0) {
      console.log(`🎭 [${avatarState}] morph targets:`);
      morphMeshes.forEach((m) => {
        if (m.morphTargetDictionary)
          console.log(`  ${m.name || "mesh"}: ${Object.keys(m.morphTargetDictionary).join(", ")}`);
      });
    } else {
      console.warn(`⚠️ [${avatarState}] no morph targets — lip sync inactive`);
    }

    // Start baked animation
    if (Array.isArray(gltf.animations) && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(modelRoot);
      const clip = pickClipForState(gltf.animations, avatarState);
      if (clip) {
      activeAction = mixer.clipAction(clip);
      activeAction.reset().play();
      console.log(`▶️  [${avatarState}] playing: ${clip.name || "(unnamed)"}`);
      }
    }

    mountedGlbUrl = sourceUrl;
    loadingGlb = false;

    if (pendingGlbUrl && pendingGlbUrl !== mountedGlbUrl) {
      requestModelSwap(pendingGlbUrl);
    } else if (mouthCur > 0.02) {
      applyVisemeToMorphs(activeViseme, mouthCur);
    }
  }

  function requestModelSwap(targetUrl) {
    pendingGlbUrl = targetUrl;

    if (loadingGlb) return;
    if (targetUrl === mountedGlbUrl && modelRoot) return;

    loadingGlb = true;
    const requestUrl = pendingGlbUrl;
    const requestId = ++loadNonce;

    loadGlb(requestUrl, (gltf) => {
      if (requestId !== loadNonce) return;
      mountGltf(gltf, requestUrl);
    });
  }

  // Initial load
  loadGlb(KITCHEN_ENV_URL, (gltf) => {
    try {
      mountKitchenEnvironment(gltf);
    } catch (error) {
      console.warn("Failed to mount kitchen environment:", error);
    }
  });
  requestModelSwap(STATE_TO_GLB["idle"]);

  function setState(newState) {
    avatarState = newState;
    visemeQueue.length = 0;
    const targetUrl = STATE_TO_GLB[newState] || STATE_TO_GLB["idle"];
    requestModelSwap(targetUrl);
  }

  function moveToAnchor(anchorName, options = {}) {
    const anchor = ANCHOR_POSITIONS[anchorName] || ANCHOR_POSITIONS.idle;
    if (options.stateName) {
      setState(options.stateName);
    }
    movementSpeed = Math.max(0.2, Number(options.speed) || 1.35);
    movementTarget = anchor.clone();
    const token = ++movementToken;

    return new Promise((resolve) => {
      const poll = () => {
        if (token !== movementToken) {
          resolve(false);
          return;
        }
        if (!movementTarget) {
          resolve(true);
          return;
        }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });
  }

  async function presentItemSelection() {
    const seq = ++presentationToken;
    buildToken += 1;

    await moveToAnchor("kitchen_work", { speed: 1.8, stateName: "excited" });
    if (seq !== presentationToken) return;

    setState("happy");
    await waitMs(420);
    if (seq !== presentationToken) return;

    await moveToAnchor("serve_position", { speed: 1.65, stateName: "talking_neutral" });
    if (seq !== presentationToken) return;

    setState("happy");
    await waitMs(720);
    if (seq !== presentationToken) return;

    setState("talking_neutral");
    moveToAnchor("idle", { speed: 1.15 });
  }

  async function performBuildStep(stepData = {}) {
    const seq = ++buildToken;
    const step = Math.max(1, Number(stepData.step) || 1);
    const totalSteps = Math.max(step, Number(stepData.totalSteps) || 1);
    const isFinalStep = step >= totalSteps;
    const stepLabel = String(stepData.stepName || "");
    const stepValue = String(stepData.option || "");

    await moveToAnchor("kitchen_work", {
      speed: 1.65,
      stateName: isFinalStep ? "happy" : "questioning"
    });
    if (seq !== buildToken) return;

    // Show the prop card with current step info
    showPropCard({
      step,
      totalSteps,
      label: stepLabel,
      value: stepValue,
      imageUrl: stepData.imageUrl || ""
    });

    await waitMs(1200);
    if (seq !== buildToken) return;

    // Hide the prop and advance to presentation
    hidePropCard();

    await moveToAnchor("serve_position", {
      speed: 1.6,
      stateName: isFinalStep ? "happy" : "talking_neutral"
    });
    if (seq !== buildToken) return;

    await waitMs(180);
    if (seq !== buildToken) return;

    setState(isFinalStep ? "happy" : "listening");
    moveToAnchor("idle", { speed: 1.2 });
  }

  function showPropCard(propData = {}) {
    const overlay = document.getElementById("build-prop-overlay");
    const stepNum = document.getElementById("build-prop-step-num");
    const stepTotal = document.getElementById("build-prop-step-total");
    const label = document.getElementById("build-prop-label");
    const value = document.getElementById("build-prop-value");
    const image = document.getElementById("build-prop-image");

    if (!overlay) return;

    stepNum.textContent = propData.step || "1";
    stepTotal.textContent = propData.totalSteps || "1";
    label.textContent = propData.label || "Ingredient";
    value.textContent = propData.value || "Selection";
    
    if (propData.imageUrl) {
      image.src = propData.imageUrl;
      image.style.display = "block";
    } else {
      image.style.display = "none";
    }

    overlay.classList.remove("is-hidden");
  }

  function hidePropCard() {
    const overlay = document.getElementById("build-prop-overlay");
    if (!overlay) return;
    overlay.classList.add("is-hidden");
  }

  function queueVisemes(input) {
    const now = performance.now();
    visemeQueue.length = 0;
    if (!Array.isArray(input)) return;
    for (const v of input) {
      visemeQueue.push({
        at:     now + Number(v.atMs || 0),
        viseme: String(v.viseme || "viseme_aa"),
        value:  Number(v.value  || 0.65)
      });
    }
  }

  function applyVisemeToMorphs(viseme, strength) {
    const keys       = VISEME_TO_KEYS[viseme] || [];
    const normalized = Math.max(0, Math.min(1, strength));

    for (const mesh of morphMeshes) {
      const dict      = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;

      for (let i = 0; i < influences.length; i++) influences[i] *= 0.80;

      for (const keyName of Object.keys(dict)) {
        const lower = keyName.toLowerCase();
        const exact = keys.some((k) => lower === k.toLowerCase());
        const fuzzy = !exact && keys.some((k) => lower.includes(k.toLowerCase()));
        if (exact || fuzzy) {
          const idx = dict[keyName];
          influences[idx] = Math.max(influences[idx], exact ? normalized : normalized * 0.85);
        }
      }

      if (avatarState === "happy" || avatarState === "excited") {
        for (const keyName of Object.keys(dict)) {
          const lower = keyName.toLowerCase();
          if (lower.includes("blink") || lower.includes("squint"))
            influences[dict[keyName]] = Math.max(influences[dict[keyName]], 0.15);
        }
      }
    }
  }

  function tick(ts) {
    requestAnimationFrame(tick);
    const dt = prevTs ? Math.min((ts - prevTs) * 0.001, 0.05) : 0.016;
    prevTs = ts;
    motionT += dt;

    if (mixer) mixer.update(dt);

    const nextV = visemeQueue[0];
    if (nextV && ts >= nextV.at) {
      visemeQueue.shift();
      activeViseme = nextV.viseme;
      mouthTarget = Math.max(mouthTarget, Math.max(0.06, Math.min(1, nextV.value)));
      applyVisemeToMorphs(nextV.viseme, mouthTarget);
    }
    mouthCur    = THREE.MathUtils.lerp(mouthCur, mouthTarget, 0.28);
    mouthTarget *= 0.82;

    if (mouthCur <= 0.02) {
      activeViseme = "viseme_sil";
    } else {
      applyVisemeToMorphs(activeViseme, mouthCur);
    }

    const isTalking = ["talking_neutral", "happy", "excited", "questioning", "frustrated", "error"].includes(avatarState);
    const isTalkingNeutral = avatarState === "talking_neutral";
    const isListening = avatarState === "listening";
    const isHappy = avatarState === "happy";
    const isExcited = avatarState === "excited";
    const isQuestioning = avatarState === "questioning";
    const isFrustrated = avatarState === "frustrated" || avatarState === "error";

    const nodAmp = isHappy
      ? 0.028
      : isTalkingNeutral
        ? 0.021
        : isQuestioning
          ? 0.013
          : isListening
            ? 0.010
            : isExcited
              ? 0.030
              : isFrustrated
                ? 0.022
                : 0.018;
    const nodFreq = isHappy
      ? 8.0
      : isTalkingNeutral
        ? 7.2
        : isQuestioning
          ? 4.6
          : isListening
            ? 2.8
            : isExcited
              ? 9.0
              : isFrustrated
                ? 6.0
                : 6.2;
    const yawAmp = isHappy
      ? 0.016
      : isTalkingNeutral
        ? 0.012
        : isQuestioning
          ? 0.009
          : isListening
            ? 0.007
            : isExcited
              ? 0.017
              : isFrustrated
                ? 0.011
                : 0.010;
    const yawFreq = isHappy
      ? 5.2
      : isTalkingNeutral
        ? 4.6
        : isQuestioning
          ? 3.5
          : isListening
            ? 2.4
            : isExcited
              ? 5.8
              : isFrustrated
                ? 3.2
                : 4.0;

    const nod          = isTalking ? Math.sin(motionT * nodFreq) * mouthCur * nodAmp : 0;
    const questionLift = isQuestioning ? Math.max(0, Math.sin(motionT * 1.8)) * 0.013 : 0;
    const yaw          = Math.sin(motionT * 0.44) * 0.045 + (isTalking ? Math.sin(motionT * yawFreq) * mouthCur * yawAmp : 0);
    const rollBase = isListening ? 0.045 : isQuestioning ? 0.03 : isFrustrated ? -0.02 : isHappy ? 0.012 : isExcited ? 0.012 : 0;
    const roll         = rollBase + Math.sin(motionT * 0.35) * 0.016;

    if (movementTarget) {
      const delta = new THREE.Vector3().subVectors(movementTarget, avatarRig.position);
      const dist = delta.length();
      if (dist < 0.04) {
        avatarRig.position.copy(movementTarget);
        movementTarget = null;
      } else {
        const step = Math.min(dist, movementSpeed * dt);
        delta.normalize();
        avatarRig.position.addScaledVector(delta, step);
        const targetYaw = Math.atan2(delta.x, delta.z);
        avatarRig.rotation.y = THREE.MathUtils.lerp(avatarRig.rotation.y, targetYaw, 0.12);
      }
    } else {
      avatarRig.rotation.y = THREE.MathUtils.lerp(avatarRig.rotation.y, 0, 0.04);
    }

    if (headBone) {
      headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, nod - questionLift, 0.20);
      headBone.rotation.y = THREE.MathUtils.lerp(headBone.rotation.y, yaw,  0.12);
      headBone.rotation.z = THREE.MathUtils.lerp(headBone.rotation.z, roll, 0.12);
    }
    if (neckBone) {
      neckBone.rotation.y = THREE.MathUtils.lerp(neckBone.rotation.y, yaw  * 0.45, 0.10);
      neckBone.rotation.z = THREE.MathUtils.lerp(neckBone.rotation.z, roll * 0.40, 0.10);
    }
    if (spineBone) {
      spineBone.rotation.y = THREE.MathUtils.lerp(spineBone.rotation.y, yaw  * 0.22, 0.08);
      spineBone.rotation.z = THREE.MathUtils.lerp(spineBone.rotation.z, roll * 0.18, 0.08);
    }
    if (jawBone) {
      jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, mouthCur * 0.50, 0.24);
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(tick);
  return { setState, queueVisemes, presentItemSelection, performBuildStep, moveToAnchor };
}
