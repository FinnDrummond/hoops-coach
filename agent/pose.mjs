// Optional pose analysis (POSE=on). Samples the caller's video, runs MoveNet Thunder
// (onnxruntime-node, CPU) and keeps the latest elbow / knee / arm-extension numbers
// for the coach to read through the get_pose_metrics tool. Nothing here runs unless POSE=on.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const poseEnabled = () => /^(on|1|true)$/i.test(process.env.POSE || '');
export const MODEL_PATH = fileURLToPath(new URL('./models/movenet-thunder.onnx', import.meta.url));

const K = { nose: 0, lEye: 1, rEye: 2, lSho: 5, rSho: 6, lElb: 7, rElb: 8, lWri: 9, rWri: 10, lHip: 11, rHip: 12, lKnee: 13, rKnee: 14, lAnk: 15, rAnk: 16 };
const MIN_SCORE = 0.3;
const SIZE = 256;

// Angle at b (degrees) between segments b->a and b->c. Points are {x, y}.
export function angle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const n = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!n) return null;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / n));
  return Math.round((Math.acos(cos) * 180) / Math.PI);
}

// kp: array of 17 {x, y, s} in image pixels. Returns metrics for the shooting side
// ('right' | 'left'). The front camera is mirrored, so `side` is the player's real
// hand and we flip it to the image side when `mirrored` is true (default).
export function metrics(kp, side = 'right', mirrored = true) {
  const imgSide = (side === 'right') !== mirrored ? 'r' : 'l';
  const pick = n => { const p = kp[K[imgSide + n]]; return p && p.s >= MIN_SCORE ? p : null; };
  const sho = pick('Sho'), elb = pick('Elb'), wri = pick('Wri'), hip = pick('Hip'), knee = pick('Knee'), ank = pick('Ank');
  const out = { side, elbow_angle: null, knee_bend: null, arm_extension: null, elbow_above_eye: null };
  if (sho && elb && wri) {
    out.elbow_angle = angle(sho, elb, wri); // ~90 at the set point, ~170+ at release
    const armLen = Math.hypot(sho.x - elb.x, sho.y - elb.y) + Math.hypot(elb.x - wri.x, elb.y - wri.y);
    out.arm_extension = Math.round((Math.hypot(sho.x - wri.x, sho.y - wri.y) / armLen) * 100); // 100 = fully straight
  }
  if (hip && knee && ank) out.knee_bend = angle(hip, knee, ank); // 180 = straight leg, lower = deeper bend
  const eye = kp[K[imgSide + 'Eye']];
  if (elb && eye && eye.s >= MIN_SCORE) out.elbow_above_eye = elb.y <= eye.y; // image y grows downward
  return out;
}

export function describe(m) {
  const parts = [];
  if (m.elbow_angle != null) parts.push(`elbow ${m.elbow_angle}°`);
  if (m.knee_bend != null) parts.push(`knee ${m.knee_bend}° (180 = straight)`);
  if (m.arm_extension != null) parts.push(`arm extension ${m.arm_extension}% (100 = fully straight)`);
  if (m.elbow_above_eye != null) parts.push(m.elbow_above_eye ? 'elbow above eye level' : 'elbow below eye level');
  return parts.length ? `${m.side}-handed shooter: ` + parts.join(', ') : null;
}

let sessionPromise = null;
async function getSession() {
  sessionPromise ??= (async () => {
    if (!existsSync(MODEL_PATH)) throw new Error(`pose model missing at ${MODEL_PATH}; run: npm run pose:model`);
    const ort = await import('onnxruntime-node');
    return { ort, session: await ort.InferenceSession.create(MODEL_PATH, { logSeverityLevel: 3 }) };
  })();
  return sessionPromise;
}

// rgba: Uint8Array of width*height*4. Letterboxes to 256x256, runs MoveNet, maps
// keypoints back to source pixels. Returns 17 {x, y, s}.
export async function estimate(rgba, width, height) {
  const { ort, session } = await getSession();
  const scale = SIZE / Math.max(width, height);
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const padX = Math.floor((SIZE - w) / 2), padY = Math.floor((SIZE - h) / 2);
  const input = new Int32Array(SIZE * SIZE * 3);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale));
      const si = (sy * width + sx) * 4, di = ((y + padY) * SIZE + x + padX) * 3;
      input[di] = rgba[si]; input[di + 1] = rgba[si + 1]; input[di + 2] = rgba[si + 2];
    }
  }
  const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('int32', input, [1, SIZE, SIZE, 3]) });
  const d = res[session.outputNames[0]].data; // [1,1,17,3] as (y, x, score), normalized to the padded square
  const kp = [];
  for (let i = 0; i < 17; i++) {
    kp.push({ y: (d[i * 3] * SIZE - padY) / scale, x: (d[i * 3 + 1] * SIZE - padX) / scale, s: d[i * 3 + 2] });
  }
  return kp;
}

// Starts sampling a remote video track (~1 frame / intervalMs). Returns { latest() -> {at, kp} | null, stop() }.
export function startPoseWatcher(track, { VideoStream, VideoBufferType }, { intervalMs = 1000 } = {}) {
  let last = null, stopped = false, busy = false, lastRun = 0;
  const reader = new VideoStream(track).getReader();
  (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        const now = Date.now();
        if (busy || now - lastRun < intervalMs) continue;
        busy = true; lastRun = now;
        try {
          const f = value.frame.convert(VideoBufferType.RGBA);
          const kp = await estimate(f.data, f.width, f.height);
          last = { at: now, kp };
        } catch (e) { console.log('pose: frame failed:', e.message); }
        busy = false;
      }
    } catch (e) { console.log('pose: watcher stopped:', e.message); }
  })();
  return {
    latest: () => last,
    stop: () => { stopped = true; reader.cancel().catch(() => {}); },
  };
}
