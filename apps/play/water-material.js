import { Filter, GlProgram, Texture, UniformGroup } from "pixi.js";

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(x) || 0));
const value = (p, key, fallback) => (Number.isFinite(Number(p[key])) ? Number(p[key]) : fallback);
const color = (hex, fallback) => {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return fallback;
  const raw = hex.slice(hex.length === 9 ? 3 : 1);
  return [0, 2, 4].map((at) => parseInt(raw.slice(at, at + 2), 16) / 255);
};
const implemented = new Set(
  "custom_water_color use_custom_water_color noise_aspect_ratio noise_magnification noise_speed reflection_intensity normal_map_scroll_speed_x normal_map_scroll_speed_y normal_map_speed_scale highlight_cutoff_threshold highlight_intensity water_blend_ratio base_color_saturation base_color_brightness condensing_pattern_color condensing_pattern_intensity condensing_pattern_scale condensing_pattern_speed falling_fluctuation_speed falling_fluctuation_height falling_speed falling_length water_depth_level bottom_water_depth_level ground__water_depth_level bottom_unified_water_depth_alpha".split(
    " ",
  ),
);
const toLinear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const toDisplay = (x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);

/** Defaults from PR Last/MapWaterOpaqueTileShader, rather than a per-map color guess. */
export function waterMaterialConfig(
  material = {},
  layerName = "",
  { properties = {}, time = 0 } = {},
) {
  const p = material.properties || {},
    depthKey = layerName.startsWith("Bottom")
      ? "bottom_water_depth_level"
      : layerName.startsWith("Ground")
        ? "ground__water_depth_level"
        : "water_depth_level";
  const config = {
    color: color(p.custom_water_color, [0.01, 0.02, 0.2]),
    useColor: p.use_custom_water_color === true,
    blend: clamp(value(p, "water_blend_ratio", 0.2)),
    saturation: value(p, "base_color_saturation", 0.78),
    brightness: value(p, "base_color_brightness", 0.45),
    noiseSpeed: value(p, "noise_speed", 0.05),
    noiseAspect: value(p, "noise_aspect_ratio", 0.1),
    noiseMagnitude: value(p, "noise_magnification", 1),
    normalSpeed: [
      value(p, "normal_map_scroll_speed_x", -0.01),
      value(p, "normal_map_scroll_speed_y", 0.01),
    ],
    normalScale: value(p, "normal_map_speed_scale", 2),
    reflection: value(p, "reflection_intensity", 0.25),
    highlightCutoff: value(p, "highlight_cutoff_threshold", 1.22),
    highlight: value(p, "highlight_intensity", 20),
    patternColor: color(p.condensing_pattern_color, [1, 1, 1]),
    patternIntensity: value(p, "condensing_pattern_intensity", 0.05),
    patternScale: value(p, "condensing_pattern_scale", 4),
    patternSpeed: value(p, "condensing_pattern_speed", 1),
    fallSpeed: value(p, "falling_speed", 0.04),
    fallLength: value(p, "falling_length", 0.16),
    fallFluctuationSpeed: value(p, "falling_fluctuation_speed", 0.4),
    fallFluctuationHeight: value(p, "falling_fluctuation_height", 4),
    depth: clamp(value(p, depthKey, value(p, "water_depth_level", 1))),
    unifiedDepth: p.bottom_unified_water_depth_alpha === true,
    opacity:
      typeof p.custom_water_color === "string" && /^#[0-9a-f]{8}$/i.test(p.custom_water_color)
        ? parseInt(p.custom_water_color.slice(1, 3), 16) / 255
        : 1,
    unknown: Object.keys(p).filter((key) => !implemented.has(key)),
    unknownTracks: [],
  };
  const plane = { Bottom: 0, Ground: 1, Upper: 2, Ceil: 3 }[
      Object.keys({ Bottom: 0, Ground: 1, Upper: 2, Ceil: 3 }).find((key) =>
        layerName.startsWith(key),
      )
    ],
    fields = {
      _CondensingPatternIntensity: "patternIntensity",
      _FluctuationMagnification: "noiseMagnitude",
      _HighlightIntensity: "highlight",
      _WaterOffsetY: "waterOffsetY",
    };
  const tracks = Object.entries(properties).sort(
    ([, a], [, b]) => (a.time || 0) - (b.time || 0) || (a.order || 0) - (b.order || 0),
  );
  for (const [key, track] of tracks) {
    const name = track.name ?? key;
    if (Number.isFinite(track.layer) && track.layer >= 0 && track.layer !== plane) continue;
    const progress = track.duration > 0 ? clamp((time - track.time) / track.duration) : 1,
      current = track.from + (track.to - track.from) * progress,
      channel = /^_WaterColor:([RGBA])$/.exec(name);
    if (channel) {
      if (channel[1] === "A") config.opacity = clamp(current / 255);
      else config.color["RGB".indexOf(channel[1])] = clamp(current / 255);
    } else if (fields[name]) config[fields[name]] = current;
    else config.unknownTracks.push(name);
  }
  return config;
}

/** RGB carries material controls; only the source alpha determines raster coverage. */
export function waterControlWeights(rgba) {
  const a = clamp(rgba[3]),
    rgb = rgba.slice(0, 3).map((c) => clamp(a ? c / a : 0));
  return {
    surface: rgb[2] * a,
    fall: rgb[0] * a,
    highlight: rgb[1] * a,
    coverage: a,
  };
}

// CPU counterpart for checking controller leakage and authored tint/floor composition.
export function shadeWaterPixel(config, control, floor, { pattern = 0, highlight = 0 } = {}) {
  const mask = waterControlWeights(control),
    coverage = mask.coverage * clamp(config.opacity),
    strength = mask.coverage
      ? Math.max(mask.surface, mask.fall, mask.highlight) / mask.coverage
      : 0,
    linear = floor.slice(0, 3).map(toLinear),
    luma = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722,
    base = linear.map((x) => (luma + (x - luma) * config.saturation) * config.brightness),
    tint = config.useColor ? config.color.map(toLinear) : base,
    rgb = base.map((x, i) =>
      toDisplay(
        clamp(
          x * (1 - config.blend) +
            tint[i] * config.blend +
            toLinear(config.patternColor[i]) * pattern * config.patternIntensity +
            highlight * config.reflection,
        ),
      ),
    );
  return [...rgb.map((x, i) => (floor[i] * (1 - strength) + x * strength) * coverage), coverage];
}

const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vWorld;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec4 uWorld;
void main(){
 vec2 p=aPosition*uOutputFrame.zw+uOutputFrame.xy;
 vWorld=uWorld.xy+p/max(0.0001,uWorld.z);
 gl_Position=vec4(p.x*2.0/uOutputTexture.x-1.0,p.y*2.0*uOutputTexture.z/uOutputTexture.y-uOutputTexture.z,0.0,1.0);
 vTextureCoord=aPosition*uOutputFrame.zw*uInputSize.zw;
}`;
const FRAGMENT = `#version 300 es
in vec2 vTextureCoord;
in vec2 vWorld;
out vec4 finalColor;
uniform sampler2D uTexture,uBackTexture,uNoise,uNormalSmall,uNormalLarge,uPattern,uPalette;
uniform vec4 uInputSize,uInputClamp,uBackClamp,uBackScale;
uniform vec4 uNoiseRect,uNormalSmallRect,uNormalLargeRect,uPatternRect,uPaletteRect,uPaletteData;
uniform vec4 uTint,uBase,uNoiseData,uNormalData,uLight,uPatternData,uPatternColor,uFall;
uniform float uTime,uPaletteOffset;
vec4 sampleRegion(sampler2D image,vec4 rect,vec2 uv){return texture(image,mix(rect.xy,rect.zw,fract(uv)));}
vec3 straight(vec4 p){return p.a>0.00001?p.rgb/p.a:vec3(0.0);}
vec3 toLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 toDisplay(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1.0/2.4))-.055,step(vec3(.0031308),c));}
void main(){
 vec4 control=texture(uTexture,vTextureCoord);
 vec3 channel=straight(control);
 float paletteIndex=floor(channel.r*uPaletteData.z)+1.0;
 bool indexed=uPaletteData.z>1.5&&channel.g>.99&&channel.b>.99&&channel.r>.005&&paletteIndex<=uPaletteData.z;
 if(indexed){
  if(uPaletteData.w<.5){finalColor=vec4(0.0);return;}
  float frame=mod(floor(uTime*uPaletteData.x*uPaletteData.y),uPaletteData.y);
  vec4 palette=sampleRegion(uPalette,uPaletteRect,vec2((frame+.5)/uPaletteData.y,(mod(paletteIndex-1.0+uPaletteOffset,uPaletteData.z)+.5)/uPaletteData.z));
  channel=straight(palette);control.a*=palette.a;
 }
 float mask=control.a*clamp(uBase.w,0.0,1.0);
 if(mask<0.0001){finalColor=vec4(0.0);return;}
 float strength=max(channel.r,max(channel.g,channel.b));
 vec3 originalFloor=straight(texture(uBackTexture,clamp(vTextureCoord*uBackScale.xy,uBackClamp.xy,uBackClamp.zw)));
 // Opaque black is data in the control render target, not water over a bank wall.
 // Preserve raster alpha while retaining the unmodified lower scene outside its RGB effect mask.
 if(strength<.0001){finalColor=vec4(originalFloor*mask,mask);return;}
 vec2 uv=vWorld/128.0;
 vec2 motion=uNormalData.xy*uTime;
 vec3 small=straight(sampleRegion(uNormalSmall,uNormalSmallRect,uv+motion));
 vec3 large=straight(sampleRegion(uNormalLarge,uNormalLargeRect,uv*.5+motion*uNormalData.z));
 float noise=sampleRegion(uNoise,uNoiseRect,uv*vec2(1.0,max(.01,uNoiseData.y))+uTime*uNoiseData.x).r;
 // Decode both normal maps from [0,1] to signed tangent-space slopes.
 vec2 normal=(small.xy+large.xy)*2.0-2.0;
 vec2 displacement=(normal+(noise-.5))*uNoiseData.z;
 // The back buffer holds the actual lower tile plane, not a fabricated floor.
 vec2 backUV=(vTextureCoord+displacement*uInputSize.zw)*uBackScale.xy;
 vec4 floor=texture(uBackTexture,clamp(backUV,uBackClamp.xy,uBackClamp.zw));
 vec3 base=toLinear(straight(floor));float luma=dot(base,vec3(.2126,.7152,.0722));
 base=mix(vec3(luma),base,uBase.y)*uBase.z;
 vec3 waterTint=toLinear(uTint.rgb);
 vec3 tint=mix(base,waterTint,uTint.a);
 vec3 rgb=mix(base,tint,uBase.x);
 // PR's WaterTex is a generated reflected scene, not the (often black) pool floor.
 // Until that separate scene pass is reproduced, retain authored water chromaticity
 // and reflection strength, illuminated by the original normal maps.
 float tintPeak=max(waterTint.r,max(waterTint.g,waterTint.b));
 vec3 reflectionTint=tintPeak>.0001?waterTint/tintPeak:vec3(1.0);
 vec3 surfaceNormal=normalize(vec3(normal,small.b+large.b-1.0));
 float illumination=.35+.65*max(0.0,dot(surfaceNormal,normalize(vec3(.4,.6,1.0))));
 rgb+=reflectionTint*uLight.x*illumination;
 float pattern=sampleRegion(uPattern,uPatternRect,uv*uPatternData.y+normal*.05+vec2(uTime*uPatternData.z*.01,-uTime*uPatternData.z*.007)).a;
 rgb+=toLinear(uPatternColor.rgb)*pattern*uPatternData.x;
 float light=max(0.0,small.b+large.b-1.0+dot(normal,normalize(vec2(.4,.6)))-uLight.y)*uLight.z;
 rgb+=(light/(1.0+light))*uLight.x;
 float fall=channel.r;
 float streak=.5+.5*sin((vWorld.y-uTime*uFall.x*128.0+sin(vWorld.x*.3+uTime*uFall.z)*uFall.w)*max(.02,uFall.y)*6.2831853);
 rgb+=fall*streak*.12*mix(vec3(1.0),waterTint,uTint.a);
 vec3 display=toDisplay(clamp(rgb,0.0,1.0));
 finalColor=vec4(mix(originalFloor,display,strength)*mask,mask);
}`;

function textureRect(texture) {
  const f = texture.frame,
    s = texture.source;
  return new Float32Array([
    f.x / s.width,
    f.y / s.height,
    (f.x + f.width) / s.width,
    (f.y + f.height) / s.height,
  ]);
}

/** One shared-resource compositing pass per water tile layer, never one filter per tile. */
export class WaterMaterial extends Filter {
  constructor({ getTexture = () => null, warn = console.warn, collectAll = () => false } = {}) {
    const values = { uTime: { value: 0, type: "f32" }, uPaletteOffset: { value: 0, type: "f32" } };
    for (const name of [
      "uWorld",
      "uTint",
      "uBase",
      "uNoiseData",
      "uNormalData",
      "uLight",
      "uPatternData",
      "uPatternColor",
      "uFall",
      "uBackScale",
      "uPaletteData",
    ])
      values[name] = { value: new Float32Array(4), type: "vec4<f32>" };
    for (const name of [
      "uNoiseRect",
      "uNormalSmallRect",
      "uNormalLargeRect",
      "uPatternRect",
      "uBackClamp",
      "uPaletteRect",
    ])
      values[name] = { value: new Float32Array([0, 0, 1, 1]), type: "vec4<f32>" };
    super({
      glProgram: GlProgram.from({
        name: "pr-map-water-composite",
        vertex: VERTEX,
        fragment: FRAGMENT,
        preferredFragmentPrecision: "highp",
      }),
      resources: {
        waterUniforms: new UniformGroup(values),
        uNoise: Texture.WHITE.source,
        uNormalSmall: Texture.WHITE.source,
        uNormalLarge: Texture.WHITE.source,
        uPattern: Texture.EMPTY.source,
        uPalette: Texture.WHITE.source,
      },
      blendRequired: true,
      resolution: 1,
      antialias: false,
      padding: 0,
    });
    this.getTexture = getTexture;
    this.warn = warn;
    this.collectAll = collectAll;
    this.warnings = new Set();
    this.ready = false;
  }
  once(key, reason, details = {}) {
    if (this.warnings.has(key) && !this.collectAll()) return;
    this.warnings.add(key);
    this.warn(key, reason, details);
  }
  update(
    material,
    { time = 0, x = 0, y = 0, scale = 1, layerName = "", mapId, depth, properties = {} } = {},
  ) {
    this.once(
      "water-material-approximate",
      "PR controller channels and source textures are composited over the actual lower tile plane; exact DXBC channel ordering, scene reflections and water-depth geometry remain approximated.",
      { mapId, layer: layerName },
    );
    this.once(
      "water-scene-reflection-approximate",
      "PR WaterTex is a generated scene/reflection buffer, and many source pool-floor tiles are intentionally black. The web substitute illuminates source normal maps with authored WaterColor chromaticity and ReflectionIntensity; it does not reproduce the separate reflected scene pass.",
      { mapId, layer: layerName },
    );
    this.once(
      "water-color-space-adapted",
      "PNG and authored HTML colors are decoded from sRGB for lighting, then encoded to the web canvas. Native render-target color-space state is not exported; this is a web color-space adaptation.",
      { mapId, layer: layerName },
    );
    if (!material) {
      this.once(
        "water-metadata-missing",
        "WaterGroup is missing exported source material properties; its controller RGB must not be drawn directly.",
        { mapId, layer: layerName },
      );
      return false;
    }
    const config = waterMaterialConfig(material, layerName, { properties, time }),
      u = this.resources.waterUniforms.uniforms;
    for (const name of config.unknown)
      this.once(
        `water-property:${name}`,
        `Unimplemented PR water property ${name} is retained in metadata.`,
        { mapId, layer: layerName },
      );
    for (const name of config.unknownTracks)
      this.once(`water-track:${name}`, `Unimplemented PR Water command property ${name}.`, {
        mapId,
        layer: layerName,
      });
    if (config.waterOffsetY)
      this.once(
        "water-offset-geometry-unimplemented",
        "PR _WaterOffsetY is retained, but geometric shoreline displacement is not yet reproduced.",
        { mapId, layer: layerName, offsetY: config.waterOffsetY },
      );
    u.uTime = time;
    u.uWorld.set([x, y, scale, 0]);
    u.uTint.set([...config.color, Number(config.useColor)]);
    u.uBase.set([config.blend, config.saturation, config.brightness, config.opacity]);
    u.uNoiseData.set([config.noiseSpeed, config.noiseAspect, config.noiseMagnitude, 0]);
    u.uNormalData.set([...config.normalSpeed, config.normalScale, 0]);
    u.uLight.set([config.reflection, config.highlightCutoff, config.highlight, 0]);
    u.uPatternData.set([config.patternIntensity, config.patternScale, config.patternSpeed, 0]);
    u.uPatternColor.set([...config.patternColor, 1]);
    u.uFall.set([
      config.fallSpeed,
      config.fallLength,
      config.fallFluctuationSpeed,
      config.fallFluctuationHeight,
    ]);
    this.ready = true;
    u.uPaletteData.set([0, 1, 1, 0]);
    u.uPaletteOffset = 0;
    for (const [key, name] of Object.entries({
      noise: "uNoise",
      normalSmall: "uNormalSmall",
      normalLarge: "uNormalLarge",
      pattern: "uPattern",
    })) {
      const image = material.textures?.[key];
      if (!image?.url) {
        this.resources[name] = Texture.EMPTY.source;
        this.once(`water-input:${key}`, `Required PR water texture ${key} is absent.`, {
          mapId,
          layer: layerName,
          resource: key,
        });
        this.ready = false;
        continue;
      }
      const texture = this.getTexture(image.url, {
        required: true,
        entityId: `water:${mapId}:${layerName}`,
        resource: key,
      });
      if (!texture || texture.destroyed || !texture.source || texture.source.destroyed) {
        this.resources[name] = Texture.EMPTY.source;
        this.ready = false;
        continue;
      }
      this.resources[name] = texture.source;
      u[name + "Rect"].set(textureRect(texture));
    }
    if (material.palette) {
      const palette = material.palette,
        texture = this.getTexture(palette.url, {
          required: true,
          entityId: `water:${mapId}:${layerName}`,
          resource: "PR water palette animation",
        });
      u.uPaletteData.set([
        palette.speed ?? 1,
        palette.frameCount,
        palette.colors,
        Number(!!texture),
      ]);
      u.uPaletteOffset = palette.bankOffset || 0;
      if (texture && !texture.destroyed && texture.source && !texture.source.destroyed) {
        this.resources.uPalette = texture.source;
        u.uPaletteRect.set(textureRect(texture));
      } else {
        this.resources.uPalette = Texture.WHITE.source;
        this.ready = false;
      }
      this.once(
        "water-palette-layout-inferred",
        "PR nonzero RGBA 0/128 markers are decoded as little-endian, one-based palette indices; WaterGroup uses the second source color bank (first can be black/transparent), inferred from the original palettes. Source pal_anim_speed is interpreted as cycles per second; native shader time scaling is not exported.",
        {
          mapId,
          layer: layerName,
          colors: palette.colors,
          frames: palette.frameCount,
          speed: palette.speed,
        },
      );
    } else this.resources.uPalette = Texture.WHITE.source;
    if (config.unifiedDepth || config.depth !== 1 || depth != null)
      this.once(
        "water-depth-geometry-unimplemented",
        "Source water-depth levels are retained, but depth/shore geometry is not reproduced; geometric depth zero is not interpreted as surface opacity zero.",
        { mapId, layer: layerName, depth: depth ?? config.depth },
      );
    return this.ready;
  }
  apply(manager, input, output, clear) {
    const back = manager.activeBackTexture,
      u = this.resources.waterUniforms.uniforms;
    if (back) {
      u.uBackScale.set([
        input.source.width / back.source.width,
        input.source.height / back.source.height,
        0,
        0,
      ]);
      u.uBackClamp.set([
        0.5 / back.source.pixelWidth,
        0.5 / back.source.pixelHeight,
        back.frame.width / back.source.width - 0.5 / back.source.pixelWidth,
        back.frame.height / back.source.height - 0.5 / back.source.pixelHeight,
      ]);
    }
    manager.applyFilter(this, input, output, clear);
  }
}
