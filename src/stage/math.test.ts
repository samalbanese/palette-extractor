import { describe, expect, it } from "vitest";
import { oklabCoords, type Pixel } from "@samalbanese/median-cut";
import { NO_SWATCH } from "../lib/stageGroups";
import {
  bitReversalOrder,
  colorPoint,
  coverTransform,
  flyerOrigins,
  groupCentroids,
  imagePoint,
  project,
} from "./math";

/** The projection the How it works cube uses, which takes 0-255 values. */
function reference(point: Pixel, angle: number, width: number, height: number) {
  const x = point[0] - 127.5;
  const y = point[1] - 127.5;
  const z = point[2] - 127.5;
  const cosY = Math.cos(angle);
  const sinY = Math.sin(angle);
  const rotatedX = x * cosY + z * sinY;
  const rotatedZ = -x * sinY + z * cosY;
  const tilt = Math.PI / 9;
  const rotatedY = y * Math.cos(tilt) - rotatedZ * Math.sin(tilt);
  const scale = (Math.min(width, height) - 44) / 360;
  return [width / 2 + rotatedX * scale, height / 2 - rotatedY * scale];
}

describe("coverTransform", () => {
  it("fills a frame wider than the image by cropping top and bottom", () => {
    const cover = coverTransform(320, 320, 640, 320);
    expect(cover.scale).toBe(2);
    expect(cover.offsetX).toBe(0);
    expect(cover.offsetY).toBe(-160);
  });

  it("fills a frame taller than the image by cropping the sides", () => {
    const cover = coverTransform(320, 180, 350, 245);
    expect(cover.scale).toBeCloseTo(245 / 180, 10);
    expect(cover.offsetX).toBeCloseTo((350 - 320 * (245 / 180)) / 2, 10);
    expect(cover.offsetY).toBe(0);
  });

  it("scales an image with the frame's aspect ratio without cropping", () => {
    const cover = coverTransform(100, 100, 200, 200);
    expect(cover).toEqual({ scale: 2, offsetX: 0, offsetY: 0 });
  });

  it("places a working-image pixel at its center in frame pixels", () => {
    const cover = coverTransform(320, 320, 640, 320);
    expect(imagePoint(0, 0, cover)).toEqual([1, -159]);
    expect(imagePoint(319, 319, cover)).toEqual([639, 479]);
  });
});

describe("colorPoint and project", () => {
  const corners: Pixel[] = [];
  for (const r of [0, 255])
    for (const g of [0, 255]) for (const b of [0, 255]) corners.push([r, g, b]);
  corners.push([128, 128, 128]);

  it("centers RGB once and projects like the How it works cube", () => {
    for (const angle of [0, 0.7, -2.4])
      for (const color of corners) {
        const [x, y] = project(colorPoint(color, "rgb"), angle, 350, 245);
        const [ex, ey] = reference(color, angle, 350, 245);
        expect(x).toBeCloseTo(ex, 9);
        expect(y).toBeCloseTo(ey, 9);
      }
  });

  it("centers OKLab coordinates once and projects like the cube", () => {
    const color: Pixel = [211, 154, 95];
    const coords = oklabCoords(color);
    expect(colorPoint(color, "oklab")).toEqual([
      coords[0] - 127.5,
      coords[1] - 127.5,
      coords[2] - 127.5,
    ]);
    const [x, y] = project(colorPoint(color, "oklab"), 1.1, 600, 327);
    const [ex, ey] = reference(coords, 1.1, 600, 327);
    expect(x).toBeCloseTo(ex, 9);
    expect(y).toBeCloseTo(ey, 9);
  });
});

describe("bitReversalOrder", () => {
  it.each([1, 2, 7, 20000])("is a permutation of 0..%i-1", (n) => {
    const order = bitReversalOrder(n);
    expect(order).toHaveLength(n);
    expect(new Set(order).size).toBe(n);
    expect(Math.max(...order)).toBe(n - 1);
  });

  it("spreads every prefix the adaptive renderer draws across the samples", () => {
    const order = bitReversalOrder(20000);
    for (const prefix of [4000, 8000]) {
      const buckets = new Array(10).fill(0);
      for (let i = 0; i < prefix; i++) buckets[Math.floor(order[i] / 2000)]++;
      for (const count of buckets)
        expect(Math.abs(count - prefix / 10)).toBeLessThanOrEqual(
          prefix / 1000,
        );
    }
  });
});

describe("groupCentroids", () => {
  it("averages each group's cube positions and leaves empty groups null", () => {
    const cube = new Float32Array([0, 0, 0, 10, 20, 30, -5, 5, 1]);
    const groups = new Uint8Array([0, 0, 2]);
    const { centroids, counts } = groupCentroids(cube, groups, 3);
    expect(centroids[0]).toEqual([5, 10, 15]);
    expect(centroids[1]).toBeNull();
    expect(centroids[2]).toEqual([-5, 5, 1]);
    expect(counts).toEqual([2, 0, 1]);
  });
});

describe("flyerOrigins", () => {
  it("weights groups that share a swatch by their sample counts", () => {
    const origins = flyerOrigins(
      [
        [0, 0, 0],
        [30, 0, 0],
        [0, 9, 0],
      ],
      [1, 2, 4],
      new Uint8Array([0, 0, 1]),
      2,
    );
    expect(origins[0]).toEqual([20, 0, 0]);
    expect(origins[1]).toEqual([0, 9, 0]);
  });

  it("gives no origin to a swatch without groups and ignores unmatched groups", () => {
    const origins = flyerOrigins(
      [[1, 1, 1], null, [4, 4, 4]],
      [3, 0, 5],
      new Uint8Array([NO_SWATCH, 0, 2]),
      3,
    );
    expect(origins).toEqual([null, null, [4, 4, 4]]);
  });
});
