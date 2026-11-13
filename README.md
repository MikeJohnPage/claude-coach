# Side-lying hip abduction coach

A browser prototype that watches you through the laptop webcam while you do side-lying hip abductions
and speaks a cue when your form drops.
Everything runs on the device: pose estimation is MediaPipe Pose Landmarker in WebAssembly,
speech is the browser's own `speechSynthesis`, and no request leaves the page's origin at runtime.

This is a prototype with provisional thresholds.
It has not yet been checked against a real person lying down, so treat every cue as unproven until you have recorded and reviewed traces.

## Camera setup

- Put the laptop on the floor, 2 to 2.5 m away, with the camera level with your hips.
- Lie on your side facing the camera, either side down, with your whole body in frame and roughly horizontal in the picture.
- Press **Start**, which is needed once for camera and speech permission. Everything after that is hands-free.
- Hold still for two seconds.
  The app works out which leg is on top, records your resting position, and says "Ready. Begin."
- If it loses you for three seconds it says "I can't see you." and recalibrates when you are back.
  The **Recalibrate** button does the same on demand.
- The screen shows the session state and the current abduction as a ring with the 30° limit marked.
  Nothing is said while your form is good.

## Voice

Speech uses the voices your browser and operating system provide, so how good it sounds depends on what is installed.
The app picks the best English voice that runs on the device, preferring the natural-sounding ones and avoiding the robotic ones,
and speaks a little slower than the default.
**Settings → Voice** lists every English voice, with a **Test** button, and remembers your choice in the browser.

- On macOS, download an Enhanced or Premium voice under System Settings → Accessibility → Spoken Content → System Voice → Manage Voices.
  It appears in Safari; Chrome may only list the standard voices, of which Samantha is the usual best.
- On Windows, add voices under Settings → Time & language → Speech.
- Voices marked **(online)**, such as Chrome's Google voices and Edge's Natural voices, usually sound best,
  but the browser sends each spoken phrase to the voice's provider.
  They are never picked automatically, since everything else in the app stays on the device.

## Running it

```bash
npm install
```

```bash
npm run models
```

```bash
npm run dev
```

`npm run models` downloads the `lite`, `full` and `heavy` pose models into `public/models/`, which is git-ignored.
Open the URL that `npm run dev` prints.
The camera needs a secure context, which `localhost` is.

Other commands:

- `npm test` runs the unit tests.
- `npm run typecheck` and `npm run lint` check the code.
- `npm run build` writes the static site to `dist/`, including the WASM runtime from the npm package and whatever models are in `public/models/`.
- `npm run smoke` opens the build in headless Chromium with a fake camera and checks that the model loads, frames are processed,
  nothing is fetched from another origin, the console has no errors, and the app reports that it can't see a person.
  It needs Playwright's Chromium (`npx playwright install chromium`) or `CHROMIUM_PATH` pointing at one.

## What it measures

- **abduction**: angle in the image between the trunk line (mid-shoulder to mid-hip) and the top thigh, positive towards the ceiling.
  Rep detection and the "too high" cue use it.
- **abductionPelvis**: the same thigh against the perpendicular of the hip-to-hip line. Debug only.
- **flexDrift**: how far the top thigh has moved forward of the body since calibration, from the 3D world landmarks.
- **pelvisRoll**: how far the top hip has rolled back, away from the camera, since calibration. **trunkRoll** is the same for the shoulders, debug only.
- **torsoShift**: how far the hips or shoulders have moved since the rep began, as a fraction of torso length.

Cues, in priority order:

- abduction above 33° for 150 ms: "Too high. Lower a little."
- pelvisRoll above 12° for 300 ms: "Stack your hips. Don't roll back."
- flexDrift above 12° for 300 ms: "Leg back, in line with your body."
- torsoShift above 0.06 for 300 ms: "Brace. Keep your trunk still."

One cue is spoken at a time and nothing is queued.
Each cue fires at most once per rep and at most every 4 s, and two different cues are at least 2 s apart.
Reps are detected only to scope the cues, as each fires at most once per rep. They are not counted or announced.
Every number and phrase is in [`src/pipeline/config.ts`](src/pipeline/config.ts).

## Settings and debug panel

Open **Settings** to see live values of every measurement, landmark visibility, FPS, the detected top side,
and whether the anterior axis `A` points towards the camera, which it should while you face it.
The panel also has:

- **Model**: `lite`, `full` (default) or `heavy`.
- **Source**: the webcam, or a local video file, so a recorded clip can be replayed. Choose the file, then press Start.
- **Rotate input**: turns the frame 90° before inference and turns the landmarks back,
  to compare tracking quality, since a lying body is unusual input for a pose model.
  Use clockwise when your head is at the left of the picture and counter-clockwise when it is at the right, so the model sees you upright.

## Recording and exporting a trace

1. Open **Settings** and press **Record**, before or after Start.
2. Do your set.
3. Press **Stop**, then **Download**.

The download is a JSON file with, per frame, the timestamp, the 33 image landmarks, the 33 world landmarks,
the measurements, the session state and any events such as cues and rep boundaries, plus the config in use.
No video is saved.
A trace runs to roughly 4 MB per minute and is held in memory until downloaded.

To replay a trace through the pipeline with the current config and print its events:

```bash
TRACE=path/to/file.trace.json npx vitest run tests/replay.test.ts
```

In code, `replay(trace, config)` from [`src/pipeline/trace.ts`](src/pipeline/trace.ts) returns every frame's output and all events,
which is how thresholds are meant to be tuned.

## Code structure

- `src/pipeline/` is pure TypeScript with no DOM or MediaPipe imports:
  `measurements.ts` → `calibration.ts` → `reps.ts` → `cues.ts`, tied together by `session.ts`.
  `trace.ts` holds the trace format and replay, and `synthetic.ts` builds the stick figure the tests use.
- `src/app/` and `src/main.ts` are thin wrappers for the camera, the model, speech, drawing and the debug panel.
- `scripts/` has the model download, the smoke test, and `check-axes.mjs`, which prints landmarks of a photo upright and rotated.

## Known limits

- **Accuracy on a real person lying down is untested.**
  The measurements are exact on a synthetic stick figure, and the model's axis convention was confirmed on a photo of an upright person.
  Whether the model tracks a side-lying body well enough is the open question the trace recorder exists to answer.
- **Pelvic tilt and bracing are only estimated through proxies.**
  The app sees four hip and shoulder points, not the pelvis or the abdominal wall.
  `pelvisRoll` is the depth difference between the hips, and "brace" is inferred from the torso moving in the picture.
- **Depth-based cues are coarse.**
  `flexDrift`, `pelvisRoll` and `trunkRoll` rely on the model's depth estimate from a single camera, which is much noisier than the in-plane angles.
  Expect to widen or lengthen those thresholds.
- The "too high" limit is an absolute angle to the trunk line, so a trunk that side-bends changes it.
- Calibration needs both ankles visible and the top hip and top ankle both above the bottom ones.
  It also needs the trunk within 30° of horizontal in the picture, so it does not calibrate on you sitting up.
- A cue is suppressed inside its 4 s cooldown, so a fast faulty rep right after a cued one can pass without a cue.
- Foot, toe and thigh rotation are not tracked.
- Speech quality depends on the voices installed, see Voice above. Chromium is the tested browser, and no voice has been listened to.

## Deployment

`.github/workflows/pages.yml` tests, builds and deploys `dist/` to GitHub Pages on every push to `main`.
It needs Pages enabled once, under Settings → Pages → Source: **GitHub Actions**.
