import {
  NODE_TYPES,
  compileStoryProject,
  sceneName,
  storyBank,
  validateStoryProject,
  validateSourceDocument,
} from "../../src/play/story-authoring.js";
import { createStoryProject, createAktoStoryDemo } from "../../src/play/story-demo.js";
import { drawStoryGraph, nodeSummary, sourceLabel } from "./story-graph.js";
import { StoryPreview } from "./story-preview.js";
const $ = (id) => document.getElementById(id),
  clone = (v) => structuredClone(v);
const state = {
  doc: null,
  revision: 0,
  dirty: false,
  sceneId: null,
  selected: null,
  view: "graph",
  inspector: "node",
  page: 0,
  offset: 0,
  segment: -1,
  undo: [],
  redo: [],
  breakpoints: new Set(),
  sourceInfo: null,
};
const element = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
function notify(message) {
  $("notification").textContent = message;
  $("notification").hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => ($("notification").hidden = true), 6500);
}
async function api(url, options) {
  const response = await fetch(`/__story/${url}`, options);
  const result = await response.json();
  if (!response.ok) {
    const error = Error(result.error || `请求失败 ${response.status}`);
    error.result = result;
    error.status = response.status;
    throw error;
  }
  return result;
}
const database = await new Promise((resolve, reject) => {
  const request = indexedDB.open("ffvi-story-editor-drafts-v1", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("documents");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function draft(id) {
  return new Promise((resolve, reject) => {
    const r = database.transaction("documents").objectStore("documents").get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function persist() {
  if (!state.doc) return;
  const tx = database.transaction("documents", "readwrite"),
    store = tx.objectStore("documents");
  store.put(
    {
      document: clone(state.doc),
      revision: state.revision,
      dirty: state.dirty,
      sceneId: state.sceneId,
      selected: state.selected,
    },
    state.doc.id,
  );
  store.put(state.doc.id, "__last__");
}
function scene() {
  return state.doc?.scenes?.find((s) => s.id === state.sceneId) || state.doc?.scenes?.[0];
}
function selectedNode() {
  return scene()?.nodes.find((n) => n.id === state.selected);
}
function edit(change, { redraw = true } = {}) {
  state.undo.push(clone(state.doc));
  if (state.undo.length > 50) state.undo.shift();
  state.redo = [];
  change();
  state.dirty = true;
  persist().catch((e) => notify(e.message));
  if (redraw) render();
  else saveLabel();
}
function saveLabel() {
  $("save-state").textContent = state.dirty
    ? "未写入文件 · 草稿已暂存"
    : state.revision
      ? `已保存 · 版本 ${state.revision}`
      : "尚未写入文件";
  $("undo").disabled = !state.undo.length;
  $("redo").disabled = !state.redo.length;
}
async function openDocument(document, revision = 0, { useDraft = true } = {}) {
  await persist();
  const savedDraft = useDraft ? await draft(document.id) : null;
  Object.assign(state, {
    doc: clone(savedDraft?.document || document),
    revision: savedDraft?.revision ?? revision,
    dirty: savedDraft?.dirty ?? false,
    sceneId: savedDraft?.sceneId || document.scenes?.[0]?.id,
    selected:
      savedDraft?.selected ?? (document.mode === "source" ? "0" : document.scenes?.[0]?.entry),
    undo: [],
    redo: [],
    offset: 0,
    segment: -1,
    sourceInfo: null,
  });
  if (state.doc.mode === "source") {
    state.doc.messages ??= {};
    state.doc.speakers ??= {};
    try {
      state.sourceInfo = await api(`program/${state.doc.source.programId}`);
    } catch (error) {
      state.sourceInfo = {};
      notify(`原版索引暂不可用，已保留源文档：${error.message}`);
    }
  }
  $("preview-world").value =
    state.doc.preview?.world ||
    (state.doc.source?.kind === "authored" || state.doc.source?.programId?.startsWith("akto-")
      ? "akto"
      : "original");
  $("preview-map").value = state.doc.preview?.mapId || state.sourceInfo?.maps?.[0] || 609;
  $("preview-entrance").value = state.doc.preview?.entrance || 1;
  render();
  await persist();
}
const catalog = await api("catalog");
for (const [id, map] of Object.entries(catalog.maps))
  $("map-options").append(element("option", `${map.title} · ${map.name}`, { value: id }));
for (const id of ["preview-map", "map-filter"]) $(id).setAttribute("list", "map-options");
$("corpus-count").textContent = catalog.programs.length.toLocaleString();
for (const [type, label] of Object.entries(NODE_TYPES))
  $("node-type").append(element("option", label, { value: type }));
let sourceResults = [];
function renderLibrary() {
  const needle = $("search").value.trim().toLowerCase(),
    category = $("category").value,
    map = $("map-filter").value;
  sourceResults = catalog.programs.filter(
    (p) =>
      (!category || p.category === category) &&
      (!map || p.maps.includes(Number(map))) &&
      (!needle || `${p.name} ${p.title} ${p.searchText || ""}`.toLowerCase().includes(needle)),
  );
  const maxPage = Math.max(0, Math.ceil(sourceResults.length / 30) - 1);
  state.page = Math.min(state.page, maxPage);
  $("source-list").replaceChildren();
  for (const p of sourceResults.slice(state.page * 30, (state.page + 1) * 30)) {
    const b = element("button", null, {
      class: `library-item ${state.doc?.source?.programId === p.id ? "active" : ""}`,
      "data-source": p.id,
    });
    b.append(
      element("span", p.title || p.name),
      element(
        "small",
        `${p.category} · ${p.name} · ${p.count} 步${p.maps.length ? ` · 地图 ${p.maps.length > 4 ? p.maps.length + " 处" : p.maps.join(",")}` : ""}`,
      ),
    );
    b.onclick = () => openSource(p.id).catch((e) => notify(e.message));
    $("source-list").append(b);
  }
  $("result-count").textContent = `${sourceResults.length} 项 · ${state.page + 1}/${maxPage + 1}`;
  $("previous").disabled = state.page === 0;
  $("next").disabled = state.page === maxPage;
}
async function openSource(id) {
  const v = await api(`program/${id}`);
  const saved = await api(`documents/source-${id}`);
  const document = {
    version: 1,
    id: `source-${id}`,
    mode: "source",
    title: v.program.title || v.program.name,
    source: clone(v.source),
    program: clone(v.program),
    messages: v.messages,
    speakers: v.speakers,
  };
  await openDocument(saved?.document || document, saved?.revision || 0);
  state.sourceInfo = v;
  renderProperties();
}
function field(parent, label, value, onChange, { type = "text", options, rows } = {}) {
  const wrapper = element("label", label),
    input = element(options ? "select" : rows ? "textarea" : "input");
  input.setAttribute("aria-label", label);
  if (options) {
    for (const item of options) {
      const [v, t] = Array.isArray(item) ? item : [item, item];
      input.append(element("option", t, { value: v }));
    }
  } else if (rows) input.rows = rows;
  else input.type = type;
  input.value = value ?? "";
  if (type === "number" && label.includes("地图")) input.setAttribute("list", "map-options");
  input.addEventListener("change", () => {
    try {
      onChange(type === "number" ? Number(input.value) : input.value);
    } catch (e) {
      notify(e.message);
    }
  });
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}
function button(parent, label, callback, attrs = {}) {
  const b = element("button", label, attrs);
  b.onclick = () => Promise.resolve(callback()).catch((e) => notify(e.message));
  parent.append(b);
  return b;
}
function note(parent, text, cls = "note") {
  parent.append(element("p", text, { class: cls }));
}
function sourceField(parent, label, value, change, type = "text") {
  return field(parent, label, value, (v) => edit(() => change(v)), { type });
}
function render() {
  if (!state.doc) return;
  saveLabel();
  $("document-title").value = state.doc.title;
  $("document-kind").textContent =
    state.doc.mode === "source"
      ? state.doc.source.kind === "authored"
        ? "阿克托演出覆盖 · 独立创作文件"
        : "原版覆盖 · 独立创作文件"
      : "原创剧情 · 本机项目";
  $("scene-title").textContent =
    state.doc.mode === "source" ? state.doc.program.name : scene()?.title;
  $("scene-list").replaceChildren();
  if (state.doc.mode !== "source")
    for (const s of state.doc.scenes) {
      const b = element("button", s.title, {
        class: `library-item ${s.id === state.sceneId ? "active" : ""}`,
      });
      b.onclick = () => {
        state.sceneId = s.id;
        state.selected = s.entry;
        render();
        persist();
      };
      $("scene-list").append(b);
    }
  for (const id of [
    "add-scene",
    "copy-scene",
    "rename-scene",
    "add-node",
    "copy-node",
    "delete-node",
    "node-type",
  ])
    $(id).disabled = state.doc.mode === "source";
  $("segment").hidden = state.doc.mode !== "source";
  $("graph-prev").hidden = state.doc.mode !== "source";
  $("graph-next").hidden = state.doc.mode !== "source";
  if (state.doc.mode === "source") {
    $("segment").replaceChildren(element("option", "按指令分页", { value: -1 }));
    (state.doc.program.segments || []).forEach((s, i) =>
      $("segment").append(
        element("option", `${s.Label} · ${s.EntryPoint} 起 / ${s.Count} 步`, { value: i }),
      ),
    );
    $("segment").value = state.segment;
  }
  renderLibrary();
  renderGraph();
  renderSteps();
  renderTracks();
  renderProperties();
  renderCompiled();
  $("selection-status").textContent = state.selected ? `选中 ${state.selected}` : "";
}
function selectNode(id) {
  state.selected = id;
  if (state.doc.mode === "source") {
    const pc = Number(id),
      current = state.doc.program.segments?.[state.segment];
    const start = current?.EntryPoint ?? state.offset,
      end = current ? start + Math.min(80, current.Count) : start + 80;
    if (pc < start || pc >= end) {
      state.segment = -1;
      state.offset = Math.floor(pc / 80) * 80;
      $("segment").value = -1;
    }
  }
  state.inspector = "node";
  for (const b of document.querySelectorAll("[data-inspector]"))
    b.setAttribute("aria-pressed", String(b.dataset.inspector === "node"));
  renderGraph();
  renderProperties();
  renderSteps();
  persist();
}
function renderGraph(executing) {
  const counts = drawStoryGraph($("graph"), {
    document: state.doc,
    scene: scene(),
    selected: state.selected,
    onSelect: selectNode,
    onReposition: (id, position) =>
      edit(() => {
        scene().nodes.find((n) => n.id === id).position = position;
      }),
    offset: state.offset,
    segment: state.segment,
    executing,
  });
  $("graph-summary").textContent =
    `${counts.total} 个${state.doc.mode === "source" ? "运行指令" : "创作节点"}${counts.count < counts.total ? ` · 当前显示 ${counts.count}` : ""}`;
}
function renderSteps() {
  const box = $("steps");
  box.replaceChildren();
  if (state.doc.mode === "source") {
    const start = state.doc.program.segments?.[state.segment]?.EntryPoint ?? state.offset;
    state.doc.program.ops.slice(start, start + 80).forEach((o, i) => {
      const b = button(
        box,
        `${start + i} · ${sourceLabel(o[0])}`,
        () => selectNode(String(start + i)),
        {
          class: `step-card ${state.selected === String(start + i) ? "active" : ""}`,
        },
      );
      b.append(
        element(
          "small",
          o[0] === "Msg" ? state.doc.messages[o[3][0]] : JSON.stringify(o.slice(1, 4)),
        ),
      );
    });
  } else
    for (const n of scene().nodes) {
      const b = button(box, n.title || NODE_TYPES[n.type] || n.type, () => selectNode(n.id), {
        class: `step-card ${state.selected === n.id ? "active" : ""}`,
      });
      b.append(element("small", nodeSummary(n)));
    }
}
function renderTracks() {
  const box = $("tracks");
  box.replaceChildren();
  const lanes = new Map();
  const add = (actor, node, title, sub) => {
    if (!lanes.has(actor)) lanes.set(actor, []);
    lanes.get(actor).push({ node, title, sub });
  };
  if (state.doc.mode === "source") {
    const p = state.doc.program;
    for (let pc = 0; pc < p.ops.length; pc++) {
      const [name, i] = p.ops[pc];
      if (name !== "SetPuppet") continue;
      let actions = 0;
      for (let t = i[2]; t < p.ops.length && actions < 80; t++) {
        const o = p.ops[t];
        if (["Exit", "Return"].includes(o[0])) break;
        add(String(i[1]), String(t), o[0], JSON.stringify(o.slice(1, 3)));
        actions++;
      }
    }
  } else
    for (const n of scene().nodes) {
      if (["move", "animation", "camera"].includes(n.type))
        add(
          String(n.type === "camera" ? "镜头" : n.actor),
          n.id,
          NODE_TYPES[n.type],
          nodeSummary(n),
        );
      if (n.type === "parallel")
        for (const t of n.tracks || [])
          add(String(t.actor), n.id, "并行移动", `(${t.x}, ${t.y}) · ${t.duration}s`);
    }
  if (!lanes.size)
    note(
      box,
      "这个脚本没有角色分派。对白与选择造成的等待由试玩决定。时间轴中的步骤按执行顺序展示。",
    );
  for (const [actor, rows] of lanes) {
    const lane = element("div", null, { class: "track-lane" });
    lane.append(element("strong", `角色 ${actor}`));
    for (const row of rows) {
      const b = button(lane, row.title, () => selectNode(row.node), { class: "track-action" });
      b.append(element("small", row.sub));
    }
    box.append(lane);
  }
}
function renderProperties() {
  const box = $("properties");
  for (const b of document.querySelectorAll("[data-inspector]"))
    b.setAttribute("aria-pressed", String(b.dataset.inspector === state.inspector));
  box.replaceChildren();
  if (state.inspector === "world") return renderWorld(box);
  if (state.inspector === "references") return renderReferences(box);
  if (state.inspector === "versions") return renderVersions(box);
  if (state.doc.mode === "source") return renderSourceProperties(box);
  const n = selectedNode();
  if (!n) return;
  box.append(element("h2", NODE_TYPES[n.type] || n.type));
  note(box, `节点 ID：${n.id}`);
  const prop = (key, label, type = "text", options) =>
    field(box, label, n[key], (v) => edit(() => (n[key] = v)), { type, options });
  prop("title", "节点名称");
  const targets = scene().nodes.map((v) => [
    v.id,
    `${v.id} · ${v.title || NODE_TYPES[v.type] || v.type}`,
  ]);
  const vars = state.doc.variables.map((v) => [v.key, v.label || v.key]);
  if (n.type === "dialogue") {
    prop("speaker", "说话人");
    field(box, "对白", n.text, (v) => edit(() => (n.text = v)), { rows: 5 });
  }
  if (["set", "condition"].includes(n.type)) {
    prop("variable", "世界变量", "text", vars);
    prop("value", "状态值", "number");
    if (n.type === "condition") {
      prop("operator", "比较", "text", ["=", "!=", ">=", "<=", ">", "<"]);
      prop("yes", "满足时前往", "text", targets);
      prop("no", "否则前往", "text", targets);
    } else
      prop("operation", "赋值方式", "text", [
        ["set", "设为"],
        ["add", "增加"],
      ]);
  }
  if (n.type === "choice") {
    n.options.forEach((o, index) => {
      const row = element("div", null, { class: "option-row" });
      field(row, `选项 ${index + 1}`, o.text, (v) => edit(() => (o.text = v)));
      field(row, `选项 ${index + 1} 前往`, o.target, (v) => edit(() => (o.target = v)), {
        options: targets,
      });
      button(row, "×", () => edit(() => n.options.splice(index, 1)), {
        "aria-label": `删除选项 ${index + 1}`,
      });
      box.append(row);
    });
    button(box, "＋ 添加选项", () =>
      edit(() =>
        n.options.push({ text: "新选项", target: scene().nodes.find((n) => n.type === "end")?.id }),
      ),
    );
  }
  if (["move", "animation"].includes(n.type)) prop("actor", "角色 ID（-1001 为玩家）", "number");
  if (["move", "camera"].includes(n.type)) {
    prop("x", "目的地 X", "number");
    prop("y", "目的地 Y", "number");
    prop("layer", "地图层（从 0 开始）", "number");
    prop("duration", "移动秒数", "number");
    note(box, "在地图与试玩中点击地图，可设置目的地。");
  }
  if (n.type === "animation") {
    prop("animation", "动作名称");
    prop("repeat", "重复次数", "number");
  }
  if (n.type === "wait") prop("duration", "等待秒数", "number");
  if (["bgm", "sound"].includes(n.type)) prop("assetId", "资源 ID", "number");
  if (n.type === "battle") prop("encounterId", "战斗编队 ID", "number");
  if (n.type === "call") prop("script", "调用脚本名");
  if (n.type === "map") {
    prop("mapId", "目标地图 ID", "number");
    prop("entrance", "入口 ID", "number");
    prop("script", "入场续接脚本（可空）");
  }
  if (n.type === "parallel") {
    (n.tracks || []).forEach((track, index) => {
      const row = element("div", null, { class: "binding-box" });
      note(row, `角色轨道 ${index + 1}`);
      for (const [key, label] of [
        ["actor", "角色 ID"],
        ["x", "目的地 X"],
        ["y", "目的地 Y"],
        ["duration", "移动秒数"],
      ])
        field(row, `轨道 ${index + 1} ${label}`, track[key], (v) => edit(() => (track[key] = v)), {
          type: "number",
        });
      button(row, "删除轨道", () => edit(() => n.tracks.splice(index, 1)));
      box.append(row);
    });
    button(box, "＋ 并行角色", () =>
      edit(() => (n.tracks ??= []).push({ actor: -1001, x: 64, y: 120, duration: 0.6 })),
    );
  }
  if (!["condition", "choice", "end", "map"].includes(n.type))
    prop("next", "下一步", "text", targets);
  const key = `${sceneName(state.doc, scene().id)}:${n.id}`;
  button(box, state.breakpoints.has(key) ? "移除断点" : "在此节点暂停", () => {
    state.breakpoints.has(key) ? state.breakpoints.delete(key) : state.breakpoints.add(key);
    renderProperties();
  });
}
function renderSourceProperties(box) {
  const pc = Number(state.selected),
    instruction = state.doc.program.ops[pc];
  if (!instruction) return;
  const [name, i, r, s] = instruction;
  box.append(element("h2", `${pc} · ${sourceLabel(name)} (${name})`));
  note(box, "原版覆盖保留指令数量与分段。参数和跳转可编辑；新编排使用原创脚本。");
  if (name === "Msg") {
    const key = s[0],
      setText = (text, speaker) => {
        const unique = `story:${state.doc.id}:message:${pc}`;
        instruction[3][0] = unique;
        state.doc.messages[unique] = text;
        state.doc.speakers[unique] = speaker;
      };
    sourceField(box, "说话人", state.doc.speakers[key] || "", (v) =>
      setText(state.doc.messages[key] || "", v),
    );
    field(
      box,
      "对白",
      state.doc.messages[key] || key,
      (v) => edit(() => setText(v, state.doc.speakers[key] || "")),
      { rows: 5 },
    );
  }
  if (name === "Wait")
    sourceField(box, "等待秒数", r[0] || 0, (v) => (instruction[2][0] = v), "number");
  if (name === "Select")
    s.forEach((key, index) => {
      if (!key) return;
      field(box, `选项 ${index + 1} 文本`, state.doc.messages[key] || key, (value) =>
        edit(() => {
          const unique = `story:${state.doc.id}:option:${pc}:${index}`;
          instruction[3][index] = unique;
          state.doc.messages[unique] = value;
        }),
      );
    });
  if (name === "Branch") {
    sourceField(box, "原版状态库", s[0], (v) => (instruction[3][0] = v));
    sourceField(box, "状态索引", i[0], (v) => (instruction[1][0] = v), "number");
    sourceField(box, "比较符号", s[1], (v) => (instruction[3][1] = v));
    sourceField(box, "比较值或索引", i[1], (v) => (instruction[1][1] = v), "number");
    sourceField(box, "满足时跳转到", i[2], (v) => (instruction[1][2] = v), "number");
  }
  if (["Call", "Jump", "JumpBattleAI"].includes(name))
    sourceField(box, "目标指令位置", i[0], (v) => (instruction[1][0] = v), "number");
  if (["Move", "LookAt"].includes(name))
    sourceField(
      box,
      "朝向（0 上 / 1 右 / 2 下 / 3 左）",
      i[0],
      (v) => (instruction[1][0] = v),
      "number",
    );
  if (name === "SetPuppet") {
    sourceField(box, "角色 ID", i[1], (v) => (instruction[1][1] = v), "number");
    sourceField(box, "角色片段入口", i[2], (v) => (instruction[1][2] = v), "number");
  }
  if (["Lerp", "SetPos"].includes(name)) {
    sourceField(box, "目的地 X", i[0], (v) => (instruction[1][0] = v), "number");
    sourceField(box, "目的地 Y", i[1], (v) => (instruction[1][1] = v), "number");
  }
  const details = element("details");
  details.append(element("summary", "完整指令参数"));
  field(details, "指令名称", name, (v) => edit(() => (instruction[0] = v)));
  for (const [slot, label] of [
    [1, "整数参数 i"],
    [2, "实数参数 r"],
    [3, "字符串参数 s"],
  ])
    field(
      details,
      label,
      JSON.stringify(instruction[slot]),
      (v) => {
        const value = JSON.parse(v);
        if (!Array.isArray(value)) throw Error("参数须为 JSON 数组");
        edit(() => (instruction[slot] = value));
      },
      { rows: 3 },
    );
  box.append(details);
  const key = `${state.doc.program.name}:${pc}`;
  button(box, state.breakpoints.has(key) ? "移除断点" : "在此指令暂停", () => {
    state.breakpoints.has(key) ? state.breakpoints.delete(key) : state.breakpoints.add(key);
    renderProperties();
  });
}
function renderWorld(box) {
  if (state.doc.mode === "source") {
    note(box, "原版覆盖沿用原有触发。新任务的 NPC、区域和入口绑定放在原创项目中。");
    return;
  }
  const project = state.doc;
  box.append(element("h2", "命名世界状态"));
  for (const variable of project.variables) {
    const row = element("div", null, { class: "variable-box" });
    note(row, `${variable.key} · 持久槽位 ${variable.slot}`);
    field(row, `状态标识 ${variable.key}`, variable.key, (value) => {
      if (!value || project.variables.some((v) => v !== variable && v.key === value))
        throw Error("状态标识须非空且不重复");
      edit(() => {
        const old = variable.key;
        variable.key = value;
        for (const scene of project.scenes)
          for (const node of scene.nodes) if (node.variable === old) node.variable = value;
        for (const binding of project.bindings)
          for (const condition of [
            ...(binding.when || []),
            ...(binding.variants || []).flatMap((v) => v.when || []),
          ])
            if (condition.variable === old) condition.variable = value;
      });
    });
    field(row, `状态名称 ${variable.key}`, variable.label, (v) => edit(() => (variable.label = v)));
    field(
      row,
      `初始值 ${variable.key}`,
      variable.initial,
      (v) => edit(() => (variable.initial = v)),
      { type: "number" },
    );
    box.append(row);
  }
  button(box, "＋ 新世界状态", () =>
    edit(() => {
      let slot = 0;
      while (project.variables.some((v) => v.slot === slot)) slot++;
      project.variables.push({ key: `state.${slot}`, label: `世界状态 ${slot}`, slot, initial: 0 });
    }),
  );
  box.append(element("h3", "触发绑定"));
  note(box, "地图试玩中点击 NPC 会创建或选中绑定。区域触发使用指定格坐标。");
  for (const binding of project.bindings) {
    const row = element("div", null, { class: "binding-box" });
    note(row, `绑定 ${binding.id}`);
    const set = (key, label, type = "text", options) =>
      field(row, label, binding[key], (v) => edit(() => (binding[key] = v)), { type, options });
    set("kind", `触发方式 ${binding.id}`, "text", [
      ["npc", "NPC / 地图物件交互"],
      ["region", "进入地图格"],
      ["entry", "进入地图"],
    ]);
    set("mapId", `绑定地图 ${binding.id}`, "number");
    set(
      "scene",
      `绑定脚本 ${binding.id}`,
      "text",
      project.scenes.map((s) => [s.id, s.title]),
    );
    if (binding.kind === "npc") set("entityId", `NPC ID ${binding.id}`);
    if (binding.kind === "region") {
      set("x", `触发 X ${binding.id}`, "number");
      set("y", `触发 Y ${binding.id}`, "number");
      set("layer", `触发层 ${binding.id}`, "number");
    }
    const vars = [["", "无条件"], ...project.variables.map((v) => [v.key, v.label || v.key])],
      c = binding.when?.[0];
    field(
      row,
      `前置状态 ${binding.id}`,
      c?.variable || "",
      (v) => edit(() => (binding.when = v ? [{ variable: v, value: 0 }] : [])),
      { options: vars },
    );
    if (c)
      field(row, `前置值 ${binding.id}`, c.value, (v) => edit(() => (c.value = v)), {
        type: "number",
      });
    const detail = element("details");
    detail.append(element("summary", "持久场景变化"));
    for (const [index, variant] of (binding.variants || []).entries()) {
      const c = variant.when?.[0];
      field(
        detail,
        `变化状态 ${binding.id} ${index}`,
        c?.variable || "",
        (v) => edit(() => (variant.when = v ? [{ variable: v, value: 1 }] : [])),
        { options: vars },
      );
      if (c)
        field(
          detail,
          `变化状态值 ${binding.id} ${index}`,
          c.value,
          (v) => edit(() => (c.value = v)),
          { type: "number" },
        );
      for (const axis of ["x", "y"])
        field(
          detail,
          `变化后的 ${axis.toUpperCase()} ${binding.id}`,
          variant.properties?.[axis],
          (v) => edit(() => ((variant.properties ??= {})[axis] = v)),
          { type: "number" },
        );
      button(detail, "删除这项变化", () => edit(() => binding.variants.splice(index, 1)));
    }
    button(detail, "＋ 场景位置变化", () =>
      edit(() =>
        (binding.variants ??= []).push({
          when: project.variables[0] ? [{ variable: project.variables[0].key, value: 1 }] : [],
          properties: { x: 0, y: 0 },
        }),
      ),
    );
    const advanced = element("details");
    advanced.append(element("summary", "完整条件与变化 JSON"));
    for (const key of ["when", "variants"])
      field(
        advanced,
        key,
        JSON.stringify(binding[key] || [], null, 2),
        (v) => {
          const value = JSON.parse(v);
          if (!Array.isArray(value)) throw Error("须使用 JSON 数组");
          edit(() => (binding[key] = value));
        },
        { rows: 4 },
      );
    detail.append(advanced);
    row.append(detail);
    button(row, "删除绑定", () =>
      edit(() => project.bindings.splice(project.bindings.indexOf(binding), 1)),
    );
    box.append(row);
  }
  button(box, "＋ 添加触发绑定", () =>
    edit(() =>
      project.bindings.push({
        id: `binding-${Date.now()}`,
        kind: "npc",
        mapId: Number($("preview-map").value),
        entityId: "",
        scene: scene().id,
      }),
    ),
  );
}
function renderReferences(box) {
  const doc = state.doc;
  box.append(element("h2", "调用与条件"));
  if (doc.mode === "source") {
    box.append(element("h3", "原始触发声明"));
    note(box, "这些是源数据中的绑定；NPC 是否出现、事件是否可用由试玩中的世界状态决定。");
    for (const trigger of state.sourceInfo?.triggers || [])
      button(
        box,
        `${catalog.maps[trigger.mapId]?.title || trigger.mapId} · ${trigger.kind}${trigger.entityId ? ` ${trigger.entityId} (${trigger.x},${trigger.y})` : ""}${trigger.group ? ` · ${trigger.group}` : ""}`,
        () => {
          $("preview-world").value = Number(trigger.mapId) >= 9000 ? "akto" : "original";
          $("preview-map").value = trigger.mapId;
          document.querySelector('[data-view="preview"]').click();
        },
        { class: "reference-link" },
      );
    note(
      box,
      `地图归属：${state.sourceInfo?.maps?.join(", ") || "公共或未声明"}。地图内脚本绑定优先于全局同名脚本。`,
    );
    for (const [key, title] of [
      ["incoming", "谁调用它"],
      ["outgoing", "它调用谁"],
    ]) {
      box.append(element("h3", title));
      for (const row of state.sourceInfo?.[key] || [])
        button(
          box,
          `${key === "incoming" ? row.from : row.to} · ${row.name} · 第 ${row.pc} 步`,
          () => openSource(key === "incoming" ? row.from : row.to),
          { class: "reference-link" },
        );
    }
    box.append(element("h3", "状态读写（原版用途保留原名）"));
    const seen = new Set();
    for (const [pc, [name, i, , s]] of doc.program.ops.entries())
      if (["Branch", "Calc", "SetFlag", "ResetFlag", "FlipFlag"].includes(name)) {
        const key = `${s[0]}[${i[0]}]`;
        if (seen.has(key)) continue;
        seen.add(key);
        button(box, `${key} · ${name === "Branch" ? "读取" : "写入"}`, async () => {
          const matches = await api(`variable?bank=${encodeURIComponent(s[0])}&slot=${i[0]}`);
          const result = element("div");
          note(result, `${key} · ${matches.length} 处引用`);
          for (const row of matches)
            button(result, `${row.name} · ${row.pc} · ${row.kind}`, () => openSource(row.id), {
              class: "reference-link",
            });
          box.replaceChildren(result);
        });
      }
  } else {
    for (const s of doc.scenes) {
      box.append(element("h3", s.title));
      for (const n of s.nodes.filter((n) => ["condition", "set", "call"].includes(n.type)))
        button(
          box,
          `${n.id} · ${nodeSummary(n)}`,
          () => {
            state.sceneId = s.id;
            selectNode(n.id);
          },
          { class: "reference-link" },
        );
    }
    note(box, `世界状态保存于独立命名空间 ${storyBank(doc)}，初始值只在新试玩时生效。`);
  }
}
async function renderVersions(box) {
  note(box, "每次保存保留完整历史；冲突双方都保留。载入历史会成为当前草稿，保存时生成新版本。");
  button(box, "读取当前磁盘版本", async () => {
    const v = await api(`documents/${state.doc.id}`);
    if (v) await openDocument(v.document, v.revision, { useDraft: false });
  });
  const id = state.doc.id,
    files = await api(`documents/${id}/history`);
  if (state.inspector !== "versions" || state.doc.id !== id) return;
  for (const file of files)
    button(
      box,
      file,
      async () => {
        const v = await api(`documents/${id}/history/${file}`);
        edit(() => (state.doc = clone(v.document)));
        notify("历史版本已载入草稿；保存会产生新版本");
      },
      { class: "reference-link" },
    );
}
function renderCompiled() {
  try {
    const compiled =
      state.doc.mode === "source"
        ? state.doc.program
        : compileStoryProject(state.doc).programs[sceneName(state.doc, scene().id)];
    $("compiled").textContent = JSON.stringify(compiled, null, 2);
  } catch (e) {
    $("compiled").textContent = e.message;
  }
}
async function reloadDocuments() {
  const values = await api("documents");
  $("documents").replaceChildren(element("option", "选择已保存项目", { value: "" }));
  for (const v of values)
    $("documents").append(element("option", `${v.title} · v${v.revision}`, { value: v.id }));
}
async function save() {
  try {
    const result = await api(`documents/${state.doc.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: state.doc, revision: state.revision }),
    });
    state.revision = result.revision;
    state.dirty = false;
    await persist();
    saveLabel();
    await reloadDocuments();
    notify(`已保存版本 ${state.revision}；此前版本均保留`);
  } catch (e) {
    if (e.status === 409)
      notify(
        `保存冲突：磁盘版本 ${e.result.current?.revision || 0}。当前草稿保留在本机及冲突历史中，请在版本面板核对。`,
      );
    else notify(e.message);
  }
}
function addNode() {
  if (state.doc.mode === "source") return;
  const type = $("node-type").value,
    s = scene(),
    selected = selectedNode(),
    end = s.nodes.find((n) => n.type === "end");
  let serial = s.nodes.length + 1;
  while (s.nodes.some((n) => n.id === `node-${serial}`)) serial++;
  const id = `node-${serial}`,
    next = selected?.next || end?.id;
  const n = { id, type, next };
  if (type === "dialogue") Object.assign(n, { speaker: "居民", text: "新的对白" });
  if (["condition", "set"].includes(type)) {
    if (!state.doc.variables.length) {
      notify("请先在触发与世界面板添加世界状态");
      return;
    }
    Object.assign(n, {
      variable: state.doc.variables[0].key,
      value: 1,
      operator: "=",
      yes: next,
      no: next,
    });
  }
  if (type === "choice")
    n.options = [
      { text: "是", target: next },
      { text: "否", target: next },
    ];
  if (["move", "camera"].includes(type))
    Object.assign(n, { actor: -1001, x: 64, y: 120, layer: 0, duration: 0.5 });
  if (type === "animation") Object.assign(n, { actor: -1001, animation: "Default", repeat: 1 });
  if (type === "parallel") n.tracks = [{ actor: -1001, x: 64, y: 120, duration: 0.5 }];
  if (type === "wait") n.duration = 0.5;
  if (type === "bgm" || type === "sound") n.assetId = 1;
  if (type === "battle") n.encounterId = 1;
  if (type === "map") Object.assign(n, { mapId: 9102, entrance: 1 });
  edit(() => {
    if (selected?.type === "end") {
      for (const old of s.nodes) {
        if (old.next === selected.id) old.next = id;
        if (old.yes === selected.id) old.yes = id;
        if (old.no === selected.id) old.no = id;
        for (const option of old.options || [])
          if (option.target === selected.id) option.target = id;
      }
      if (s.entry === selected.id) s.entry = id;
    } else if (selected && !["choice", "condition"].includes(selected.type)) selected.next = id;
    s.nodes.push(n);
    state.selected = id;
  });
}
function deleteNode() {
  const s = scene(),
    n = selectedNode();
  if (!n || s.nodes.length <= 1) return;
  const replacement = n.next || s.nodes.find((v) => v.type === "end" && v !== n)?.id;
  if (!replacement) return notify("请保留一个结束节点");
  edit(() => {
    for (const old of s.nodes) {
      for (const key of ["next", "yes", "no"]) if (old[key] === n.id) old[key] = replacement;
      for (const o of old.options || []) if (o.target === n.id) o.target = replacement;
    }
    if (s.entry === n.id) s.entry = replacement;
    s.nodes.splice(s.nodes.indexOf(n), 1);
    state.selected = replacement;
  });
}
const preview = new StoryPreview({
  notify,
  getBreakpoints: () => state.breakpoints,
  onTrace: (row) => {
    if (!state.doc) return;
    const match =
      state.doc.mode === "source"
        ? row.script === state.doc.program.name
        : row.script === sceneName(state.doc, scene().id);
    if (match) {
      for (const n of $("graph").querySelectorAll("[data-node]"))
        n.classList.toggle("executing", n.dataset.node === (row.node || String(row.pc)));
    }
  },
  onMapPick: (point) => {
    const n = selectedNode();
    if (state.doc.mode !== "source" && ["move", "camera"].includes(n?.type)) {
      edit(() => Object.assign(n, { x: point.x, y: point.y, layer: point.layer }));
      notify(`目的地已设为 (${point.x}, ${point.y})`);
      return;
    }
    if (state.doc.mode === "source")
      return notify(
        `地图 ${point.mapId} · (${point.x}, ${point.y}) · NPC ${point.entity?.id || "无"}`,
      );
    if (!point.entity) return notify(`地图格 (${point.x}, ${point.y})；区域触发可在绑定面板填写`);
    const existing = state.doc.bindings.find(
      (b) => Number(b.mapId) === point.mapId && b.entityId === String(point.entity.id),
    );
    state.inspector = "world";
    if (!existing)
      edit(() =>
        state.doc.bindings.push({
          id: `npc-${point.mapId}-${point.entity.id}`,
          kind: "npc",
          mapId: point.mapId,
          entityId: String(point.entity.id),
          scene: scene().id,
        }),
      );
    else renderProperties();
    notify(`已选中 NPC ${point.entity.id} 的绑定`);
  },
});
$("play").onclick = async () => {
  try {
    if (state.doc.mode !== "source") {
      const errors = validateStoryProject(state.doc);
      if (errors.length) throw Error(errors.join("\n"));
      edit(
        () =>
          (state.doc.preview = {
            world: $("preview-world").value,
            mapId: Number($("preview-map").value),
            entrance: Number($("preview-entrance").value),
          }),
        { redraw: false },
      );
    }
    await preview.start(clone(state.doc), {
      world: $("preview-world").value,
      mapId: Number($("preview-map").value),
      entrance: Number($("preview-entrance").value),
    });
  } catch (e) {
    notify(e.message);
  }
};
for (const b of document.querySelectorAll("[data-view]"))
  b.onclick = () => {
    state.view = b.dataset.view;
    for (const button of document.querySelectorAll("[data-view]"))
      button.setAttribute("aria-pressed", String(button === b));
    for (const view of ["graph", "steps", "tracks", "preview"])
      $(view + "-panel").hidden = view !== state.view;
  };
for (const b of document.querySelectorAll("[data-inspector]"))
  b.onclick = () => {
    state.inspector = b.dataset.inspector;
    for (const button of document.querySelectorAll("[data-inspector]"))
      button.setAttribute("aria-pressed", String(button === b));
    renderProperties();
  };
for (const id of ["search", "category", "map-filter"])
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    state.page = 0;
    renderLibrary();
  });
$("previous").onclick = () => {
  state.page--;
  renderLibrary();
};
$("next").onclick = () => {
  state.page++;
  renderLibrary();
};
$("segment").onchange = () => {
  state.segment = Number($("segment").value);
  state.selected = String(state.doc.program.segments?.[state.segment]?.EntryPoint || 0);
  renderGraph();
  renderSteps();
  renderProperties();
};
$("graph-prev").onclick = () => {
  state.segment = -1;
  state.offset = Math.max(0, state.offset - 80);
  render();
};
$("graph-next").onclick = () => {
  state.segment = -1;
  state.offset = Math.min(Math.max(0, state.doc.program.ops.length - 1), state.offset + 80);
  render();
};
$("save").onclick = save;
$("document-title").onchange = () => edit(() => (state.doc.title = $("document-title").value));
$("undo").onclick = () => {
  if (!state.undo.length) return;
  state.redo.push(clone(state.doc));
  state.doc = state.undo.pop();
  state.dirty = true;
  render();
  persist();
};
$("redo").onclick = () => {
  if (!state.redo.length) return;
  state.undo.push(clone(state.doc));
  state.doc = state.redo.pop();
  state.dirty = true;
  render();
  persist();
};
$("add-node").onclick = addNode;
$("copy-node").onclick = () => {
  const node = selectedNode();
  if (!node) return;
  edit(() => {
    const next = clone(node);
    next.id = `copy-${Date.now()}`;
    next.title = (node.title || NODE_TYPES[node.type]) + "（副本）";
    scene().nodes.push(next);
    state.selected = next.id;
  });
};
$("copy-scene").onclick = () => {
  edit(() => {
    const next = clone(scene());
    next.id = `copy-${Date.now()}`;
    next.title += "（副本）";
    state.doc.scenes.push(next);
    state.sceneId = next.id;
    state.selected = next.entry;
  });
};
$("delete-node").onclick = deleteNode;
$("rename-scene").onclick = () => {
  const box = $("properties");
  box.replaceChildren();
  field(box, "脚本显示名称", scene().title, (v) => edit(() => (scene().title = v)));
};
$("add-scene").onclick = () => {
  const id = `scene-${Date.now()}`;
  edit(() => {
    const s = createStoryProject().scenes[0];
    s.id = id;
    state.doc.scenes.push(s);
    state.sceneId = id;
    state.selected = s.entry;
  });
};
$("new-project").onclick = () => openDocument(createStoryProject(`story-${Date.now()}`));
$("demo").onclick = () => openDocument(createAktoStoryDemo());
$("documents").onchange = async () => {
  if (!$("documents").value) return;
  const v = await api(`documents/${$("documents").value}`);
  await openDocument(v.document, v.revision);
};
$("export").onclick = () => {
  const blob = new Blob(
      [
        JSON.stringify(
          { format: "ffvi-story-workspace", version: 1, document: state.doc },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = element("a", null, { href: url, download: `${state.doc.id}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("import").onclick = () => $("import-file").click();
$("import-file").onchange = async (e) => {
  try {
    const value = JSON.parse(await e.target.files[0].text()),
      document = value.document || value;
    if (!document.id || document.version !== 1) throw Error("不是工作台源文档");
    if (document.mode === "source") {
      const errors = validateSourceDocument(document);
      if (errors.length) throw Error(errors.join("\n"));
    } else if (
      !Array.isArray(document.scenes) ||
      !document.scenes.length ||
      document.scenes.some((s) => !Array.isArray(s.nodes)) ||
      !Array.isArray(document.variables) ||
      !Array.isArray(document.bindings)
    )
      throw Error("创作源文档缺少脚本、节点、世界变量或触发绑定数组");
    await openDocument(document, 0, { useDraft: false });
    state.dirty = true;
    await persist();
    saveLabel();
  } catch (e) {
    notify(e.message);
  }
  e.target.value = "";
};
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    save();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "z" && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
    e.preventDefault();
    $(e.shiftKey ? "redo" : "undo").click();
  }
});
window.addEventListener("beforeunload", () => persist());
let opera;
$("opera-open").onclick = async () => {
  try {
    opera ??= await api("opera");
    $("opera-select").replaceChildren();
    for (const [scene, data] of Object.entries(opera.scenes))
      for (const name of Object.keys(data.timelines))
        $("opera-select").append(
          element("option", `${scene} / ${name}`, { value: `${scene}|${name}` }),
        );
    $("opera-dialog").showModal();
    renderOpera();
  } catch (e) {
    notify(e.message);
  }
};
function renderOpera() {
  const [scene, name] = $("opera-select").value.split("|"),
    timeline = opera.scenes[scene].timelines[name],
    box = $("opera-tracks");
  box.replaceChildren();
  note(
    box,
    `${timeline.duration.toFixed(2)} 秒 · ${timeline.tracks.length} 轨 · 原版时间轴浏览（专用剪辑编辑尚未接入）`,
  );
  for (const track of timeline.tracks) {
    const row = element("div", null, { class: "opera-row" }),
      scale = element("div", null, { class: "opera-scale" });
    row.append(element("span", `${track.name || track.type} · ${track.type}`));
    for (const clip of track.clips) {
      const mark = element("div", clip.name || clip.displayName || "片段", {
        class: "opera-clip",
        title: `${clip.start}s / ${clip.duration}s`,
      });
      mark.style.left = `${(clip.start / timeline.duration) * 100}%`;
      mark.style.width = `${Math.max(0.5, (clip.duration / timeline.duration) * 100)}%`;
      scale.append(mark);
    }
    row.append(scale);
    box.append(row);
  }
}
$("opera-select").onchange = renderOpera;
$("opera-close").onclick = () => $("opera-dialog").close();
await reloadDocuments();
const last = await draft("__last__"),
  lastDraft = last ? await draft(last) : null;
await openDocument(lastDraft?.document || createAktoStoryDemo(), lastDraft?.revision || 0);
window.storyEditor = { state, preview, save, openDocument, openSource };
