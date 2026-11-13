import { PoseLandmarker } from "@mediapipe/tasks-vision";
import { unrotateImageLandmark, unrotateWorldLandmark, type Rotation } from "../pipeline/rotate";
import type { Landmark, PoseFrame } from "../pipeline/types";

const asset = (path: string): string => new URL(path, document.baseURI).href;

export type Delegate = "GPU" | "CPU";

/** Thin wrapper around MediaPipe Pose Landmarker: loads a model variant and turns a video frame into a `PoseFrame`. */
export class PoseEngine {
  delegate: Delegate | null = null;
  variant: string | null = null;
  private landmarker: PoseLandmarker | null = null;
  private readonly rotated = document.createElement("canvas");

  get ready(): boolean {
    return this.landmarker !== null;
  }

  /** Tries the GPU delegate first and falls back to CPU if it fails to initialise. */
  async load(variant: string, forceCpu = false): Promise<void> {
    this.landmarker?.close();
    this.landmarker = null;
    this.delegate = null;
    const fileset = {
      wasmLoaderPath: asset("wasm/vision_wasm_internal.js"),
      wasmBinaryPath: asset("wasm/vision_wasm_internal.wasm"),
    };
    const create = (delegate: Delegate): Promise<PoseLandmarker> =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: asset(`models/pose_landmarker_${variant}.task`), delegate },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    if (!forceCpu) {
      try {
        this.landmarker = await create("GPU");
        this.delegate = "GPU";
      } catch (error) {
        console.warn("GPU delegate failed to initialise, falling back to CPU.", error);
      }
    }
    if (!this.landmarker) {
      this.landmarker = await create("CPU");
      this.delegate = "CPU";
    }
    this.variant = variant;
  }

  /**
   * Runs inference on the current video frame.
   * With a rotation, the frame is turned before inference and the landmarks are turned back,
   * so the result is always in the coordinates of the original frame.
   */
  detect(video: HTMLVideoElement, timestampMs: number, rotation: Rotation): Omit<PoseFrame, "t"> {
    if (!this.landmarker) throw new Error("Pose model is not loaded");
    const width = video.videoWidth;
    const height = video.videoHeight;
    let input: HTMLVideoElement | HTMLCanvasElement = video;
    if (rotation !== 0) {
      const canvas = this.rotated;
      if (canvas.width !== height || canvas.height !== width) {
        canvas.width = height;
        canvas.height = width;
      }
      const ctx = canvas.getContext("2d")!;
      if (rotation === 90) ctx.setTransform(0, 1, -1, 0, height, 0);
      else ctx.setTransform(0, -1, 1, 0, 0, width);
      ctx.drawImage(video, 0, 0);
      input = canvas;
    }
    const result = this.landmarker.detectForVideo(input, timestampMs);
    const image = result.landmarks[0];
    const world = result.worldLandmarks[0];
    if (!image || !world) return { width, height, landmarks: null, world: null };
    const landmarks: Landmark[] = image.map((l) =>
      unrotateImageLandmark({ x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 0 }, rotation),
    );
    const worldLandmarks: Landmark[] = world.map((l, i) =>
      unrotateWorldLandmark({ x: l.x, y: l.y, z: l.z, visibility: image[i]?.visibility ?? 0 }, rotation),
    );
    return { width, height, landmarks, world: worldLandmarks };
  }
}
