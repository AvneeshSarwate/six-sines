import { SixSinesEventType, SixSinesNode } from "./six-sines-node.js";

const resultElement = document.querySelector("#result");
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function run() {
  const context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
  const synth = await SixSinesNode.create(context, {
    wasmUrl: "./six-sines.wasm",
    workletUrl: "./six-sines-worklet.js",
    scheduleAheadSeconds: 0.1,
  });
  try {
    const presetBytes = await fetch("./init.sxsnp").then((response) => response.arrayBuffer());
    await synth.loadPreset(presetBytes);
    synth.connect(context.destination);
    await context.resume();
    if (context.state !== "running") throw new Error(`AudioContext did not start: ${context.state}`);

    const before = await synth.stats();
    const start = Math.round((context.currentTime + 0.2) * context.sampleRate);
    await synth.schedule([
      { frame: start, type: SixSinesEventType.paramValue, paramId: 500, value: 0.25 },
      { frame: start, type: SixSinesEventType.noteOn, noteId: 701, key: 60, value: 0.7 },
      { frame: start + 9_600, type: SixSinesEventType.paramMod, noteId: 701, key: 60,
        paramId: 40_000, value: 0.6 },
      { frame: start + 24_000, type: SixSinesEventType.noteOff, noteId: 701, key: 60, value: 0 },
    ]);
    await delay(1_200);
    const after = await synth.stats();
    const advancedFrames = after.renderFrame - before.renderFrame;
    if (!(advancedFrames > context.sampleRate * 0.75 && after.queuedEventCount === 0 &&
          after.lateEventCount === 0 && after.overflowEventCount === 0 &&
          after.outOfOrderEventCount === 0 && after.memoryGrowthCount === 0 &&
          !synth.lastError)) {
      throw new Error(`real-time assertions failed: ${JSON.stringify({ before, after })}`);
    }
    return {
      test: "six-sines-audio-worklet-chromium-realtime",
      status: "pass",
      sample_rate: context.sampleRate,
      advanced_frames: advancedFrames,
      advanced_seconds: advancedFrames / context.sampleRate,
      worklet_stats: after,
    };
  } finally {
    await context.suspend();
    await synth.dispose();
    await context.close();
  }
}

try {
  const report = await run();
  globalThis.__sixSinesRealtimeSmoke = report;
  resultElement.textContent = JSON.stringify(report, null, 2);
  document.body.dataset.status = "pass";
} catch (error) {
  const report = { status: "fail", error: String(error?.stack ?? error) };
  globalThis.__sixSinesRealtimeSmoke = report;
  resultElement.textContent = JSON.stringify(report, null, 2);
  document.body.dataset.status = "fail";
}
