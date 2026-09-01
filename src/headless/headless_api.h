/*
 * Six Sines headless C ABI.
 *
 * Keep this header C-compatible: it is the shared boundary for native tests,
 * Emscripten, and the AudioWorklet wrapper.
 */

#ifndef BACONPAUL_SIX_SINES_HEADLESS_API_H
#define BACONPAUL_SIX_SINES_HEADLESS_API_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void *sx_handle;

typedef enum sx_event_type
{
    SX_EVENT_NOTE_ON = 1,
    SX_EVENT_NOTE_OFF = 2,
    SX_EVENT_NOTE_EXPRESSION = 3,
    SX_EVENT_PARAM_VALUE = 4,
    SX_EVENT_PARAM_MOD = 5,
    SX_EVENT_ALL_NOTES_OFF = 6,
} sx_event_type;

/*
 * `frame` is relative to the start of the current sx_process() call. Events
 * must be sorted by frame and satisfy `frame < frames` for that process call.
 * Identity and value semantics match CLAP events.
 */
typedef struct sx_event
{
    uint32_t frame;
    uint32_t type;
    int32_t note_id;
    int16_t port;
    int16_t channel;
    int16_t key;
    int16_t reserved;
    uint32_t param_id;
    int32_t expression_id;
    double value;
} sx_event;

typedef struct sx_param_info
{
    uint32_t id;
    uint32_t flags;
    double min_value;
    double max_value;
    double default_value;
    char name[256];
} sx_param_info;

uint32_t sx_event_sizeof(void);
uint32_t sx_param_info_sizeof(void);

sx_handle sx_create(double sample_rate);
void sx_destroy(sx_handle handle);

int32_t sx_load_preset_utf8(sx_handle handle, const uint8_t *bytes, uint32_t size);
uint32_t sx_get_param_count(sx_handle handle);
int32_t sx_get_param_info(sx_handle handle, uint32_t index, sx_param_info *out);

/* The facade accepts any frame count and preserves the engine's eight-frame event quantization. */
int32_t sx_process(sx_handle handle, uint32_t frames, const float *input_left,
                   const float *input_right, float *output_left, float *output_right,
                   const sx_event *events, uint32_t event_count);

#ifdef __cplusplus
}
#endif

#endif
