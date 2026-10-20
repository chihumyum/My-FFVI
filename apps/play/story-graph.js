import { NODE_TYPES, nodeTargets, sourceEdges } from "../../src/play/story-authoring.js";
const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs, text) => {
  const value = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) value.setAttribute(k, v);
  if (text != null) value.textContent = text;
  return value;
};
const shorten = (text, n = 23) => [...String(text || "")].slice(0, n).join("");
export const sourceLabel = (name) =>
  ({
    Nop: "片段标签",
    Blank: "让出一帧",
    Exit: "结束片段",
    Return: "返回调用者",
    Call: "调用片段",
    Jump: "跳转",
    ChangeScript: "调用 / 切换脚本",
    Branch: "条件判断",
    Calc: "变量计算",
    SetFlag: "设置标志",
    ResetFlag: "清除标志",
    FlipFlag: "翻转标志",
    Wait: "等待",
    SetPuppet: "分派角色片段",
    ExecPuppet: "执行角色片段",
    FinishPuppet: "结束角色片段",
    SetEntities: "启用场景对象组",
    SetPos: "设置位置",
    Move: "按方向移动",
    Lerp: "移动到坐标",
    MoveTo: "移动到目标",
    LookAt: "设置朝向",
    Hide: "隐藏角色",
    Show: "显示角色",
    HidePlayer: "隐藏玩家",
    ShowPlayer: "显示玩家",
    CueAnim: "切换动作",
    PlayAnim: "播放动作",
    Msg: "对白",
    MsgClose: "关闭对白",
    Select: "玩家选择",
    ChangeMap: "切换地图",
    Encount: "开始战斗",
    EncountBoss: "开始首领战",
    PlayBGM: "播放音乐",
    StopBGM: "停止音乐",
    PlaySE: "播放音效",
    FadeIn: "画面淡入",
    FadeOut: "画面淡出",
    SysCall: "系统事件",
    BranchByCharacter: "检查队员",
    BranchByLeader: "检查领队",
    BranchByPlayerDirection: "检查玩家朝向",
    BranchByNumOfMember: "检查队伍人数",
    GetItem: "获得物品",
    RemoveItem: "失去物品",
    AutoSave: "自动存档",
  })[name] || name;
export function nodeSummary(node) {
  switch (node.type) {
    case "dialogue":
      return `${node.speaker || "无署名"}：${node.text || ""}`;
    case "condition":
      return `${node.variable} ${node.operator || "="} ${node.value}`;
    case "set":
      return `${node.variable} ${node.operation === "add" ? "+=" : "="} ${node.value}`;
    case "choice":
      return node.options.map((o) => o.text).join(" / ");
    case "move":
    case "camera":
      return `${node.actor ?? "镜头"} → (${node.x}, ${node.y}) · ${node.duration}s`;
    case "parallel":
      return `${node.tracks?.length || 0} 个角色 · 等待全部完成`;
    case "animation":
      return `角色 ${node.actor} · ${node.animation}`;
    case "wait":
      return `${node.duration} 秒`;
    case "call":
      return node.script;
    default:
      return node.id;
  }
}
export function drawStoryGraph(
  container,
  { document: doc, scene, selected, onSelect, onReposition, offset = 0, segment = -1, executing },
) {
  container.replaceChildren();
  let nodes,
    edges = [];
  if (doc.mode === "source") {
    const part = doc.program.segments?.[segment],
      start = part?.EntryPoint ?? offset;
    const end = Math.min(doc.program.ops.length, start + 80, part ? start + part.Count : Infinity);
    nodes = doc.program.ops.slice(start, end).map((o, index) => ({
      id: String(start + index),
      title: `${start + index} · ${sourceLabel(o[0])}`,
      sub:
        o[0] === "Msg"
          ? doc.messages[o[3][0]] || o[3][0]
          : o[5] || JSON.stringify(o[1]).slice(0, 52),
      type: o[0],
    }));
    for (const n of nodes)
      edges.push(
        ...sourceEdges(doc.program, Number(n.id)).map((e) => ({
          from: n.id,
          to: String(e.target),
          label: e.label,
          kind: e.kind,
        })),
      );
  } else {
    nodes = scene.nodes.map((n) => ({
      id: n.id,
      title: n.title || NODE_TYPES[n.type] || n.type,
      sub: nodeSummary(n),
      type: n.type,
    }));
    for (const n of scene.nodes)
      edges.push(
        ...nodeTargets(n).map(([label, to]) => ({
          from: n.id,
          to,
          label,
          kind: n.type === "parallel" ? "parallel" : "next",
        })),
      );
  }
  const positions = new Map();
  if (doc.mode === "source")
    nodes.forEach((n, i) => positions.set(n.id, { x: 60, y: 30 + i * 94 }));
  else {
    const levels = new Map([[scene.entry, 0]]),
      queue = [scene.entry];
    for (let i = 0; i < queue.length; i++)
      for (const e of edges.filter((e) => e.from === queue[i]))
        if (!levels.has(e.to)) {
          levels.set(e.to, (levels.get(e.from) || 0) + 1);
          queue.push(e.to);
        }
    const rows = new Map();
    nodes.forEach((n) => {
      const level = levels.get(n.id) ?? Math.max(0, ...levels.values()) + 1;
      if (!rows.has(level)) rows.set(level, []);
      rows.get(level).push(n.id);
    });
    for (const [level, row] of rows)
      row.forEach((id, i) => positions.set(id, { x: 35 + i * 270, y: 30 + level * 125 }));
  }
  if (doc.mode !== "source")
    for (const node of scene.nodes) if (node.position) positions.set(node.id, node.position);
  const width = Math.max(610, ...[...positions.values()].map((p) => p.x + 270)),
    height = Math.max(220, ...[...positions.values()].map((p) => p.y + 120));
  const root = svg("svg", {
    class: "story-graph",
    width,
    height,
    role: "img",
    "aria-label": `${scene?.title || doc.title}流程图`,
  });
  root.append(svg("title", {}, "点击节点编辑参数；曲线表示执行连接，虚线表示角色分派。"));
  for (const e of edges) {
    const a = positions.get(e.from),
      b = positions.get(e.to);
    if (!a) continue;
    if (!b) {
      if (e.kind !== "next") {
        const link = svg(
          "text",
          { x: a.x + 245, y: a.y + 40, class: "edge-label", role: "button", tabindex: 0 },
          `→ ${e.to}`,
        );
        link.addEventListener("click", () => onSelect(e.to));
        link.addEventListener("keydown", (event) => {
          if (event.key === "Enter") onSelect(e.to);
        });
        root.append(link);
      }
      continue;
    }
    const x1 = a.x + 115,
      y1 = a.y + 70,
      x2 = b.x + 115,
      y2 = b.y;
    const d =
      y2 > y1
        ? `M${x1} ${y1} C${x1} ${y1 + 26},${x2} ${y2 - 26},${x2} ${y2}`
        : `M${a.x + 230} ${a.y + 35} C${Math.max(a.x, b.x) + 260} ${a.y + 35},${Math.max(a.x, b.x) + 260} ${b.y + 35},${b.x + 230} ${b.y + 35}`;
    root.append(svg("path", { d, class: `edge ${e.kind === "parallel" ? "parallel-edge" : ""}` }));
    if (e.label !== "继续")
      root.append(
        svg(
          "text",
          { x: (x1 + x2) / 2 + 7, y: (y1 + y2) / 2, class: "edge-label" },
          shorten(e.label, 17),
        ),
      );
  }
  for (const n of nodes) {
    const p = positions.get(n.id),
      group = svg("g", {
        class: `node ${selected === n.id ? "selected" : ""} ${executing === n.id ? "executing" : ""}`,
        transform: `translate(${p.x} ${p.y})`,
        tabindex: 0,
        role: "button",
        "aria-label": `${n.title} ${n.sub}`,
        "data-node": n.id,
      });
    group.append(
      svg("rect", { width: 230, height: 70, rx: 7 }),
      svg("text", { x: 12, y: 25 }, shorten(n.title, 26)),
      svg("text", { x: 12, y: 47, class: "node-sub" }, shorten(n.sub)),
    );
    let drag,
      moved = false;
    if (doc.mode !== "source" && onReposition) {
      group.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        drag = { x: event.clientX, y: event.clientY };
        moved = false;
        group.setPointerCapture(event.pointerId);
      });
      group.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const dx = event.clientX - drag.x,
          dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
        if (moved)
          group.setAttribute(
            "transform",
            `translate(${Math.max(10, p.x + dx)} ${Math.max(10, p.y + dy)})`,
          );
      });
      group.addEventListener("pointerup", (event) => {
        if (!drag) return;
        const start = drag;
        drag = null;
        if (moved)
          onReposition(n.id, {
            x: Math.max(10, p.x + event.clientX - start.x),
            y: Math.max(10, p.y + event.clientY - start.y),
          });
      });
      group.addEventListener("pointercancel", () => {
        drag = null;
      });
    }
    group.addEventListener("click", () => {
      if (!moved) onSelect(n.id);
    });
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(n.id);
      }
    });
    root.append(group);
  }
  container.append(root);
  return {
    count: nodes.length,
    total: doc.mode === "source" ? doc.program.ops.length : scene.nodes.length,
  };
}
