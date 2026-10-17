import { createWidget } from "./ui.js";
import { WebData, webIndexURL } from "./data.js";
import { bestiaryRecords } from "../../src/play/bestiary.js";

export function createExtras({ ui, renderer, audio, game: currentGame, onOpen, onClose }) {
  const root = ui.get("extras"),
    navigation = ui.get("extras-nav"),
    body = ui.get("extras-body"),
    status = ui.get("extras-status");
  let catalog, battleData, loading, previousMusic, previousCatalog, pausedMusic;
  let opening = 0;
  const state = { page: "图鉴", offset: 0, selected: null, knownOnly: false, music: 0 };
  const node = (tag, text) => {
    const n = createWidget(tag);
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (label, action) => {
    const n = node("button", label);
    n.onclick = action;
    return n;
  };
  const image = (source, large = false) => {
    const n = node("img");
    n.setAttribute("src", source.url);
    if (large) Object.assign(n.dataset, { width: "1536", height: "660", block: "1" });
    return n;
  };
  const paragraph = (text) => body.append(node("p", text));
  const entryName = (entry) => {
    const name = entry.name || battleData.monsters[entry.monsterId]?.name;
    return name && !/^mt_ff6_/i.test(name) ? name : `资料 ${catalog.thumbnails.indexOf(entry) + 1}`;
  };
  async function load() {
    if (!loading)
      loading = (async () => {
        const repository = new WebData(webIndexURL());
        const index = (repository.index = await repository.json(webIndexURL().href));
        if (!index.extras) throw Error("额外内容数据尚未导出，请重新导出数据。");
        [catalog, battleData] = await Promise.all([
          repository.json(index.extras),
          repository.json(index.battle),
        ]);
        renderer.setAssets(index.assets.images, repository.baseURL);
        audio.setAssets(index.assets.audio, repository.baseURL);
        for (const message of catalog.warnings || []) console.warn("[Extras guess]", message);
      })().catch((error) => {
        loading = null;
        throw error;
      });
    await loading;
  }
  function selectPage(page) {
    Object.assign(state, { page, offset: 0, selected: null });
    ui.scroll(root, -Infinity);
    render();
  }
  async function play(index, offset = 0) {
    if (!catalog.music.length) return;
    state.music = (index + catalog.music.length) % catalog.music.length;
    pausedMusic = null;
    const track = catalog.music[state.music];
    await audio.playMusic(track.bgmId, { offset, restart: true });
    if (root.hidden) return;
    status.textContent =
      audio.current?.id === Number(track.bgmId)
        ? `正在播放：${track.name}`
        : "曲目未能播放，请重试。";
    render();
  }
  function details(entry, records) {
    body.append(
      button("← 返回列表", () => {
        state.selected = null;
        ui.scroll(root, -Infinity);
        render();
      }),
    );
    if (state.page === "画廊") {
      paragraph(entry.name);
      body.append(image(entry.image, true));
      return;
    }
    const monster = battleData.monsters[entry.monsterId],
      record = records[entry.monsterId],
      known = state.page === "资料库" || !!record;
    paragraph(known ? entryName(entry) : `No. ${entry.id}　？？？`);
    if (!known) return paragraph("尚未记录。遇见敌人后会保留在当前存档的图鉴中。");
    if (entry.image || entry.thumbnail || monster?.sprite)
      body.append(image(entry.image || entry.thumbnail || monster.sprite));
    if (record)
      paragraph(
        record.historical
          ? "旧存档：已胜利阵型记录"
          : `遇见 ${record.seen} 场 · 击倒 ${record.defeated} 场`,
      );
    if (monster && entry.statusDisplay !== false && entry.statusDisplay !== 0) {
      paragraph(`Lv ${monster.level}　HP ${monster.maxHp}　MP ${monster.maxMp}`);
      paragraph(
        `攻击 ${monster.attack}　防御 ${monster.defense}　魔防 ${monster.magicDefense}　速度 ${monster.speed}`,
      );
      paragraph(`经验 ${monster.exp}　金币 ${monster.gil}`);
      const names = (rows) =>
        (rows || []).map((r) => battleData.contentNames[r.id] || `#${r.id}`).join(" / ") || "无";
      paragraph(`掉落：${names(monster.drops)}　偷盗：${names(monster.steal)}`);
      const elements = ["", "火", "冰", "雷", "毒", "风", "圣", "地", "水"];
      const labels = { 1: "弱点", 2: "耐性", 3: "无效", 4: "吸收" };
      const affinity = Object.entries(monster.elementResistances || {})
        .map(([id, rate]) => `${elements[id] || id}：${labels[rate] || rate}`)
        .join("　");
      if (affinity) paragraph(`属性：${affinity}`);
    }
    const habitats = entry.habitats || [];
    if (habitats.length)
      paragraph(
        `栖息地：${[...new Set(habitats.map((h) => h.areaName || h.name || `区域 ${h.areaId}`))].join("、")}`,
      );
  }
  function render() {
    navigation.replaceChildren(
      ...["图鉴", "画廊", "资料库", "音乐"].map((page) => button(page, () => selectPage(page))),
    );
    body.replaceChildren();
    if (!catalog) return;
    const records = bestiaryRecords(currentGame(), battleData);
    if (Object.values(records).some((r) => r.historical) && !state.warnedHistory) {
      state.warnedHistory = true;
      console.warn(
        "[Extras guess] Old-save bestiary uses victorious PR formations; conditional/hidden members may be overcounted. New battles record visible combatants individually.",
      );
    }
    let entries =
      state.page === "图鉴"
        ? catalog.bestiary
        : state.page === "画廊"
          ? catalog.gallery
          : state.page === "资料库"
            ? catalog.thumbnails
            : catalog.music;
    if (state.page === "图鉴") {
      paragraph(
        `怪物图鉴　${catalog.bestiary.filter((e) => records[e.monsterId]).length} / ${catalog.bestiary.length}`,
      );
      body.append(
        button(state.knownOnly ? "显示全部" : "只看已遇见", () => {
          state.knownOnly = !state.knownOnly;
          state.offset = 0;
          state.selected = null;
          render();
        }),
      );
      if (state.knownOnly) entries = entries.filter((e) => records[e.monsterId]);
    }
    if (state.selected != null)
      return details(entries.find((e) => e.id === state.selected) || entries[0], records);
    if (state.page === "音乐") {
      const selected = catalog.music[state.music];
      paragraph(
        selected ? `${state.music + 1} / ${catalog.music.length}　${selected.name}` : "没有曲目",
      );
      body.append(
        button("上一首", () => play(state.music - 1)),
        button("播放", () => play(state.music, pausedMusic?.offset || 0)),
        button("暂停", () => {
          pausedMusic = audio.current ? { offset: audio.position() } : pausedMusic;
          audio.playMusic(0);
          status.textContent = "已暂停";
        }),
        button("下一首", () => play(state.music + 1)),
        button("停止", () => {
          pausedMusic = null;
          audio.playMusic(0);
          status.textContent = "已停止";
        }),
      );
    }
    const pageSize = 12,
      total = Math.max(1, Math.ceil(entries.length / pageSize));
    state.offset = Math.min(state.offset, total - 1);
    paragraph(`${state.page}　${entries.length} 项　${state.offset + 1} / ${total} 页`);
    body.append(
      button("← 上一页", () => {
        state.offset = Math.max(0, state.offset - 1);
        render();
      }),
      button("下一页 →", () => {
        state.offset = Math.min(total - 1, state.offset + 1);
        render();
      }),
    );
    for (const entry of entries.slice(state.offset * pageSize, (state.offset + 1) * pageSize)) {
      const known = state.page !== "图鉴" || records[entry.monsterId];
      const row = button(
        `${String(state.page === "资料库" ? entries.indexOf(entry) + 1 : entry.id).padStart(3, "0")}　${known ? entryName(entry) : "？？？"}`,
        () => {
          if (state.page === "音乐") return play(catalog.music.indexOf(entry));
          state.selected = entry.id;
          ui.scroll(root, -Infinity);
          render();
        },
      );
      row.dataset.block = "1";
      body.append(row);
    }
  }
  return {
    get active() {
      return !root.hidden;
    },
    async open(page = "图鉴") {
      const ticket = ++opening;
      previousMusic = audio.current ? { id: audio.current.id, offset: audio.position() } : null;
      previousCatalog = audio.catalog;
      audio.playMusic(0);
      root.hidden = false;
      onOpen();
      status.textContent = "正在读取额外内容…";
      try {
        await load();
        if (root.hidden || ticket !== opening) return;
        audio.setCatalog(catalog.audio);
        status.textContent = "";
        selectPage(page);
      } catch (error) {
        status.textContent = error.message;
      }
    },
    close() {
      opening++;
      root.hidden = true;
      pausedMusic = null;
      audio.setCatalog(previousCatalog);
      audio.playMusic(previousMusic?.id || 0, {
        offset: previousMusic?.offset || 0,
        restart: true,
      });
      onClose();
    },
  };
}
