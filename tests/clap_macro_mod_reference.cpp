/*
 * Six Sines
 *
 * Headless dynamic-CLAP reference test for per-note Macro Level modulation.
 */

#include <clap/clap.h>
#include <clap/ext/params.h>
#include <clap/ext/state.h>
#include <clap/ext/thread-check.h>

#include "headless/headless_api.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

#if defined(__APPLE__)
#include <Foundation/Foundation.h>
#endif

namespace
{
constexpr double sampleRate{48000.0};
constexpr uint32_t blockFrames{64};
constexpr uint32_t totalFrames{24576};
constexpr uint32_t noteOnFrame{512};
constexpr uint32_t controlBegin{4096};
constexpr uint32_t controlEnd{7168};
constexpr uint32_t modAFrame{8192};
constexpr uint32_t modABegin{9216};
constexpr uint32_t modAEnd{12288};
constexpr uint32_t modBFrame{13312};
constexpr uint32_t dualBegin{14336};
constexpr uint32_t dualEnd{17408};
constexpr uint32_t unknownModFrame{18432};
constexpr uint32_t unknownBegin{19456};
constexpr uint32_t unknownEnd{22528};

constexpr uint32_t macroLevelBase{40000};
constexpr uint32_t macroLevelStride{250};
constexpr uint32_t outputLevelId{500};
constexpr uint32_t velocitySensitivityId{522};
constexpr uint32_t pianoModeId{529};
constexpr uint32_t unisonPhaseRandomId{532};
constexpr uint32_t outputModSource0Id{620};
constexpr uint32_t outputModDepth0Id{621};
constexpr uint32_t outputModTarget0Id{650};
constexpr double macro0ModSource{410.0};
constexpr double outputAmplitudeTarget{10.0};

void require(bool condition, const std::string &message)
{
    if (!condition)
        throw std::runtime_error(message);
}

std::filesystem::path resolveBinary(const std::filesystem::path &pluginPath)
{
#if defined(__APPLE__)
    if (std::filesystem::is_directory(pluginPath) && pluginPath.extension() == ".clap")
        return pluginPath / "Contents" / "MacOS" / pluginPath.stem();
#endif
    return pluginPath;
}

class SharedLibrary
{
  public:
    explicit SharedLibrary(const std::filesystem::path &path)
    {
#if defined(_WIN32)
        handle = LoadLibraryW(path.wstring().c_str());
#else
        handle = dlopen(path.c_str(), RTLD_LOCAL | RTLD_NOW);
#endif
        require(handle != nullptr, "Unable to load CLAP binary: " + path.string());
    }

    ~SharedLibrary()
    {
        if (!handle)
            return;
#if defined(_WIN32)
        FreeLibrary(handle);
#else
        dlclose(handle);
#endif
    }

    void *symbol(const char *name) const
    {
#if defined(_WIN32)
        return reinterpret_cast<void *>(GetProcAddress(handle, name));
#else
        return dlsym(handle, name);
#endif
    }

  private:
#if defined(_WIN32)
    HMODULE handle{nullptr};
#else
    void *handle{nullptr};
#endif
};

struct HostContext
{
    clap_host_t host{};
    clap_host_thread_check_t threadCheck{};
    clap_host_params_t params{};
    bool inAudioThread{false};
    bool callbackRequested{false};

    HostContext()
    {
        host.clap_version = CLAP_VERSION;
        host.host_data = this;
        host.name = "Six Sines Headless Reference";
        host.vendor = "Six Sines Tests";
        host.url = "https://github.com/baconpaul/six-sines";
        host.version = "1";
        host.get_extension = getExtension;
        host.request_restart = requestRestart;
        host.request_process = requestProcess;
        host.request_callback = requestCallback;

        threadCheck.is_main_thread = isMainThread;
        threadCheck.is_audio_thread = isAudioThread;
        params.rescan = paramsRescan;
        params.clear = paramsClear;
        params.request_flush = paramsRequestFlush;
    }

    static HostContext &from(const clap_host_t *host)
    {
        return *static_cast<HostContext *>(host->host_data);
    }

    static const void *CLAP_ABI getExtension(const clap_host_t *host, const char *id)
    {
        auto &self = from(host);
        if (std::strcmp(id, CLAP_EXT_THREAD_CHECK) == 0)
            return &self.threadCheck;
        if (std::strcmp(id, CLAP_EXT_PARAMS) == 0)
            return &self.params;
        return nullptr;
    }

    static void CLAP_ABI requestRestart(const clap_host_t *) {}
    static void CLAP_ABI requestProcess(const clap_host_t *) {}
    static void CLAP_ABI requestCallback(const clap_host_t *host)
    {
        from(host).callbackRequested = true;
    }
    static bool CLAP_ABI isMainThread(const clap_host_t *host)
    {
        return !from(host).inAudioThread;
    }
    static bool CLAP_ABI isAudioThread(const clap_host_t *host)
    {
        return from(host).inAudioThread;
    }
    static void CLAP_ABI paramsRescan(const clap_host_t *, clap_param_rescan_flags) {}
    static void CLAP_ABI paramsClear(const clap_host_t *, clap_id, clap_param_clear_flags) {}
    static void CLAP_ABI paramsRequestFlush(const clap_host_t *) {}
};

class Bundle
{
  public:
    explicit Bundle(const std::filesystem::path &path)
        : pluginPath(path), library(resolveBinary(path))
    {
        entry = static_cast<const clap_plugin_entry_t *>(library.symbol("clap_entry"));
        require(entry != nullptr, "CLAP entry symbol is missing");
        require(clap_version_is_compatible(entry->clap_version), "Incompatible CLAP version");
        require(entry->init(pluginPath.string().c_str()), "CLAP entry init failed");
        initialized = true;
        factory = static_cast<const clap_plugin_factory_t *>(
            entry->get_factory(CLAP_PLUGIN_FACTORY_ID));
        require(factory != nullptr, "CLAP plugin factory is missing");
        require(factory->get_plugin_count(factory) > 0, "CLAP bundle contains no plugins");
        descriptor = factory->get_plugin_descriptor(factory, 0);
        require(descriptor != nullptr, "CLAP plugin descriptor is missing");
        require(descriptor->version != nullptr, "CLAP plugin descriptor version is missing");
#ifdef SIX_SINES_EXPECTED_BUILD_ID
        require(std::string_view(descriptor->version).find(SIX_SINES_EXPECTED_BUILD_ID) !=
                    std::string_view::npos,
                "CLAP descriptor does not contain the paired build ID: " +
                    std::string(descriptor->version));
#endif
    }

    ~Bundle()
    {
        if (initialized)
            entry->deinit();
    }

    std::filesystem::path pluginPath;
    SharedLibrary library;
    const clap_plugin_entry_t *entry{nullptr};
    const clap_plugin_factory_t *factory{nullptr};
    const clap_plugin_descriptor_t *descriptor{nullptr};
    bool initialized{false};
};

struct OutputEvents
{
    clap_output_events_t iface{};
    OutputEvents()
    {
        iface.ctx = this;
        iface.try_push = tryPush;
    }
    static bool CLAP_ABI tryPush(const clap_output_events_t *, const clap_event_header_t *)
    {
        return true;
    }
};

struct StoredEvent
{
    static constexpr size_t storageSize{64};
    alignas(std::max_align_t) std::array<std::byte, storageSize> storage{};

    template <typename T> explicit StoredEvent(const T &event)
    {
        static_assert(sizeof(T) <= storageSize);
        std::memcpy(storage.data(), &event, sizeof(T));
    }

    const clap_event_header_t *header() const
    {
        return reinterpret_cast<const clap_event_header_t *>(storage.data());
    }
};

struct InputEvents
{
    clap_input_events_t iface{};
    std::vector<StoredEvent> events;

    InputEvents()
    {
        iface.ctx = this;
        iface.size = size;
        iface.get = get;
    }

    void finish()
    {
        std::stable_sort(events.begin(), events.end(), [](const auto &a, const auto &b)
                         { return a.header()->time < b.header()->time; });
    }

    void addParamValue(uint32_t time, clap_id id, double value)
    {
        clap_event_param_value_t event{};
        setHeader(event.header, time, CLAP_EVENT_PARAM_VALUE, sizeof(event));
        event.param_id = id;
        event.cookie = nullptr;
        event.note_id = -1;
        event.port_index = -1;
        event.channel = -1;
        event.key = -1;
        event.value = value;
        events.emplace_back(event);
    }

    void addNote(uint32_t time, bool on, int32_t noteId, int16_t key, double velocity)
    {
        clap_event_note_t event{};
        setHeader(event.header, time, on ? CLAP_EVENT_NOTE_ON : CLAP_EVENT_NOTE_OFF,
                  sizeof(event));
        event.note_id = noteId;
        event.port_index = 0;
        event.channel = 0;
        event.key = key;
        event.velocity = velocity;
        events.emplace_back(event);
    }

    void addNotePan(uint32_t time, int32_t noteId, int16_t key, double pan)
    {
        addNoteExpression(time, noteId, key, CLAP_NOTE_EXPRESSION_PAN, pan);
    }

    void addNoteExpression(uint32_t time, int32_t noteId, int16_t key, int32_t expressionId,
                           double value)
    {
        clap_event_note_expression_t event{};
        setHeader(event.header, time, CLAP_EVENT_NOTE_EXPRESSION, sizeof(event));
        event.expression_id = expressionId;
        event.note_id = noteId;
        event.port_index = 0;
        event.channel = 0;
        event.key = key;
        event.value = value;
        events.emplace_back(event);
    }

    void addParamMod(uint32_t time, int32_t noteId, int16_t key, clap_id paramId, double amount)
    {
        clap_event_param_mod_t event{};
        setHeader(event.header, time, CLAP_EVENT_PARAM_MOD, sizeof(event));
        event.param_id = paramId;
        event.cookie = nullptr;
        event.note_id = noteId;
        event.port_index = 0;
        event.channel = 0;
        event.key = key;
        event.amount = amount;
        events.emplace_back(event);
    }

  private:
    static void setHeader(clap_event_header_t &header, uint32_t time, uint16_t type, uint32_t size)
    {
        header.size = size;
        header.time = time;
        header.space_id = CLAP_CORE_EVENT_SPACE_ID;
        header.type = type;
        header.flags = 0;
    }

    static uint32_t CLAP_ABI size(const clap_input_events_t *list)
    {
        return static_cast<uint32_t>(static_cast<const InputEvents *>(list->ctx)->events.size());
    }

    static const clap_event_header_t *CLAP_ABI get(const clap_input_events_t *list, uint32_t index)
    {
        const auto &self = *static_cast<const InputEvents *>(list->ctx);
        return index < self.events.size() ? self.events[index].header() : nullptr;
    }
};

class PluginInstance
{
  public:
    explicit PluginInstance(Bundle &bundle)
    {
        plugin = bundle.factory->create_plugin(bundle.factory, &host.host, bundle.descriptor->id);
        require(plugin != nullptr, "Unable to create CLAP plugin instance");
        require(plugin->init(plugin), "CLAP plugin init failed");

        params = static_cast<const clap_plugin_params_t *>(
            plugin->get_extension(plugin, CLAP_EXT_PARAMS));
        state = static_cast<const clap_plugin_state_t *>(
            plugin->get_extension(plugin, CLAP_EXT_STATE));
        require(params != nullptr, "Plugin does not expose clap.params");
        require(state != nullptr, "Plugin does not expose clap.state");
    }

    ~PluginInstance()
    {
        if (!plugin)
            return;
        if (processing)
        {
            host.inAudioThread = true;
            plugin->stop_processing(plugin);
            host.inAudioThread = false;
        }
        if (active)
            plugin->deactivate(plugin);
        plugin->destroy(plugin);
    }

    void activate()
    {
        require(plugin->activate(plugin, sampleRate, blockFrames, blockFrames),
                "CLAP plugin activation failed");
        active = true;
        host.inAudioThread = true;
        const auto started = plugin->start_processing(plugin);
        host.inAudioThread = false;
        require(started, "CLAP start_processing failed");
        processing = true;
    }

    void runMainThreadCallback()
    {
        if (!host.callbackRequested)
            return;
        host.callbackRequested = false;
        plugin->on_main_thread(plugin);
    }

    std::string saveState() const
    {
        struct Buffer
        {
            std::string bytes;
            clap_ostream_t stream{};
            Buffer()
            {
                stream.ctx = this;
                stream.write = write;
            }
            static int64_t CLAP_ABI write(const clap_ostream_t *stream, const void *data,
                                          uint64_t size)
            {
                auto &self = *static_cast<Buffer *>(stream->ctx);
                self.bytes.append(static_cast<const char *>(data), static_cast<size_t>(size));
                return static_cast<int64_t>(size);
            }
        } buffer;

        require(state->save(plugin, &buffer.stream), "CLAP state save failed");
        return buffer.bytes;
    }

    void loadState(std::string_view bytes)
    {
        struct Buffer
        {
            std::string_view bytes;
            size_t position{0};
            clap_istream_t stream{};
            explicit Buffer(std::string_view source) : bytes(source)
            {
                stream.ctx = this;
                stream.read = read;
            }
            static int64_t CLAP_ABI read(const clap_istream_t *stream, void *destination,
                                         uint64_t size)
            {
                auto &self = *static_cast<Buffer *>(stream->ctx);
                const auto remaining = self.bytes.size() - self.position;
                const auto count = std::min<size_t>(remaining, static_cast<size_t>(size));
                if (count)
                    std::memcpy(destination, self.bytes.data() + self.position, count);
                self.position += count;
                return static_cast<int64_t>(count);
            }
        } buffer(bytes);

        require(!active, "CLAP state must be loaded before activation in this host");
        require(state->load(plugin, &buffer.stream), "CLAP state load failed");
        require(buffer.position == bytes.size(), "CLAP state load did not consume the preset");
    }

    void process(uint64_t startFrame, InputEvents &input, float *left, float *right)
    {
        std::array<float *, 2> channels{left, right};
        clap_audio_buffer_t output{};
        output.data32 = channels.data();
        output.channel_count = 2;

        clap_process_t process{};
        process.steady_time = static_cast<int64_t>(startFrame);
        process.frames_count = blockFrames;
        process.audio_outputs = &output;
        process.audio_outputs_count = 1;
        process.in_events = &input.iface;
        process.out_events = &outputEvents.iface;

        host.inAudioThread = true;
        const auto status = plugin->process(plugin, &process);
        host.inAudioThread = false;
        require(status != CLAP_PROCESS_ERROR, "CLAP process returned an error");
    }

    HostContext host;
    const clap_plugin_t *plugin{nullptr};
    const clap_plugin_params_t *params{nullptr};
    const clap_plugin_state_t *state{nullptr};
    OutputEvents outputEvents;
    bool active{false};
    bool processing{false};
};

struct RenderResult
{
    std::vector<float> left = std::vector<float>(totalFrames, 0.f);
    std::vector<float> right = std::vector<float>(totalFrames, 0.f);
    std::string stateBeforeMod;
    std::string stateAfter;
};

void addEventsForBlock(InputEvents &events, uint32_t blockStart)
{
    auto localTime = [blockStart](uint32_t absolute) { return absolute - blockStart; };
    auto contains = [blockStart](uint32_t absolute)
    { return absolute >= blockStart && absolute < blockStart + blockFrames; };

    if (blockStart == 0)
    {
        // Init-patch-independent modulation fixture: Macro 1 drives per-voice output amplitude.
        events.addParamValue(0, outputLevelId, 0.5);
        events.addParamValue(0, velocitySensitivityId, 0.0);
        events.addParamValue(0, pianoModeId, 0.0);
        events.addParamValue(0, unisonPhaseRandomId, 0.0);
        events.addParamValue(0, outputModSource0Id, macro0ModSource);
        events.addParamValue(0, outputModDepth0Id, 1.0);
        events.addParamValue(0, outputModTarget0Id, outputAmplitudeTarget);
    }

    if (contains(noteOnFrame))
    {
        const auto time = localTime(noteOnFrame);
        events.addNote(time, true, 101, 60, 0.8);
        events.addNotePan(time, 101, 60, 0.0);
        events.addNote(time, true, 102, 60, 0.8);
        events.addNotePan(time, 102, 60, 1.0);
    }

    if (contains(modAFrame))
        events.addParamMod(localTime(modAFrame), 101, 60, macroLevelBase, 0.7);
    if (contains(modBFrame))
        events.addParamMod(localTime(modBFrame), 102, 60, macroLevelBase, -0.4);
    if (contains(unknownModFrame))
        events.addParamMod(localTime(unknownModFrame), 9999, 60, macroLevelBase, 0.9);

    events.finish();
}

void addPortableEventsForBlock(InputEvents &events, uint32_t blockStart,
                               const std::vector<sx_event> &score)
{
    const auto blockEnd = blockStart + blockFrames;
    for (const auto &event : score)
    {
        if (event.frame < blockStart)
            continue;
        if (event.frame >= blockEnd)
            break;
        const auto time = event.frame - blockStart;
        switch (event.type)
        {
        case SX_EVENT_NOTE_ON:
            events.addNote(time, true, event.note_id, event.key, event.value);
            break;
        case SX_EVENT_NOTE_OFF:
            events.addNote(time, false, event.note_id, event.key, event.value);
            break;
        case SX_EVENT_NOTE_EXPRESSION:
            events.addNoteExpression(time, event.note_id, event.key, event.expression_id,
                                     event.value);
            break;
        case SX_EVENT_PARAM_VALUE:
            events.addParamValue(time, event.param_id, event.value);
            break;
        case SX_EVENT_PARAM_MOD:
            events.addParamMod(time, event.note_id, event.key, event.param_id, event.value);
            break;
        default:
            require(false, "Unsupported portable event in CLAP stress score");
        }
    }
    events.finish();
}

RenderResult render(PluginInstance &instance, const std::vector<sx_event> *score = nullptr)
{
    instance.activate();
    RenderResult result;

    for (uint32_t start = 0; start < totalFrames; start += blockFrames)
    {
        if (start == modAFrame)
        {
            instance.runMainThreadCallback();
            result.stateBeforeMod = instance.saveState();
        }

        InputEvents events;
        if (score)
            addPortableEventsForBlock(events, start, *score);
        else
            addEventsForBlock(events, start);
        instance.process(start, events, result.left.data() + start, result.right.data() + start);
        instance.runMainThreadCallback();
    }

    result.stateAfter = instance.saveState();
    require(result.stateBeforeMod == result.stateAfter,
            "PARAM_MOD or note processing changed serialized CLAP state");
    return result;
}

double rms(const std::vector<float> &signal, uint32_t begin, uint32_t end)
{
    double sum{0.0};
    for (uint32_t i = begin; i < end; ++i)
    {
        const auto sample = static_cast<double>(signal[i]);
        sum += sample * sample;
    }
    return std::sqrt(sum / static_cast<double>(end - begin));
}

double relativeDifference(double a, double b)
{
    return std::abs(a - b) / std::max(std::abs(a), 1e-12);
}

std::set<clap_id> perNoteModulatableParameters(PluginInstance &instance)
{
    std::set<clap_id> result;
    const auto count = instance.params->count(instance.plugin);
    for (uint32_t i = 0; i < count; ++i)
    {
        clap_param_info_t info{};
        require(instance.params->get_info(instance.plugin, i, &info),
                "Unable to enumerate CLAP parameter " + std::to_string(i));
        if (info.flags & CLAP_PARAM_IS_MODULATABLE_PER_NOTE_ID)
        {
            require(info.flags & CLAP_PARAM_IS_MODULATABLE,
                    "Per-note parameter is missing CLAP_PARAM_IS_MODULATABLE");
            require(info.flags & CLAP_PARAM_IS_AUTOMATABLE,
                    "Per-note Macro Level lost CLAP_PARAM_IS_AUTOMATABLE");
            result.insert(info.id);
        }
    }
    return result;
}

std::string readBytes(const std::filesystem::path &path)
{
    std::ifstream input(path, std::ios::binary);
    require(input.good(), "Unable to open preset: " + path.string());
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

void writePlanarPcm(const std::filesystem::path &path, const RenderResult &result)
{
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    require(output.good(), "Unable to create PCM reference: " + path.string());
    output.write(reinterpret_cast<const char *>(result.left.data()),
                 static_cast<std::streamsize>(result.left.size() * sizeof(float)));
    output.write(reinterpret_cast<const char *>(result.right.data()),
                 static_cast<std::streamsize>(result.right.size() * sizeof(float)));
    require(output.good(), "Unable to write PCM reference: " + path.string());
}

std::vector<sx_event> readPortableScore(const std::filesystem::path &path)
{
    const auto bytes = readBytes(path);
    require(bytes.size() % sizeof(sx_event) == 0, "Portable score has an invalid byte length");
    std::vector<sx_event> result(bytes.size() / sizeof(sx_event));
    if (!bytes.empty())
        std::memcpy(result.data(), bytes.data(), bytes.size());
    for (size_t index = 0; index < result.size(); ++index)
    {
        require(result[index].frame < totalFrames, "Portable score event is outside the render");
        require(index == 0 || result[index - 1].frame <= result[index].frame,
                "Portable score is not sorted");
    }
    return result;
}
} // namespace

int runMain(int argc, char **argv)
{
    try
    {
        require(argc >= 2 && argc <= 5,
                "Usage: six-sines-clap-reference /path/to/Six Sines.clap [preset.sxsnp] [pcm.f32] [score.sxev]");
        Bundle bundle(argv[1]);
        PluginInstance instance(bundle);

        if (argc >= 3)
            instance.loadState(readBytes(argv[2]));

        std::set<clap_id> expected;
        for (uint32_t i = 0; i < 6; ++i)
            expected.insert(macroLevelBase + i * macroLevelStride);
        const auto discovered = perNoteModulatableParameters(instance);
        require(discovered == expected, "Dynamic CLAP did not expose exactly six Macro Levels");

        std::vector<sx_event> score;
        if (argc >= 5)
            score = readPortableScore(argv[4]);
        const auto result = render(instance, score.empty() ? nullptr : &score);
        if (argc >= 4)
            writePlanarPcm(argv[3], result);
        const auto controlLeft = rms(result.left, controlBegin, controlEnd);
        const auto controlRight = rms(result.right, controlBegin, controlEnd);
        const auto modALeft = rms(result.left, modABegin, modAEnd);
        const auto modARight = rms(result.right, modABegin, modAEnd);
        const auto dualLeft = rms(result.left, dualBegin, dualEnd);
        const auto dualRight = rms(result.right, dualBegin, dualEnd);
        const auto unknownLeft = rms(result.left, unknownBegin, unknownEnd);
        const auto unknownRight = rms(result.right, unknownBegin, unknownEnd);

        const auto modAAddressedChange = relativeDifference(controlLeft, modALeft);
        const auto modAOtherChange = relativeDifference(controlRight, modARight);
        const auto modBAddressedChange = relativeDifference(modARight, dualRight);
        const auto modBOtherChange = relativeDifference(modALeft, dualLeft);
        const auto unknownLeftChange = relativeDifference(dualLeft, unknownLeft);
        const auto unknownRightChange = relativeDifference(dualRight, unknownRight);
        const bool isConfiguredModulationOracle = argc == 2;

        std::cerr << "CLAP macro-mod RMS: control=" << controlLeft << ',' << controlRight
                  << " modA=" << modALeft << ',' << modARight << " dual=" << dualLeft << ','
                  << dualRight << " unknown=" << unknownLeft << ',' << unknownRight << '\n';

        require(controlLeft > 1e-5 && controlRight > 1e-5,
                "Two same-key note IDs did not produce both isolated channels");
        require(std::all_of(result.left.begin(), result.left.end(),
                            [](float sample) { return std::isfinite(sample); }) &&
                    std::all_of(result.right.begin(), result.right.end(),
                                [](float sample) { return std::isfinite(sample); }),
                "CLAP render produced a non-finite sample");
        if (isConfiguredModulationOracle)
        {
            constexpr double unchangedTolerance{0.05};
            constexpr double changedThreshold{0.20};
            require(modAAddressedChange > changedThreshold,
                    "Mod-A did not substantially change the addressed left note");
            require(modAOtherChange < unchangedTolerance, "Mod-A leaked into the right note");
            require(modBAddressedChange > changedThreshold,
                    "Mod-B did not substantially change the addressed right note");
            require(modBOtherChange < unchangedTolerance, "Mod-B leaked into the left note");
            require(unknownLeftChange < unchangedTolerance &&
                        unknownRightChange < unchangedTolerance,
                    "Unknown note_id changed audio");
        }

        std::cout << "{\n"
                  << "  \"test\": \""
                  << (isConfiguredModulationOracle
                          ? "macro-per-note-clap"
                          : (score.empty() ? "native-clap-preset-reference"
                                           : "native-clap-seeded-stress-reference"))
                  << "\",\n"
                  << "  \"status\": \"pass\",\n"
                  << "  \"plugin_version\": \"" << bundle.descriptor->version << "\",\n"
                  << "  \"per_note_parameter_count\": " << discovered.size() << ",\n"
                  << "  \"mod_a_frame\": " << modAFrame << ",\n"
                  << "  \"mod_b_frame\": " << modBFrame << ",\n"
                  << "  \"mod_a_addressed_relative_change\": " << modAAddressedChange << ",\n"
                  << "  \"mod_a_other_relative_change\": " << modAOtherChange << ",\n"
                  << "  \"mod_b_addressed_relative_change\": " << modBAddressedChange << ",\n"
                  << "  \"mod_b_other_relative_change\": " << modBOtherChange << ",\n"
                  << "  \"unknown_left_relative_change\": " << unknownLeftChange << ",\n"
                  << "  \"unknown_right_relative_change\": " << unknownRightChange << "\n"
                  << "}\n";
        return 0;
    }
    catch (const std::exception &error)
    {
        std::cerr << "six-sines-clap-reference: " << error.what() << '\n';
        return 1;
    }
}

int main(int argc, char **argv)
{
#if defined(__APPLE__)
    @autoreleasepool
    {
        return runMain(argc, argv);
    }
#else
    return runMain(argc, argv);
#endif
}
