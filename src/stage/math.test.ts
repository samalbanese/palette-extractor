import { describe, expect, it } from "vitest";
import {
  oklabCoords,
  type ColorSpace,
  type Pixel,
} from "@samalbanese/median-cut";
import { NO_SWATCH } from "../lib/stageGroups";
import colors from "./__fixtures__/sample-colors.json";
import {
  bitReversalOrder,
  boxCorners,
  colorPoint,
  coverTransform,
  fitPoint,
  fitView,
  flyerOrigins,
  groupCentroids,
  imagePoint,
  project,
  VIEW_RADIUS,
  type Vec3,
} from "./math";

/** The projection with no fit applied, which takes 0-255 values. */
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
  const side = Math.min(width, height);
  const scale = Math.min(0.42 * side, side / 2 - 22) / VIEW_RADIUS;
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

  it("centers RGB once and projects about the frame center", () => {
    for (const angle of [0, 0.7, -2.4])
      for (const color of corners) {
        const [x, y] = project(colorPoint(color, "rgb"), angle, 350, 245);
        const [ex, ey] = reference(color, angle, 350, 245);
        expect(x).toBeCloseTo(ex, 9);
        expect(y).toBeCloseTo(ey, 9);
      }
  });

  it("centers OKLab coordinates once and projects the same way", () => {
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

type Sample = keyof typeof colors;

/**
 * A built-in photo's colors as 0-255 coordinates in `space`. The fixture
 * holds every tenth of the photo's 20,000 stage samples, as RGB bytes.
 */
function fixtureCoords(name: Sample, space: ColorSpace): Pixel[] {
  const bytes = Uint8Array.from(atob(colors[name]), (c) => c.charCodeAt(0));
  const coords: Pixel[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const rgb: Pixel = [bytes[i], bytes[i + 1], bytes[i + 2]];
    coords.push(space === "oklab" ? oklabCoords(rgb) : rgb);
  }
  return coords;
}

/** The fixture's colors as a cube, the way the stage holds them. */
function fixtureCube(name: Sample, space: ColorSpace) {
  const coords = fixtureCoords(name, space);
  const cube = new Float32Array(coords.length * 3);
  coords.forEach((c, i) =>
    cube.set(
      [0, 1, 2].map((k) => c[k] - 127.5),
      i * 3,
    ),
  );
  return cube;
}

/** Each point's bounding rectangle on screen. */
function extent(points: [number, number][]) {
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

// The stage at 1440 x 900 and 390 x 844, How it works at 1440, and a frame
// small enough that the margin, not the 42%, sets the scale.
const FRAMES = [
  [597.984375, 325],
  [348, 218],
  [800, 480],
  [240, 180],
];
const YAWS = Array.from({ length: 24 }, (_, k) => (k / 24) * Math.PI * 2);
const SAMPLES: Sample[] = ["Golden dunes", "Forest floor"];
const SPACES: ColorSpace[] = ["rgb", "oklab"];

describe("fitView", () => {
  it("centers on the mean and maps the radius to 42% of the shorter side", () => {
    const fit = fitView(new Float32Array([40, 20, 5, -20, 20, 5, 10, 20, 5]));
    expect(fit.center[0]).toBeCloseTo(10, 5);
    expect(fit.center[1]).toBeCloseTo(20, 5);
    expect(fit.center[2]).toBeCloseTo(5, 5);
    // The farthest points sit 30 from the mean.
    expect(fit.zoom).toBeCloseTo(VIEW_RADIUS / 30, 5);
    const [cx, cy] = project(fitPoint(fit.center, fit), 0.4, 600, 400);
    expect(cx).toBeCloseTo(300, 9);
    expect(cy).toBeCloseTo(200, 9);
    // At yaw 0 the first axis runs straight across the screen.
    const [x, y] = project(fitPoint([40, 20, 5], fit), 0, 600, 400);
    expect(x).toBeCloseTo(300 + 0.42 * 400, 5);
    expect(y).toBeCloseTo(200, 5);
  });

  it("widens the radius when the bounding box's corners reach far past it", () => {
    const fit = fitView(
      new Float32Array([30, 0, 0, -30, 0, 0, 0, 0, 30, 0, 0, -30]),
    );
    // Corners sit 30 * sqrt(2) out, and may reach 1.15 times the radius.
    expect(fit.zoom).toBeCloseTo((VIEW_RADIUS * 1.15) / (30 * Math.SQRT2), 5);
  });

  it("keeps a 22 px margin where 42% of the side would cross it", () => {
    const fit = fitView(new Float32Array([-50, 0, 0, 50, 0, 0]));
    expect(project(fitPoint([50, 0, 0], fit), 0, 200, 200)[0]).toBeCloseTo(
      200 - 22,
      5,
    );
  });

  it("clamps the zoom for a flat image so it stays a dot", () => {
    const flat = fitView(new Float32Array([12, -40, 7, 12, -40, 7]));
    expect(flat.center).toEqual([12, -40, 7]);
    expect(flat.zoom).toBeCloseTo(VIEW_RADIUS / 12, 9);
    expect(fitView(new Float32Array([0, 0, 0, 3, 0, 0])).zoom).toBeCloseTo(
      VIEW_RADIUS / 12,
      9,
    );
    expect(fitView(new Float32Array(0))).toEqual({
      center: [0, 0, 0],
      zoom: VIEW_RADIUS / 12,
    });
  });

  for (const name of SAMPLES)
    for (const space of SPACES)
      it(`keeps every ${name} point inside the margin at 24 yaws (${space})`, () => {
        const cube = fixtureCube(name, space);
        const fit = fitView(cube);
        const fitted: Vec3[] = [];
        for (let i = 0; i < cube.length; i += 3)
          fitted.push(fitPoint([cube[i], cube[i + 1], cube[i + 2]], fit));
        for (const [width, height] of FRAMES)
          for (const angle of YAWS) {
            const box = extent(
              fitted.map((p) => project(p, angle, width, height)),
            );
            expect(box.left).toBeGreaterThanOrEqual(22 - 1e-6);
            expect(box.top).toBeGreaterThanOrEqual(22 - 1e-6);
            expect(box.right).toBeLessThanOrEqual(width - 22 + 1e-6);
            expect(box.bottom).toBeLessThanOrEqual(height - 22 + 1e-6);
          }
      });

  for (const space of SPACES)
    it(`spreads Golden dunes across the frame at the resting angle (${space})`, () => {
      const cube = fixtureCube("Golden dunes", space);
      const fit = fitView(cube);
      const [width, height] = FRAMES[0];
      const points: [number, number][] = [];
      for (let i = 0; i < cube.length; i += 3)
        points.push(
          project(
            fitPoint([cube[i], cube[i + 1], cube[i + 2]], fit),
            -Math.PI / 4,
            width,
            height,
          ),
        );
      const box = extent(points);
      expect(
        Math.max(box.right - box.left, box.bottom - box.top) / height,
      ).toBeGreaterThanOrEqual(0.45);
    });

  for (const name of SAMPLES)
    for (const space of SPACES)
      it(`keeps the box around all of ${name} inside the frame (${space})`, () => {
        const coords = fixtureCoords(name, space);
        const min = [0, 1, 2].map((k) =>
          Math.min(...coords.map((c) => c[k])),
        ) as Pixel;
        const max = [0, 1, 2].map((k) =>
          Math.max(...coords.map((c) => c[k])),
        ) as Pixel;
        const fit = fitView(fixtureCube(name, space));
        for (const [width, height] of FRAMES)
          for (const angle of YAWS) {
            const box = extent(
              boxCorners({ min, max }, fit).map((p) =>
                project(p, angle, width, height),
              ),
            );
            expect(box.left).toBeGreaterThan(0);
            expect(box.top).toBeGreaterThan(0);
            expect(box.right).toBeLessThan(width);
            expect(box.bottom).toBeLessThan(height);
          }
      });
});

describe("boxCorners", () => {
  it("lists a box's eight corners through the same fit as the points", () => {
    const fit = { center: [10, -20, 5] as Vec3, zoom: 2 };
    const corners = boxCorners({ min: [0, 10, 20], max: [100, 110, 120] }, fit);
    const expected = (color: Pixel) => fitPoint(colorPoint(color, "rgb"), fit);
    expect(corners).toHaveLength(8);
    // Bit k of the index picks the high end of axis k.
    expect(corners[0]).toEqual(expected([0, 10, 20]));
    expect(corners[1]).toEqual(expected([100, 10, 20]));
    expect(corners[4]).toEqual(expected([0, 10, 120]));
    expect(corners[7]).toEqual(expected([100, 110, 120]));
  });
});
