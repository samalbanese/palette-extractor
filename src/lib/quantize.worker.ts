import { runExtraction, type WorkerRequest } from "./extraction";

export type { WorkerRequest };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const { message, transfer } = runExtraction(event.data);
    self.postMessage(message, { transfer });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Could not extract image colors.",
    });
  }
};
