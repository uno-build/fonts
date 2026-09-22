#include "msdf-atlas-wasm.h"

#include <cmath>
#include <cstdint>
#include <iomanip>
#include <limits>
#include <locale>
#include <new>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <msdfgen.h>
#include <msdfgen-ext.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include "msdf-atlas-gen/BitmapAtlasStorage.h"
#include "msdf-atlas-gen/FontGeometry.h"
#include "msdf-atlas-gen/ImmediateAtlasGenerator.h"
#include "msdf-atlas-gen/TightAtlasPacker.h"
#include "msdf-atlas-gen/glyph-generators.h"
#include "msdf-atlas-gen/image-encode.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define MSDF_WASM_KEEPALIVE EMSCRIPTEN_KEEPALIVE
#else
#define MSDF_WASM_KEEPALIVE
#endif

using namespace msdf_atlas;

struct AtlasResultHandle {
    // FT_New_Memory_Face does not copy font bytes. Keeping this vector in the
    // result guarantees that the input remains alive until destroyFont returns.
    std::vector<uint8_t> fontBytes;
    std::vector<uint8_t> png;
    std::string metadata;
    std::string error;
    int width = 0;
    int height = 0;
};

struct FontCharsetResultHandle {
    std::vector<uint32_t> codepoints;
    std::vector<uint32_t> glyphIndices;
    std::string error;
};

namespace {

struct Options {
    std::string charset;
    std::string type = "msdf";
    double size = 32;
    double pxRange = 4;
    int width = 0;
    int height = 0;
    double angleThreshold = 3.0;
    std::string coloringStrategy = "inktrap";
    msdfgen::YAxisOrientation yOrigin = msdfgen::Y_UPWARD;
};

class FontGuard {
public:
    FontGuard(msdfgen::FreetypeHandle *library, msdfgen::FontHandle *font) : library(library), font(font) { }
    ~FontGuard() {
        if (font)
            msdfgen::destroyFont(font);
        if (library)
            msdfgen::deinitializeFreetype(library);
    }
private:
    msdfgen::FreetypeHandle *library;
    msdfgen::FontHandle *font;
};

static size_t findValue(const std::string &json, const char *key) {
    const std::string needle = std::string("\"")+key+"\"";
    size_t p = json.find(needle);
    if (p == std::string::npos)
        return p;
    p = json.find(':', p+needle.size());
    if (p == std::string::npos)
        throw std::runtime_error("invalid options JSON");
    do { ++p; } while (p < json.size() && (json[p] == ' ' || json[p] == '\t' || json[p] == '\r' || json[p] == '\n'));
    return p;
}

static unsigned hexDigit(char c) {
    if (c >= '0' && c <= '9') return unsigned(c-'0');
    if (c >= 'a' && c <= 'f') return unsigned(c-'a'+10);
    if (c >= 'A' && c <= 'F') return unsigned(c-'A'+10);
    throw std::runtime_error("invalid Unicode escape in options JSON");
}

static void appendUtf8(std::string &out, uint32_t cp) {
    if (cp <= 0x7f) out.push_back(char(cp));
    else if (cp <= 0x7ff) {
        out.push_back(char(0xc0|(cp>>6))); out.push_back(char(0x80|(cp&0x3f)));
    } else if (cp <= 0xffff) {
        out.push_back(char(0xe0|(cp>>12))); out.push_back(char(0x80|((cp>>6)&0x3f))); out.push_back(char(0x80|(cp&0x3f)));
    } else if (cp <= 0x10ffff) {
        out.push_back(char(0xf0|(cp>>18))); out.push_back(char(0x80|((cp>>12)&0x3f))); out.push_back(char(0x80|((cp>>6)&0x3f))); out.push_back(char(0x80|(cp&0x3f)));
    } else throw std::runtime_error("invalid Unicode codepoint in options JSON");
}

static std::string parseString(const std::string &json, size_t p) {
    if (p >= json.size() || json[p] != '"')
        throw std::runtime_error("expected a string in options JSON");
    std::string out;
    for (++p; p < json.size(); ++p) {
        char c = json[p];
        if (c == '"') return out;
        if (c != '\\') { out.push_back(c); continue; }
        if (++p >= json.size()) break;
        switch (json[p]) {
            case '"': out.push_back('"'); break;
            case '\\': out.push_back('\\'); break;
            case '/': out.push_back('/'); break;
            case 'b': out.push_back('\b'); break;
            case 'f': out.push_back('\f'); break;
            case 'n': out.push_back('\n'); break;
            case 'r': out.push_back('\r'); break;
            case 't': out.push_back('\t'); break;
            case 'u': {
                if (p+4 >= json.size()) throw std::runtime_error("truncated Unicode escape in options JSON");
                uint32_t cp = 0;
                for (int i = 0; i < 4; ++i) cp = (cp<<4)|hexDigit(json[++p]);
                if (cp >= 0xd800 && cp <= 0xdbff) {
                    if (p+6 >= json.size() || json[p+1] != '\\' || json[p+2] != 'u') throw std::runtime_error("unpaired UTF-16 surrogate");
                    p += 2;
                    uint32_t low = 0;
                    for (int i = 0; i < 4; ++i) low = (low<<4)|hexDigit(json[++p]);
                    if (low < 0xdc00 || low > 0xdfff) throw std::runtime_error("unpaired UTF-16 surrogate");
                    cp = 0x10000+((cp-0xd800)<<10)+(low-0xdc00);
                } else if (cp >= 0xdc00 && cp <= 0xdfff) throw std::runtime_error("unpaired UTF-16 surrogate");
                appendUtf8(out, cp);
                break;
            }
            default: throw std::runtime_error("invalid escape in options JSON");
        }
    }
    throw std::runtime_error("unterminated string in options JSON");
}

static double parseNumber(const std::string &json, size_t p) {
    size_t end = p;
    while (end < json.size() && ((json[end] >= '0' && json[end] <= '9') || json[end] == '-' || json[end] == '+' || json[end] == '.' || json[end] == 'e' || json[end] == 'E')) ++end;
    if (end == p) throw std::runtime_error("expected a number in options JSON");
    size_t consumed = 0;
    double value = std::stod(json.substr(p, end-p), &consumed);
    if (consumed != end-p || !std::isfinite(value)) throw std::runtime_error("invalid number in options JSON");
    return value;
}

static Options parseOptions(const char *optionsJson) {
    Options o;
    for (uint32_t cp = 0x20; cp < 0x7f; ++cp) appendUtf8(o.charset, cp);
    const std::string json = optionsJson ? optionsJson : "{}";
    size_t p;
    if ((p = findValue(json, "charset")) != std::string::npos) o.charset = parseString(json, p);
    if ((p = findValue(json, "type")) != std::string::npos) o.type = parseString(json, p);
    if ((p = findValue(json, "size")) != std::string::npos) o.size = parseNumber(json, p);
    if ((p = findValue(json, "pxRange")) != std::string::npos) o.pxRange = parseNumber(json, p);
    if ((p = findValue(json, "width")) != std::string::npos) o.width = int(parseNumber(json, p));
    if ((p = findValue(json, "height")) != std::string::npos) o.height = int(parseNumber(json, p));
    if ((p = findValue(json, "angleThreshold")) != std::string::npos) o.angleThreshold = parseNumber(json, p);
    if ((p = findValue(json, "coloringStrategy")) != std::string::npos) o.coloringStrategy = parseString(json, p);
    if ((p = findValue(json, "yOrigin")) != std::string::npos) {
        const std::string y = parseString(json, p);
        if (y == "top") o.yOrigin = msdfgen::Y_DOWNWARD;
        else if (y == "bottom") o.yOrigin = msdfgen::Y_UPWARD;
        else throw std::runtime_error("yOrigin must be 'top' or 'bottom'");
    }
    if (o.charset.empty()) throw std::runtime_error("charset must not be empty");
    if (!(o.size > 0 && o.size <= 4096)) throw std::runtime_error("size must be between 0 and 4096");
    if (!(o.pxRange > 0 && o.pxRange <= 256)) throw std::runtime_error("pxRange must be between 0 and 256");
    if ((o.width == 0) != (o.height == 0)) throw std::runtime_error("width and height must be specified together");
    if (o.width < 0 || o.height < 0 || o.width > 32768 || o.height > 32768) throw std::runtime_error("invalid atlas dimensions");
    if (!(o.angleThreshold > 0 && o.angleThreshold < 3.14159265358979323846)) throw std::runtime_error("angleThreshold must be between 0 and pi");
    if (o.type != "hardmask" && o.type != "softmask" && o.type != "sdf" && o.type != "psdf" && o.type != "msdf" && o.type != "mtsdf") throw std::runtime_error("type must be 'hardmask', 'softmask', 'sdf', 'psdf', 'msdf', or 'mtsdf'");
    if (o.coloringStrategy != "simple" && o.coloringStrategy != "inktrap" && o.coloringStrategy != "distance") throw std::runtime_error("unknown coloringStrategy");
    return o;
}

static Charset decodeCharset(const std::string &text) {
    Charset charset;
    const uint8_t *s = reinterpret_cast<const uint8_t *>(text.data());
    size_t i = 0;
    while (i < text.size()) {
        uint32_t cp;
        uint8_t c = s[i++];
        unsigned remaining;
        if (c < 0x80) cp = c, remaining = 0;
        else if ((c&0xe0) == 0xc0) cp = c&0x1f, remaining = 1;
        else if ((c&0xf0) == 0xe0) cp = c&0x0f, remaining = 2;
        else if ((c&0xf8) == 0xf0) cp = c&0x07, remaining = 3;
        else throw std::runtime_error("charset is not valid UTF-8");
        if (i+remaining > text.size()) throw std::runtime_error("charset is truncated UTF-8");
        for (unsigned n = 0; n < remaining; ++n) {
            if ((s[i]&0xc0) != 0x80) throw std::runtime_error("charset is not valid UTF-8");
            cp = (cp<<6)|(s[i++]&0x3f);
        }
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || (remaining == 1 && cp < 0x80) || (remaining == 2 && cp < 0x800) || (remaining == 3 && cp < 0x10000)) throw std::runtime_error("charset contains an invalid Unicode codepoint");
        charset.add(cp);
    }
    return charset;
}

static void appendBounds(std::ostringstream &out, const GlyphGeometry &glyph, const Options &options, int atlasHeight) {
    double l, b, r, t;
    glyph.getQuadPlaneBounds(l, b, r, t);
    if (l || b || r || t) {
        if (options.yOrigin == msdfgen::Y_DOWNWARD)
            out << ",\"planeBounds\":{\"left\":" << l << ",\"top\":" << -t << ",\"right\":" << r << ",\"bottom\":" << -b << '}';
        else
            out << ",\"planeBounds\":{\"left\":" << l << ",\"bottom\":" << b << ",\"right\":" << r << ",\"top\":" << t << '}';
    }
    glyph.getQuadAtlasBounds(l, b, r, t);
    if (l || b || r || t) {
        if (options.yOrigin == msdfgen::Y_DOWNWARD)
            out << ",\"atlasBounds\":{\"left\":" << l << ",\"top\":" << atlasHeight-t << ",\"right\":" << r << ",\"bottom\":" << atlasHeight-b << '}';
        else
            out << ",\"atlasBounds\":{\"left\":" << l << ",\"bottom\":" << b << ",\"right\":" << r << ",\"top\":" << t << '}';
    }
}

static std::string makeMetadata(const FontGeometry &font, const Options &options, int width, int height, double size, msdfgen::Range range) {
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out << std::setprecision(17);
    out << "{\"atlas\":{\"type\":\"" << options.type << '"';
    if (options.type != "hardmask" && options.type != "softmask")
        out << ",\"distanceRange\":" << range.upper-range.lower
            << ",\"distanceRangeMiddle\":" << .5*(range.lower+range.upper);
    out << ",\"size\":" << size << ",\"width\":" << width << ",\"height\":" << height << ",\"yOrigin\":\""
        << (options.yOrigin == msdfgen::Y_DOWNWARD ? "top" : "bottom") << "\"},\"metrics\":{";
    const msdfgen::FontMetrics &m = font.getMetrics();
    const double yf = options.yOrigin == msdfgen::Y_DOWNWARD ? -1 : 1;
    out << "\"emSize\":" << m.emSize << ",\"lineHeight\":" << m.lineHeight << ",\"ascender\":" << yf*m.ascenderY
        << ",\"descender\":" << yf*m.descenderY << ",\"underlineY\":" << yf*m.underlineY
        << ",\"underlineThickness\":" << m.underlineThickness << "},\"glyphs\":[";
    bool first = true;
    for (const GlyphGeometry &glyph : font.getGlyphs()) {
        if (!first) out << ',';
        first = false;
        out << "{\"unicode\":" << glyph.getCodepoint() << ",\"advance\":" << glyph.getAdvance();
        appendBounds(out, glyph, options, height);
        out << '}';
    }
    out << "],\"kerning\":[";
    first = true;
    for (const auto &pair : font.getKerning()) {
        const GlyphGeometry *g1 = font.getGlyph(msdfgen::GlyphIndex(pair.first.first));
        const GlyphGeometry *g2 = font.getGlyph(msdfgen::GlyphIndex(pair.first.second));
        if (!(g1 && g2 && g1->getCodepoint() && g2->getCodepoint())) continue;
        if (!first) out << ',';
        first = false;
        out << "{\"unicode1\":" << g1->getCodepoint() << ",\"unicode2\":" << g2->getCodepoint() << ",\"advance\":" << pair.second << '}';
    }
    out << "]}";
    return out.str();
}

template <int N, GeneratorFunction<float, N> GEN_FN>
static void generateBitmap(AtlasResultHandle &result, const std::vector<GlyphGeometry> &glyphs, const Options &options, const GeneratorAttributes &attributes) {
    ImmediateAtlasGenerator<float, N, GEN_FN, BitmapAtlasStorage<uint8_t, N> > generator(result.width, result.height);
    generator.setAttributes(attributes);
    generator.setThreadCount(1);
    generator.generate(glyphs.data(), int(glyphs.size()));
    msdfgen::BitmapConstSection<uint8_t, N> bitmap = generator.atlasStorage();
    bitmap.reorient(options.yOrigin);
    if (!encodePng(result.png, bitmap)) throw std::runtime_error("libpng failed to encode the atlas");
}

static void generate(AtlasResultHandle &result, const uint8_t *fontData, size_t fontSize, const char *optionsJson) {
    if (!fontData || !fontSize) throw std::runtime_error("font data is empty");
    if (fontSize > size_t(std::numeric_limits<int>::max())) throw std::runtime_error("font is too large");
    Options options = parseOptions(optionsJson);
    Charset charset = decodeCharset(options.charset);
    if (charset.empty()) throw std::runtime_error("charset must not be empty");

    result.fontBytes.assign(fontData, fontData+fontSize);
    msdfgen::FreetypeHandle *ft = msdfgen::initializeFreetype();
    if (!ft) throw std::runtime_error("failed to initialize FreeType");
    msdfgen::FontHandle *fontHandle = msdfgen::loadFontData(ft, result.fontBytes.data(), int(result.fontBytes.size()));
    FontGuard guard(ft, fontHandle);
    if (!fontHandle) throw std::runtime_error("invalid or unsupported font: FreeType could not create FT_Face");

    std::vector<GlyphGeometry> glyphs;
    FontGeometry font(&glyphs);
    int loaded = font.loadCharset(fontHandle, 1.0, charset, true, true);
    if (loaded < 0) throw std::runtime_error("failed to load font metrics or glyph geometry");
    if (!loaded) throw std::runtime_error("none of the requested charset glyphs are present in the font");

    TightAtlasPacker packer;
    if (options.width && options.height) packer.setDimensions(options.width, options.height);
    else packer.setDimensionsConstraint(DimensionsConstraint::MULTIPLE_OF_FOUR_SQUARE);
    const bool maskType = options.type == "hardmask" || options.type == "softmask";
    const bool multiChannelType = options.type == "msdf" || options.type == "mtsdf";
    packer.setSpacing(multiChannelType ? 0 : -1);
    packer.setScale(options.size);
    packer.setPixelRange(msdfgen::Range(maskType ? 1.0 : options.pxRange));
    packer.setMiterLimit(options.type == "psdf" || multiChannelType ? 1.0 : 0.0);
    packer.setOriginPixelAlignment(false, true);
    int remaining = packer.pack(glyphs.data(), int(glyphs.size()));
    if (remaining < 0) throw std::runtime_error("failed to pack atlas");
    if (remaining > 0) throw std::runtime_error("atlas dimensions are insufficient for the requested glyphs");
    packer.getDimensions(result.width, result.height);
    if (result.width <= 0 || result.height <= 0) throw std::runtime_error("atlas packer produced invalid dimensions");

    if (multiChannelType) {
        void (*coloring)(msdfgen::Shape &, double, unsigned long long) = msdfgen::edgeColoringInkTrap;
        if (options.coloringStrategy == "simple") coloring = msdfgen::edgeColoringSimple;
        else if (options.coloringStrategy == "distance") coloring = msdfgen::edgeColoringByDistance;
        unsigned long long seed = 0;
        for (GlyphGeometry &glyph : glyphs) {
            seed *= 6364136223846793005ull;
            glyph.edgeColoring(coloring, options.angleThreshold, seed);
        }
    }

    GeneratorAttributes attributes;
    attributes.config.overlapSupport = false;
    attributes.scanlinePass = false;
    if (options.type == "hardmask")
        generateBitmap<1, scanlineGenerator>(result, glyphs, options, attributes);
    else if (options.type == "softmask" || options.type == "sdf")
        generateBitmap<1, sdfGenerator>(result, glyphs, options, attributes);
    else if (options.type == "psdf")
        generateBitmap<1, psdfGenerator>(result, glyphs, options, attributes);
    else if (options.type == "msdf")
        generateBitmap<3, msdfGenerator>(result, glyphs, options, attributes);
    else
        generateBitmap<4, mtsdfGenerator>(result, glyphs, options, attributes);
    if (result.png.size() < 8 || result.png[0] != 0x89 || result.png[1] != 'P' || result.png[2] != 'N' || result.png[3] != 'G') throw std::runtime_error("PNG encoder returned invalid data");
    result.metadata = makeMetadata(font, options, result.width, result.height, packer.getScale(), packer.getPixelRange());
}

static void getFontCharset(FontCharsetResultHandle &result, const uint8_t *fontData, size_t fontSize) {
    if (!fontData || !fontSize) throw std::runtime_error("font data is empty");
    if (fontSize > size_t(std::numeric_limits<FT_Long>::max())) throw std::runtime_error("font is too large");

    FT_Library library = nullptr;
    FT_Face face = nullptr;
    if (FT_Init_FreeType(&library)) throw std::runtime_error("failed to initialize FreeType");
    try {
        if (FT_New_Memory_Face(library, fontData, FT_Long(fontSize), 0, &face))
            throw std::runtime_error("invalid or unsupported font: FreeType could not create FT_Face");
        if (FT_Select_Charmap(face, FT_ENCODING_UNICODE))
            throw std::runtime_error("font does not contain a Unicode character map");

        FT_UInt glyphIndex = 0;
        FT_ULong codepoint = FT_Get_First_Char(face, &glyphIndex);
        while (glyphIndex) {
            if (codepoint <= 0x10ffff && !(codepoint >= 0xd800 && codepoint <= 0xdfff)) {
                result.codepoints.push_back(uint32_t(codepoint));
                result.glyphIndices.push_back(uint32_t(glyphIndex));
            }
            codepoint = FT_Get_Next_Char(face, codepoint, &glyphIndex);
        }
        if (result.codepoints.empty()) throw std::runtime_error("font Unicode character map is empty");
    } catch (...) {
        if (face) FT_Done_Face(face);
        FT_Done_FreeType(library);
        throw;
    }
    FT_Done_Face(face);
    FT_Done_FreeType(library);
}

} // namespace

extern "C" {

MSDF_WASM_KEEPALIVE AtlasResultHandle *msdf_generate_atlas(const uint8_t *font_data, size_t font_size, const char *options_json) {
    AtlasResultHandle *result = new (std::nothrow) AtlasResultHandle;
    if (!result) return nullptr;
    try { generate(*result, font_data, font_size, options_json); }
    catch (const std::bad_alloc &) { result->error = "out of memory while generating atlas"; }
    catch (const std::exception &e) { result->error = e.what(); }
    catch (...) { result->error = "unknown native atlas generation failure"; }
    return result;
}

MSDF_WASM_KEEPALIVE const uint8_t *msdf_result_png_data(const AtlasResultHandle *r) { return r && !r->png.empty() ? r->png.data() : nullptr; }
MSDF_WASM_KEEPALIVE size_t msdf_result_png_size(const AtlasResultHandle *r) { return r ? r->png.size() : 0; }
MSDF_WASM_KEEPALIVE const char *msdf_result_metadata_json(const AtlasResultHandle *r) { return r && !r->metadata.empty() ? r->metadata.c_str() : nullptr; }
MSDF_WASM_KEEPALIVE const char *msdf_result_error(const AtlasResultHandle *r) { return r && !r->error.empty() ? r->error.c_str() : nullptr; }
MSDF_WASM_KEEPALIVE int msdf_result_width(const AtlasResultHandle *r) { return r ? r->width : 0; }
MSDF_WASM_KEEPALIVE int msdf_result_height(const AtlasResultHandle *r) { return r ? r->height : 0; }
MSDF_WASM_KEEPALIVE void msdf_destroy_result(AtlasResultHandle *r) { delete r; }

MSDF_WASM_KEEPALIVE FontCharsetResultHandle *msdf_get_font_charset(const uint8_t *font_data, size_t font_size) {
    FontCharsetResultHandle *result = new (std::nothrow) FontCharsetResultHandle;
    if (!result) return nullptr;
    try { getFontCharset(*result, font_data, font_size); }
    catch (const std::bad_alloc &) { result->error = "out of memory while reading font charset"; }
    catch (const std::exception &e) { result->error = e.what(); }
    catch (...) { result->error = "unknown native font charset failure"; }
    return result;
}

MSDF_WASM_KEEPALIVE const uint32_t *msdf_font_charset_data(const FontCharsetResultHandle *r) { return r && !r->codepoints.empty() ? r->codepoints.data() : nullptr; }
MSDF_WASM_KEEPALIVE const uint32_t *msdf_font_charset_glyph_indices(const FontCharsetResultHandle *r) { return r && !r->glyphIndices.empty() ? r->glyphIndices.data() : nullptr; }
MSDF_WASM_KEEPALIVE size_t msdf_font_charset_size(const FontCharsetResultHandle *r) { return r ? r->codepoints.size() : 0; }
MSDF_WASM_KEEPALIVE const char *msdf_font_charset_error(const FontCharsetResultHandle *r) { return r && !r->error.empty() ? r->error.c_str() : nullptr; }
MSDF_WASM_KEEPALIVE void msdf_destroy_font_charset_result(FontCharsetResultHandle *r) { delete r; }

}
