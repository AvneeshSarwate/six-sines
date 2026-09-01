import { ClapNoteExpression, SixSinesEventType, SixSinesNode } from "./six-sines-node.js";

const resultElement = document.querySelector("#result");

function rms(signal, begin, end) {
  let sum = 0;
  for (let i = begin; i < end; ++i) sum += signal[i] * signal[i];
  return Math.sqrt(sum / (end - begin));
}

function relativeDifference(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-12);
}

async function run() {
  const totalFrames = 24_576;
  const context = new OfflineAudioContext(2, totalFrames, 48_000);
  const synth = await SixSinesNode.create(context, {
    wasmUrl: "./six-sines.wasm",
    workletUrl: "./six-sines-worklet.js",
  });
  const presetBytes = await fetch("./init.sxsnp").then((response) => response.arrayBuffer());
  await synth.loadPreset(presetBytes);
  synth.connect(context.destination);
  const perNoteFlag = 1 << 11;
  const perNoteIds = (await synth.getParameterInfo())
    .filter((parameter) => parameter.flags & perNoteFlag)
    .map((parameter) => parameter.id);
  const expectedPerNoteIds = [40_000, 40_250, 40_500, 40_750, 41_000, 41_250];
  if (JSON.stringify(perNoteIds) !== JSON.stringify(expectedPerNoteIds)) {
    throw new Error(`unexpected per-note parameters: ${JSON.stringify(perNoteIds)}`);
  }

  const value = (frame, paramId, amount) =>
    ({ frame, type: SixSinesEventType.paramValue, paramId, value: amount });
  const events = [
    value(0, 500, 0.5),
    value(0, 506, 1),
    value(0, 522, 0),
    value(0, 529, 0),
    value(0, 532, 0),
    value(0, 620, 410),
    value(0, 621, 1),
    value(0, 650, 10),
    { frame: 512, type: SixSinesEventType.noteOn, noteId: 101, key: 60, value: 0.8 },
    { frame: 512, type: SixSinesEventType.noteExpression, noteId: 101, key: 60,
      expressionId: ClapNoteExpression.pan, value: 0 },
    { frame: 512, type: SixSinesEventType.noteOn, noteId: 102, key: 60, value: 0.8 },
    { frame: 512, type: SixSinesEventType.noteExpression, noteId: 102, key: 60,
      expressionId: ClapNoteExpression.pan, value: 1 },
    { frame: 8_192, type: SixSinesEventType.paramMod, noteId: 101, key: 60,
      paramId: 40_000, value: 0.7 },
    { frame: 13_312, type: SixSinesEventType.paramMod, noteId: 102, key: 60,
      paramId: 40_000, value: -0.4 },
    { frame: 18_432, type: SixSinesEventType.paramMod, noteId: 9_999, key: 60,
      paramId: 40_000, value: 0.9 },
  ];
  const queued = await synth.schedule(events);
  if (queued.accepted !== events.length || queued.rejected !== 0) {
    throw new Error(`worklet rejected events: ${JSON.stringify(queued)}`);
  }
  const rendered = await context.startRendering();
  const stats = await synth.stats();
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);

  const controlLeft = rms(left, 4_096, 7_168);
  const controlRight = rms(right, 4_096, 7_168);
  const modALeft = rms(left, 9_216, 12_288);
  const modARight = rms(right, 9_216, 12_288);
  const dualLeft = rms(left, 14_336, 17_408);
  const dualRight = rms(right, 14_336, 17_408);
  const unknownLeft = rms(left, 19_456, 22_528);
  const unknownRight = rms(right, 19_456, 22_528);
  const report = {
    test: "macro-per-note-audio-worklet-chromium",
    status: "pass",
    ready_frame: synth.readyInfo.frame,
    preset_load_via_message: true,
    per_note_parameter_count: perNoteIds.length,
    control_left_rms: controlLeft,
    control_right_rms: controlRight,
    worklet_stats: stats,
    mod_a_addressed_relative_change: relativeDifference(controlLeft, modALeft),
    mod_a_other_relative_change: relativeDifference(controlRight, modARight),
    mod_b_addressed_relative_change: relativeDifference(modARight, dualRight),
    mod_b_other_relative_change: relativeDifference(modALeft, dualLeft),
    unknown_left_relative_change: relativeDifference(dualLeft, unknownLeft),
    unknown_right_relative_change: relativeDifference(dualRight, unknownRight),
  };
  if (!(controlLeft > 1e-5 && controlRight > 1e-5 &&
        report.mod_a_addressed_relative_change > 0.20 &&
        report.mod_a_other_relative_change < 0.05 &&
        report.mod_b_addressed_relative_change > 0.20 &&
        report.mod_b_other_relative_change < 0.05 &&
        report.unknown_left_relative_change < 0.05 &&
        report.unknown_right_relative_change < 0.05)) {
    throw new Error(`audio assertions failed: ${JSON.stringify(report)}`);
  }
  await synth.dispose();
  return report;
}

try {
  const report = await run();
  globalThis.__sixSinesSmoke = report;
  resultElement.textContent = JSON.stringify(report, null, 2);
  document.body.dataset.status = "pass";
} catch (error) {
  const report = { status: "fail", error: String(error?.stack ?? error) };
  globalThis.__sixSinesSmoke = report;
  resultElement.textContent = JSON.stringify(report, null, 2);
  document.body.dataset.status = "fail";
}
