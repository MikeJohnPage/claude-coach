import type { Landmark } from "./types";

/** Degrees clockwise by which the input frame is rotated before inference. */
export type Rotation = 0 | 90 | -90;

// A frame rotated 90° clockwise maps the original (u, v) to (1 - v, u);
// counter-clockwise maps it to (v, 1 - u). The functions below invert that.

/** Maps a normalised image landmark found in the rotated frame back to the original frame. */
export function unrotateImageLandmark(lm: Landmark, rotation: Rotation): Landmark {
  if (rotation === 90) return { ...lm, x: lm.y, y: 1 - lm.x };
  if (rotation === -90) return { ...lm, x: 1 - lm.y, y: lm.x };
  return lm;
}

/** Maps a world landmark (origin at the hip midpoint) found in the rotated frame back to the original axes. */
export function unrotateWorldLandmark(lm: Landmark, rotation: Rotation): Landmark {
  if (rotation === 90) return { ...lm, x: lm.y, y: -lm.x };
  if (rotation === -90) return { ...lm, x: -lm.y, y: lm.x };
  return lm;
}
