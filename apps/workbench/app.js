const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const labels = { source: '来源完整性', structure: '内容结构与依赖', behavior: '原版行为对照', visual: '视觉与音画对照', browser: '目标浏览器运行', transfer: '陌生场景复用' };
let report, target = 'narshe';
const images = new Map();
const mapLayers = [];
const selected = new Set();
function element(tag, value, className) { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; return e; }
function flatten(layers, opacity = 1, visible = true, x = 0, y = 0) {
  for (const l of layers) {
    const alpha = opacity * (l.opacity ?? 1), show = visible && l.visible !== false;
    const dx = x + (l.offsetx ?? 0), dy = y + (l.offsety ?? 0);
    if (l.type === 'group') flatten(l.layers, alpha, show, dx, dy);
    else if (l.type === 'tilelayer') { mapLayers.push({ ...l, effectiveOpacity: alpha, dx, dy }); if (show) selected.add(l.id); }
  }
}
function drawTile(ctx, img, x, y, tw, th, tx, ty, horizontal, vertical, diagonal) {
  ctx.save(); ctx.translate(x + tw / 2, y + th / 2);
  // Tiled diagonal swaps axes before horizontal/vertical flips for orthogonal maps.
  if (diagonal) ctx.transform(0, vertical ? -1 : 1, horizontal ? -1 : 1, 0, 0, 0);
  else ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
  ctx.drawImage(img, tx, ty, tw, th, -tw / 2, -th / 2, tw, th); ctx.restore();
}
function drawMap() {
  const a = report.targets.narshe.artifact, m = a.tilemap, c = $('map'), ctx = c.getContext('2d');
  c.width = m.width * m.tilewidth; c.height = m.height * m.tileheight; ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, c.width, c.height);
  let missing = 0;
  for (const l of mapLayers) {
    if (!selected.has(l.id)) continue;
    ctx.globalAlpha = l.effectiveOpacity;
    for (let i = 0; i < l.data.length; i++) {
      const raw = l.data[i] >>> 0, gid = raw & 0x0fffffff;
      if (!gid) continue;
      const ts = [...m.tilesets].reverse().find(t => t.firstgid <= gid), img = ts && images.get(ts.image);
      if (!ts || !img) { missing++; continue; }
      let n = gid - ts.firstgid;
      const animation = ts.tiles?.find(t => t.id === n)?.animation;
      if (animation?.length) n = animation[0].tileid;
      const sx = (n % ts.columns) * (ts.tilewidth + (ts.spacing ?? 0)) + (ts.margin ?? 0);
      const sy = Math.floor(n / ts.columns) * (ts.tileheight + (ts.spacing ?? 0)) + (ts.margin ?? 0);
      drawTile(ctx, img, ((i % l.width) + (l.x ?? 0)) * m.tilewidth + l.dx, (Math.floor(i / l.width) + (l.y ?? 0)) * m.tileheight + l.dy,
        ts.tilewidth, ts.tileheight, sx, sy, !!(raw & 0x80000000), !!(raw & 0x40000000), !!(raw & 0x20000000));
    }
  }
  ctx.globalAlpha = 1;
  if ($('collision').checked) {
    const drawCollision = layers => { for (const l of layers ?? []) {
      if (l.layers) drawCollision(l.layers);
      if (!Array.isArray(l.data)) continue;
      l.data.forEach((v, i) => { if (!v) return; ctx.fillStyle = `hsla(${(Number(v) * 37) % 360},65%,65%,.35)`; ctx.fillRect((i % l.width) * m.tilewidth, Math.floor(i / l.width) * m.tileheight, m.tilewidth, m.tileheight); });
    } };
    a.collision.forEach(v => drawCollision(v.data.layers));
  }
  text('map-status', `源图层静态投影 · ${m.width} × ${m.height} 图块 · 动画显示首帧 · ${selected.size}/${mapLayers.length} 图层 · 缺失图块 ${missing}。剧情可见性与碰撞值含义待验证。`);
}
function showTarget(id) {
  target = id;
  for (const name of ['narshe', 'opera']) $(name + '-tab').setAttribute('aria-pressed', String(name === id));
  $('map-panel').hidden = id !== 'narshe'; $('collision-control').hidden = id !== 'narshe'; $('opera-panel').hidden = id !== 'opera';
  const context = report.contexts[id], result = report.targets[id];
  text('target-title', id === 'narshe' ? '纳尔谢 · Map_20010' : '歌剧 · 源时间线');
  text('target-subtitle', id === 'narshe' ? '已确认区域归属；开场所用状态与图层尚待原版对照。' : '查看已提取的轨道与时间范围；片段根、播放和外部绑定尚待验证。');
  text('region-binding', `${context.sourceBinding.names.system_zhc} / ${context.sourceBinding.names.system_en}，区域 ${context.sourceBinding.areaId}，关联 ${context.sourceBinding.maps.length} 条地图记录。`);
  $('questions').replaceChildren(...context.questions.map(q => element('li', q)));
  $('acceptance').replaceChildren(...Object.entries(result.report.lanes).map(([key, lane]) => {
    const row = element('div', '', 'lane'); row.append(element('span', labels[key]), element('span', lane.status === 'pass' ? '通过' : lane.status === 'fail' ? '失败' : '待验证', lane.status === 'pass' ? 'pass' : 'pending')); return row;
  }));
  const groups = new Map();
  for (const d of result.report.blockers) { const list = groups.get(d.code) ?? []; list.push(d); groups.set(d.code, list); }
  $('diagnostics').replaceChildren(...[...groups].map(([code, list]) => element('p', `${code} · ${list.length} 项\n${list[0].detail}\n${list[0].nextAction}`)));
  if (id === 'opera') drawOpera();
}
function drawOpera() {
  const a = report.targets.opera.artifact;
  const tracks = a.tracks.filter(t => t.sourceFile === $('opera-bundle').value);
  const end = Math.max(1, ...tracks.flatMap(t => t.clips.map(c => c.start + c.duration)));
  text('opera-summary', `${tracks.length} 条源轨道 · 显示范围 0–${end.toFixed(2)} · 源 m_Start / m_Duration 数值；实际时钟、激活与绑定待验证。`);
  $('timeline-list').replaceChildren(...tracks.map(t => {
    const row = element('div', '', 'track'), name = element('div', t.name || '(未命名)', 'track-name'); name.append(element('span', t.type));
    const bars = element('div', '', 'track-bars');
    for (const c of t.clips) { const lane = element('div', '', 'clip-lane'), bar = element('span', ''); bar.style.left = `${c.start / end * 100}%`; bar.style.width = `${c.duration / end * 100}%`; bar.title = `${c.label}: ${c.start} + ${c.duration}`; lane.append(bar); bars.append(lane); }
    if (!t.clips.length) bars.append(element('code', '没有 clips；轨道仍可能包含其他行为'));
    row.append(name, bars); return row;
  }));
}
async function init() {
  const response = await fetch('/reports/status.json'); if (!response.ok) throw new Error('尚无编译结果。先运行资源导入和 npm run pipeline。');
  report = await response.json();
  const map = report.targets.narshe.artifact;
  for (const texture of map.textures) { const img = new Image(); img.src = '/imports/' + texture.file; await img.decode(); images.set(texture.name + '.png', img); }
  flatten(map.tilemap.layers);
  for (const l of mapLayers) { const label = element('label', ''), input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(l.id); input.addEventListener('change', () => { if (input.checked) selected.add(l.id); else selected.delete(l.id); drawMap(); }); label.append(input, document.createTextNode(' ' + l.name)); $('layers').append(label); }
  for (const file of [...new Set(report.targets.opera.artifact.tracks.map(t => t.sourceFile))]) { const o = element('option', file.replace(/_assets_all_.*/, '')); o.value = file; $('opera-bundle').append(o); }
  text('source-hash', report.sourceSetHash); text('corpus', `${report.corpus.bundleCount} 个地图/脚本包 · ${report.corpus.jsonCount} 个 JSON · ${report.corpus.mnemonicScriptCount} 份 Mnemonics 脚本。仅代表解析覆盖。`);
  $('content').hidden = false; showTarget(target); drawMap();
}
$('narshe-tab').addEventListener('click', () => showTarget('narshe')); $('opera-tab').addEventListener('click', () => showTarget('opera'));
$('collision').addEventListener('change', drawMap); $('opera-bundle').addEventListener('change', drawOpera);
init().catch(e => { $('error').hidden = false; text('error', String(e.message ?? e)); });
