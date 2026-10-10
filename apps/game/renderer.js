const FACING = { up: "WalkB", right: "WalkR", down: "Default", left: "WalkL" };
export class Renderer {
  constructor(canvas, content, images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.content = content;
    this.images = images;
    this.sets = [...content.map.tilesets].sort(
      (a, b) => b.firstgid - a.firstgid,
    );
  }
  tile(raw, x, y, time) {
    const gid = raw & 0x0fffffff;
    if (!gid) return;
    const s = this.sets.find((s) => s.firstgid <= gid);
    if (!s) throw new Error("图块缺少图集");
    const image = this.images.get(this.content.map.textures[s.image]);
    if (!image) throw new Error("缺少地图图片 " + s.image);
    let n = gid - s.firstgid,
      animation = s.tiles?.find((t) => t.id === n)?.animation;
    if (animation?.length) {
      let t = time % animation.reduce((sum, f) => sum + f.duration, 0);
      for (const f of animation) {
        n = f.tileid;
        if (t < f.duration) break;
        t -= f.duration;
      }
    }
    const sx =
        (n % s.columns) * (s.tilewidth + (s.spacing ?? 0)) + (s.margin ?? 0),
      sy =
        Math.floor(n / s.columns) * (s.tileheight + (s.spacing ?? 0)) +
        (s.margin ?? 0);
    const c = this.ctx,
      h = !!(raw & 0x80000000),
      v = !!(raw & 0x40000000),
      d = !!(raw & 0x20000000);
    c.save();
    c.translate(x + s.tilewidth / 2, y + s.tileheight / 2);
    if (d) c.transform(0, v ? -1 : 1, h ? -1 : 1, 0, 0, 0);
    else c.scale(h ? -1 : 1, v ? -1 : 1);
    c.drawImage(
      image,
      sx,
      sy,
      s.tilewidth,
      s.tileheight,
      -s.tilewidth / 2,
      -s.tileheight / 2,
      s.tilewidth,
      s.tileheight,
    );
    c.restore();
  }
  point(a) {
    const m = a.motion;
    if (!m) return a;
    const t = Math.min(1, m.elapsed / m.duration);
    return {
      x: m.from.x + (m.to.x - m.from.x) * t,
      y: m.from.y + (m.to.y - m.from.y) * t,
    };
  }
  sprite(asset, key, a, x, y, crop = 0, lift = 0) {
    const char = this.content.characters[asset];
    if (!char) throw new Error("缺少角色 " + asset);
    let animation = char.animations[key];
    if (!animation) throw new Error("缺少动画 " + asset + "/" + key);
    if (a.motion && a.steps % 2 && animation.next) {
      animation = char.animations[animation.next];
      if (!animation) throw new Error("缺少后续动画");
    }
    const t = a.motion ? a.motion.elapsed / a.motion.duration : 1;
    const f =
      animation.frames[
        Math.min(
          animation.frames.length - 1,
          Math.floor(t * animation.frames.length),
        )
      ];
    if (!f) throw new Error("空动画");
    const s = char.sprites[f.sprite],
      image = this.images.get(s.file);
    if (!image) throw new Error("缺少角色图像");
    const flip = animation.flip !== f.flip,
      c = this.ctx;
    c.save();
    c.translate(Math.round(x + f.x), Math.round(y - f.y - lift));
    c.scale(flip ? -1 : 1, 1);
    c.globalAlpha = f.alpha;
    c.drawImage(
      image,
      0,
      0,
      s.width,
      s.height - crop,
      -s.width * s.pivot[0],
      -s.height * (1 - s.pivot[1]),
      s.width,
      s.height - crop,
    );
    c.restore();
  }
  actor(a, cx, cy) {
    const p = this.point(a),
      x = (p.x + 0.5) * 16 - cx,
      y = (p.y + 1) * 16 - 2 - cy;
    const key = FACING[a.direction];
    if (a.mount) {
      this.sprite(a.mount, key, a, x, y);
      const ride = { WalkL: "RideL", WalkR: "RideR" }[key] ?? key;
      this.sprite(a.asset, ride, a, x, y, 8, 14);
    } else this.sprite(a.asset, key, a, x, y);
  }
  draw(game) {
    const c = this.ctx,
      m = this.content.map,
      p = this.point(game.player),
      w = this.canvas.width,
      h = this.canvas.height,
      range = game.collisionRange;
    const camera = (position, start, length, viewport) =>
      Math.round(
        length * 16 <= viewport
          ? start * 16 + (length * 16 - viewport) / 2
          : Math.max(
              start * 16,
              Math.min(
                (start + length) * 16 - viewport,
                (position + 0.5) * 16 - viewport / 2,
              ),
            ),
      );
    const cx = camera(p.x, range.x, range.width, w),
      cy = camera(p.y, range.y, range.height, h);
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#09111b";
    c.fillRect(0, 0, w, h);
    const actors = Object.values(game.actors)
      .filter(
        (a) =>
          !game.hiddenEntities.has(a.id) &&
          a.x >= 0 &&
          a.x < m.width &&
          a.y >= 0 &&
          a.y < m.height,
      )
      .sort(
        (a, b) => this.point(a).y - this.point(b).y || a.id.localeCompare(b.id),
      );
    const drawActors = (layer) => {
      for (const a of actors) if (a.layer === layer) this.actor(a, cx, cy);
    };
    for (const l of m.layers) {
      c.globalAlpha = l.opacity;
      for (
        let y = Math.max(0, Math.floor(cy / 16));
        y < Math.min(l.height, Math.ceil((cy + h) / 16));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(cx / 16));
          x < Math.min(l.width, Math.ceil((cx + w) / 16));
          x++
        )
          this.tile(
            l.data[y * l.width + x] >>> 0,
            x * 16 - cx,
            y * 16 - cy,
            game.time,
          );
      c.globalAlpha = 1;
      if (l.name === "BottomLayer") drawActors(0);
      if (l.name === "GroundLayer") drawActors(1);
      if (l.name === "UpperLayer") drawActors(2);
      if (l.name === "CeilLayer") drawActors(3);
    }
    if (game.fade) {
      c.fillStyle = `rgba(0,0,0,${1 - game.fade.elapsed / game.fade.duration})`;
      c.fillRect(0, 0, w, h);
    }
  }
}
