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
  TILT,
  viewScale,
  type Vec3,
  type ViewFit,
} from "./math";

/** A fit about the cube's center, so points project from 0-255 values. */
const CUBE_FIT: ViewFit = {
  center: [0, 0, 0],
  reachX: 150,
  reachY: 120,
  boxX: 160,
  boxY: 130,
};

/** The projection written out, which takes 0-255 values. */
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
  const scale = Math.min(
    (width / 2 - 22) / 150,
    (height / 2 - 22) / 120,
    (width / 2 - 2) / 160,
    (height / 2 - 2) / 130,
  );
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
        const [x, y] = project(
          colorPoint(color, "rgb"),
          angle,
          350,
          245,
          CUBE_FIT,
        );
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
    const [x, y] = project(colorPoint(color, "oklab"), 1.1, 600, 327, CUBE_FIT);
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

// The stage at 1440 x 900 and 390 x 844, How it works at 1440, and frames
// small or taller than they are wide.
const FRAMES = [
  [597.984375, 325],
  [348, 218],
  [800, 480],
  [240, 180],
  [200, 420],
];
const YAWS = Array.from({ length: 24 }, (_, k) => (k / 24) * Math.PI * 2);
const SAMPLES: Sample[] = ["Golden dunes", "Forest floor"];
const SPACES: ColorSpace[] = ["rgb", "oklab"];
const COS = Math.cos(TILT),
  SIN = Math.sin(TILT);

/** A cloud of the eight corners of a box (±a, ±b, ±c) about `center`. */
function boxCloud([a, b, c]: Vec3, center: Vec3) {
  const cube = new Float32Array(24);
  for (let i = 0; i < 8; i++)
    cube.set(
      [
        center[0] + (i & 1 ? a : -a),
        center[1] + (i & 2 ? b : -b),
        center[2] + (i & 4 ? c : -c),
      ],
      i * 3,
    );
  return cube;
}

/** Every point of a cube, fitted and projected, at one yaw. */
function screen(
  cube: Float32Array,
  fit: ViewFit,
  angle: number,
  width: number,
  height: number,
) {
  const points: [number, number][] = [];
  for (let i = 0; i < cube.length; i += 3)
    points.push(
      project(
        fitPoint([cube[i], cube[i + 1], cube[i + 2]], fit),
        angle,
        width,
        height,
        fit,
      ),
    );
  return points;
}

describe("fitView", () => {
  it("centers on the middle of the range and bounds the reach across and up the screen at any yaw", () => {
    const fit = fitView(boxCloud([30, 20, 10], [10, 20, 5]));
    expect(fit.center[0]).toBeCloseTo(10, 5);
    expect(fit.center[1]).toBeCloseTo(20, 5);
    expect(fit.center[2]).toBeCloseTo(5, 5);
    // Across: the farthest distance from the vertical axis. Up: the height,
    // tilted, plus the tilt's share of that distance.
    const h = Math.hypot(30, 10);
    expect(fit.reachX).toBeCloseTo(h, 5);
    expect(fit.reachY).toBeCloseTo(20 * COS + h * SIN, 5);
    // The points are the box's corners, so the box reaches no farther.
    expect(fit.boxX).toBeCloseTo(fit.reachX, 9);
    expect(fit.boxY).toBeCloseTo(fit.reachY, 9);
  });

  it("fills the frame to the margin on its tighter axis, and only there", () => {
    const cube = boxCloud([30, 20, 10], [10, 20, 5]);
    const fit = fitView(cube);
    const yaws = Array.from(
      { length: 3600 },
      (_, k) => (k / 3600) * 2 * Math.PI,
    );
    const nearest = (width: number, height: number) => {
      let left = Infinity,
        top = Infinity;
      for (const angle of yaws)
        for (const [x, y] of screen(cube, fit, angle, width, height)) {
          left = Math.min(left, x);
          top = Math.min(top, y);
        }
      return { left, top };
    };
    // A wide frame: the height sets the scale, and at some yaw the points
    // come within 22 px of the top, but never closer.
    expect(viewScale(1000, 300, fit)).toBeCloseTo((150 - 22) / fit.reachY, 9);
    const wide = nearest(1000, 300);
    expect(wide.top).toBeGreaterThanOrEqual(22 - 1e-9);
    expect(wide.top).toBeCloseTo(22, 2);
    expect(wide.left).toBeGreaterThan(122);
    // A tall frame: the width sets it.
    expect(viewScale(300, 1000, fit)).toBeCloseTo((150 - 22) / fit.reachX, 9);
    const tall = nearest(300, 1000);
    expect(tall.left).toBeGreaterThanOrEqual(22 - 1e-9);
    expect(tall.left).toBeCloseTo(22, 2);
    expect(tall.top).toBeGreaterThan(122);
    // The center lands on the middle of the frame.
    const [cx, cy] = project(fitPoint(fit.center, fit), 0.4, 600, 400, fit);
    expect(cx).toBeCloseTo(300, 9);
    expect(cy).toBeCloseTo(200, 9);
  });

  it("scales down when the bounding box's corners reach past the points", () => {
    const fit = fitView(
      new Float32Array([30, 0, 0, -30, 0, 0, 0, 0, 30, 0, 0, -30]),
    );
    expect(fit.reachX).toBeCloseTo(30, 5);
    // Corners sit 30 * sqrt(2) out; they may run into the margin but stay
    // 2 px inside the edge.
    expect(fit.boxX).toBeCloseTo(30 * Math.SQRT2, 5);
    expect(fit.boxY).toBeCloseTo(30 * Math.SQRT2 * SIN, 5);
    expect(viewScale(200, 200, fit)).toBeCloseTo(
      (100 - 2) / (30 * Math.SQRT2),
      9,
    );
  });

  it("turns a lopsided cloud about the middle of its range, not its mean", () => {
    // Most pixels dark, one bright: the mean sits near the dark end.
    const cube = new Float32Array(30);
    for (let i = 0; i < 9; i++) cube.set([-100, -100, -100], i * 3);
    cube.set([100, 100, 100], 27);
    const fit = fitView(cube);
    expect(fit.center).toEqual([0, 0, 0]);
    // Either end reaches as far: 100 on each axis, where the bright pixel
    // would reach 180 from the mean.
    expect(fit.reachX).toBeCloseTo(100 * Math.SQRT2, 3);
  });

  it("clamps the reach for a flat image so it stays a dot", () => {
    const flat = fitView(new Float32Array([12, -40, 7, 12, -40, 7]));
    const clamped = { reachX: 12, reachY: 12, boxX: 12, boxY: 12 };
    expect(flat).toMatchObject({ center: [12, -40, 7], ...clamped });
    expect(fitView(new Float32Array([0, 0, 0, 3, 0, 0]))).toMatchObject({
      center: [1.5, 0, 0],
      ...clamped,
    });
    expect(fitView(new Float32Array(0))).toMatchObject({
      center: [0, 0, 0],
      ...clamped,
    });
    expect(viewScale(400, 300, flat)).toBeCloseTo((150 - 22) / 12, 9);
    // Turning never magnifies it either.
    for (const angle of YAWS)
      expect(viewScale(400, 300, flat, angle)).toBeCloseTo((150 - 22) / 12, 9);
  });

  it("keeps split boxes in the frame when they cover pixels the samples missed", () => {
    // A flat gray image whose one red pixel was not sampled: the points sit
    // in one spot, but the quantizer's boxes still stretch out to the red.
    const gray = colorPoint([128, 128, 128], "rgb");
    const cube = new Float32Array([...gray, ...gray]);
    const extent = {
      min: [128, 0, 0] as [number, number, number],
      max: [255, 128, 128] as [number, number, number],
    };
    const fit = fitView(cube, extent);
    // The points' own reach is unchanged; only the boxes' grows.
    expect(fit.reachX).toBe(12);
    expect(fit.reachY).toBe(12);
    for (let k = 0; k < 24; k++) {
      const angle = (k / 24) * 2 * Math.PI;
      for (const corner of boxCorners(extent, fit)) {
        const [x, y] = project(corner, angle, 400, 300, fit);
        expect(Math.min(x, 400 - x, y, 300 - y)).toBeGreaterThanOrEqual(
          2 - 1e-6,
        );
      }
    }
  });

  it("never gives a negative scale for a frame smaller than its margins", () => {
    expect(viewScale(30, 30, CUBE_FIT)).toBe(0);
  });

  for (const name of SAMPLES)
    for (const space of SPACES)
      it(`keeps every ${name} point inside the margin at 24 yaws (${space})`, () => {
        const cube = fixtureCube(name, space);
        const fit = fitView(cube);
        for (const [width, height] of FRAMES)
          for (const angle of YAWS) {
            const box = extent(screen(cube, fit, angle, width, height));
            expect(box.left).toBeGreaterThanOrEqual(22 - 1e-6);
            expect(box.top).toBeGreaterThanOrEqual(22 - 1e-6);
            expect(box.right).toBeLessThanOrEqual(width - 22 + 1e-6);
            expect(box.bottom).toBeLessThanOrEqual(height - 22 + 1e-6);
          }
      });

  for (const name of SAMPLES)
    for (const space of SPACES)
      it(`brings ${name} to the margin at some yaw (${space})`, () => {
        const cube = fixtureCube(name, space);
        const fit = fitView(cube);
        const yaws = Array.from({ length: 360 }, (_, k) => (k / 180) * Math.PI);
        for (const [width, height] of FRAMES) {
          // The nearest any point comes to the margin, or a box corner to
          // the edge, over a full turn: one of them is what limits the scale.
          let points = Infinity;
          for (const angle of yaws) {
            const box = extent(screen(cube, fit, angle, width, height));
            points = Math.min(
              points,
              box.left - 22,
              box.top - 22,
              width - 22 - box.right,
              height - 22 - box.bottom,
            );
          }
          const scale = viewScale(width, height, fit);
          const corners = Math.min(
            width / 2 - 2 - fit.boxX * scale,
            height / 2 - 2 - fit.boxY * scale,
          );
          expect(Math.min(points, corners)).toBeLessThan(1);
        }
      });

  for (const space of SPACES)
    it(`spreads Golden dunes across the stage at the resting angle (${space})`, () => {
      const cube = fixtureCube("Golden dunes", space);
      const fit = fitView(cube);
      for (const [width, height] of FRAMES.slice(0, 2)) {
        const box = extent(screen(cube, fit, -Math.PI / 4, width, height));
        // Measured on the frame's own axes, inside the margin.
        expect(
          Math.max(
            (box.right - box.left) / (width - 44),
            (box.bottom - box.top) / (height - 44),
          ),
        ).toBeGreaterThanOrEqual(0.45);
      }
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
                project(p, angle, width, height, fit),
              ),
            );
            expect(box.left).toBeGreaterThanOrEqual(2 - 1e-6);
            expect(box.top).toBeGreaterThanOrEqual(2 - 1e-6);
            expect(box.right).toBeLessThanOrEqual(width - 2 + 1e-6);
            expect(box.bottom).toBeLessThanOrEqual(height - 2 + 1e-6);
          }
      });
});

/**
 * A thin streak of sea and sky blues: long one way, narrow the others, so
 * how much room it needs depends on the angle it is seen from.
 */
function streak() {
  const cube = new Float32Array(400 * 3);
  for (let i = 0; i < 400; i++) {
    const t = i / 399;
    const wobble = 3 * Math.sin(i * 12.9898);
    cube.set(
      [-60 + 120 * t + wobble, -20 + 30 * t, -70 + 110 * t - wobble],
      i * 3,
    );
  }
  return cube;
}

const MARGIN = 22;

/**
 * At one yaw and share of room for boxes, the nearest any point comes to
 * the margin, and any corner of the box around the points (and of `box`,
 * when given) to the edge. Each is negative once something has crossed.
 */
function clearance(
  cube: Float32Array,
  fit: ViewFit,
  angle: number,
  width: number,
  height: number,
  boxes = 1,
  box?: { min: Pixel; max: Pixel },
) {
  const scale = viewScale(width, height, fit, angle, boxes);
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const place = ([x, y, z]: Vec3) => [
    (x * cos + z * sin) * scale,
    (y * COS - (-x * sin + z * cos) * SIN) * scale,
  ];
  let points = Infinity;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < cube.length; i += 3) {
    const [x, y] = place(fitPoint([cube[i], cube[i + 1], cube[i + 2]], fit));
    points = Math.min(
      points,
      width / 2 - MARGIN - Math.abs(x),
      height / 2 - MARGIN - Math.abs(y),
    );
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], cube[i + k] + 127.5);
      max[k] = Math.max(max[k], cube[i + k] + 127.5);
    }
  }
  let corners = Infinity;
  for (const b of [{ min, max } as { min: Pixel; max: Pixel }, box])
    if (b)
      for (const corner of boxCorners(b, fit)) {
        const [x, y] = place(corner);
        corners = Math.min(
          corners,
          width / 2 - 2 - Math.abs(x),
          height / 2 - 2 - Math.abs(y),
        );
      }
  return { points, corners };
}

// Half-degree steps, offset to fall between the yaws a fit measures.
const FINE_YAWS = Array.from(
  { length: 720 },
  (_, k) => ((k + 0.37) / 720) * 2 * Math.PI,
);

describe("viewScale at a yaw", () => {
  const clouds: [string, () => Float32Array][] = [
    ["a thin streak", streak],
    ...SAMPLES.flatMap((name) =>
      SPACES.map((space): [string, () => Float32Array] => [
        `${name} (${space})`,
        () => fixtureCube(name, space),
      ]),
    ),
  ];

  for (const [name, make] of clouds)
    it(`keeps ${name} inside the margin at every yaw, and its box inside the edge while boxes show`, () => {
      const cube = make();
      const fit = fitView(cube);
      for (const boxes of [1, 0.5, 0])
        for (const [width, height] of FRAMES)
          for (const angle of FINE_YAWS) {
            const { points, corners } = clearance(
              cube,
              fit,
              angle,
              width,
              height,
              boxes,
            );
            expect(points).toBeGreaterThanOrEqual(-1e-6);
            if (boxes === 1) expect(corners).toBeGreaterThanOrEqual(-1e-6);
          }
    });

  it("keeps split boxes over skipped colors inside the edge at every yaw", () => {
    const gray = colorPoint([128, 128, 128], "rgb");
    const cube = new Float32Array([...gray, ...gray]);
    const extent = {
      min: [128, 0, 0] as Pixel,
      max: [255, 128, 128] as Pixel,
    };
    const fit = fitView(cube, extent);
    for (const [width, height] of FRAMES)
      for (const angle of FINE_YAWS)
        expect(
          clearance(cube, fit, angle, width, height, 1, extent).corners,
        ).toBeGreaterThanOrEqual(-1e-6);
  });

  for (const [name, make] of clouds)
    it(`never draws ${name} smaller than the size that fits every yaw, nor past 2.5 times it`, () => {
      const fit = fitView(make());
      for (const boxes of [1, 0])
        for (const [width, height] of FRAMES) {
          const still = viewScale(width, height, fit, undefined, boxes);
          for (const angle of FINE_YAWS) {
            const scale = viewScale(width, height, fit, angle, boxes);
            expect(scale).toBeGreaterThanOrEqual(still * (1 - 1e-9));
            expect(scale).toBeLessThanOrEqual(still * 2.5 * (1 + 1e-9));
          }
        }
    });

  it("zooms a thin streak in where it looks shortest", () => {
    const fit = fitView(streak());
    // Seen along its length, the streak's 120 across and 110 deep cancel.
    const endOn = Math.atan2(-120, 110);
    for (const [width, height] of FRAMES) {
      const still = viewScale(width, height, fit, undefined, 0);
      expect(viewScale(width, height, fit, endOn, 0)).toBeGreaterThanOrEqual(
        still * 2,
      );
    }
  });

  it("draws Golden dunes larger at rest than while its boxes show", () => {
    // In RGB its colors fill a slanted slab whose box corners sit well
    // outside the points.
    const fit = fitView(fixtureCube("Golden dunes", "rgb"));
    for (const [width, height] of FRAMES.slice(0, 2)) {
      const rest = viewScale(width, height, fit, -Math.PI / 4, 0);
      expect(rest).toBeGreaterThanOrEqual(
        viewScale(width, height, fit, -Math.PI / 4, 1) * 1.25,
      );
      expect(rest).toBeGreaterThanOrEqual(viewScale(width, height, fit) * 1.5);
    }
  });

  for (const [name, make] of clouds)
    it(`eases the zoom on ${name} as it turns, never jumping`, () => {
      const fit = fitView(make());
      const step = (2 * Math.PI) / 2880;
      for (const boxes of [1, 0.4, 0])
        for (const [width, height] of FRAMES) {
          let last = Math.log(viewScale(width, height, fit, 0, boxes));
          for (let k = 1; k <= 2880; k++) {
            const next = Math.log(
              viewScale(width, height, fit, k * step, boxes),
            );
            // At most 1.2 in log scale per radian: about 2% per degree.
            expect(Math.abs(next - last)).toBeLessThanOrEqual(
              1.2 * step + 1e-9,
            );
            last = next;
          }
        }
    });

  it("moves evenly between the sizes with and without room for boxes", () => {
    const fit = fitView(fixtureCube("Golden dunes", "rgb"));
    for (const angle of [-Math.PI / 4, 1.9, 4.4]) {
      const full = viewScale(600, 400, fit, angle, 1);
      const none = viewScale(600, 400, fit, angle, 0);
      expect(none).toBeGreaterThanOrEqual(full);
      if (angle < 0) expect(none).toBeGreaterThan(full * 1.1);
      expect(viewScale(600, 400, fit, angle, 0.5)).toBeCloseTo(
        Math.sqrt(full * none),
        9,
      );
    }
  });

  it("projects with the scale for the yaw and box room it is given", () => {
    const fit = fitView(streak());
    const p: Vec3 = [40, -10, 25];
    for (const angle of [0, 0.3, 2.2, -4])
      for (const boxes of [1, 0.3, 0]) {
        const scale = viewScale(600, 400, fit, angle, boxes);
        const [x] = project(p, angle, 600, 400, fit, boxes);
        const across = p[0] * Math.cos(angle) + p[2] * Math.sin(angle);
        expect(x).toBeCloseTo(300 + across * scale, 9);
      }
  });

  it("keeps one size at every yaw for a fit built by hand", () => {
    for (const angle of YAWS)
      expect(viewScale(600, 327, CUBE_FIT, angle)).toBe(
        viewScale(600, 327, CUBE_FIT),
      );
  });

  it("never gives a negative scale for a frame smaller than its margins", () => {
    const fit = fitView(streak());
    for (const angle of YAWS) expect(viewScale(30, 30, fit, angle)).toBe(0);
  });
});

describe("boxCorners", () => {
  it("lists a box's eight corners through the same fit as the points", () => {
    const fit = { ...CUBE_FIT, center: [10, -20, 5] as Vec3 };
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
