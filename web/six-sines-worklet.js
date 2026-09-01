import createSixSinesModule from "./six-sines.js";

const EVENT_SIZE = 40;
const DEFAULT_QUEUE_CAPACITY = 4096;
const DEFAULT_EVENTS_PER_QUANTUM = 256;
const DEFAULT_MAX_FRAMES = 2048;

class SixSinesProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options.processorOptions ?? {};
    this.maxFrames = processorOptions.maxFrames ?? DEFAULT_MAX_FRAMES;
    this.maxEventsPerQuantum = processorOptions.maxEventsPerQuantum ?? DEFAULT_EVENTS_PER_QUANTUM;
    this.queueCapacity = processorOptions.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;
    this.renderFrame = Number(globalThis.currentFrame ?? 0);
    this.ready = false;
    this.failed = false;
    this.lateEventCount = 0;
    this.overflowEventCount = 0;
    this.outOfOrderEventCount = 0;
    this.memoryGrowthCount = 0;

    this.queueFrame = new Float64Array(this.queueCapacity);
    this.queueType = new Uint32Array(this.queueCapacity);
    this.queueNoteId = new Int32Array(this.queueCapacity);
    this.queuePort = new Int16Array(this.queueCapacity);
    this.queueChannel = new Int16Array(this.queueCapacity);
    this.queueKey = new Int16Array(this.queueCapacity);
    this.queueParamId = new Uint32Array(this.queueCapacity);
    this.queueExpressionId = new Int32Array(this.queueCapacity);
    this.queueValue = new Float64Array(this.queueCapacity);
    this.queueHead = 0;
    this.queueCount = 0;

    this.port.onmessage = ({ data }) => this.onMessage(data);
    this.initialize(processorOptions).catch((error) => {
      this.failed = true;
      this.port.postMessage({ type: "error", message: String(error?.stack ?? error) });
    });
  }

  async initialize(options) {
    if (!options.wasmBytes) throw new Error("SixSinesProcessor requires processorOptions.wasmBytes");
    this.wasm = await createSixSinesModule({ wasmBinary: new Uint8Array(options.wasmBytes) });
    this.handle = this.wasm._sx_create(sampleRate);
    if (!this.handle) throw new Error("sx_create failed");
    if (this.wasm._sx_event_sizeof() !== EVENT_SIZE) throw new Error("unexpected sx_event ABI");

    this.inputLeftPointer = this.wasm._malloc(this.maxFrames * 4);
    this.inputRightPointer = this.wasm._malloc(this.maxFrames * 4);
    this.outputLeftPointer = this.wasm._malloc(this.maxFrames * 4);
    this.outputRightPointer = this.wasm._malloc(this.maxFrames * 4);
    this.eventPointer = this.wasm._malloc(this.maxEventsPerQuantum * EVENT_SIZE);
    this.paramInfoSize = this.wasm._sx_param_info_sizeof();
    this.paramInfoPointer = this.wasm._malloc(this.paramInfoSize);
    if (!this.inputLeftPointer || !this.inputRightPointer || !this.outputLeftPointer ||
        !this.outputRightPointer || !this.eventPointer || !this.paramInfoPointer) {
      throw new Error("worklet buffer allocation failed");
    }
    if (options.presetBytes) this.loadPreset(new Uint8Array(options.presetBytes));
    this.refreshEventView();
    this.ready = true;
    this.port.postMessage({ type: "ready", frame: this.renderFrame });
  }

  loadPreset(bytes) {
    const pointer = this.wasm._malloc(bytes.byteLength);
    if (!pointer) throw new Error("preset allocation failed");
    try {
      this.wasm.HEAPU8.set(bytes, pointer);
      if (!this.wasm._sx_load_preset_utf8(this.handle, pointer, bytes.byteLength)) {
        throw new Error("sx_load_preset_utf8 failed");
      }
    } finally {
      this.wasm._free(pointer);
    }
    if (this.eventPointer) this.refreshEventView();
  }

  refreshEventView() {
    this.eventView = new DataView(this.wasm.HEAPU8.buffer, this.eventPointer,
      this.maxEventsPerQuantum * EVENT_SIZE);
  }

  onMessage(message) {
    try {
      if (message?.type === "events") {
        let accepted = 0;
        for (const event of message.events ?? []) accepted += this.enqueue(event) ? 1 : 0;
        this.port.postMessage({
          type: "eventsQueued",
          requestId: message.requestId,
          accepted,
          rejected: (message.events?.length ?? 0) - accepted,
        });
      } else if (message?.type === "loadPreset") {
        if (!this.ready) throw new Error("cannot load a replacement preset before ready");
        this.loadPreset(new Uint8Array(message.bytes));
        this.port.postMessage({ type: "presetLoaded", requestId: message.requestId });
      } else if (message?.type === "stats") {
        this.postStats(message.requestId);
      } else if (message?.type === "parameterInfo") {
        this.port.postMessage({
          type: "parameterInfo",
          requestId: message.requestId,
          parameters: this.getParameterInfo(),
        });
      } else if (message?.type === "dispose" && this.ready) {
        for (const pointer of [this.paramInfoPointer, this.eventPointer,
          this.outputRightPointer, this.outputLeftPointer,
          this.inputRightPointer, this.inputLeftPointer]) {
          this.wasm._free(pointer);
        }
        this.wasm._sx_destroy(this.handle);
        this.ready = false;
        this.port.postMessage({ type: "disposed", requestId: message.requestId });
      }
    } catch (error) {
      this.port.postMessage({
        type: "error",
        requestId: message?.requestId,
        message: String(error?.stack ?? error),
      });
    }
  }

  getParameterInfo() {
    const parameters = [];
    const count = this.wasm._sx_get_param_count(this.handle);
    for (let index = 0; index < count; ++index) {
      if (!this.wasm._sx_get_param_info(this.handle, index, this.paramInfoPointer)) {
        throw new Error(`sx_get_param_info failed at index ${index}`);
      }
      const view = new DataView(this.wasm.HEAPU8.buffer, this.paramInfoPointer,
        this.paramInfoSize);
      let nameEnd = 32;
      while (nameEnd < this.paramInfoSize && view.getUint8(nameEnd)) ++nameEnd;
      let name = "";
      for (let at = 32; at < nameEnd; ++at) name += String.fromCharCode(view.getUint8(at));
      parameters.push({
        id: view.getUint32(0, true),
        flags: view.getUint32(4, true),
        minValue: view.getFloat64(8, true),
        maxValue: view.getFloat64(16, true),
        defaultValue: view.getFloat64(24, true),
        name,
      });
    }
    return parameters;
  }

  enqueue(event) {
    if (this.queueCount === this.queueCapacity) {
      ++this.overflowEventCount;
      return false;
    }
    const frame = Number(event.frame);
    if (!Number.isSafeInteger(frame) || frame < 0) throw new Error(`invalid event frame ${event.frame}`);
    if (this.queueCount) {
      const last = (this.queueHead + this.queueCount - 1) % this.queueCapacity;
      if (frame < this.queueFrame[last]) {
        ++this.outOfOrderEventCount;
        return false;
      }
    }
    const at = (this.queueHead + this.queueCount) % this.queueCapacity;
    this.queueFrame[at] = frame;
    this.queueType[at] = event.type;
    this.queueNoteId[at] = event.noteId ?? -1;
    this.queuePort[at] = event.port ?? 0;
    this.queueChannel[at] = event.channel ?? 0;
    this.queueKey[at] = event.key ?? -1;
    this.queueParamId[at] = event.paramId ?? 0;
    this.queueExpressionId[at] = event.expressionId ?? 0;
    this.queueValue[at] = event.value ?? 0;
    ++this.queueCount;
    return true;
  }

  writeEvent(source, destination, localFrame) {
    const at = destination * EVENT_SIZE;
    this.eventView.setUint32(at + 0, localFrame, true);
    this.eventView.setUint32(at + 4, this.queueType[source], true);
    this.eventView.setInt32(at + 8, this.queueNoteId[source], true);
    this.eventView.setInt16(at + 12, this.queuePort[source], true);
    this.eventView.setInt16(at + 14, this.queueChannel[source], true);
    this.eventView.setInt16(at + 16, this.queueKey[source], true);
    this.eventView.setInt16(at + 18, 0, true);
    this.eventView.setUint32(at + 20, this.queueParamId[source], true);
    this.eventView.setInt32(at + 24, this.queueExpressionId[source], true);
    this.eventView.setFloat64(at + 32, this.queueValue[source], true);
  }

  postStats(requestId) {
    this.port.postMessage({
      type: "stats",
      requestId,
      renderFrame: this.renderFrame,
      queuedEventCount: this.queueCount,
      lateEventCount: this.lateEventCount,
      overflowEventCount: this.overflowEventCount,
      outOfOrderEventCount: this.outOfOrderEventCount,
      memoryGrowthCount: this.memoryGrowthCount,
    });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const frames = output?.[0]?.length ?? 0;
    if (!frames) return true;
    if (!this.ready || this.failed || frames > this.maxFrames) {
      for (const channel of output) channel.fill(0);
      this.renderFrame += frames;
      return true;
    }

    const input = inputs[0];
    const heap = this.wasm.HEAPF32;
    const inputLeftAt = this.inputLeftPointer >> 2;
    const inputRightAt = this.inputRightPointer >> 2;
    for (let frame = 0; frame < frames; ++frame) {
      heap[inputLeftAt + frame] = input?.[0]?.[frame] ?? 0;
      heap[inputRightAt + frame] = input?.[1]?.[frame] ?? input?.[0]?.[frame] ?? 0;
    }

    const quantumEnd = this.renderFrame + frames;
    let eventCount = 0;
    while (this.queueCount && this.queueFrame[this.queueHead] < quantumEnd &&
           eventCount < this.maxEventsPerQuantum) {
      const absoluteFrame = this.queueFrame[this.queueHead];
      const localFrame = absoluteFrame < this.renderFrame ? 0 : absoluteFrame - this.renderFrame;
      if (absoluteFrame < this.renderFrame) ++this.lateEventCount;
      this.writeEvent(this.queueHead, eventCount++, localFrame);
      this.queueHead = (this.queueHead + 1) % this.queueCapacity;
      --this.queueCount;
    }
    if (this.queueCount && this.queueFrame[this.queueHead] < quantumEnd) ++this.overflowEventCount;

    const ok = this.wasm._sx_process(this.handle, frames, this.inputLeftPointer,
      this.inputRightPointer, this.outputLeftPointer, this.outputRightPointer,
      this.eventPointer, eventCount);
    if (!ok) {
      this.failed = true;
      for (const channel of output) channel.fill(0);
      this.port.postMessage({ type: "error", message: "sx_process failed" });
      return true;
    }

    const outputHeap = this.wasm.HEAPF32;
    if (outputHeap.buffer !== heap.buffer) {
      ++this.memoryGrowthCount;
      this.refreshEventView();
    }
    const leftAt = this.outputLeftPointer >> 2;
    const rightAt = this.outputRightPointer >> 2;
    for (let frame = 0; frame < frames; ++frame) {
      output[0][frame] = outputHeap[leftAt + frame];
      if (output[1]) output[1][frame] = outputHeap[rightAt + frame];
    }
    this.renderFrame = quantumEnd;
    return true;
  }
}

registerProcessor("six-sines", SixSinesProcessor);
