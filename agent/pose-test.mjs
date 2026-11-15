// Offline check for the optional pose feature. No call, no keys needed.
//   npm run pose:test                 -> angle math only
//   npm run pose:test -- photo.jpg    -> also runs MoveNet on a JPEG and prints the numbers
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { angle, describe, estimate, metrics } from './pose.mjs';

assert.equal(angle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 90);
assert.equal(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180);
// Synthetic right-handed shooter, camera mirrored (so the player's right arm is the image-left one).
const kp = Array.from({ length: 17 }, () => ({ x: 0, y: 0, s: 0 }));
const set = (i, x, y) => (kp[i] = { x, y, s: 0.9 });
set(5, 100, 100); set(7, 100, 160); set(9, 150, 160); // L shoulder/elbow/wrist in image: elbow 90 deg
set(1, 90, 60); set(11, 100, 250); set(13, 100, 330); set(15, 100, 410); // straight leg
const m = metrics(kp, 'right', true);
assert.equal(m.elbow_angle, 90);
assert.equal(m.knee_bend, 180);
assert.equal(m.elbow_above_eye, false);
console.log('math ok ->', describe(m));

if (process.argv[2]) {
  const img = jpeg.decode(readFileSync(process.argv[2]), { useTArray: true });
  const t = Date.now();
  const pts = await estimate(img.data, img.width, img.height);
  console.log(`inference ${Date.now() - t} ms`);
  for (const side of ['right', 'left']) console.log(side, '->', describe(metrics(pts, side, false)) ?? 'not visible');
}
