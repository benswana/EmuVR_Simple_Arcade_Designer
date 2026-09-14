// Pure math for the direction dial and the logarithmic scale slider (no DOM).

const TAU = Math.PI * 2;

// Angle of the pointer around the dial centre in screen coordinates (y grows downward):
// 0 = up/north, clockwise positive, range (-PI, PI].
export function pointerToAngle(cx, cy, px, py) {
  return Math.atan2(px - cx, cy - py) + 0; // + 0 turns -0 into 0
}

// Round an angle (radians) to the nearest stepDeg degrees; free = true returns it unchanged.
export function snapAngle(a, stepDeg = 15, free = false) {
  if (free || !(stepDeg > 0)) return a;
  const deg = (a * 180) / Math.PI;
  return ((Math.round(deg / stepDeg) * stepDeg) * Math.PI) / 180 + 0;
}

// Shortest signed turn from `from` to `to`, in (-PI, PI].
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d <= -Math.PI) d += TAU;
  else if (d > Math.PI) d -= TAU;
  return d + 0;
}

// Slider range 0..1000 covers centre/100 .. centre*100 on a log scale; 500 = centre. No rounding here.
const SLIDER_MAX = 1000, DECADES = 2;
const PER_DECADE = SLIDER_MAX / (2 * DECADES);

export function scaleToSlider(scale, centre) {
  if (!(scale > 0) || !(centre > 0)) return scale > 0 ? SLIDER_MAX / 2 : 0;
  const v = SLIDER_MAX / 2 + PER_DECADE * Math.log10(scale / centre);
  return Math.min(SLIDER_MAX, Math.max(0, v));
}

export function sliderToScale(v, centre) {
  const c = Math.min(SLIDER_MAX, Math.max(0, Number(v)));
  return centre * Math.pow(10, (c - SLIDER_MAX / 2) / PER_DECADE);
}

// Multiply a scale by factor: a number stays a number, an {x,y,z} vector keeps its proportions.
export function uniformScale(s, factor) {
  if (s && typeof s === 'object') return { x: s.x * factor, y: s.y * factor, z: s.z * factor };
  return s * factor;
}
