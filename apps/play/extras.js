import { tr } from "../../src/play/i18n.js";
import { localizeBattle, localizeExtras } from "../../src/play/localized-data.js";
import { createWidget } from "./ui.js";
import { WebData, webIndexURL } from "./data.js";
import { bestiaryRecords } from "../../src/play/bestiary.js";

export function createExtras({ ui, renderer, audio, game: currentGame, onOpen, onClose }) {
  const root = ui.get("extras"),
    navigation = ui.get("extras-nav"),
    body = ui.get("extras-body"),
    status = ui.get("extras-status");
  root.dataset.modern = "1";
  let catalog, battleData, loading, previousMusic, previousCatalog, pausedMusic;
  let previews = {},
    opening = 0;
  const state = {
    page: "图鉴",
    offset: 0,
    selected: null,
    knownOnly: false,
    music: 0,
    query: "",
    columns: 6,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  const node = (tag, text) => {
    const n = createWidget(tag);
    n.dataset.modern = "1";
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (label, action, width) => {
    const n = node("button", label);
    if (width) n.dataset.width = String(width);
    n.onclick = action;
    return n;
  };
  const paragraph = (text) => body.append(node("p", text));
  const entryName = (entry) => {
    const name = entry.name || battleData.monsters[entry.monsterId]?.name;
    return name && !/^mt_ff6_/i.test(name)
      ? name
      : tr("extras.reference_value", { v0: catalog.thumbnails.indexOf(entry) + 1 });
  };
  const entryNumber = (entry) =>
    state.page === "资料库" ? catalog.thumbnails.indexOf(entry) + 1 : entry.id;
  function setPreviews(manifest) {
    previews = manifest?.images || {};
    if (catalog && !root.hidden) render();
  }
  async function load() {
    if (!loading)
      loading = (async () => {
        const repository = new WebData(webIndexURL());
        const index = (repository.index = await repository.json(webIndexURL().href));
        if (!index.extras)
          throw Error(tr("extras.extra_content_has_not_been_exported_export_the_data_aga"));
        [catalog, battleData] = await Promise.all([
          repository.json(index.extras),
          repository.json(index.battle),
        ]);
        catalog = structuredClone(catalog);
        battleData = structuredClone(battleData);
        const locale = await repository.locale();
        localizeExtras(catalog, locale);
        localizeBattle(battleData, locale);
        if (index.extrasPreviews) setPreviews(await repository.json(index.extrasPreviews));
        audio.setAssets(index.assets.audio, repository.baseURL);
        for (const message of catalog.warnings || []) console.warn("[Extras guess]", message);
      })().catch((error) => {
        loading = null;
        throw error;
      });
    await loading;
  }
  function selectPage(page) {
    Object.assign(state, { page, offset: 0, selected: null, query: "", zoom: 1, panX: 0, panY: 0 });
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
        ? tr("extras.playing_value", { v0: track.name })
        : tr("extras.could_not_play_the_track_please_retry");
    render();
  }
  function picture(source, height, key, zoomable = false) {
    const n = node(zoomable ? "viewer" : "img");
    n.setAttribute("src", source.url);
    Object.assign(n.dataset, {
      height: String(height),
      block: "1",
      required: "1",
      entityId: String(key),
      resource: state.page === "画廊" ? "extras-gallery" : "extras-monster",
      zoom: String(state.zoom),
      panX: String(state.panX),
      panY: String(state.panY),
    });
    n.onpan = (x, y) => {
      state.panX = x;
      state.panY = y;
    };
    return n;
  }
  function details(entry, records) {
    body.append(
      button(
        tr("extras.back_to_grid"),
        () => {
          state.selected = null;
          ui.scroll(root, -Infinity);
          render();
        },
        228,
      ),
    );
    if (state.page === "画廊") {
      const zoom = (value) => {
        state.zoom = Math.max(1, Math.min(4, value));
        state.panX = state.panY = 0;
        render();
      };
      body.append(
        button(tr("extras.zoom_out"), () => zoom(state.zoom - 0.5), 180),
        button(
          tr("extras.fit_window_value", { v0: Math.round(state.zoom * 100) }),
          () => zoom(1),
          360,
        ),
        button(tr("extras.zoom_in"), () => zoom(state.zoom + 0.5), 180),
      );
      paragraph(tr("extras.value_drag_to_pan_when_zoomed_in", { v0: entry.name }));
      body.append(picture(entry.image, 684, entry.id, true));
      return;
    }
    const monster = battleData.monsters[entry.monsterId],
      record = records[entry.monsterId],
      known = state.page === "资料库" || !!record;
    paragraph(known ? entryName(entry) : `No. ${entry.id}　？？？`);
    if (!known)
      return paragraph(tr("extras.not_recorded_yet_encounter_enemies_to_add_them_to_this_"));
    if (entry.image || entry.thumbnail || monster?.sprite)
      body.append(picture(entry.image || entry.thumbnail || monster.sprite, 240, entry.id));
    if (record)
      paragraph(
        record.historical
          ? tr("extras.legacy_save_victorious_formation_records")
          : tr("extras.encounters_value_defeats_value", { v0: record.seen, v1: record.defeated }),
      );
    if (monster && entry.statusDisplay !== false && entry.statusDisplay !== 0) {
      paragraph(`Lv ${monster.level}　HP ${monster.maxHp}　MP ${monster.maxMp}`);
      paragraph(
        tr("extras.attack_value_defense_value_magic_defense_value_speed_va", {
          v0: monster.attack,
          v1: monster.defense,
          v2: monster.magicDefense,
          v3: monster.speed,
        }),
      );
      paragraph(tr("extras.exp_value_gil_value", { v0: monster.exp, v1: monster.gil }));
      const names = (rows) =>
        (rows || []).map((r) => battleData.contentNames[r.id] || `#${r.id}`).join(" / ") ||
        tr("extras.none");
      paragraph(
        tr("extras.drops_value_steal_value", {
          v0: names(monster.drops),
          v1: names(monster.steal),
        }),
      );
      const elements = [
          "",
          tr("extras.fire"),
          tr("extras.ice"),
          tr("extras.lightning"),
          tr("extras.poison"),
          tr("extras.wind"),
          tr("extras.holy"),
          tr("extras.earth"),
          tr("extras.water"),
        ],
        labels = {
          1: tr("extras.weak"),
          2: tr("extras.resist"),
          3: tr("extras.immune"),
          4: tr("extras.absorb"),
        };
      const affinity = Object.entries(monster.elementResistances || {})
        .map(([id, rate]) => `${elements[id] || id}：${labels[rate] || rate}`)
        .join("　");
      if (affinity) paragraph(tr("extras.elements_value", { v0: affinity }));
    }
    if (entry.habitats?.length)
      paragraph(
        tr("extras.habitat_value", {
          v0: [
            ...new Set(
              entry.habitats.map(
                (h) => h.areaName || h.name || tr("extras.area_value", { v0: h.areaId }),
              ),
            ),
          ].join("、"),
        }),
      );
  }
  function render() {
    ui.clearHover();
    navigation.replaceChildren(
      ...["图鉴", "画廊", "资料库", "音乐"].map((page) => {
        const keys = {
          图鉴: "extras.bestiary",
          画廊: "extras.gallery",
          资料库: "extras.reference",
          音乐: "extras.music",
        };
        const n = button(tr(keys[page]), () => selectPage(page), 216);
        n.dataset.selected = page === state.page ? "1" : "";
        return n;
      }),
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
    if (state.selected != null) {
      const selected = entries.find((e) => e.id === state.selected);
      if (selected) return details(selected, records);
      state.selected = null;
    }
    const search = node("input");
    search.value = state.query;
    search.setAttribute("type", "search");
    search.setAttribute("aria-label", tr("extras.search_name_or_number"));
    search.setAttribute("placeholder", tr("extras.search_name_or_number_208"));
    Object.assign(search.dataset, { width: "660", maxLength: "120" });
    search.onchange = () => {
      state.query = search.value;
      state.offset = 0;
      ui.scroll(root, -Infinity);
      render();
    };
    body.append(
      search,
      button(
        tr("battle_menu.clear"),
        () => {
          state.query = "";
          state.offset = 0;
          render();
        },
        132,
      ),
    );
    if (state.page === "图鉴") {
      body.append(
        button(
          state.knownOnly ? tr("extras.encountered") : tr("extras.encountered_only"),
          () => {
            state.knownOnly = !state.knownOnly;
            state.offset = 0;
            render();
          },
          252,
        ),
      );
      if (state.knownOnly) entries = entries.filter((e) => records[e.monsterId]);
    }
    body.append(
      button(
        state.columns === 6 ? tr("extras.24_per_page") : tr("extras.32_per_page"),
        () => {
          state.columns = state.columns === 6 ? 8 : 6;
          state.offset = 0;
          render();
        },
        228,
      ),
    );
    const query = state.query.trim().toLocaleLowerCase();
    if (query)
      entries = entries.filter((e) => {
        const known = state.page !== "图鉴" || records[e.monsterId];
        return `${String(entryNumber(e)).padStart(3, "0")} ${known ? entryName(e) : "？？？"}`
          .toLocaleLowerCase()
          .includes(query);
      });
    const pageSize = state.columns * 4,
      total = Math.max(1, Math.ceil(entries.length / pageSize));
    state.offset = Math.min(state.offset, total - 1);
    const pager = node("div"),
      prev = button(
        tr("extras.previous_page"),
        () => {
          state.offset--;
          render();
        },
        228,
      ),
      next = button(
        tr("extras.next_page"),
        () => {
          state.offset++;
          render();
        },
        228,
      );
    prev.disabled = state.offset === 0;
    next.disabled = state.offset >= total - 1;
    const count = button(
      tr("extras.value_value_entries_page_value_value", {
        v0: tr(
          {
            图鉴: "extras.bestiary",
            画廊: "extras.gallery",
            资料库: "extras.reference",
            音乐: "extras.music",
          }[state.page],
        ),
        v1: entries.length,
        v2: state.offset + 1,
        v3: total,
      }),
      () => {},
      750,
    );
    count.disabled = true;
    pager.append(prev, count, next);
    body.append(pager);
    if (state.page === "音乐") {
      body.append(
        button(tr("extras.previous_track"), () => play(state.music - 1), 180),
        button(tr("extras.play"), () => play(state.music, pausedMusic?.offset || 0), 180),
        button(
          tr("extras.pause"),
          () => {
            pausedMusic = audio.current ? { offset: audio.position() } : pausedMusic;
            audio.playMusic(0);
            status.textContent = tr("extras.paused");
          },
          180,
        ),
        button(tr("extras.next_track"), () => play(state.music + 1), 180),
        button(
          tr("extras.stop"),
          () => {
            pausedMusic = null;
            audio.playMusic(0);
            status.textContent = tr("extras.stopped");
          },
          180,
        ),
      );
    }
    const grid = node("grid");
    Object.assign(grid.dataset, {
      columns: String(state.columns),
      rows: "4",
      height: state.page === "音乐" ? "510" : "624",
    });
    for (const entry of entries.slice(state.offset * pageSize, (state.offset + 1) * pageSize)) {
      const known = state.page !== "图鉴" || records[entry.monsterId],
        ordinal = entryNumber(entry),
        card = button(
          `${String(ordinal).padStart(3, "0")}　${known ? entryName(entry) : "？？？"}`,
          () => {
            if (state.page === "音乐") return play(catalog.music.indexOf(entry));
            Object.assign(state, { selected: entry.id, zoom: 1, panX: 0, panY: 0 });
            ui.scroll(root, -Infinity);
            render();
          },
        );
      card.dataset.card = "1";
      const source =
        state.page === "画廊"
          ? previews[entry.image?.url]
          : known
            ? entry.image || entry.thumbnail || battleData.monsters[entry.monsterId]?.sprite
            : null;
      if (source) {
        card.setAttribute("src", source.url);
        Object.assign(card.dataset, {
          required: "1",
          entityId: String(entry.id),
          resource: state.page === "画廊" ? "extras-preview" : "extras-thumbnail",
        });
      }
      if (state.page === "音乐")
        card.dataset.selected = entry === catalog.music[state.music] ? "1" : "";
      grid.append(card);
    }
    body.append(grid);
    if (!entries.length) paragraph(tr("extras.no_matching_entries_try_a_different_search"));
    if (state.page === "画廊" && !Object.keys(previews).length && !state.warnedPreviews) {
      state.warnedPreviews = true;
      console.warn(
        "[Extras] Gallery previews are unavailable; only a selected original is loaded.",
      );
    }
  }
  return {
    async translate(locale = null) {
      if (!catalog) return;
      if (!locale) {
        const repository = new WebData(webIndexURL());
        locale = await repository.locale();
      }
      localizeExtras(catalog, locale);
      localizeBattle(battleData, locale);
      if (!root.hidden) render();
    },
    get active() {
      return !root.hidden;
    },
    setPreviews,
    async open(page = "图鉴") {
      const ticket = ++opening;
      previousMusic = audio.current ? { id: audio.current.id, offset: audio.position() } : null;
      previousCatalog = audio.catalog;
      audio.playMusic(0);
      root.hidden = false;
      onOpen();
      status.textContent = tr("extras.loading_extra_content");
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
      ui.clearHover();
      ui.closeSelect();
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
