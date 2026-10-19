import {
  Container,
  Filter,
  GlProgram,
  Graphics,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";

const vertex = `
in vec2 aPosition;
out vec2 vUV;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  gl_Position = vec4(p.x*2.0/uOutputTexture.x-1.0,
    p.y*2.0*uOutputTexture.z/uOutputTexture.y-uOutputTexture.z,0.0,1.0);
  vUV = aPosition;
}`;
const fragment = `
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uGround;
uniform sampler2D uSky;
uniform vec4 uGroundFrame;
uniform vec4 uSkyFrame;
uniform float uTravel;
void main() {
  vec2 uv=vUV;
  vec2 skyUV=clamp(vec2(.08+uv.x*.84,uv.y/.68),vec2(.001),vec2(.999));
  vec4 sky=texture(uSky,uSkyFrame.xy+skyUV*uSkyFrame.zw);
  float depth=28.0/max(.035,uv.y-.44);
  vec2 groundUV=fract(vec2(.5+(uv.x-.5)*depth*.004,uTravel-depth/512.0));
  groundUV=clamp(groundUV,vec2(.003),vec2(.997));
  vec4 ground=texture(uGround,uGroundFrame.xy+groundUV*uGroundFrame.zw);
  ground.rgb*=vec3(.42,.46,.62);
  float fade=smoothstep(.42,.72,uv.y);
  finalColor=vec4(mix(sky.rgb,ground.rgb,fade),1.0);
}`;
const frame = (texture) =>
  new Float32Array([
    texture.frame.x / texture.source.width,
    texture.frame.y / texture.source.height,
    texture.frame.width / texture.source.width,
    texture.frame.height / texture.source.height,
  ]);

// A presentation of the real map40000, nalshe_op texture and n076 armor clips.
// Source puppets own the positions/duration. Projection and snow are inferred;
// this class neither starts scripts nor advances or skips the game clock.
export class OpeningMarch {
  constructor({ parent, getTexture, sample, warn, diagnostics }) {
    Object.assign(this, { getTexture, sample, warn, diagnostics });
    this.container = new Container({ label: "opening-snow-march" });
    this.container.visible = false;
    parent.addChild(this.container);
    this.backdrop = new Sprite(Texture.WHITE);
    this.backdrop.width = 320;
    this.backdrop.height = 180;
    this.container.addChild(this.backdrop);
    this.sprites = new Map();
    this.snow = new Graphics();
    this.container.addChild(this.snow);
  }
  matches(game) {
    return game?.mapId === 572 && game.furthest?.script === "sc_e_0001_4";
  }
  draw(game, data, catalog, renderer) {
    const skyInfo = catalog?.sky.nalshe_op,
      groundURL = game.map.textures?.[game.map.tilesets?.[0]?.image],
      ground = this.getTexture(groundURL, { required: true, entityId: "opening-ground" }),
      sky = this.getTexture(skyInfo?.url, { required: true, entityId: "opening-sky" });
    this.container.visible = true;
    this.backdrop.visible = !!(ground && sky);
    if (ground && sky) {
      if (!this.filter) {
        this.filter = new Filter({
          resolution: 1,
          antialias: false,
          glProgram: GlProgram.from({
            name: "pr-opening-snow",
            vertex: "#version 300 es\n" + vertex,
            fragment: "#version 300 es\n" + fragment,
          }),
          resources: {
            uGround: ground.source,
            uSky: sky.source,
            properties: {
              uGroundFrame: { value: frame(ground), type: "vec4<f32>" },
              uSkyFrame: { value: frame(sky), type: "vec4<f32>" },
              uTravel: { value: 0, type: "f32" },
            },
          },
        });
        // Bake this two-texture projection before the world's screen filter.
        // Nesting its procedural filter under that pass sampled a cropped
        // region of the backdrop instead of the complete sky/ground frame.
        this.surface = new Sprite(Texture.WHITE);
        this.surface.width = 320;
        this.surface.height = 180;
        this.surface.filterArea = new Rectangle(0, 0, 320, 180);
        this.surface.filters = [this.filter];
        this.target = RenderTexture.create({ width: 320, height: 180, resolution: 1 });
        this.target.source.style.scaleMode = "nearest";
        this.backdrop.texture = this.target;
      }
      this.filter.resources.uGround = ground.source;
      this.filter.resources.uSky = sky.source;
      Object.assign(this.filter.resources.properties.uniforms, {
        uGroundFrame: frame(ground),
        uSkyFrame: frame(sky),
        uTravel: (game.camera.y || 0) / 32,
      });
      renderer.render({ container: this.surface, target: this.target, clear: true });
    }
    this.warn(
      "opening-projection",
      "Opening uses PR map40000/nalshe_op and its three authored armor puppets; web perspective, fog and snow density are approximated.",
    );
    const records = [];
    for (const sprite of this.sprites.values()) sprite.visible = false;
    const actors = [...game.actors.values()].filter((a) => a.kind === 6 && a.visible !== false);
    for (const actor of actors.sort((a, b) => a.y - b.y)) {
      const character = data.characters[actor.asset?.toLowerCase()];
      if (!character?.sprites) {
        this.diagnostics.record("missing-character-data", {
          entityId: actor.id,
          resource: actor.asset,
        });
        continue;
      }
      const clip = this.sample(actor, character, game.time),
        texture = this.getTexture(clip?.info?.file, {
          required: true,
          entityId: actor.id,
          asset: actor.asset,
          animation: clip?.clip,
        });
      const dy = actor.y - game.camera.y,
        scale = Math.max(0.6, Math.min(1.25, 0.85 + dy * 0.12)),
        x = 160 + (actor.x - game.camera.x) * 43 * scale,
        y = 114 + dy * 14;
      let sprite = this.sprites.get(actor.id);
      if (!sprite) {
        sprite = new Sprite();
        sprite.anchor.set(0.5, 1);
        this.sprites.set(actor.id, sprite);
      }
      this.container.addChild(sprite);
      sprite.visible = !!texture;
      if (texture) sprite.texture = texture;
      sprite.position.set(Math.round(x), Math.round(y));
      sprite.scale.set(scale * (clip?.flip ? -1 : 1), scale);
      records.push({
        side: "field",
        entityId: actor.id,
        asset: actor.asset,
        resource: clip?.info?.file,
        animation: clip?.clip,
        frame: clip?.name,
        drawn: !!texture,
        screen: { x, y },
      });
    }
    this.container.addChild(this.snow);
    this.snow.clear();
    for (let i = 0; i < 64; i++) {
      const x = (((i * 71 - game.time * (9 + (i % 13))) % 320) + 320) % 320,
        y = (i * 43 + game.time * (12 + (i % 17))) % 180;
      this.snow
        .rect(Math.round(x), Math.round(y), i % 4 === 0 ? 2 : 1, 1)
        .fill({ color: 0xd9e4ff, alpha: 0.3 + (i % 5) * 0.1 });
    }
    return records;
  }
  destroy() {
    if (this.surface) {
      this.surface.filters = null;
      this.surface.destroy();
    }
    this.backdrop.texture = Texture.EMPTY;
    this.filter?.destroy();
    this.target?.destroy(true);
  }
}
