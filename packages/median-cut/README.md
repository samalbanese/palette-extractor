# @samalbanese/median-cut

A from-scratch median-cut color quantizer for reducing an image's pixels
to a small palette. It has an optional OKLab perceptual mode, so grouping
follows colors the eye actually treats as similar rather than raw RGB
distance. Zero runtime dependencies. Every returned color is a real pixel
from the input, never an averaged color that appears nowhere in the source.

## Install

```sh
npm install @samalbanese/median-cut
```

## Example

```js
import { medianCut } from "@samalbanese/median-cut";

const canvas = document.createElement("canvas");
canvas.width = img.width;
canvas.height = img.height;
const ctx = canvas.getContext("2d");
ctx.drawImage(img, 0, 0);
const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

const pixels = [];
for (let i = 0; i < data.length; i += 4) {
  if (data[i + 3] >= 125) pixels.push([data[i], data[i + 1], data[i + 2]]);
}

const palette = medianCut(pixels, 6, { colorSpace: "oklab" });
```

`palette` is an array of up to 6 `{ r, g, b }` colors, ordered by how much
of the image each one covers.

## API

| Export              | Signature                                                                                                         | Returns                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `medianCut`         | `(pixels: Pixel[], count: number, options?: MedianCutOptions) => RGB[]`                                           | Up to `count` colors, most populous first.                                  |
| `medianCutWeighted` | `(pixels: Pixel[], count: number, options?: MedianCutOptions) => WeightedColor[]`                                 | Same colors, each paired with its pixel population.                         |
| `medianCutTrace`    | `(pixels: Pixel[], count: number, options?: MedianCutOptions) => { steps: SplitStep[]; result: WeightedColor[] }` | The final result plus the box-split history, for visualizing the algorithm. |
| `srgbToOklab`       | `(rgb: RGB) => Oklab`                                                                                             | An sRGB color converted to OKLab.                                           |
| `oklabCoords`       | `(pixel: Pixel) => Pixel`                                                                                         | OKLab, rescaled into the same 0-255 domain as RGB pixels.                   |
| `oklabDistance`     | `(a: RGB, b: RGB) => number`                                                                                      | Perceptual distance between two colors, roughly 0 to 1.                     |

Types: `RGB` (`{ r, g, b }`), `Pixel` (`[r, g, b]` tuple), `Oklab`
(`{ L, a, b }`), `WeightedColor`, `SplitStep`, `ColorSpace`
(`"rgb" | "oklab"`), `MedianCutOptions` (`{ colorSpace?: ColorSpace }`).

## How median cut works

Median cut starts with every pixel in one box and repeatedly splits the
box with the highest score along its widest color channel, at a point
pushed toward the middle of the wider side of that channel's range rather
than the exact median. That tends to land the cut in the gap between two
color clusters instead of through the middle of one. Early splits favor
the most populous box, which finds the dominant colors first. The final
quarter of splits weighs population by box volume, which rescues small
but visually distinct accents that population alone would ignore. Once
the target count of boxes exists, each box contributes its member pixel
closest to the box's average as a swatch, since the average itself can
fall between clusters and invent a color absent from the source image.

## What the OKLab option changes

By default, box splits and scores run on raw RGB coordinates. RGB
distances do not match how people perceive color difference: two greens
40 units apart in RGB can look clearly different, while a green and a
yellow-green 50 units apart can look nearly identical. Passing
`{ colorSpace: "oklab" }` runs the same splitting logic on OKLab
coordinates instead, so the quantizer groups colors by how different they
look rather than by their raw channel values. The colors returned are
still always real source pixels; converting back from OKLab is never
needed for the output.

## Demo

See it running on real images at the
[Palette Extractor live demo](https://palette-extractor.samalbanese.workers.dev/).
