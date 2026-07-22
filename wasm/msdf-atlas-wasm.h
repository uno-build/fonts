#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct AtlasResultHandle AtlasResultHandle;
typedef struct FontCharsetResultHandle FontCharsetResultHandle;

AtlasResultHandle *msdf_generate_atlas(const uint8_t *font_data, size_t font_size, const char *options_json);
const uint8_t *msdf_result_png_data(const AtlasResultHandle *result);
size_t msdf_result_png_size(const AtlasResultHandle *result);
const char *msdf_result_metadata_json(const AtlasResultHandle *result);
const char *msdf_result_error(const AtlasResultHandle *result);
int msdf_result_width(const AtlasResultHandle *result);
int msdf_result_height(const AtlasResultHandle *result);
void msdf_destroy_result(AtlasResultHandle *result);

FontCharsetResultHandle *msdf_get_font_charset(const uint8_t *font_data, size_t font_size);
const uint32_t *msdf_font_charset_data(const FontCharsetResultHandle *result);
size_t msdf_font_charset_size(const FontCharsetResultHandle *result);
const char *msdf_font_charset_error(const FontCharsetResultHandle *result);
void msdf_destroy_font_charset_result(FontCharsetResultHandle *result);

#ifdef __cplusplus
}
#endif
