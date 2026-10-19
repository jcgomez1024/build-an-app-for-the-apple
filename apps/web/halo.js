// Lightweight Elvi "halo" — replaces the three.js GLB avatar.
// Pure DOM/CSS: state is exposed via data-state, mic level via --level (0..1).
const STATE_MAP = {
  idle: "idle",
  listening: "listening",
  thinking: "thinking",
  talking_neutral: "speaking", happy: "speaking", excited: "speaking", questioning: "speaking",
  frustrated: "error", error: "error",
};

export function mountElviHalo(root) {
  if (!root) return null;
  let analyser = null, ctx = null, src = null, raf = 0, buf = null, currentStream = null;
  root.dataset.state = "idle";
  root.style.setProperty("--level", "0");

  function setState(s) {
    root.dataset.state = STATE_MAP[s] || "idle";
    if (root.dataset.state !== "listening") root.style.setProperty("--level", "0");
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!analyser || root.dataset.state !== "listening") return;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    root.style.setProperty("--level", level.toFixed(3));
  }

  function attachStream(stream) {
    if (!stream || stream === currentStream) return;
    detachStream();
    try {
      currentStream = stream;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      buf = new Uint8Array(analyser.fftSize);
      src.connect(analyser);
      if (!raf) loop();
    } catch (e) { console.warn("[HALO] mic level unavailable", e); }
  }

  function detachStream() {
    try { src?.disconnect(); ctx?.close(); } catch {}
    analyser = ctx = src = null; currentStream = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    root.style.setProperty("--level", "0");
  }

  const noop = async () => {};
  // Avatar-compatible no-ops so existing call sites keep working.
  return { setState, attachStream, detachStream, presentItemSelection: noop, performBuildStep: noop, queueVisemes() {}, moveToAnchor() {} };
}
