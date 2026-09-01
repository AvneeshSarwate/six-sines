/*
 * Six Sines
 * Native contract tests for the C/Wasm headless facade.
 */

#include "catch2/catch2.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <set>
#include <vector>

#include <clap/ext/params.h>

#include "headless/engine_facade.h"
#include "synth/patch.h"
#include "synth/synth.h"

using namespace baconpaul::six_sines;

namespace
{
constexpr uint32_t frames{24576};

double rms(const std::vector<float> &signal, uint32_t begin, uint32_t end)
{
    double sum{0.0};
    for (uint32_t i = begin; i < end; ++i)
        sum += static_cast<double>(signal[i]) * signal[i];
    return std::sqrt(sum / static_cast<double>(end - begin));
}

double relativeDifference(double a, double b)
{
    return std::abs(a - b) / std::max(std::abs(a), 1e-12);
}

sx_event event(uint32_t frame, sx_event_type type, int32_t noteId = -1, int16_t key = -1,
               uint32_t id = 0, double value = 0.0)
{
    sx_event result{};
    result.frame = frame;
    result.type = type;
    result.note_id = noteId;
    result.port = 0;
    result.channel = 0;
    result.key = key;
    result.param_id = id;
    result.value = value;
    return result;
}
} // namespace

TEST_CASE("headless facade loads preset bytes and exposes CLAP metadata", "[headless][facade]")
{
    headless::EngineFacade facade(48000.0);
    REQUIRE(facade.synth().suppressMainThreadParamEcho);
    auto statePatch = std::make_unique<Patch>();
    statePatch->output.outputGain.value = 0.375f;
    const auto state = statePatch->toState();

    REQUIRE(facade.loadPreset(state));
    REQUIRE(facade.synth().patch.output.outputGain.value == Approx(0.375f));
    REQUIRE(facade.paramCount() == facade.synth().patchMain.params.size());

    std::set<uint32_t> perNoteIds;
    for (uint32_t i = 0; i < facade.paramCount(); ++i)
    {
        sx_param_info info{};
        REQUIRE(facade.paramInfo(i, info));
        if (info.flags & CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID)
            perNoteIds.insert(info.id);
    }

    std::set<uint32_t> expected;
    for (uint32_t i = 0; i < numMacros; ++i)
        expected.insert(Patch::MacroNode::idBase + i * Patch::MacroNode::idStride);
    REQUIRE(perNoteIds == expected);
}

TEST_CASE("headless C ABI routes independent macro modulation by note id", "[headless][facade]")
{
    std::unique_ptr<void, decltype(&sx_destroy)> handle(sx_create(48000.0), sx_destroy);
    REQUIRE(handle != nullptr);
    REQUIRE(sx_get_param_count(handle.get()) > 2500);

    std::vector<sx_event> events;
    auto param = [&](uint32_t id, double value)
    { events.push_back(event(0, SX_EVENT_PARAM_VALUE, -1, -1, id, value)); };
    param(500, 0.5);   // output level
    param(522, 0.0);   // velocity sensitivity
    param(529, 0.0);   // repeated keys create independent voices
    param(532, 0.0);   // deterministic unison phase
    param(620, 410.0); // Macro 1 Modulated
    param(621, 1.0);   // modulation depth
    param(650, 10.0);  // output amplitude target

    events.push_back(event(512, SX_EVENT_NOTE_ON, 101, 60, 0, 0.8));
    auto panA = event(512, SX_EVENT_NOTE_EXPRESSION, 101, 60, 0, 0.0);
    panA.expression_id = CLAP_NOTE_EXPRESSION_PAN;
    events.push_back(panA);
    events.push_back(event(512, SX_EVENT_NOTE_ON, 102, 60, 0, 0.8));
    auto panB = event(512, SX_EVENT_NOTE_EXPRESSION, 102, 60, 0, 1.0);
    panB.expression_id = CLAP_NOTE_EXPRESSION_PAN;
    events.push_back(panB);
    events.push_back(event(8192, SX_EVENT_PARAM_MOD, 101, 60, 40000, 0.7));
    events.push_back(event(13312, SX_EVENT_PARAM_MOD, 102, 60, 40000, -0.4));
    events.push_back(event(18432, SX_EVENT_PARAM_MOD, 9999, 60, 40000, 0.9));
    std::stable_sort(events.begin(), events.end(),
                     [](const auto &a, const auto &b) { return a.frame < b.frame; });

    std::vector<float> left(frames, 0.f), right(frames, 0.f);
    REQUIRE(sx_process(handle.get(), frames, nullptr, nullptr, left.data(), right.data(),
                       events.data(), static_cast<uint32_t>(events.size())));

    const auto controlLeft = rms(left, 4096, 7168);
    const auto controlRight = rms(right, 4096, 7168);
    const auto modALeft = rms(left, 9216, 12288);
    const auto modARight = rms(right, 9216, 12288);
    const auto dualLeft = rms(left, 14336, 17408);
    const auto dualRight = rms(right, 14336, 17408);
    const auto unknownLeft = rms(left, 19456, 22528);
    const auto unknownRight = rms(right, 19456, 22528);

    REQUIRE(controlLeft > 1e-5);
    REQUIRE(controlRight > 1e-5);
    REQUIRE(relativeDifference(controlLeft, modALeft) > 0.20);
    REQUIRE(relativeDifference(controlRight, modARight) < 0.05);
    REQUIRE(relativeDifference(modARight, dualRight) > 0.20);
    REQUIRE(relativeDifference(modALeft, dualLeft) < 0.05);
    REQUIRE(relativeDifference(dualLeft, unknownLeft) < 0.05);
    REQUIRE(relativeDifference(dualRight, unknownRight) < 0.05);
}

TEST_CASE("headless facade retains events across sub-block process calls", "[headless][facade]")
{
    headless::EngineFacade facade(48000.0);
    std::array<float, 8> firstLeft{}, firstRight{};
    REQUIRE(facade.process(8, nullptr, nullptr, firstLeft.data(), firstRight.data(), nullptr, 0));

    std::array<float, 5> shortLeft{}, shortRight{};
    const auto delayedNote = event(4, SX_EVENT_NOTE_ON, 7401, 60, 0, 0.8);
    REQUIRE(facade.process(5, nullptr, nullptr, shortLeft.data(), shortRight.data(), &delayedNote,
                           1));

    // The event is due, but this call still ends exactly at the next internal boundary. It must
    // remain pending until process() can execute that boundary rather than disappearing.
    std::array<float, 3> bridgeLeft{}, bridgeRight{};
    REQUIRE(facade.process(3, nullptr, nullptr, bridgeLeft.data(), bridgeRight.data(), nullptr, 0));

    std::vector<float> renderedLeft(4096), renderedRight(4096);
    REQUIRE(facade.process(static_cast<uint32_t>(renderedLeft.size()), nullptr, nullptr,
                           renderedLeft.data(), renderedRight.data(), nullptr, 0));
    const auto peak = std::max(*std::max_element(renderedLeft.begin(), renderedLeft.end()),
                               *std::max_element(renderedRight.begin(), renderedRight.end()));
    REQUIRE(peak > 1e-5f);
}
