/*
 * Six Sines
 * Portable, CLAP-shaped owner/dispatcher around the DSP engine.
 */

#ifndef BACONPAUL_SIX_SINES_ENGINE_FACADE_H
#define BACONPAUL_SIX_SINES_ENGINE_FACADE_H

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>

#include "headless/headless_api.h"

namespace baconpaul::six_sines
{
struct Synth;

namespace headless
{
class EngineFacade
{
  public:
    explicit EngineFacade(double sampleRate);
    ~EngineFacade();

    EngineFacade(const EngineFacade &) = delete;
    EngineFacade &operator=(const EngineFacade &) = delete;

    bool loadPreset(std::string_view utf8State);
    uint32_t paramCount() const;
    bool paramInfo(uint32_t index, sx_param_info &out) const;

    bool process(uint32_t frames, const float *inputLeft, const float *inputRight,
                 float *outputLeft, float *outputRight, const sx_event *events,
                 uint32_t eventCount);

    Synth &synth();
    const Synth &synth() const;

  private:
    static constexpr uint32_t pendingEventCapacity{4096};
    void dispatch(const sx_event &event);

    std::unique_ptr<Synth> engine;
    uint32_t blockPosition{0};
    std::array<sx_event, pendingEventCapacity> pendingEvents{};
    uint32_t pendingEventCount{0};
};
} // namespace headless
} // namespace baconpaul::six_sines

#endif
