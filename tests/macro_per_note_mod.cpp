/*
 * Six Sines
 *
 * A synth with audio rate modulation.
 *
 * Copyright 2024-2025, Paul Walker and Various authors, as described in the github
 * transaction log.
 *
 * This source repo is released under the MIT license, but has
 * GPL3 dependencies, as such the combined work will be
 * released under GPL3.
 *
 * The source code and license are at https://github.com/baconpaul/six-sines
 */

#include "catch2/catch2.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <set>
#include <vector>

#include "synth/matrix_index.h"
#include "synth/patch.h"
#include "synth/synth.h"
#include "synth/voice.h"

using namespace baconpaul::six_sines;

namespace
{
uint32_t macroLevelId(size_t index)
{
    return Patch::MacroNode::idBase + static_cast<uint32_t>(index) * Patch::MacroNode::idStride;
}

std::unique_ptr<Synth> bringUpSynth(int unisonCount = 1)
{
    auto synth = std::make_unique<Synth>(false);
    synth->setSampleRate(48000.0);
    synth->patch.output.playMode.value = 0.f;
    synth->patch.output.polyLimit.value = static_cast<float>(maxVoices);
    synth->patch.output.unisonCount.value = static_cast<float>(unisonCount);
    synth->reapplyControlSettings();
    return synth;
}

std::vector<Voice *> activeVoices(Synth &synth)
{
    std::vector<Voice *> result;
    for (auto *voice = synth.head; voice; voice = voice->next)
        result.push_back(voice);
    return result;
}

size_t countRawValue(Synth &synth, size_t macroIndex, float value)
{
    size_t count{0};
    for (const auto *voice : activeVoices(synth))
        if (std::fabs(voice->voiceValues.macroLevelModulation[macroIndex] - value) < 1e-6f)
            ++count;
    return count;
}
} // namespace

TEST_CASE("only macro levels advertise per-note modulation", "[macro_mod][structure]")
{
    MatrixIndex::initialize();
    auto patch = std::make_unique<Patch>();

    const std::set<uint32_t> expected{
        Patch::MacroNode::idBase + 0 * Patch::MacroNode::idStride,
        Patch::MacroNode::idBase + 1 * Patch::MacroNode::idStride,
        Patch::MacroNode::idBase + 2 * Patch::MacroNode::idStride,
        Patch::MacroNode::idBase + 3 * Patch::MacroNode::idStride,
        Patch::MacroNode::idBase + 4 * Patch::MacroNode::idStride,
        Patch::MacroNode::idBase + 5 * Patch::MacroNode::idStride,
    };

    std::set<uint32_t> actual;
    for (const auto *param : patch->params)
    {
        const auto flags = param->meta.flags;
        if (flags & CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID)
        {
            actual.insert(param->meta.id);
            REQUIRE(flags & CLAP_PARAM_IS_MODULATABLE);
            REQUIRE(flags & CLAP_PARAM_IS_AUTOMATABLE);
        }
    }

    REQUIRE(actual == expected);
}

TEST_CASE("polyphonic macro modulation is isolated by note id", "[macro_mod][routing]")
{
    auto synth = bringUpSynth();
    const auto patchBefore = synth->patch.toState();
    const auto patchMainBefore = synth->patchMain.toState();

    synth->voiceManager->processNoteOnEvent(0, 0, 60, 101, 0.8f, 0.f);
    synth->voiceManager->processNoteOnEvent(0, 0, 60, 102, 0.8f, 0.f);
    REQUIRE(activeVoices(*synth).size() == 2);

    REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 101, macroLevelId(0), 0.7));
    REQUIRE(countRawValue(*synth, 0, 0.7f) == 1);
    REQUIRE(countRawValue(*synth, 0, 0.f) == 1);

    REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 102, macroLevelId(0), -0.4));
    REQUIRE(countRawValue(*synth, 0, 0.7f) == 1);
    REQUIRE(countRawValue(*synth, 0, -0.4f) == 1);

    REQUIRE(synth->patch.toState() == patchBefore);
    REQUIRE(synth->patchMain.toState() == patchMainBefore);
}

TEST_CASE("macro modulation reaches all unison children of only one host note",
          "[macro_mod][routing]")
{
    auto synth = bringUpSynth(3);
    synth->voiceManager->processNoteOnEvent(0, 0, 60, 201, 0.8f, 0.f);
    synth->voiceManager->processNoteOnEvent(0, 0, 60, 202, 0.8f, 0.f);
    REQUIRE(activeVoices(*synth).size() == 6);

    REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 201, macroLevelId(2), 0.625));
    REQUIRE(countRawValue(*synth, 2, 0.625f) == 3);
    REQUIRE(countRawValue(*synth, 2, 0.f) == 3);
}

TEST_CASE("only the six macro level ids are accepted", "[macro_mod][routing]")
{
    auto synth = bringUpSynth();
    synth->voiceManager->processNoteOnEvent(0, 0, 60, 301, 0.8f, 0.f);
    auto *voice = synth->head;
    REQUIRE(voice != nullptr);

    for (size_t i = 0; i < numMacros; ++i)
    {
        const auto amount = static_cast<double>(i + 1) / 10.0;
        REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 301, macroLevelId(i), amount));
        REQUIRE(voice->voiceValues.macroLevelModulation[i] ==
                Approx(static_cast<float>(amount)).margin(1e-7));
    }

    const auto rawBefore = voice->voiceValues.macroLevelModulation;
    REQUIRE_FALSE(synth->handlePolyphonicParamMod(0, 0, 60, 301, macroLevelId(0) + 1, 0.9));
    REQUIRE_FALSE(synth->handlePolyphonicParamMod(0, 0, 60, -1, macroLevelId(0), 0.9));
    REQUIRE(voice->voiceValues.macroLevelModulation == rawBefore);

    // A valid event for a note which does not exist is accepted by the dispatcher but routed to
    // no voice.
    REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 9999, macroLevelId(0), -0.9));
    REQUIRE(voice->voiceValues.macroLevelModulation == rawBefore);
}

TEST_CASE("macro modulation snaps on attack and smooths mid-note", "[macro_mod][smoothing]")
{
    auto synth = bringUpSynth();
    synth->voiceManager->processNoteOnEvent(0, 0, 60, 401, 0.8f, 0.f);
    auto *voice = synth->head;
    REQUIRE(voice != nullptr);

    REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 401, macroLevelId(0), 0.75));
    synth->process(nullptr);
    REQUIRE(voice->voiceValues.macroLevelModulationLag[0].v == Approx(0.75f).margin(1e-7));

    REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 401, macroLevelId(0), -0.25));
    synth->process(nullptr);
    REQUIRE(voice->voiceValues.macroLevelModulationLag[0].v < 0.75f);
    REQUIRE(voice->voiceValues.macroLevelModulationLag[0].v > -0.25f);

    for (int i = 0; i < 100; ++i)
        synth->process(nullptr);
    REQUIRE(voice->voiceValues.macroLevelModulationLag[0].v == Approx(-0.25f).margin(1e-4));
}

TEST_CASE("macro modulation is applied at the Macro Level parameter", "[macro_mod][dsp]")
{
    SECTION("SuperMacro power off")
    {
        auto synth = bringUpSynth();
        auto &macro = synth->patch.macroNodes[0];
        macro.level.value = 0.2f;
        macro.macroPower.value = 0.f;

        synth->voiceManager->processNoteOnEvent(0, 0, 60, 501, 0.8f, 0.f);
        auto *voice = synth->head;
        REQUIRE(voice != nullptr);
        REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 501, macroLevelId(0), 0.3));
        synth->process(nullptr);

        REQUIRE(voice->voiceValues.macroOut[0] == Approx(0.5f).margin(1e-6));
    }

    SECTION("SuperMacro power on applies the offset before its envelope")
    {
        auto synth = bringUpSynth();
        auto &macro = synth->patch.macroNodes[0];
        macro.level.value = 0.2f;
        macro.macroPower.value = 1.f;
        macro.delay.value = 0.f;
        macro.attack.value = 0.f;
        macro.hold.value = 0.f;
        macro.decay.value = 0.f;
        macro.sustain.value = 0.5f;
        macro.release.value = 1.f;
        macro.envPower.value = 1.f;
        macro.envIsMultiplcative.value = 1.f;
        macro.lfoDepth.value = 0.f;

        synth->voiceManager->processNoteOnEvent(0, 0, 60, 502, 0.8f, 0.f);
        auto *voice = synth->head;
        REQUIRE(voice != nullptr);
        REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 502, macroLevelId(0), 0.3));
        synth->process(nullptr);

        // (base 0.2 + per-note 0.3) * envelope 0.5. Adding after the envelope would be 0.4.
        REQUIRE(voice->voiceValues.macroOut[0] == Approx(0.25f).margin(1e-5));
    }
}

TEST_CASE("voice cleanup and reuse clear macro modulation", "[macro_mod][lifecycle]")
{
    auto synth = bringUpSynth();
    synth->voiceManager->processNoteOnEvent(0, 0, 60, 601, 0.8f, 0.f);
    auto *originalVoice = synth->head;
    REQUIRE(originalVoice != nullptr);
    REQUIRE(synth->handlePolyphonicParamMod(0, 0, 60, 601, macroLevelId(0), 0.8));
    synth->process(nullptr);
    REQUIRE(originalVoice->voiceValues.macroLevelModulationLag[0].v ==
            Approx(0.8f).margin(1e-7));

    synth->voiceManager->allSoundsOff();
    for (int i = 0; i < 128 && synth->head; ++i)
        synth->process(nullptr);
    REQUIRE(synth->head == nullptr);
    REQUIRE_FALSE(originalVoice->used);
    for (size_t i = 0; i < numMacros; ++i)
    {
        REQUIRE(originalVoice->voiceValues.macroLevelModulation[i] == 0.f);
        REQUIRE(originalVoice->voiceValues.macroLevelModulationLag[i].v == 0.f);
    }

    synth->voiceManager->processNoteOnEvent(0, 0, 62, 602, 0.8f, 0.f);
    REQUIRE(synth->head == originalVoice);
    REQUIRE(originalVoice->voiceValues.macroLevelModulation[0] == 0.f);
    synth->process(nullptr);
    REQUIRE(originalVoice->voiceValues.macroLevelModulationLag[0].v == 0.f);
}
