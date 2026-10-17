import { GameRenderer } from "./renderer.js";
import { WebData, webIndexURL } from "./data.js";
import { loadPresentation } from "./presentation.js";
import { OperaPlayer, operaCaption } from "./opera.js";
import { OperaHost } from "./opera-host.js";
import { WebAudioPlayer } from "./audio.js";
const $ = (id) => document.getElementById(id);
const renderer = new GameRenderer($("screen"));
await renderer.init();
const repository = new WebData(webIndexURL());
repository.index = await repository.json(webIndexURL().href);
const presentation = await loadPresentation(repository, renderer, { setPresentation() {} });
const audio = new WebAudioPlayer();
audio.setAssets(repository.index.assets.audio, repository.baseURL);
const core = await repository.json(repository.index.core);
audio.setCatalog(core.audio);
const host = new OperaHost(renderer, audio, { fontFamily: presentation.fontFamily });
host.setRepository(repository);
const catalog = await repository.json(repository.index.opera);
const preview = new OperaPlayer({
  parent: renderer.app.stage,
  renderer: renderer.app.renderer,
  getTexture: (url) => renderer.getTexture(url),
  fontFamily: presentation.fontFamily,
  warn: (message) => renderer._warnOnce("opera:" + message, message),
});
await preview.load(catalog);
let stage = 100,
  previous = performance.now();
function sample() {
  host.reset();
  preview.select(stage);
  preview.time = Math.max(0, Math.min(preview.duration - 0.001, Number($("time").value) || 0));
  preview.container.visible = true;
  preview.render();
  $("status").textContent =
    `源片段 ${stage} · 时间 ${preview.time.toFixed(3)} / ${preview.duration.toFixed(3)} 秒`;
}
for (const [id, label] of [
  [100, "100 序幕"],
  [101, "101 玛利亚登场"],
  [200, "200 咏叹调"],
  [301, "301 婚礼舞蹈"],
]) {
  const button = document.createElement("button");
  button.textContent = label;
  button.onclick = () => {
    stage = id;
    sample();
  };
  $("stages").append(button);
}
$("sample").onclick = sample;
$("play").onclick = () => {
  preview.container.visible = false;
  host.play(stage);
  $("status").textContent = `播放源片段 ${stage}（空格暂停，Esc 跳过）`;
};
$("pause").onclick = () => host.togglePause();
$("skip").onclick = () => {
  host.finish();
  $("status").textContent = "演出已结束，主机可继续剧情";
};
addEventListener("keydown", (event) => host.handleKey(event));
addEventListener("pointerdown", () => audio.unlock());
sample();
function loop(now) {
  const dt = Math.min(0.1, (now - previous) / 1000);
  previous = now;
  renderer.resize(undefined, Math.max(180, innerHeight - 270));
  host.update(dt);
  preview.container.scale.set(renderer.app.screen.width / 384);
  // Refresh pending atlas pages while this source time is held still.
  if (!host.busy && preview.container.visible) preview.render();
  renderer.render(null);
  const player = host.busy ? host.player : preview;
  $("metrics").textContent = JSON.stringify(
    {
      mode: host.busy ? "source-playback" : "source-still",
      stage,
      loading: !!host.loading,
      paused: !!host.paused,
      holdsGameplay: host.busy,
      time: player?.time,
      duration: player?.duration,
      caption: player?.state ? operaCaption(catalog, player.state) : null,
      draws: player?.draws.size || 0,
      renderTextures: player?.targets.size || 0,
      audio: audio.snapshot(),
      renderer: renderer.metrics(),
    },
    null,
    2,
  );
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
