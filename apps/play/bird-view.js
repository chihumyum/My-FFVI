import { Container, Filter, GlProgram, Rectangle, RenderTexture, Sprite, Texture } from "pixi.js";
import {
  flightCamera,
  flightPose,
  flightShadow,
  projectFlightPoint,
  radians,
} from "./airship-motion.js";
import { canVehicleLand } from "../../src/play/vehicle-input.js";
import { sampleFieldClip } from "./field-animation.js";
const vertex = `
in vec2 aPosition;
out vec2 vUV;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(){
 vec2 p=aPosition*uOutputFrame.zw+uOutputFrame.xy;
 gl_Position=vec4(p.x*2.0/uOutputTexture.x-1.0,p.y*2.0*uOutputTexture.z/uOutputTexture.y-uOutputTexture.z,0.,1.);
 vUV=aPosition;
}`;
const fragment = `
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uGround;
uniform sampler2D uSky;
uniform vec4 uSkyFrame;
uniform vec4 uCamera;
uniform vec4 uPlane;
void main(){
 float pitch=uCamera.x, heading=uCamera.y, tangent=uCamera.z, distance=uCamera.w;
 vec2 skyUV=vec2(fract(.5-heading/6.2831853+(vUV.x-.5)*.4),clamp(vUV.y+.25-pitch*.2,0.001,.999));
 vec4 sky=texture(uSky,uSkyFrame.xy+skyUV*uSkyFrame.zw);
 vec3 ray=vec3((vUV.x*2.-1.)*1.7777778*tangent,(1.-vUV.y*2.)*tangent,1.);
 float cs=cos(pitch),sn=sin(pitch);
 ray.yz=mat2(cs,sn,-sn,cs)*ray.yz;
 vec3 origin=vec3(0.,distance*sn+uPlane.z,-distance*cs);
 if(ray.y>=-.00001){finalColor=sky;return;}
 float t=-origin.y/ray.y;
 vec2 ground=(origin+ray*t).xz;
 float ca=cos(heading),sa=sin(heading);
 ground=mat2(ca,sa,-sa,ca)*ground;
 vec2 uv=vec2(.5+ground.x/uPlane.x,.5-ground.y/uPlane.y);
 if(t<0. || any(lessThan(uv,vec2(0.))) || any(greaterThan(uv,vec2(1.)))) {finalColor=sky;return;}
 vec4 terrain=texture(uGround,uv);
 float fog=smoothstep(uPlane.w*.65,uPlane.w,t);
 finalColor=mix(terrain+sky*(1.-terrain.a),sky,fog);
}`;
const textureFrame = (t) => [
  t.frame.x / t.source.width,
  t.frame.y / t.source.height,
  t.frame.width / t.source.width,
  t.frame.height / t.source.height,
];

/** PR's ground camera/mesh followed by billboard sprites and their shadows. */
export class BirdView {
  constructor({ parent, getTexture, warn, diagnostics, sampleActor }) {
    Object.assign(this, { getTexture, warn, diagnostics, sampleActor });
    this.container = new Container({ label: "pr-bird-view" });
    parent.addChild(this.container);
    this.container.sortableChildren = true;
    this.display = new Sprite(Texture.EMPTY);
    this.container.addChild(this.display);
    this.display.zIndex = -Infinity;
    this.surface = new Sprite(Texture.WHITE);
    this.surface.width = 960;
    this.surface.height = 540;
    this.surface.filterArea = new Rectangle(0, 0, 960, 540);
    this.filter = new Filter({
      resolution: 1,
      antialias: false,
      glProgram: GlProgram.from({
        name: "pr-bird-camera",
        vertex: "#version 300 es\n" + vertex,
        fragment: "#version 300 es\n" + fragment,
        preferredFragmentPrecision: "highp",
      }),
      resources: {
        uGround: Texture.EMPTY.source,
        uSky: Texture.WHITE.source,
        properties: {
          uCamera: { value: new Float32Array(4), type: "vec4<f32>" },
          uPlane: { value: new Float32Array(4), type: "vec4<f32>" },
          uSkyFrame: { value: new Float32Array([0, 0, 1, 1]), type: "vec4<f32>" },
        },
      },
    });
    this.surface.filters = [this.filter];
    this.output = RenderTexture.create({
      width: 960,
      height: 540,
      resolution: 1,
      scaleMode: "nearest",
    });
    this.sprites = new Map();
  }
  draw(renderer, ground, game, data, catalog, state, height = 1, landingVehicle = null) {
    const parameters = catalog.flight,
      camera = flightCamera(state, parameters, height);
    const skyName = `bird_view_skybox_${game.map.name.replace(/_\d$/, "")}_normal`,
      skyInfo =
        catalog.sky[skyName] ||
        catalog.sky[
          `bird_view_skybox_${/10020/.test(game.map.name) ? "Map_10020" : "Map_10010"}_normal`
        ],
      sky = this.getTexture(skyInfo?.url, {
        required: true,
        entityId: "scene:flight-sky",
        animation: skyName,
      });
    this.filter.resources.uGround = ground.source;
    this.filter.resources.uSky = (sky || Texture.EMPTY).source;
    Object.assign(this.filter.resources.properties.uniforms, {
      uCamera: [
        radians(camera.pitch),
        radians(camera.rotation),
        Math.tan(radians(camera.fov) / 2),
        camera.distance,
      ],
      uPlane: [
        ground.width * 2,
        ground.height * 2,
        camera.upDown,
        Math.min(3000, ground.height * 2),
      ],
      uSkyFrame: textureFrame(sky || Texture.EMPTY),
    });
    // A dedicated prepass is essential: nesting this procedural filter in the
    // screen-effect pass otherwise crops the sampled ground/sky rectangle.
    renderer.render({ container: this.surface, target: this.output, clear: true });
    this.display.texture = this.output;
    this.display.width = 320;
    this.display.height = 180;
    for (const sprite of this.sprites.values()) sprite.visible = false;
    const binding = catalog.maps?.[game.mapId];
    const birdActors = binding?.birdActors || {};
    const records = [],
      ship = parameters.ships[Number(landingVehicle || game.player.vehicle)],
      actors = [
        ...(game.player.visible !== false ? [game.player] : []),
        ...[...(game.actors?.values() || [])].filter(
          (a) => a.visible !== false && birdActors[String(a.id)],
        ),
      ];
    if (game.player.visible === false)
      records.push({
        side: "field",
        entityId: game.player.id,
        asset: ship || game.player.asset,
        drawn: false,
        reason: "hidden-player",
      });
    this.metrics = {
      ...state,
      camera,
      pose: ship ? flightPose(state, parameters) : null,
      shadow: ship ? flightShadow(state, parameters, height) : null,
      input: { width: ground.width, height: ground.height },
    };
    for (const actor of actors) {
      const controlled = actor === game.player,
        vessel = controlled && ship,
        asset = vessel || actor.asset,
        character = data.characters[asset];
      if (!character?.sprites) {
        this.diagnostics?.record("missing-character-data", { entityId: actor.id, resource: asset });
        continue;
      }
      const pose = vessel ? flightPose(state, parameters) : actor.animation,
        frame = vessel
          ? sampleFieldClip(character, pose, game.time, null, this.warn)
          : this.sampleActor(actor, character, game.time);
      const shadowIndex = flightShadow(state, parameters, height),
        shadowKey = canVehicleLand(game, Number(landingVehicle || game.player.vehicle))
          ? "ShadowLerp"
          : "ShadowLerp_Red",
        shadow = vessel
          ? sampleFieldClip(character, shadowKey, 0, shadowIndex / 6, this.warn)
          : null;
      const focus = game.camera?.manual ? game.camera : game.player,
        x = controlled ? 0 : (actor.x - focus.x - state.offset.x) * (game.map.tileSize || 16) * 2,
        z = controlled
          ? -12
          : -(actor.y - focus.y - state.offset.y) * (game.map.tileSize || 16) * 2,
        altitude = controlled
          ? camera.flightAltitude
          : (1 - height) * 320 + height * 24 * (birdActors[String(actor.id)]?.altitude ?? 1),
        actorCamera = controlled ? { ...camera, rotation: 0 } : camera,
        bodyPoint = projectFlightPoint({ x, y: altitude, z }, actorCamera),
        shadowPoint = projectFlightPoint({ x, y: 0, z: z - 6 }, actorCamera);
      for (const [part, clip, point] of [
        ["shadow", shadow, shadowPoint],
        ["body", frame, bodyPoint],
      ]) {
        if (!clip) continue;
        const texture = this.getTexture(clip?.info?.file, {
          required: true,
          entityId: actor.id,
          asset,
          animation: part === "shadow" ? shadowKey : pose,
        });
        const key = `${actor.id}:${part}`;
        let sprite = this.sprites.get(key);
        if (!sprite) {
          sprite = new Sprite(Texture.EMPTY);
          sprite.anchor.set(0.5, 0.5);
          this.container.addChild(sprite);
          this.sprites.set(key, sprite);
        }
        sprite.visible = !!texture && point.visible;
        if (texture) {
          sprite.texture = texture;
          const info = clip.info;
          sprite.width = (info.logicalWidth || info.width) * 2 * point.scale;
          sprite.height = (info.logicalHeight || info.height) * 2 * point.scale;
          sprite.scale.x = Math.abs(sprite.scale.x) * (clip.flip ? -1 : 1);
          sprite.position.set(
            point.x + (clip.offsetx || 0) * 2 * point.scale,
            point.y - (clip.offsety || 0) * 2 * point.scale,
          );
          sprite.alpha = clip.alpha ?? 1;
          sprite.tint = clip.tint ?? 0xffffff;
          sprite.zIndex = -(point.depth || 0) + (part === "body" ? 0.001 : 0);
          sprite.visible &&=
            sprite.x + Math.abs(sprite.width) / 2 > 0 &&
            sprite.x - Math.abs(sprite.width) / 2 < 320 &&
            sprite.y + sprite.height / 2 > 0 &&
            sprite.y - sprite.height / 2 < 180;
        }
      }
      records.push({
        side: "field",
        entityId: actor.id,
        asset,
        characterId: actor.characterId,
        vehicle: actor.vehicle,
        birdview: !controlled,
        animation: pose,
        clip: frame?.clip,
        frame: frame?.name,
        resource: frame?.info?.file,
        x: actor.x,
        y: actor.y,
        screen: {
          ...bodyPoint,
          x: this.sprites.get(`${actor.id}:body`)?.x ?? bodyPoint.x,
          y: this.sprites.get(`${actor.id}:body`)?.y ?? bodyPoint.y,
        },
        drawn: !!this.sprites.get(`${actor.id}:body`)?.visible && bodyPoint.visible,
        reason: this.sprites.get(`${actor.id}:body`)?.visible ? null : "outside-viewport",
      });
    }
    return records;
  }
  destroy() {
    this.filter.destroy();
    this.output.destroy(true);
    this.surface.destroy();
    this.container.destroy({ children: true });
  }
}
