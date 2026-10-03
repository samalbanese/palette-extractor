import {
  bitReversalOrder,
  coverTransform,
  imagePoint,
  TILT,
  viewScale,
  type ViewFit,
} from "./math";
import { prepare, yieldTask, type Renderer } from "./data";
import {
  DEPTH_FADE,
  DEPTH_GROW,
  depthReach,
  FOCUS_FADE,
  FOCUS_GROW,
  FOCUS_SHRINK,
  REST_FADE,
  restSize,
} from "./look";
import type { StageSamples } from "../lib/extraction";

// A number as a GLSL float literal, so a whole number stays a float.
const glsl = (n: number) => n.toFixed(6);

const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 aFrame;
layout(location=1) in vec3 aCube;
layout(location=2) in vec3 aColor;
layout(location=3) in float aGroup;
uniform vec2 uSize;
uniform vec4 uTime;
uniform vec4 uView;
uniform vec4 uLook;
uniform vec3 uColors[32];
uniform float uLit[32];
out vec4 vColor;
vec2 projectPoint(vec3 p) {
  float x = p.x*cos(uView.x)+p.z*sin(uView.x);
  float z = -p.x*sin(uView.x)+p.z*cos(uView.x);
  float y = p.y*${Math.cos(TILT)}-z*${Math.sin(TILT)};
  return uSize*.5+vec2(x,-y)*uView.w;
}
void main() {
  int g = int(aGroup);
  float tint = uTime.y*(1.-uTime.w);
  float turned = -aCube.x*sin(uView.x)+aCube.z*cos(uView.x);
  float near = clamp((aCube.y*${glsl(Math.sin(TILT))}+turned*${glsl(Math.cos(TILT))})*uLook.y,-1.,1.);
  float lit = uLit[g];
  vec2 position = mix(aFrame,projectPoint(aCube),uTime.x);
  gl_Position = vec4(position/uSize*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);
  gl_PointSize = uView.y*mix(uView.z,uLook.x,uTime.x)
    *(1.+${glsl(DEPTH_GROW)}*near*uTime.x)
    *(1.+(${glsl(FOCUS_GROW)}*lit-${glsl(FOCUS_SHRINK)}*(1.-lit))*uLook.z);
  float alpha = (1.-${glsl(REST_FADE)}*uTime.w)
    *(1.-${glsl(DEPTH_FADE)}*(1.-near)*uTime.x*.5)
    *(1.-${glsl(FOCUS_FADE)}*(1.-lit)*uLook.z);
  vColor = vec4(mix(aColor,uColors[g],tint),alpha);
}`;
const fragment = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 color;
void main() {
  float radius = length(gl_PointCoord-.5)*2.;
  if(radius>1.) discard;
  float edge = 1.-smoothstep(.65,1.,radius);
  color = vec4(vColor.rgb,vColor.a*edge);
}`;

const noneLit = new Float32Array(32);

export function create(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    // The blend below leaves premultiplied color in the buffer.
    premultipliedAlpha: true,
    // Keeps the last frame readable, so a paused or finished cloud can be
    // copied (and compared) after it has been composited.
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const program = gl.createProgram()!;
  const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, i) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, i ? fragment : vertex);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    shaders.forEach((shader) => gl.deleteShader(shader));
    gl.deleteProgram(program);
    return null;
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffers = [2, 3, 3, 1].map((size, location) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return buffer;
  });
  const uniforms = Object.fromEntries(
    ["Size", "Time", "View", "Look", "Colors", "Lit"].map((name) => [
      name,
      gl.getUniformLocation(program, `u${name}`),
    ]),
  );
  let width = 1,
    height = 1,
    dpr = 1;
  let samples: StageSamples | undefined;
  let fit: ViewFit | undefined;
  let order: Uint32Array = new Uint32Array(0);
  let disposed = false;
  let lost = () => {};
  const onLost = (event: Event) => {
    event.preventDefault();
    lost();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  const upload = (index: number, values: Float32Array) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[index]);
    gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
  };
  const framePositions = () => {
    if (!samples) return;
    const cover = coverTransform(samples.width, samples.height, width, height);
    const frame = new Float32Array(order.length * 2);
    order.forEach((i, j) =>
      frame.set(
        imagePoint(
          samples!.positions[2 * i],
          samples!.positions[2 * i + 1],
          cover,
        ),
        2 * j,
      ),
    );
    upload(0, frame);
  };
  return {
    async setSamples(next, space, nextFit) {
      samples = next;
      order = bitReversalOrder(next.groups.length);
      const colors = new Float32Array(order.length * 3);
      const groups = new Float32Array(order.length);
      order.forEach((i, j) => {
        for (let k = 0; k < 3; k++)
          colors[j * 3 + k] = next.colors[i * 3 + k] / 255;
        groups[j] = next.groups[i];
      });
      framePositions();
      upload(2, colors);
      upload(3, groups);
      await yieldTask();
      const data = prepare(next, space, nextFit);
      if (disposed) return data;
      fit = data.fit;
      const cube = new Float32Array(data.cube.length);
      order.forEach((i, j) =>
        cube.set(data.cube.subarray(i * 3, i * 3 + 3), j * 3),
      );
      upload(1, cube);
      const groupColors = new Float32Array(96);
      next.groupColors.forEach((c, i) =>
        groupColors.set([c.r / 255, c.g / 255, c.b / 255], i * 3),
      );
      gl.useProgram(program);
      gl.uniform3fv(uniforms.Colors, groupColors);
      return data;
    },
    resize(w, h, ratio) {
      width = w;
      height = h;
      dpr = ratio;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
      framePositions();
    },
    draw(state) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      // Color is premultiplied by the point's alpha and the canvas's own
      // alpha adds up as coverage, so a point drawn at 50% shows at 50%.
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      gl.uniform2f(uniforms.Size, width, height);
      gl.uniform4f(
        uniforms.Time,
        state.toCloud,
        state.converge,
        state.flight,
        state.release,
      );
      const pitch = samples
        ? Math.max(width / samples.width, height / samples.height) *
          Math.sqrt(
            (samples.width * samples.height) /
              Math.min(state.points, order.length),
          )
        : 2;
      gl.uniform4f(
        uniforms.View,
        state.angle,
        dpr,
        pitch * 1.35,
        fit ? viewScale(width, height, fit, state.angle, state.boxes) : 0,
      );
      gl.uniform4f(
        uniforms.Look,
        restSize(width, height),
        fit ? 1 / depthReach(fit) : 0,
        state.focus ?? 0,
        0,
      );
      gl.uniform1fv(uniforms.Lit, state.lit ?? noneLit);
      gl.drawArrays(gl.POINTS, 0, Math.min(state.points, order.length));
    },
    onContextLost(callback) {
      lost = callback;
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      buffers.forEach((buffer) => gl.deleteBuffer(buffer));
      shaders.forEach((shader) => gl.deleteShader(shader));
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
