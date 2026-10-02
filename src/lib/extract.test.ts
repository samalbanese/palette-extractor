import { describe, expect, it } from "vitest";
import { runInWorker, type ExtractionDetail, type WorkerLike } from "./extract";
import type { WorkerRequest } from "./extraction";

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  terminated = false;
  received: unknown[] = [];
  postMessage(message: unknown) {
    this.received.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const request: WorkerRequest = {
  buffer: new ArrayBuffer(4),
  width: 1,
  height: 1,
  count: 6,
  exclude: [],
  colorSpace: "rgb",
};

const detail = (r: number): ExtractionDetail => ({
  colors: [{ color: { r, g: 0, b: 0 }, population: 1 }],
  pixels: [],
  steps: [],
  samples: {
    width: 1,
    height: 1,
    positions: new Uint16Array(2),
    colors: new Uint8Array([r, 0, 0]),
    groups: new Uint8Array(1),
    boxes: new Uint8Array(0),
    groupColors: [{ r, g: 0, b: 0 }],
  },
});

describe("runInWorker", () => {
  it("terminates the worker when posting the request throws", async () => {
    const worker = new FakeWorker();
    const error = new DOMException(
      "Could not clone the request.",
      "DataCloneError",
    );
    worker.postMessage = () => {
      throw error;
    };
    const run = runInWorker(request, [], undefined, () => worker);
    await expect(run).rejects.toBe(error);
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it("posts the request and resolves with the worker's reply", async () => {
    const worker = new FakeWorker();
    const run = runInWorker(request, [], undefined, () => worker);
    expect(worker.received).toEqual([request]);
    const reply = detail(10);
    worker.reply(reply);
    expect(await run).toBe(reply);
    expect(worker.terminated).toBe(true);
  });

  it("rejects with the worker's error message", async () => {
    const worker = new FakeWorker();
    const run = runInWorker(request, [], undefined, () => worker);
    worker.reply({ error: "That image is fully transparent." });
    await expect(run).rejects.toThrow("That image is fully transparent.");
  });

  it("ignores a reply that arrives after cancelling", async () => {
    const controller = new AbortController();
    const worker = new FakeWorker();
    const run = runInWorker(request, [], controller.signal, () => worker);
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    worker.reply(detail(10)); // nothing is listening any more
  });

  it("lets only the newer of two overlapping runs resolve", async () => {
    const first = new AbortController();
    const older = new FakeWorker();
    const newer = new FakeWorker();
    const run1 = runInWorker(request, [], first.signal, () => older).catch(
      (error: unknown) => error,
    );
    first.abort();
    const run2 = runInWorker(
      request,
      [],
      new AbortController().signal,
      () => newer,
    );
    const second = detail(20);
    newer.reply(second);
    const result = await run2;
    older.reply(detail(10));
    expect(result).toBe(second);
    expect(result.samples!.colors[0]).toBe(20);
    expect(await run1).toMatchObject({ name: "AbortError" });
  });

  it("rejects without starting a worker when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    let started = false;
    const run = runInWorker(request, [], controller.signal, () => {
      started = true;
      return new FakeWorker();
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(started).toBe(false);
  });
});
