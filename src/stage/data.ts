import type { ColorSpace } from "@samalbanese/median-cut";
import type { StageSamples } from "../lib/extraction";
import {
  bitReversalOrder,
  colorPoint,
  fitPoint,
  fitView,
  groupCentroids,
  type ViewFit,
} from "./math";
import type { IntroState } from "./timeline";

export const yieldTask = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Every sample's color as a cube point in `space`, before any fit. */
export function sampleCube(samples: StageSamples, space: ColorSpace) {
  const cube = new Float32Array(samples.groups.length * 3);
  samples.groups.forEach((_, i) => {
    cube.set(
      colorPoint(
        [
          samples.colors[i * 3],
          samples.colors[i * 3 + 1],
          samples.colors[i * 3 + 2],
        ],
        space,
      ),
      i * 3,
    );
  });
  return cube;
}

/**
 * Everything a renderer draws from: the samples' points and group
 * centroids, relative to the fit's center, and the fit itself. A subset
 * passes the fit of the set it came from, so both draw at the same place
 * and scale.
 */
export function prepare(
  samples: StageSamples,
  space: ColorSpace,
  fit?: ViewFit,
) {
  const cube = sampleCube(samples, space);
  const view = fit ?? fitView(cube);
  for (let i = 0; i < cube.length; i += 3)
    cube.set(fitPoint([cube[i], cube[i + 1], cube[i + 2]], view), i);
  return {
    samples,
    cube,
    fit: view,
    order: bitReversalOrder(samples.groups.length),
    ...groupCentroids(cube, samples.groups, samples.groupColors.length),
  };
}
export type CloudData = ReturnType<typeof prepare>;
export interface DrawState extends IntroState {
  angle: number;
  points: number;
}
export interface Renderer {
  /** Loads a sample set, fitted with `fit` when given, else its own fit. */
  setSamples(
    samples: StageSamples,
    space: ColorSpace,
    fit?: ViewFit,
  ): Promise<CloudData>;
  resize(width: number, height: number, dpr: number): void;
  draw(state: DrawState): void;
  onContextLost(callback: () => void): void;
  dispose(): void;
}
