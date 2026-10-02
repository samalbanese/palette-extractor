import type { ColorSpace } from "@samalbanese/median-cut";
import type { StageSamples } from "../lib/extraction";
import { bitReversalOrder, colorPoint, groupCentroids } from "./math";
import type { IntroState } from "./timeline";

export const yieldTask = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

export function prepare(samples: StageSamples, space: ColorSpace) {
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
  return {
    samples,
    cube,
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
  setSamples(samples: StageSamples, space: ColorSpace): Promise<CloudData>;
  resize(width: number, height: number, dpr: number): void;
  draw(state: DrawState): void;
  onContextLost(callback: () => void): void;
  dispose(): void;
}
