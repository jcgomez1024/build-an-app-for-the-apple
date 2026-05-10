import * as THREE from "https://unpkg.com/three@0.177.0/build/three.module.js?module";
import { GLTFLoader } from "https://unpkg.com/three@0.177.0/examples/jsm/loaders/GLTFLoader.js?module";

const MODEL_URL = "/avatar/elvis-avatar_Idle_11_withSkin-Realistic.glb";

const VISEME_TO_KEYS = {
  viseme_aa: ["aa", "a", "jawopen", "mouthopen", "vowel_a", "mouth_a"],
  viseme_E: ["ee", "e", "vowel_e", "mouth_e"],
  viseme_I: ["ih", "i", "vowel_i", "mouth_i"],
  viseme_O: ["oh", "o", "vowel_o", "mouth_o"],
  viseme_U: ["ou", "u", "vowel_u", "mouth_u"],
  viseme_FF: ["f", "v", "ff", "vv"],
  viseme_TH: ["th", "tongue"],
  viseme_DD: ["d", "t", "l", "n", "dd", "tt", "alveolar"],
  viseme_kk: ["k", "g", "kk", "gg", "velar"],
  viseme_CH: ["ch", "sh", "j", "postalveolar"],
  viseme_SS: ["s", "z", "ss", "zz", "sibilant"],
  viseme_nn: ["n", "ng", "nasal"],
  viseme_RR: ["r", "rr"],
  viseme_PP: ["p", "b", "m", "pp", "bb", "mm", "labial"],
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

function findClip(clips, aliases) {
  const terms = aliases.map((a) => a.toLowerCase());
  return clips.find((clip) => {
    const name = String(clip.name || "").toLowerCase();
    return terms.some((a) => name.includes(a));
  });
}

export function mountElviAvatar(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 100);
  camera.position.set(0, 1.2, 4.1);
  camera.lookAt(0, 1.0, 0);

  const key = new THREE.DirectionalLight(0xfff7ef, 2.0);
  key.position.set(-1.8, 3.2, 2.2);
  const fill = new THREE.DirectionalLight(0xdde8ff, 0.85);
  fill.position.set(2.4, 1.1, 2.1);
  const rim = new THREE.PointLight(0x8fb7df, 1.2, 12);
  rim.position.set(0.9, 2.6, -2.6);
  const bounce = new THREE.DirectionalLight(0xffe5cf, 0.30);
  bounce.position.set(0, -2.0, 2.0);
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

  let avatarState = "idle";
  let modelRoot = null;
  let mixer = null;
  let activeAction = null;
  let clips = [];
  let headBone = null;
  let neckBone = null;
  let spineBone = null;
  let jawBone = null;
  const morphMeshes = [];
  const visemeQueue = [];
  let mouthCur = 0;
  let mouthTarget = 0;
  let prevTs = 0;
  let motionT = Math.random() * Math.PI * 2;

  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      modelRoot = gltf.scene;
      modelRoot.position.set(0, 0, 0);
      modelRoot.scale.setScalar(1.0);
      scene.add(modelRoot);

      const box = new THREE.Box3().setFromObject(modelRoot);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const floorY = box.min.y;
      modelRoot.position.x -= center.x;
      modelRoot.position.y -= floorY;
      modelRoot.position.z -= center.z;

      // Auto-frame any GLB scale/origin so the avatar is always visible.
      const maxSpan = Math.max(size.y || 1, size.x || 1, size.z || 1);
      const fitHeight = Math.max(size.y * 1.12, 1.4);
      const dist = fitHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
      camera.position.set(0, Math.max(size.y * 0.56, 1.1), dist + maxSpan * 0.42);
      camera.lookAt(0, Math.max(size.y * 0.50, 0.95), 0);

      headBone = findBone(modelRoot, ["head"]);
      neckBone = findBone(modelRoot, ["neck"]);
      spineBone = findBone(modelRoot, ["spine", "chest", "upperchest"]);
      jawBone = findBone(modelRoot, ["jaw", "mandible"]);

      modelRoot.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.frustumCulled = false;
        obj.castShadow = false;
        obj.receiveShadow = false;
        if (obj.morphTargetDictionary && Array.isArray(obj.morphTargetInfluences)) {
          morphMeshes.push(obj);
        }
      });

      // Debug: log available morph targets
      if (morphMeshes.length > 0) {
        console.log("🎭 Avatar loaded with morph targets:");
        for (const mesh of morphMeshes) {
          if (mesh.morphTargetDictionary) {
            const targetNames = Object.keys(mesh.morphTargetDictionary);
            console.log(`  ${mesh.name || "mesh"}: ${targetNames.join(", ")}`);
          }
        }
      } else {
        console.warn("⚠️ No morph targets found in GLB — lip sync will not work");
      }

      if (Array.isArray(gltf.animations) && gltf.animations.length > 0) {
        clips = gltf.animations;
        mixer = new THREE.AnimationMixer(modelRoot);
        const idle = findClip(clips, ["idle", "breath", "stand"]) || clips[0];
        activeAction = mixer.clipAction(idle);
        activeAction.reset().play();
      }

      setState(avatarState);
    },
    undefined,
    (err) => {
      console.warn("Failed to load GLB avatar:", err);
    }
  );

  function setState(newState) {
    avatarState = newState;
    if (!mixer || !modelRoot) return;

    const targetClip =
      newState === "happy" || newState === "excited"
        ? findClip(clips, ["happy", "smile", "joy"])
        : newState === "listening" || newState === "questioning"
          ? findClip(clips, ["listen", "thinking", "attentive"])
          : newState === "talking_neutral"
            ? findClip(clips, ["talk", "speak"])
            : findClip(clips, ["idle", "breath", "stand"]);

    if (!targetClip) return;
    const next = mixer.clipAction(targetClip);
    if (activeAction === next) return;
    next.reset().play();
    if (activeAction) activeAction.crossFadeTo(next, 0.25, false);
    activeAction = next;
  }

  function queueVisemes(input) {
    const now = performance.now();
    visemeQueue.length = 0;
    if (!Array.isArray(input)) return;
    for (const v of input) {
      visemeQueue.push({
        at: now + Number(v.atMs || 0),
        viseme: String(v.viseme || "viseme_aa"),
        value: Number(v.value || 0.65)
      });
    }
  }

  function applyVisemeToMorphs(viseme, strength) {
    const keys = VISEME_TO_KEYS[viseme] || [];
    const normalized = Math.max(0, Math.min(1, strength));

    for (const mesh of morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dict || !influences) continue;

      // Smooth decay instead of hard reset
      for (let i = 0; i < influences.length; i++) {
        influences[i] = influences[i] * 0.80;
      }

      // Try exact match first, then fuzzy match
      for (const keyName of Object.keys(dict)) {
        const lower = keyName.toLowerCase();
        const exact = keys.some((k) => lower === k.toLowerCase());
        const fuzzy = keys.some((k) => lower.includes(k.toLowerCase()));
        
        if (exact || fuzzy) {
          const index = dict[keyName];
          const strength_val = exact ? Math.max(normalized, influences[index]) : normalized * 0.85;
          influences[index] = Math.max(influences[index], strength_val);
        }
      }

      // Apply eye blinks when happy
      if (avatarState === "happy") {
        for (const keyName of Object.keys(dict)) {
          const lower = keyName.toLowerCase();
          if (lower.includes("blink") || lower.includes("squint")) {
            influences[dict[keyName]] = Math.max(influences[dict[keyName]], 0.15);
          }
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

    const next = visemeQueue[0];
    if (next && ts >= next.at) {
      visemeQueue.shift();
      mouthTarget = Math.max(mouthTarget, Math.max(0.06, Math.min(1, next.value)));
      applyVisemeToMorphs(next.viseme, mouthTarget);
    }

    mouthCur = THREE.MathUtils.lerp(mouthCur, mouthTarget, 0.28);
    mouthTarget *= 0.82;

    const isTalking = avatarState === "talking_neutral" || avatarState === "happy" || avatarState === "excited" || avatarState === "questioning";
    const isExcited = avatarState === "excited";
    const isQuestioning = avatarState === "questioning";
    const nodAmp = isExcited ? 0.032 : isQuestioning ? 0.015 : 0.020;
    const nodFreq = isExcited ? 9.4 : isQuestioning ? 5.4 : 7.4;
    const talkYawAmp = isExcited ? 0.018 : isQuestioning ? 0.008 : 0.012;
    const talkYawFreq = isExcited ? 5.8 : isQuestioning ? 3.8 : 4.6;
    const nod = isTalking ? Math.sin(motionT * nodFreq) * mouthCur * nodAmp : 0;
    const yaw = Math.sin(motionT * 0.44) * 0.045 + (isTalking ? Math.sin(motionT * talkYawFreq) * mouthCur * talkYawAmp : 0);
    const rollBase = avatarState === "listening" ? 0.05 : isQuestioning ? 0.035 : isExcited ? 0.012 : 0;
    const roll = rollBase + Math.sin(motionT * 0.35) * 0.016;

    // Short expressive upward beat when asking a question.
    const questionLift = isQuestioning ? Math.max(0, Math.sin(motionT * 1.8)) * 0.010 : 0;

    if (headBone) {
      headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, nod - questionLift, 0.20);
      headBone.rotation.y = THREE.MathUtils.lerp(headBone.rotation.y, yaw, 0.12);
      headBone.rotation.z = THREE.MathUtils.lerp(headBone.rotation.z, roll, 0.12);
    }
    if (neckBone) {
      neckBone.rotation.y = THREE.MathUtils.lerp(neckBone.rotation.y, yaw * 0.45, 0.10);
      neckBone.rotation.z = THREE.MathUtils.lerp(neckBone.rotation.z, roll * 0.4, 0.10);
    }
    if (spineBone) {
      spineBone.rotation.y = THREE.MathUtils.lerp(spineBone.rotation.y, yaw * 0.22, 0.08);
      spineBone.rotation.z = THREE.MathUtils.lerp(spineBone.rotation.z, roll * 0.18, 0.08);
    }
    if (jawBone) {
      jawBone.rotation.x = THREE.MathUtils.lerp(jawBone.rotation.x, mouthCur * 0.50, 0.24);
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(tick);
  return { setState, queueVisemes };
}
