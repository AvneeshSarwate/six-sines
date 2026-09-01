import { ClapNoteExpression, SixSinesEventType, SixSinesNode } from "./six-sines-node.js";

const resultElement = document.querySelector("#result");
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const query = new URLSearchParams(location.search);
const requestedSampleRate = Number(query.get("sampleRate") ?? 0);
const phaseMilliseconds = Number(query.get("phaseMs") ?? 2_000);

async function run() {
  const contextOptions = { latencyHint: "interactive" };
  if (requestedSampleRate) contextOptions.sampleRate = requestedSampleRate;
  const context = new AudioContext(contextOptions);
  const buildManifest = await fetch("./six-sines-build.json").then((response) => {
    if (!response.ok) throw new Error(`build manifest fetch failed: ${response.status}`);
    return response.json();
  });
  const synth = await SixSinesNode.create(context, {
    wasmUrl: "./six-sines.wasm",
    workletUrl: "./six-sines-worklet.js",
  });
  const analyser = new AnalyserNode(context, { fftSize: 256 });
  const mutedOutput = new GainNode(context, { gain: 0 });
  const samples = new Float32Array(analyser.fftSize);
  const initPreset = await fetch("./init.sxsnp").then((response) => response.arrayBuffer());
  const replacementPreset = await fetch("./realtime-replacement.sxsnp")
    .then((response) => response.arrayBuffer());
  let peak = 0;
  let noteId = 10_000;
  let sentEventCount = 0;
  let acceptedEventCount = 0;
  let pumpEnabled = true;
  const failures = [];
  const inFlight = new Set();
  const pendingNoteOffs = new Set();

  const track = (promise) => {
    const tracked = promise.then((response) => {
      acceptedEventCount += response.accepted;
    }).catch((error) => failures.push(String(error?.stack ?? error)))
      .finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
    return tracked;
  };
  const configure = () => {
    const values = [
      [500, 0.2], [506, 1], [522, 0], [526, 8], [529, 0], [532, 0],
      [620, 410], [621, 1], [650, 10],
    ].map(([paramId, value]) => ({ type: SixSinesEventType.paramValue, paramId, value }));
    sentEventCount += values.length;
    return track(synth.send(values));
  };

  try {
    if (!synth.readyInfo.buildId || synth.readyInfo.buildId !== buildManifest.sourceId) {
      throw new Error(`build identity mismatch: ${JSON.stringify({
        worklet: synth.readyInfo.buildId,
        manifest: buildManifest.sourceId,
      })}`);
    }
    await synth.loadPreset(initPreset);
    synth.connect(analyser);
    analyser.connect(mutedOutput).connect(context.destination);
    await context.resume();
    if (context.state !== "running") throw new Error(`AudioContext did not start: ${context.state}`);
    await configure();
    const before = await synth.stats();

    const meter = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    }, 20);
    const pump = setInterval(() => {
      if (!pumpEnabled || context.state !== "running") return;
      const currentNoteId = noteId++;
      const key = 36 + currentNoteId % 49;
      const pan = (currentNoteId % 101) / 100;
      const events = [
        { type: SixSinesEventType.noteOn, noteId: currentNoteId, key, value: 0.65 },
        { type: SixSinesEventType.noteExpression, noteId: currentNoteId, key,
          expressionId: ClapNoteExpression.pan, value: pan },
        { type: SixSinesEventType.paramMod, noteId: currentNoteId, key,
          paramId: 40_000, value: ((currentNoteId % 21) - 10) / 10 },
      ];
      sentEventCount += events.length;
      track(synth.send(events));
      const timeout = setTimeout(() => {
        pendingNoteOffs.delete(timeout);
        ++sentEventCount;
        track(synth.noteOff({ noteId: currentNoteId, key }));
      }, 140);
      pendingNoteOffs.add(timeout);
    }, 25);

    await delay(phaseMilliseconds);
    pumpEnabled = false;
    await context.suspend();
    const suspended = await synth.stats();
    await delay(250);
    await context.resume();
    pumpEnabled = true;

    await delay(phaseMilliseconds);
    pumpEnabled = false;
    await synth.loadPreset(replacementPreset);
    await configure();
    pumpEnabled = true;

    await delay(phaseMilliseconds);
    pumpEnabled = false;
    synth.disconnect();
    const disconnected = await synth.stats();
    await delay(250);
    synth.connect(analyser);
    pumpEnabled = true;

    await delay(phaseMilliseconds);
    pumpEnabled = false;
    clearInterval(pump);
    for (const timeout of pendingNoteOffs) clearTimeout(timeout);
    pendingNoteOffs.clear();
    ++sentEventCount;
    const allNotesOffResponse = await synth.allNotesOff();
    acceptedEventCount += allNotesOffResponse.accepted;
    await Promise.all(inFlight);
    await delay(250);
    clearInterval(meter);
    const after = await synth.stats();

    const advancedFrames = after.renderFrame - before.renderFrame;
    const minimumActiveSeconds = phaseMilliseconds * 4 / 1_000 * 0.75;
    if (!(advancedFrames > context.sampleRate * minimumActiveSeconds &&
          after.queuedEventCount === 0 && after.immediateQueuedEventCount === 0 &&
          after.scheduledQueuedEventCount === 0 && after.lateEventCount === 0 &&
          after.overflowEventCount === 0 && after.outOfOrderEventCount === 0 &&
          after.memoryGrowthCount === 0 && acceptedEventCount === sentEventCount &&
          peak > 1e-5 && failures.length === 0 && !synth.lastError)) {
      throw new Error(`real-time assertions failed: ${JSON.stringify({
        before, suspended, disconnected, after, advancedFrames, peak,
        sentEventCount, acceptedEventCount, failures,
      })}`);
    }
    return {
      test: "six-sines-audio-worklet-realtime-hardening",
      status: "pass",
      requested_sample_rate: requestedSampleRate || "device-default",
      actual_sample_rate: context.sampleRate,
      build_id: synth.readyInfo.buildId,
      immediate_api: true,
      preset_replacement: true,
      suspend_resume: true,
      disconnect_reconnect: true,
      advanced_frames: advancedFrames,
      observed_peak: peak,
      sent_event_count: sentEventCount,
      accepted_event_count: acceptedEventCount,
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
  globalThis.__sixSinesRealtimeHardening = report;
  resultElement.textContent = JSON.stringify(report, null, 2);
  document.body.dataset.status = "pass";
} catch (error) {
  const report = { status: "fail", error: String(error?.stack ?? error) };
  globalThis.__sixSinesRealtimeHardening = report;
  resultElement.textContent = JSON.stringify(report, null, 2);
  document.body.dataset.status = "fail";
}
