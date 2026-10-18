import {
  Filter,
  GlProgram,
  UniformGroup,
  Texture,
  Sprite,
  RenderTexture,
  Rectangle,
} from "pixi.js";

const WHITE = [1, 1, 1, 1],
  BLACK = [0, 0, 0, 1];
const clamp = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a + (b - a) * t;
const reported = new Set();

/** Known Tiled image-layer controls; camera/parallax layout stays with caller. */
export function materialFromLayer(shaderName, layerProperties = {}, textures = {}) {
  const p = Array.isArray(layerProperties)
    ? Object.fromEntries(layerProperties.map((row) => [row.name, row.value]))
    : layerProperties;
  const floats = {},
    colors = {};
  const mapping = {
    h_speed: "_AutoScrollOffsetX",
    v_speed: "_AutoScrollOffsetY",
    h_center_width: "_HLoopSize",
    v_center_height: "_VLoopSize",
    h_left_width: "_LeftOffset",
    v_bottom_height: "_BottomOffset",
    ocean_whitecap_intensity: "_OceanAlphaIntensity",
    ocean_subsolar_point_x: "_SubSolarX",
    ocean_subsolar_point_y: "_SubSolarY",
    ocean_subsolar_radius: "_SubSolarRadius",
    width: "_Width",
    height: "_Height",
  };
  for (const [name, target] of Object.entries(mapping))
    if (Number.isFinite(p[name])) floats[target] = p[name];
  for (const [name, target] of [
    ["ocean_surface_base_color", "_OceanBaseColor"],
    ["ocean_surface_add_color", "_OceanAddColor"],
  ]) {
    const raw = p[name]?.replace(/^#/, "");
    if (raw && /^[0-9a-f]{8}$/i.test(raw))
      colors[target] = [2, 4, 6, 0].map((at) => parseInt(raw.slice(at, at + 2), 16) / 255);
  }
  return { shader: shaderName, floats, colors, textures };
}

const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vLocalCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  p.x = p.x * (2.0 / uOutputTexture.x) - 1.0;
  p.y = p.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(p, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vLocalCoord = aPosition;
}`;

const FRAGMENT = `#version 300 es
in vec2 vTextureCoord;
in vec2 vLocalCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uMaskTexture;
uniform sampler2D uNoiseTexture;
uniform sampler2D uGradientTexture;
uniform sampler2D uRampTexture;
uniform sampler2D uSecondTexture;
uniform vec4 uInputClamp;
uniform vec4 uMaskRect, uNoiseRect, uGradientRect, uRampRect, uSecondRect;
uniform float uTime, uMode, uOpacity;
uniform vec4 uColor, uBlack, uWhite, uEdgeColor;
uniform vec4 uFlags1, uFlags2, uFlags3;
uniform vec4 uParam1, uParam2, uParam3, uGradient;
uniform vec4 uBaseUV, uMaskUV, uNoiseUV;
uniform vec2 uBaseScroll, uMaskScroll, uNoiseScroll;
uniform vec4 uScene, uSceneUV, uMaskTransform, uMosaic;
uniform vec2 uMaskMode;
uniform vec4 uScreen1, uScreen2, uScreen3, uScreen4, uScreen5;
uniform vec4 uWater1, uWater2, uFilterGradient;
const float PI = 3.141592653589793;
vec4 region(sampler2D image, vec4 rect, vec2 uv) {
  return texture(image, mix(rect.xy, rect.zw, fract(uv)));
}
vec4 inputAt(vec2 uv) {
  return texture(uTexture, mix(uInputClamp.xy, uInputClamp.zw, clamp(uv, 0.0, 1.0)));
}
vec3 straight(vec4 value) { return value.a > 0.00001 ? value.rgb / value.a : vec3(0.0); }
float grey(vec3 rgb) { return max(rgb.r, max(rgb.g, rgb.b)); }
vec4 particleMaterial() {
  vec2 uv = vLocalCoord;
  if (uFlags3.x > 0.5) { vec2 p = uv - 0.5; uv = vec2(atan(p.y,p.x)/(2.0*PI)+0.5,length(p)*2.0); }
  if (uFlags3.y > 0.5) uv = (floor(uv * max(1.0,uParam3.x)) + 0.5) / max(1.0,uParam3.x);
  vec2 noiseUV = uv * uNoiseUV.xy + uNoiseUV.zw + uNoiseScroll * uTime;
  vec4 noise = region(uNoiseTexture,uNoiseRect,noiseUV);
  noise.rgb = straight(noise);
  if (uFlags1.y > 0.5) uv += (noise.rg - 0.5) * uParam3.w;
  vec2 baseUV = uv * uBaseUV.xy + uBaseUV.zw + uBaseScroll * uTime;
  vec4 base = inputAt(fract(baseUV));
  vec3 rgb = straight(base);
  float luma = grey(rgb), alpha = base.a;
  vec4 mask = region(uMaskTexture,uMaskRect,uv*uMaskUV.xy+uMaskUV.zw+uMaskScroll*uTime);
  if (uFlags2.x > 0.5) alpha *= luma;
  if (uFlags1.x > 0.5) alpha *= straight(mask).r * mask.a;
  if (uFlags1.w > 0.5) {
    float shape = uFlags1.y > 0.5 ? noise.r : (uFlags1.x > 0.5 ? straight(mask).r : luma);
    float edge = max(0.001,0.1*abs(uParam1.w));
    alpha *= smoothstep(1.0-uParam1.z,1.0-uParam1.z+edge,shape);
  }
  if (uFlags1.z > 0.5) {
    rgb = mix(uBlack.rgb,uWhite.rgb,clamp(luma,0.0,1.0));
    if (uGradient.x > 0.5) {
      vec4 g = region(uGradientTexture,uGradientRect,vec2(luma+uTime*uGradient.y,0.5));
      rgb = mix(rgb,straight(g),clamp(uGradient.z,0.0,1.0));
    }
  }
  if (uFlags2.w > 0.5) rgb = straight(region(uRampTexture,uRampRect,vec2(luma+uTime*uGradient.w,0.5)));
  if (uFlags2.y > 0.5) {
    float lo=min(uParam2.y,uParam2.z), hi=max(uParam2.y,uParam2.z);
    float weight=step(lo,alpha)*(1.0-step(hi,alpha));
    rgb=mix(rgb,uEdgeColor.rgb,weight*uEdgeColor.a);
  }
  if (uFlags2.z > 0.5 && alpha < uParam2.x) alpha=0.0;
  rgb *= uColor.rgb * (1.0 + max(0.0,uParam1.x));
  alpha *= uColor.a;
  alpha = clamp(alpha + uParam1.y * alpha,0.0,1.0);
  if (uFlags3.z > 0.5) rgb=floor(rgb*max(1.0,uParam3.y))/max(1.0,uParam3.y);
  if (uFlags3.w > 0.5) alpha=floor(alpha*max(1.0,uParam3.z))/max(1.0,uParam3.z);
  return vec4(max(rgb,0.0)*alpha,alpha);
}
void main() {
  if (uMode < 0.5) { finalColor=particleMaterial()*uOpacity; return; }
  vec2 uv=vLocalCoord;
  vec2 shift=uSceneUV.xy+uSceneUV.zw*uTime;
  if (uMode == 5.0) {
    uv+=uScreen4.zw*uScreen4.y;
    if (uScreen2.x > 0.5) uv.x+=sin(uv.y*uScreen2.y*2.0*PI+uTime*uScreen2.w)*uScreen2.z;
    if (uScreen3.x > 0.5) uv.x+=sin(uv.y*2.0*PI+uTime*uScreen3.y)*mix(uScreen3.z,uScreen3.w,0.5);
  }
  if (uMode == 7.0) {
    vec4 n=region(uNoiseTexture,uNoiseRect,uv+uTime*uWater1.xy);
    uv+=(n.rg-0.5)*uWater2.y;
    uv.x+=sin(uv.y*max(1.0,uWater1.w)+uTime*uWater2.x)*uWater2.y;
    uv+=uWater1.xy*uTime;
  }
  uv+=shift;
  if ((uMode==3.0 || uMode==6.0) && uMosaic.z>0.5) uv=(floor(uv*max(uMosaic.xy,1.0))+0.5)/max(uMosaic.xy,1.0);
  vec4 inputColor=inputAt(fract(uv));
  vec3 rgb=straight(inputColor); float alpha=inputColor.a;
  if (uMode==1.0) {
    vec4 b=region(uSecondTexture,uSecondRect,uv);
    inputColor=mix(inputColor,b,clamp(uScene.x,0.0,1.0)); rgb=straight(inputColor); alpha=inputColor.a;
  }
  if (uMode==2.0) {
    vec2 maskUV=(vLocalCoord-0.5)*uMaskTransform.xy+0.5+uMaskTransform.zw;
    vec4 mask=region(uMaskTexture,uMaskRect,maskUV);
    float inside=step(0.0,maskUV.x)*step(maskUV.x,1.0)*step(0.0,maskUV.y)*step(maskUV.y,1.0);
    float m=mix(straight(mask).r*mask.a,mask.a,uMaskMode.x)*inside+(1.0-inside)*uMaskMode.y;
    if (uScene.w>0.5) m=1.0-m;
    alpha*=m;
  }
  if (uMode==3.0 || uMode==6.0) {
    rgb=uScene.w>0.5 ? rgb+uColor.rgb*uScene.z : mix(rgb,rgb*uColor.rgb,uScene.z);
    if(uMode==6.0)rgb=mix(rgb,1.0-rgb,clamp(uScreen5.z,0.0,1.0));
  } else if (uMode==4.0) {
    float amount=clamp((vLocalCoord.y-(1.0-uFilterGradient.x))*uFilterGradient.z+uFilterGradient.y,0.0,1.0);
    rgb*=mix(uWhite.rgb,uBlack.rgb,amount);
  } else if(uMode==8.0) {
    vec4 b=region(uSecondTexture,uSecondRect,uv); rgb=mix(rgb,straight(b),b.a)*uColor.rgb; alpha=alpha+b.a*(1.0-alpha);
  } else if(uMode!=1.0 && uMode!=2.0 && uMode!=7.0) rgb*=uColor.rgb;
  if (uMode==5.0) {
    float luma=dot(rgb,vec3(0.2126,0.7152,0.0722)); rgb=mix(vec3(luma),rgb,uScreen1.y);
    vec3 sepia=vec3(dot(rgb,vec3(.393,.769,.189)),dot(rgb,vec3(.349,.686,.168)),dot(rgb,vec3(.272,.534,.131)));
    rgb=mix(rgb,sepia,clamp(uScreen1.z,0.0,1.0))*uScreen1.x;
    rgb*=clamp(1.0-dot(vLocalCoord-0.5,vLocalCoord-0.5)*uScreen1.w,0.0,1.0);
    if(uScreen5.x>0.0) {
      vec2 stepUV=vec2(1.0/max(1.0,uMosaic.x),1.0/max(1.0,uMosaic.y))*max(1.0,uScreen5.y);
      vec3 blur=straight(inputAt(uv+vec2(stepUV.x,0.0)))+straight(inputAt(uv-vec2(stepUV.x,0.0)))+straight(inputAt(uv+vec2(0.0,stepUV.y)))+straight(inputAt(uv-vec2(0.0,stepUV.y)));
      rgb=mix(rgb,blur*0.25,clamp(uScreen5.x,0.0,1.0));
    }
  }
  if(uMode==7.0) {
    if(uWater1.z>0.5){
      rgb=uColor.rgb*uWater2.z+uBlack.rgb*inputColor.g*uWater2.w;
      // PR's opaque ocean shader uses the texture as wave controls. Its
      // transparent gaps are calm water, never holes exposing black or sky.
      alpha=1.0;
    }
    else {rgb=rgb*uColor.rgb*uWater2.z+uBlack.rgb;alpha*=uWater2.w;}
  }
  if(alpha<uScene.y)alpha=0.0;
  alpha*=uOpacity*uColor.a;
  finalColor=vec4(max(rgb,0.0)*alpha,alpha);
}`;

function modeFor(name) {
  if (name === "Last/LastEffectMaster") return 0;
  if (/FarBgCrossFade/.test(name)) return 1;
  if (/Foreground.*AlphaMask/.test(name)) return 2;
  if (name === "Last/LastBackGround") return 3;
  if (/FilterColor/.test(name)) return 4;
  if (/FilterScreen/.test(name)) return 5;
  if (/LastSpriteMaster/.test(name)) return 6;
  if (/Ocean|Water|Warter|river/.test(name)) return 7;
  if (/LastMapOverlay/.test(name)) return 8;
  return 9;
}

export function needsMaterialProcessing(material) {
  const f = material?.floats || {};
  return [
    "_UseMask",
    "_UseNoise",
    "_UseGradient",
    "_Dissolve",
    "_BaseToAlpha",
    "_AlphaEdge",
    "_Cutoff",
    "_UseRamp",
    "_BaseScroll",
    "_Polar",
    "_Pixelate",
    "_ColorReduction",
    "_AlphaReduction",
  ].some((name) => f[name]);
}

/** CPU reference for common alpha/color operations (UV sampling is supplied). */
export function shadeMaterialSample(
  material,
  base,
  { mask = WHITE, noise = WHITE, gradient = null, ramp = null } = {},
) {
  const f = material.floats || {},
    c = material.colors || {};
  let rgb = base.slice(0, 3),
    a = base[3],
    luma = Math.max(...rgb);
  if (f._BaseToAlpha) a *= luma;
  if (f._UseMask) a *= mask[0] * mask[3];
  if (f._Dissolve) {
    const shape = f._UseNoise ? noise[0] : f._UseMask ? mask[0] : luma;
    const start = 1 - (f._DissolveOffset ?? 1),
      edge = Math.max(0.001, 0.1 * Math.abs(f._Edge ?? 1));
    const t = clamp((shape - start) / edge);
    a *= t * t * (3 - 2 * t);
  }
  if (f._UseGradient) {
    const lo = c._GradientBlackColor || BLACK,
      hi = c._GradientWhiteColor || WHITE;
    rgb = rgb.map((_, i) => mix(lo[i], hi[i], clamp(luma)));
    if (f._GradientWithTex && gradient)
      rgb = rgb.map((v, i) => mix(v, gradient[i], clamp(f._GradientTexBlend ?? 0.5)));
  }
  if (f._UseRamp && ramp) rgb = ramp.slice(0, 3);
  if (f._AlphaEdge && a >= (f._AlphaEdgeMin ?? 0) && a < (f._AlphaEdgeMax ?? 1)) {
    const edge = c._AlphaEdgeColor || WHITE;
    rgb = rgb.map((v, i) => mix(v, edge[i], edge[3]));
  }
  if (f._Cutoff && a < (f._CutOffThreshold ?? 0.5)) a = 0;
  const tint = c._Color || c._TintColor || material.color || WHITE;
  rgb = rgb.map((v, i) => Math.max(0, v * tint[i] * (1 + Math.max(0, f._Emission || 0))));
  a = clamp(a * tint[3] * (1 + (f._AEmission || 0)));
  if (f._ColorReduction)
    rgb = rgb.map(
      (v) =>
        Math.floor(v * Math.max(1, f._ColorReductionLevel || 8)) /
        Math.max(1, f._ColorReductionLevel || 8),
    );
  if (f._AlphaReduction)
    a =
      Math.floor(a * Math.max(1, f._AlphaReductionLevel || 8)) /
      Math.max(1, f._AlphaReductionLevel || 8);
  return [...rgb.map((v) => v * a), a];
}

/** A single layer/actor Filter. Never attach one to each particle. */
export class PRFilter extends Filter {
  constructor(
    shaderName,
    { getTexture = () => null, material = {}, width = 384, height = 216, warn = console.warn } = {},
  ) {
    const uniforms = {
      uTime: { value: 0, type: "f32" },
      uMode: { value: modeFor(shaderName), type: "f32" },
      uOpacity: { value: 1, type: "f32" },
    };
    for (const name of ["uColor", "uWhite", "uEdgeColor"])
      uniforms[name] = { value: new Float32Array(WHITE), type: "vec4<f32>" };
    for (const name of [
      "uBlack",
      "uFlags1",
      "uFlags2",
      "uFlags3",
      "uParam1",
      "uParam2",
      "uParam3",
      "uGradient",
      "uScene",
      "uSceneUV",
      "uMaskTransform",
      "uMosaic",
      "uScreen1",
      "uScreen2",
      "uScreen3",
      "uScreen4",
      "uScreen5",
      "uWater1",
      "uWater2",
      "uFilterGradient",
    ])
      uniforms[name] = { value: new Float32Array(4), type: "vec4<f32>" };
    for (const name of [
      "uMaskRect",
      "uNoiseRect",
      "uGradientRect",
      "uRampRect",
      "uSecondRect",
      "uBaseUV",
      "uMaskUV",
      "uNoiseUV",
    ])
      uniforms[name] = { value: new Float32Array([0, 0, 1, 1]), type: "vec4<f32>" };
    for (const name of ["uBaseScroll", "uMaskScroll", "uNoiseScroll", "uMaskMode"])
      uniforms[name] = { value: new Float32Array(2), type: "vec2<f32>" };
    const resources = { prUniforms: new UniformGroup(uniforms) };
    for (const name of [
      "uMaskTexture",
      "uNoiseTexture",
      "uGradientTexture",
      "uRampTexture",
      "uSecondTexture",
    ])
      resources[name] = Texture.WHITE.source;
    super({
      glProgram: GlProgram.from({
        name: "pr-source-adapter",
        vertex: VERTEX,
        fragment: FRAGMENT,
        preferredFragmentPrecision: "highp",
      }),
      resources,
      padding: 0,
      resolution: 1,
      antialias: false,
    });
    this.shaderName = shaderName;
    this.getTexture = getTexture;
    this.warn = warn;
    this._warned = new Set();
    this._overrides = {};
    this._textures = {};
    this.width = width;
    this.height = height;
    this.setMaterial(material);
    this._warning(
      "dxbc",
      "WebGL expressions follow PR properties; original D3D11 DXBC operation order and rounding are inferred.",
    );
  }
  _warning(key, message) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    const globalKey = `${this.shaderName}:${key}`;
    if (reported.has(globalKey)) return;
    reported.add(globalKey);
    this.warn(`[PR shader] ${this.shaderName}: ${message}`);
  }
  setMaterial(material) {
    this.material = material || {};
    this._overrides = {};
    this.update(0);
    return this;
  }
  setProperties(properties) {
    Object.assign(this._overrides, properties);
    return this;
  }
  setTexture(name, texture) {
    this._textures[name] = texture;
    return this;
  }
  _texture(name, resource, rect) {
    const descriptor = this.material.textures?.[name],
      texture =
        this._textures[name] ||
        (descriptor?.url
          ? this.getTexture(descriptor.url, {
              required: true,
              entityId: `shader:${this.shaderName}:${name}`,
              animation: name,
            })
          : Texture.WHITE);
    if (!texture || texture.destroyed || !texture.source || texture.source.destroyed) {
      this.resources[resource] = Texture.EMPTY.source;
      return !descriptor;
    }
    this.resources[resource] = texture.source;
    const frame = texture.frame,
      source = texture.source;
    this.resources.prUniforms.uniforms[rect].set([
      (frame.x + 0.5) / source.width,
      (frame.y + 0.5) / source.height,
      (frame.x + frame.width - 0.5) / source.width,
      (frame.y + frame.height - 0.5) / source.height,
    ]);
    return true;
  }
  update(timeSeconds = 0, context = {}) {
    const f = { ...this.material.floats, ...this._overrides },
      c = this.material.colors || {},
      u = this.resources.prUniforms.uniforms;
    const value = (name, fallback = 0) => (Number.isFinite(f[name]) ? f[name] : fallback);
    const vector = (name, array) => u[name].set(array);
    vector("uMaskMode", [context.maskAlphaOnly ? 1 : 0, context.maskOutsideOpaque ? 1 : 0]);
    const color = (name, fallback = WHITE) => this._overrides[name] || c[name] || fallback;
    u.uTime = f._BuiltInTime === 0 ? value("_ElapsedSec") : timeSeconds;
    u.uOpacity = context.opacity ?? value("opacity", 1);
    vector("uColor", color("_Color", color("_TintColor", this.material.color || WHITE)));
    vector("uWhite", color("_GradientWhiteColor"));
    vector("uBlack", color("_GradientBlackColor", BLACK));
    vector("uEdgeColor", color("_AlphaEdgeColor"));
    vector("uFlags1", [
      value("_UseMask"),
      value("_UseNoise"),
      value("_UseGradient"),
      value("_Dissolve"),
    ]);
    vector("uFlags2", [
      value("_BaseToAlpha"),
      value("_AlphaEdge"),
      value("_Cutoff"),
      value("_UseRamp"),
    ]);
    vector("uFlags3", [
      value("_Polar"),
      value("_Pixelate"),
      value("_ColorReduction"),
      value("_AlphaReduction"),
    ]);
    vector("uParam1", [
      value("_Emission"),
      value("_AEmission"),
      value("_DissolveOffset", 1),
      value("_Edge", 1),
    ]);
    vector("uParam2", [
      value("_CutOffThreshold", 0.5),
      value("_AlphaEdgeMin"),
      value("_AlphaEdgeMax", 1),
      value("_PreMultiplyAlpha"),
    ]);
    vector("uParam3", [
      value("_PixelScale", 32),
      value("_ColorReductionLevel", 8),
      value("_AlphaReductionLevel", 8),
      value("_NoiseScale", 1),
    ]);
    vector("uGradient", [
      value("_GradientWithTex"),
      value("_GradientTexSpeed", 1),
      value("_GradientTexBlend", 0.5),
      value("_Rspeed", 1),
    ]);
    for (const [target, prefix] of [
      ["uBaseUV", "_Base"],
      ["uMaskUV", "_M"],
      ["uNoiseUV", "_N"],
    ]) {
      const tile = prefix === "_Base" ? "_" : "";
      vector(target, [
        value(prefix === "_Base" ? "_TileX" : prefix + "TileX", 1),
        value(prefix === "_Base" ? "_TileY" : prefix + "TileY", 1),
        value(prefix + "OffsetX"),
        value(prefix + "OffsetY"),
      ]);
    }
    vector("uBaseScroll", [
      value("_BaseScrollX") * value("_BaseScroll"),
      -value("_BaseScrollY") * value("_BaseScroll"),
    ]);
    vector("uMaskScroll", [
      value("_MaskScrollX") * value("_MaskScroll"),
      -value("_MaskScrollY") * value("_MaskScroll"),
    ]);
    vector("uNoiseScroll", [value("_NoiseScrollX"), -value("_NoiseScrollY")]);
    const width = context.width || this.width,
      height = context.height || this.height;
    vector("uScene", [
      value("_BlendRatio"),
      value("_ZeroClipThreshold"),
      value("_Weight", value("_TintColorWeight", 1)),
      context.inverseMask ? 1 : value("_IsAddition"),
    ]);
    vector("uSceneUV", [
      (value("_OffsetX") + value("_HScrollValue")) / width,
      -(value("_OffsetY") + value("_VScrollValue")) / height,
      value("_AutoScrollOffsetX") / width,
      -value("_AutoScrollOffsetY") / height,
    ]);
    vector(
      "uMaskTransform",
      context.maskTransform || [
        value("_RelativeSizeX", 1) * value("_InverseMaskScale", 1),
        value("_RelativeSizeY", 1) * value("_InverseMaskScale", 1),
        0,
        0,
      ],
    );
    const columns = value("_Block", value("_MosaicBlock", width));
    vector("uMosaic", [
      Math.max(1, columns),
      Math.max(1, (columns * height) / width),
      columns < width ? 1 : 0,
      0,
    ]);
    vector("uScreen1", [
      value("_Brightness", 1),
      value("_SaturationValue", 1),
      value("_SepiaRatio"),
      value("_VignetteScale"),
    ]);
    vector("uScreen2", [
      value("_UseRaster"),
      value("_Frequency", 1),
      value("_Amplitude"),
      value("_RasterTimeScale", 1),
    ]);
    vector("uScreen3", [
      value("_UseWave"),
      value("_WaveTimeScale", 1),
      value("_WaveMinScale"),
      value("_WaveMaxScale"),
    ]);
    vector("uScreen4", [
      value("_VScale", 1),
      value("_UseScroll"),
      value("_HScrollValue"),
      value("_VScrollValue"),
    ]);
    vector("uScreen5", [
      value("_BlurRatio"),
      value("_BlurSampling", 1),
      value("_NegaposiWeight"),
      0,
    ]);
    vector("uWater1", [
      value("_ScrollSpeedX", value("_SpeedX", value("_OceanScrollSpeed"))),
      value("_ScrollSpeedY", value("_SpeedY")),
      /WorldmapFarBg/.test(this.shaderName) ? 1 : 0,
      value("_WaveLength", 10),
    ]);
    vector("uWater2", [
      value("_WaveSpeed", 1),
      value("_FluctuationMagnification", value("_OceanDisplacementScaleFactor", 0.002)),
      value("_BaseIntensity", value("_OceanBaseIntensity", 1)),
      value(
        "_AlphaIntensity",
        value("_OceanAlphaIntensity", /WorldmapFarBg/.test(this.shaderName) ? 0.35 : 1),
      ),
    ]);
    if (u.uMode === 4) {
      vector("uWhite", color("_TopColor"));
      vector("uBlack", color("_BottomColor"));
    }
    if (u.uMode === 7) {
      vector("uColor", color("_BaseColor", color("_OceanBaseColor")));
      vector("uBlack", color("_AddColor", color("_OceanAddColor", BLACK)));
    }
    vector("uFilterGradient", [
      value("_TopColorPos", 1),
      value("_TopColorAmount", 0.5),
      value("_GradationRange", 2),
      0,
    ]);
    const needed = {
      _MaskTex: value("_UseMask") || u.uMode === 2,
      _NoiseTex: value("_UseNoise") || u.uMode === 7,
      _GradientTex: value("_UseGradient") && value("_GradientWithTex"),
      _RampTex: value("_UseRamp"),
      _MainTex2: u.uMode === 1,
      _SubTex: u.uMode === 8,
    };
    let ready = true;
    for (const [name, resource, rect] of [
      ["_MaskTex", "uMaskTexture", "uMaskRect"],
      ["_NoiseTex", "uNoiseTexture", "uNoiseRect"],
      ["_GradientTex", "uGradientTexture", "uGradientRect"],
      ["_RampTex", "uRampTexture", "uRampRect"],
      [u.uMode === 8 ? "_SubTex" : "_MainTex2", "uSecondTexture", "uSecondRect"],
    ]) {
      if (needed[name]) ready = this._texture(name, resource, rect) && ready;
      else {
        // WebGL still binds active sampler uniforms when a feature flag is off.
        // Do not retain an atlas source that the shared LRU may have evicted.
        this.resources[resource] = Texture.WHITE.source;
        u[rect].set([0, 0, 1, 1]);
      }
    }
    if (Object.keys(f).some((name) => /^_Override|^_TargetSkin|^_HollowOut/.test(name) && f[name]))
      this._warning(
        "palette",
        "palette/skin matching and hollow-out controls are retained but not reproduced.",
      );
    if (value("_UseMagneticEffect") || value("_DistortionStrength"))
      this._warning(
        "distortion",
        "screen magnetic/normal-map distortion is not implemented; source wave/raster controls still apply.",
      );
    if (/WorldmapFarBg/.test(this.shaderName))
      this._warning(
        "ocean-control",
        "green control-channel modulates the source ocean base/add colors; sun/caustic/river compositing remains approximated.",
      );
    if (value("_ScaleWithAilpha"))
      this._warning(
        "alpha-size",
        "alpha-driven geometry scaling is not reproduced by the shared texture cache.",
      );
    if (u.uMode === 6 && (value("_IsUVScroll") || value("_IsDissovle")))
      this._warning(
        "sprite-uv",
        "LastSpriteMaster UV-scroll/dissolve controls are retained but not reproduced; particle LastEffectMaster processing is separate.",
      );
    // Safe first-frame behavior while optional scene textures are loading:
    // retain the original crossfade image and hide an unmasked foreground.
    if (!ready && u.uMode === 1) u.uScene[0] = 0;
    if (!ready && u.uMode === 2) u.uOpacity = 0;
    this.ready = ready;
    return ready;
  }
}

/** One offscreen result per material, shared by every particle using it. */
export function materialRasterSize(material, source, limit = 2048) {
  const f = material.floats || {},
    textures = material.textures || {},
    number = (value, fallback = 1) => (Number.isFinite(Number(value)) ? Number(value) : fallback),
    layers = [
      [textures._MainTex, f._TileX, f._TileY],
      ...(f._UseMask ? [[textures._MaskTex, f._MTileX, f._MTileY]] : []),
      ...(f._UseNoise ? [[textures._NoiseTex, f._NTileX, f._NTileY]] : []),
    ];
  let width = source.width,
    height = source.height;
  for (const [texture, x, y] of layers) {
    if (!texture) continue;
    width = Math.max(
      width,
      (texture.width || source.width) * Math.abs(number(x) * number(texture.scale?.[0])),
    );
    height = Math.max(
      height,
      (texture.height || source.height) * Math.abs(number(y) * number(texture.scale?.[1])),
    );
  }
  return {
    width: Math.max(1, Math.min(limit, Math.ceil(width))),
    height: Math.max(1, Math.min(limit, Math.ceil(height))),
    limited: width > limit || height > limit,
  };
}

export class PRMaterialCache {
  constructor({
    renderer,
    getTexture,
    maxBytes = 32 * 1024 * 1024,
    updatesPerSecond = 15,
    warn = console.warn,
  } = {}) {
    this.renderer = renderer;
    this.getTexture = getTexture;
    this.maxBytes = maxBytes;
    this.rate = updatesPerSecond;
    this.warn = warn;
    this.entries = new Map();
    this._bytes = 0;
    this._renders = 0;
    this._evictions = 0;
    this._warned = new Set();
    this._frame = 0;
    this._pending = new WeakMap();
  }
  handles(material) {
    return needsMaterialProcessing(material);
  }
  beginFrame() {
    this._frame++;
  }
  get(material, time) {
    if (!this.renderer) return null;
    let entry = this.entries.get(material);
    if (entry?.checkedFrame === this._frame) return entry.ready ? entry.target : null;
    if (this._pending.get(material) === this._frame) return null;
    const main = material.textures?._MainTex,
      texture = main?.url
        ? this.getTexture(main.url, {
            required: true,
            entityId: `material:${material.name || material.shader}:_MainTex`,
            animation: "_MainTex",
          })
        : Texture.WHITE;
    if (!texture || texture.destroyed || texture.source.destroyed) {
      this._pending.set(material, this._frame);
      return null;
    }
    if (!entry) {
      // Baking repeated UVs into the unscaled source dimensions aliases away
      // detail: the river's 64px texture tiled 10x9 became six pixels per tile.
      // Preserve source texels for every authored base/mask/noise repeat.
      const { width, height, limited } = materialRasterSize(material, texture);
      if (limited)
        this.warn(
          `[PR shader] ${material.name}: tiled material exceeds the 2048px cache edge; raster resolution is capped.`,
        );
      const target = RenderTexture.create({
        width,
        height,
        resolution: 1,
        scaleMode: "nearest",
        antialias: false,
      });
      const filter = new PRFilter("Last/LastEffectMaster", {
        material,
        getTexture: this.getTexture,
        width,
        height,
        warn: this.warn,
      });
      const sprite = new Sprite({ texture, roundPixels: true });
      sprite.width = width;
      sprite.height = height;
      sprite.filters = [filter];
      sprite.filterArea = new Rectangle(0, 0, width, height);
      entry = {
        target,
        filter,
        sprite,
        bytes: width * height * 4,
        lastUsed: time,
        tick: null,
        source: null,
      };
      this.entries.set(material, entry);
      this._bytes += entry.bytes;
    }
    entry.lastUsed = time;
    entry.checkedFrame = this._frame;
    entry.ready = entry.filter.update(time);
    if (!entry.ready) return null;
    const f = material.floats || {},
      dynamic = f._UseNoise || f._MaskScroll || f._BaseScroll || f._UseRamp || f._GradientWithTex;
    const tick = dynamic ? Math.floor(time * this.rate) : 0;
    const textureChanged = entry.source !== texture;
    if (entry.tick !== tick || textureChanged) {
      entry.sprite.texture = texture;
      // Offscreen material preprocessing happens once, not inside the final
      // particle draw. All particle Sprites continue using Pixi batching.
      this.renderer.render({ container: entry.sprite, target: entry.target, clear: true });
      entry.tick = tick;
      entry.source = texture;
      this._renders++;
    }
    return entry.target;
  }
  prune(time) {
    for (const [material, entry] of [...this.entries].sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    )) {
      if (entry.lastUsed === time) continue;
      if (this._bytes <= this.maxBytes && time - entry.lastUsed < 3) continue;
      entry.sprite.filters = null;
      entry.sprite.destroy({ texture: false, textureSource: false });
      entry.filter.destroy(false);
      entry.target.destroy(true);
      this.entries.delete(material);
      this._bytes -= entry.bytes;
      this._evictions++;
    }
    if (this._bytes > this.maxBytes && !this._warned.has("budget")) {
      this._warned.add("budget");
      this.warn(
        "[PR shader] Current visible particle materials exceed the estimated 32 MiB cache budget; active materials are retained.",
      );
    }
  }
  clear() {
    for (const e of this.entries.values()) {
      e.sprite.filters = null;
      e.sprite.destroy({ texture: false, textureSource: false });
      e.filter.destroy(false);
      e.target.destroy(true);
    }
    this.entries.clear();
    this._bytes = 0;
  }
  destroy() {
    this.clear();
  }
  metrics() {
    return {
      materials: this.entries.size,
      estimatedBytes: this._bytes,
      materialRenders: this._renders,
      evicted: this._evictions,
      updateRate: this.rate,
    };
  }
}
