import { analyzeFiles } from "./scanner";
self.onmessage = (event) => {
  try {
    self.postMessage({
      result: analyzeFiles(event.data.files, event.data.name, event.data.path),
    });
  } catch {
    self.postMessage({ error: "Could not analyze this repository." });
  }
};
