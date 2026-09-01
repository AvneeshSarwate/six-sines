/*
 * Six Sines
 * Portable, CLAP-shaped owner/dispatcher around the DSP engine.
 */

#include "headless/engine_facade.h"

#include <algorithm>
#include <cstring>
#include <exception>

#include "configuration.h"
#include "synth/patch.h"
#include "synth/synth.h"

namespace baconpaul::six_sines::headless
{
EngineFacade::EngineFacade(double sampleRate) : engine(std::make_unique<Synth>(false))
{
    engine->suppressMainThreadParamEcho = true;
    engine->patch.copyValuesFrom(engine->patchMain);
    engine->setSampleRate(sampleRate);
}

EngineFacade::~EngineFacade() = default;

bool EngineFacade::loadPreset(std::string_view utf8State)
{
    auto loaded = std::make_unique<Patch>();
    if (!loaded->fromState(std::string(utf8State)))
        return false;

    engine->voiceManager->allSoundsOff();
    engine->patchMain.copyValuesFrom(*loaded);
    engine->patch.copyValuesFrom(*loaded);
    engine->postLoad();
    blockPosition = 0;
    pendingEventCount = 0;
    return true;
}

uint32_t EngineFacade::paramCount() const
{
    return static_cast<uint32_t>(engine->patchMain.params.size());
}

bool EngineFacade::paramInfo(uint32_t index, sx_param_info &out) const
{
    if (index >= engine->patchMain.params.size())
        return false;

    const auto &meta = engine->patchMain.params[index]->meta;
    out = {};
    out.id = meta.id;
    out.flags = static_cast<uint32_t>(meta.flags);
    out.min_value = meta.minVal;
    out.max_value = meta.maxVal;
    out.default_value = meta.defaultVal;
    std::strncpy(out.name, meta.name.c_str(), sizeof(out.name) - 1);
    return true;
}

void EngineFacade::dispatch(const sx_event &event)
{
    auto &vm = *engine->voiceManager;
    switch (event.type)
    {
    case SX_EVENT_NOTE_ON:
        vm.processNoteOnEvent(event.port, event.channel, event.key, event.note_id,
                              static_cast<float>(event.value), 0.f);
        break;
    case SX_EVENT_NOTE_OFF:
        vm.processNoteOffEvent(event.port, event.channel, event.key, event.note_id,
                               static_cast<float>(event.value));
        break;
    case SX_EVENT_NOTE_EXPRESSION:
        vm.routeNoteExpression(event.port, event.channel, event.key, event.note_id,
                               event.expression_id, event.value);
        break;
    case SX_EVENT_PARAM_VALUE:
    {
        auto found = engine->patch.paramMap.find(event.param_id);
        if (found != engine->patch.paramMap.end())
            engine->handleParamValue(found->second, event.param_id, static_cast<float>(event.value));
        break;
    }
    case SX_EVENT_PARAM_MOD:
        engine->handlePolyphonicParamMod(event.port, event.channel, event.key, event.note_id,
                                         event.param_id, event.value);
        break;
    case SX_EVENT_ALL_NOTES_OFF:
        vm.allSoundsOff();
        break;
    default:
        break;
    }
}

bool EngineFacade::process(uint32_t frames, const float *inputLeft, const float *inputRight,
                           float *outputLeft, float *outputRight, const sx_event *events,
                           uint32_t eventCount)
{
    if (!outputLeft || !outputRight || (eventCount && !events))
        return false;
    for (uint32_t index = 0; index < eventCount; ++index)
    {
        if (events[index].frame >= frames ||
            (index && events[index].frame < events[index - 1].frame))
            return false;
    }

    uint32_t nextEvent{0};
    for (uint32_t frame = 0; frame < frames; ++frame)
    {
        engine->pushAudioIn(inputLeft ? inputLeft[frame] : 0.f,
                            inputRight ? inputRight[frame] : 0.f);

        if (blockPosition == 0)
        {
            for (uint32_t index = 0; index < pendingEventCount; ++index)
                dispatch(pendingEvents[index]);
            pendingEventCount = 0;
            while (nextEvent < eventCount && events[nextEvent].frame <= frame)
                dispatch(events[nextEvent++]);
            engine->process(nullptr);
        }

        outputLeft[frame] = engine->output[0][blockPosition];
        outputRight[frame] = engine->output[1][blockPosition];
        blockPosition = (blockPosition + 1) % blockSize;
    }

    const auto remaining = eventCount - nextEvent;
    if (remaining > pendingEventCapacity - pendingEventCount)
        return false;
    for (; nextEvent < eventCount; ++nextEvent)
        pendingEvents[pendingEventCount++] = events[nextEvent];

    return true;
}

Synth &EngineFacade::synth() { return *engine; }
const Synth &EngineFacade::synth() const { return *engine; }
} // namespace baconpaul::six_sines::headless

using baconpaul::six_sines::headless::EngineFacade;

extern "C"
{
uint32_t sx_event_sizeof(void) { return sizeof(sx_event); }
uint32_t sx_param_info_sizeof(void) { return sizeof(sx_param_info); }
const char *sx_get_build_id(void)
{
#ifdef SIX_SINES_PORT_BUILD_ID
    return SIX_SINES_PORT_BUILD_ID;
#else
    return "unknown";
#endif
}

sx_handle sx_create(double sampleRate)
{
    try
    {
        return new EngineFacade(sampleRate);
    }
    catch (...)
    {
        return nullptr;
    }
}

void sx_destroy(sx_handle handle) { delete static_cast<EngineFacade *>(handle); }

int32_t sx_load_preset_utf8(sx_handle handle, const uint8_t *bytes, uint32_t size)
{
    if (!handle || (!bytes && size))
        return 0;
    try
    {
        return static_cast<EngineFacade *>(handle)->loadPreset(
                   std::string_view(reinterpret_cast<const char *>(bytes), size))
                   ? 1
                   : 0;
    }
    catch (...)
    {
        return 0;
    }
}

uint32_t sx_get_param_count(sx_handle handle)
{
    return handle ? static_cast<EngineFacade *>(handle)->paramCount() : 0;
}

int32_t sx_get_param_info(sx_handle handle, uint32_t index, sx_param_info *out)
{
    return handle && out && static_cast<EngineFacade *>(handle)->paramInfo(index, *out) ? 1 : 0;
}

int32_t sx_process(sx_handle handle, uint32_t frames, const float *inputLeft,
                   const float *inputRight, float *outputLeft, float *outputRight,
                   const sx_event *events, uint32_t eventCount)
{
    if (!handle)
        return 0;
    try
    {
        return static_cast<EngineFacade *>(handle)->process(frames, inputLeft, inputRight,
                                                            outputLeft, outputRight, events,
                                                            eventCount)
                   ? 1
                   : 0;
    }
    catch (...)
    {
        return 0;
    }
}
}
