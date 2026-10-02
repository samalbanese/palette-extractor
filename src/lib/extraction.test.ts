import { describe, expect, it } from "vitest";
import {
  medianCutTrace,
  oklabCoords,
  type ColorSpace,
  type Pixel,
} from "@samalbanese/median-cut";
import { colorDistanceSq, type RGB } from "./color";
import {
  PINNED_BOX,
  STAGE_SAMPLE_LIMIT,
  runExtraction,
  type WorkerRequest,
} from "./extraction";

type RGBA = [number, number, number, number];

function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => RGBA,
): ArrayBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  return data.buffer;
}

function request(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  extra: Partial<WorkerRequest> = {},
): WorkerRequest {
  return {
    buffer,
    width,
    height,
    count: 6,
    exclude: [],
    colorSpace: "rgb",
    ...extra,
  };
}

/**
 * Today's worker computation, frozen as the reference for the fields the app
 * already reads. It calls the package without the new option, whose output
 * the package's recorded fixture and parity tests already pin.
 */
function legacy(req: WorkerRequest) {
  const data = new Uint8ClampedArray(req.buffer);
  const all: Pixel[] = [];
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] >= 125) all.push([data[i], data[i + 1], data[i + 2]]);
  if (!all.length)
    throw new Error(
      "That image is fully transparent. Choose an image with visible pixels.",
    );
  let near: (p: Pixel) => boolean;
  if (req.colorSpace === "oklab") {
    const pinned = req.exclude.map((c) => oklabCoords([c.r, c.g, c.b]));
    const limit = (0.1 * 255) ** 2;
    near = (p) => {
      const [l, a, b] = oklabCoords(p);
      return pinned.some(
        (q) => (l - q[0]) ** 2 + (a - q[1]) ** 2 + (b - q[2]) ** 2 < limit,
      );
    };
  } else {
    near = (p) =>
      req.exclude.some(
        (c) => colorDistanceSq({ r: p[0], g: p[1], b: p[2] }, c) < 60 ** 2,
      );
  }
  const filtered = req.exclude.length ? all.filter((p) => !near(p)) : all;
  const pixels = filtered.length ? filtered : all;
  const { result, steps } = medianCutTrace(pixels, req.count, {
    colorSpace: req.colorSpace,
  });
  const stride = pixels.length / Math.min(pixels.length, 3000);
  const sample = Array.from(
    { length: Math.min(pixels.length, 3000) },
    (_, i) => pixels[Math.floor(i * stride)],
  );
  return { colors: result, pixels: sample, steps };
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RED: RGB = { r: 200, g: 30, b: 30 };
const BLUE: RGB = { r: 30, g: 30, b: 200 };
const halves = () =>
  image(10, 4, (x) => (x < 5 ? [200, 30, 30, 255] : [30, 30, 200, 255]));

describe("runExtraction stage samples", () => {
  it("skips alpha 124, keeps alpha 125, and maps every sample back to its pixel", () => {
    const pixels: RGBA[] = [
      [0, 0, 0, 0],
      [10, 0, 0, 255],
      [20, 0, 0, 124],
      [30, 0, 0, 125],
      [40, 0, 0, 255],
      [50, 0, 0, 0],
      [60, 0, 0, 255],
      [70, 0, 0, 255],
      [80, 0, 0, 255],
      [90, 0, 0, 255],
      [100, 0, 0, 255],
      [110, 0, 0, 0],
    ];
    const buffer = image(4, 3, (x, y) => pixels[y * 4 + x]);
    const { samples } = runExtraction(request(buffer, 4, 3)).message;
    const reds = [10, 30, 40, 60, 70, 80, 90, 100];
    expect([...samples.colors].filter((_, i) => i % 3 === 0)).toEqual(reds);
    for (let i = 0; i < reds.length; i++) {
      const x = samples.positions[2 * i];
      const y = samples.positions[2 * i + 1];
      expect(pixels[y * 4 + x][0]).toBe(reds[i]);
    }
    expect(samples.width).toBe(4);
    expect(samples.height).toBe(3);
  });

  it("positions follow the opaque list with a fractional stride", () => {
    const width = 320,
      height = 100;
    const alpha = (x: number, y: number) =>
      x === 0 ||
      x === width - 1 ||
      (y === 0 && x < 5) ||
      (y === height - 1 && x > width - 4)
        ? 0
        : 255;
    // Color encodes position: r = x low byte, g = y, b marks x >= 256.
    const buffer = image(width, height, (x, y) => [
      x & 255,
      y,
      x >= 256 ? 107 : 7,
      alpha(x, y),
    ]);
    const opaque: number[] = [];
    for (let q = 0; q < width * height; q++)
      if (alpha(q % width, Math.floor(q / width)) >= 125) opaque.push(q);
    expect(opaque.length).toBeGreaterThan(STAGE_SAMPLE_LIMIT);

    const { samples } = runExtraction(request(buffer, width, height)).message;
    const n = STAGE_SAMPLE_LIMIT;
    expect(samples.positions).toHaveLength(2 * n);
    for (let i = 0; i < n; i++) {
      const q = opaque[Math.floor((i * opaque.length) / n)];
      const x = samples.positions[2 * i],
        y = samples.positions[2 * i + 1];
      expect([x, y]).toEqual([q % width, Math.floor(q / width)]);
      expect([
        samples.colors[3 * i],
        samples.colors[3 * i + 1],
        samples.colors[3 * i + 2],
      ]).toEqual([x & 255, y, x >= 256 ? 107 : 7]);
    }
  });

  it("caps a full 320 by 320 image at 20,000 evenly spaced samples", () => {
    const buffer = image(320, 320, (x, y) => [x & 255, y & 255, 0, 255]);
    const { samples } = runExtraction(request(buffer, 320, 320)).message;
    expect(samples.positions).toHaveLength(40000);
    expect(samples.groups).toHaveLength(20000);
    // Sample 19,999 is opaque pixel floor(19999 * 102400 / 20000) = 102394.
    expect([samples.positions[39998], samples.positions[39999]]).toEqual([
      314, 319,
    ]);
  });

  for (const colorSpace of ["rgb", "oklab"] as ColorSpace[]) {
    describe(`locked colors in ${colorSpace}`, () => {
      it("labels pixels near a lock with that lock and box 255", () => {
        const { message } = runExtraction(
          request(halves(), 10, 4, { count: 1, exclude: [RED], colorSpace }),
        );
        const { colors, samples } = message;
        expect(colors).toHaveLength(1);
        expect(samples.groupColors).toEqual([colors[0].color, RED]);
        const steps = message.steps.length;
        for (let i = 0; i < samples.groups.length; i++) {
          const isRed = samples.colors[3 * i] === 200;
          expect(samples.groups[i]).toBe(isRed ? 1 : 0);
          for (let k = 0; k < steps; k++)
            expect(
              samples.boxes[k * samples.groups.length + i] === PINNED_BOX,
            ).toBe(isRed);
        }
      });

      it("gives overlapping locks to the first one", () => {
        const second: RGB = { r: 205, g: 32, b: 32 };
        const { message } = runExtraction(
          request(halves(), 10, 4, {
            count: 1,
            exclude: [RED, second],
            colorSpace,
          }),
        );
        const reds = [...message.samples.groups].filter(
          (_, i) => message.samples.colors[3 * i] === 200,
        );
        expect(new Set(reds)).toEqual(new Set([message.colors.length + 0]));
      });

      it("ignores a lock that matches nothing", () => {
        const { message } = runExtraction(
          request(halves(), 10, 4, {
            count: 2,
            exclude: [{ r: 0, g: 255, b: 0 }],
            colorSpace,
          }),
        );
        expect(Math.max(...message.samples.groups)).toBeLessThan(
          message.colors.length,
        );
        expect([...message.samples.boxes]).not.toContain(PINNED_BOX);
      });

      it("falls back to every pixel when the locks cover the whole image", () => {
        const buffer = image(6, 2, () => [200, 30, 30, 255]);
        const { message } = runExtraction(
          request(buffer, 6, 2, { count: 1, exclude: [RED], colorSpace }),
        );
        expect([...message.samples.groups]).toEqual(new Array(12).fill(0));
        expect([...message.samples.boxes]).not.toContain(PINNED_BOX);
      });
    });
  }
});

describe("runExtraction keeps the existing fields", () => {
  it("matches today's computation for colors, pixels and steps", () => {
    const rand = mulberry32(20261002);
    const noisy = image(96, 64, () => [
      Math.floor(rand() * 256),
      Math.floor(rand() * 256),
      Math.floor(rand() * 256),
      rand() < 0.1 ? 0 : 255,
    ]);
    const cases: WorkerRequest[] = [];
    for (const colorSpace of ["rgb", "oklab"] as ColorSpace[])
      for (const count of [1, 6, 10])
        for (const exclude of [[], [RED, BLUE]])
          cases.push(request(noisy, 96, 64, { count, exclude, colorSpace }));
    for (const req of cases) {
      const { colors, pixels, steps } = runExtraction(req).message;
      expect({ colors, pixels, steps }).toEqual(legacy(req));
    }
  });

  it("throws today's message for a fully transparent image", () => {
    expect(() =>
      runExtraction(
        request(
          image(3, 3, () => [9, 9, 9, 0]),
          3,
          3,
        ),
      ),
    ).toThrow(
      "That image is fully transparent. Choose an image with visible pixels.",
    );
  });
});

describe("runExtraction transfer list", () => {
  it("transfers exactly the four sample buffers, which detach after posting", () => {
    const { message, transfer } = runExtraction(request(halves(), 10, 4));
    const { positions, colors, groups, boxes } = message.samples;
    const buffers = [
      positions.buffer,
      colors.buffer,
      groups.buffer,
      boxes.buffer,
    ];
    expect(new Set(buffers).size).toBe(4);
    expect(transfer).toHaveLength(4);
    expect(new Set(transfer)).toEqual(new Set(buffers));
    structuredClone(message, { transfer });
    expect(buffers.map((b) => b.byteLength)).toEqual([0, 0, 0, 0]);
  });
});
