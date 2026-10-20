// Editor documents are authored source. PR programs stay in their export directory.
const copy = (value) => structuredClone(value);
const op = (name, i = [], r = [], s = [], label = "") => [name, i, r, s, 1, label];
export const storyBank = (project) => `Story:${project.id}`;
export const sceneName = (project, scene) => `story:${project.id}:${scene}`;
export const NODE_TYPES = {
  dialogue: "对白",
  choice: "玩家选择",
  condition: "世界条件",
  set: "改变世界状态",
  move: "角色移动",
  animation: "角色动作",
  parallel: "并行演出",
  wait: "等待",
  camera: "镜头移动",
  bgm: "播放音乐",
  sound: "播放音效",
  battle: "进入战斗",
  call: "调用脚本",
  map: "切换地图",
  end: "结束演出",
};
export function nodeTargets(node) {
  if (["end", "map"].includes(node.type)) return [];
  if (node.type === "condition")
    return [
      ["满足", node.yes],
      ["否则", node.no],
    ];
  if (node.type === "choice") return (node.options || []).map((v) => [v.text, v.target]);
  return node.next ? [["继续", node.next]] : [];
}
export function validateStoryProject(project) {
  const errors = [];
  if (project.version !== 1 || !/^[a-z][a-z0-9-]{0,79}$/.test(project.id || ""))
    errors.push("项目 ID 须使用小写字母、数字与连字符，且以字母开头");
  const variables = project.variables || [],
    slots = new Set(),
    keys = new Set();
  for (const v of variables) {
    if (!v.key || keys.has(v.key) || !Number.isInteger(v.slot) || v.slot < 0 || slots.has(v.slot))
      errors.push(`世界变量重复或槽位无效：${v.key}`);
    keys.add(v.key);
    slots.add(v.slot);
  }
  const scenes = project.scenes || [],
    ids = new Set();
  for (const scene of scenes) {
    if (!scene.id || ids.has(scene.id)) errors.push(`脚本 ID 重复或为空：${scene.id}`);
    ids.add(scene.id);
    const nodes = scene.nodes || [],
      nodeIds = new Set(nodes.map((n) => n.id));
    if (nodeIds.size !== nodes.length || !nodeIds.has(scene.entry))
      errors.push(`${scene.id}：入口或节点 ID 无效`);
    for (const node of nodes) {
      for (const [, target] of nodeTargets(node))
        if (!nodeIds.has(target))
          errors.push(`${scene.id}/${node.id}：连接目标 ${target || "空"} 不存在`);
      if (!["end", "map", "condition", "choice"].includes(node.type) && !node.next)
        errors.push(`${scene.id}/${node.id}：请连接下一步或添加结束节点`);
      if (["condition", "set"].includes(node.type) && !keys.has(node.variable))
        errors.push(`${scene.id}/${node.id}：世界变量不存在`);
      if (node.type === "condition" && (!node.yes || !node.no))
        errors.push(`${scene.id}/${node.id}：条件需连接两个分支`);
      if (node.type === "choice" && (!node.options?.length || node.options.length > 8))
        errors.push(`${scene.id}/${node.id}：选项应为 1 至 8 个`);
      if (["set", "condition"].includes(node.type) && !Number.isFinite(node.value))
        errors.push(`${node.id}：状态值必须是数字`);
      for (const move of node.type === "parallel" ? node.tracks || [] : [node]) {
        if (["move", "camera"].includes(node.type) || node.type === "parallel") {
          if (![move.x, move.y, move.duration ?? 0.5].every(Number.isFinite))
            errors.push(`${node.id}：坐标和时长必须是数字`);
        }
      }
    }
  }
  for (const b of project.bindings || []) {
    if (!ids.has(b.scene)) errors.push(`绑定 ${b.id}：脚本 ${b.scene} 不存在`);
    for (const c of [...(b.when || []), ...(b.variants || []).flatMap((v) => v.when || [])])
      if (!keys.has(c.variable)) errors.push(`绑定 ${b.id}：世界变量 ${c.variable} 不存在`);
  }
  return errors;
}

export function compileStoryProject(project) {
  const errors = validateStoryProject(project);
  if (errors.length) throw Error(errors.join("\n"));
  const programs = {},
    messages = {},
    speakers = {},
    sourceNodes = {},
    warnings = [];
  const bank = storyBank(project),
    variables = new Map((project.variables || []).map((v) => [v.key, v.slot]));
  for (const scene of project.scenes || []) {
    const name = sceneName(project, scene.id),
      ops = [],
      starts = new Map(),
      pending = [],
      tracks = [];
    sourceNodes[name] = {};
    const emit = (node, instruction) => {
      sourceNodes[name][ops.length] = node.id;
      ops.push(instruction);
      return instruction;
    };
    const jump = (node, target) => {
      const instruction = emit(node, op("Jump", [0]));
      pending.push([instruction, 0, target]);
    };
    // Keep the document's arrangement independent of the VM's numeric addresses.
    const ordered = [
      scene.nodes.find((n) => n.id === scene.entry),
      ...scene.nodes.filter((n) => n.id !== scene.entry),
    ];
    for (const node of ordered) {
      starts.set(node.id, ops.length);
      const key = `${name}:${node.id}`;
      switch (node.type) {
        case "dialogue":
          messages[key] = node.text || "";
          speakers[key] = node.speaker || "";
          emit(node, op("Msg", [], [], [key]));
          break;
        case "choice": {
          const keys = node.options.map((v, index) => {
            const k = `${key}:${index}`;
            messages[k] = v.text;
            return k;
          });
          emit(node, op("Select", [], [], keys));
          node.options.forEach((v, index) => {
            const instruction = emit(
              node,
              op("Branch", [0, index, 0], [], ["MessageSelection", "=", "imm"]),
            );
            pending.push([instruction, 2, v.target]);
          });
          jump(node, node.options[0].target);
          continue;
        }
        case "condition": {
          const instruction = emit(
            node,
            op(
              "Branch",
              [variables.get(node.variable), node.value, 0],
              [],
              [bank, node.operator || "=", "imm"],
            ),
          );
          pending.push([instruction, 2, node.yes]);
          jump(node, node.no);
          continue;
        }
        case "set":
          emit(
            node,
            op(
              "Calc",
              [variables.get(node.variable), node.value],
              [],
              [bank, node.operation === "add" ? "+" : "=", "imm"],
            ),
          );
          break;
        case "move":
        case "animation":
        case "camera": {
          const instruction = emit(
            node,
            op("SetPuppet", [0, node.type === "camera" ? 0 : (node.actor ?? -1001), 0]),
          );
          tracks.push({ node, instruction, slot: 2, actions: [node] });
          emit(node, op("ExecPuppet", [0]));
          break;
        }
        case "parallel":
          (node.tracks || []).forEach((track, index) => {
            const instruction = emit(node, op("SetPuppet", [index, track.actor ?? -1001, 0]));
            tracks.push({ node, instruction, slot: 2, actions: [{ ...track, type: "move" }] });
          });
          emit(node, op("ExecPuppet", [0]));
          break;
        case "wait":
          emit(node, op("Wait", [], [Math.max(0, node.duration ?? 0.5)]));
          break;
        case "bgm":
          emit(node, op("PlayBGM", [node.assetId || 1, 1]));
          break;
        case "sound":
          emit(node, op("PlaySE", [node.assetId || 1]));
          break;
        case "battle":
          emit(node, op("Encount", [node.encounterId || 1]));
          break;
        case "call":
          emit(node, op("ChangeScript", [1], [], [node.script || ""]));
          break;
        case "map":
          emit(node, op("ChangeMap", [node.mapId, node.entrance || 1], [], [node.script || ""]));
          continue;
        case "end":
          emit(node, op("Exit"));
          continue;
        default:
          warnings.push(`${scene.id}/${node.id}：未知节点 ${node.type} 已保留，运行时跳过`);
          emit(node, op("Nop"));
      }
      jump(node, node.next);
    }
    for (const [instruction, slot, target] of pending) instruction[1][slot] = starts.get(target);
    for (const track of tracks) {
      track.instruction[1][track.slot] = ops.length;
      for (const action of track.actions) {
        if (action.type === "animation")
          emit(
            track.node,
            op("PlayAnim", [0, action.repeat || 1], [], [action.animation || "Default"]),
          );
        else
          emit(
            track.node,
            op("Lerp", [action.x, action.y, (action.layer ?? 0) + 1], [action.duration ?? 0.5]),
          );
        if (action.direction != null) emit(track.node, op("LookAt", [Number(action.direction)]));
      }
      emit(track.node, op("Exit"));
    }
    programs[name] = {
      name,
      title: scene.title,
      locals: [],
      segments: ordered.map((n) => ({ Label: n.id, EntryPoint: starts.get(n.id), Count: 0 })),
      ops,
    };
    for (let n = 0; n < programs[name].segments.length; n++) {
      const s = programs[name].segments[n];
      s.Count =
        (programs[name].segments[n + 1]?.EntryPoint ?? tracks[0]?.instruction[1][2] ?? ops.length) -
        s.EntryPoint;
    }
  }
  return { programs, messages, speakers, sourceNodes, warnings };
}

export const SOURCE_TARGETS = {
  Jump: [0],
  Call: [0],
  JumpBattleAI: [0],
  Branch: [2],
  SetPuppet: [2],
  BranchByNumOfMember: [2],
  BranchByCharacter: [3],
  BranchByLeader: [1],
  BranchByPlayerDirection: [0, 1, 2, 3],
  IsVariableComparison: [2],
  IsCheckHp: [1],
  IsCheckMp: [1],
  IsMyCondition: [1],
  IsNotCondition: [1],
  IsOnlyAlive: [0],
  IsGroupAlive: [0],
  IsUnitAliveCount: [2],
  IsEnemyUnitIndex: [1],
  IsCheckMonsterPTId: [1],
  IsLevelCheck: [2],
  IsRecevieAbility: [1],
  IsRecevieAbilitySystem: [1],
  IsRecevieAttackByHit: [0],
  IsCounterTypeId: [1],
  IsEnemyAttackJump: [0],
  DamagedJump: [0],
  IsRecevieItem: [1],
  IsWeakCheck: [1],
  IsReverseAttribute: [1],
  IsCheckEnemyConditionAllReflex: [0],
  IsCheckPlayerConditionAll: [1],
  IsCondition: [3],
  IsNotConditionAct: [3],
  IsUnitAlive: [2],
  IsCheckPlayerId: [1],
  IsTimerJump: [0],
  IsReverseUnit: [2],
  IsCheckUnitStatus: [3],
};
export function sourceEdges(program, pc) {
  const [name, i = []] = program.ops[pc] || [];
  const result = (SOURCE_TARGETS[name] || [])
    .filter((slot) => Number.isInteger(i[slot]))
    .map((slot) => ({
      target: i[slot],
      label: name === "SetPuppet" ? `角色 ${i[1]}` : `i[${slot}]`,
      kind: name === "SetPuppet" ? "parallel" : "branch",
    }));
  if (
    !["Exit", "Return", "Jump", "JumpBattleAI", "ChangeMap", "BranchByPlayerDirection"].includes(
      name,
    ) &&
    pc + 1 < program.ops.length
  )
    result.push({ target: pc + 1, label: "继续", kind: "next" });
  return result;
}
export function validateSourceDocument(document) {
  const errors = [];
  if (!Array.isArray(document.source?.program?.ops) || !Array.isArray(document.program?.ops))
    return ["原版源文档缺少指令数组"];
  if (
    !document.source?.program ||
    !document.program ||
    document.program.ops.length !== document.source.program.ops.length
  )
    errors.push("原版覆盖须保留指令数量；新增编排请使用创作脚本");
  for (const [index, instruction] of (document.program?.ops || []).entries()) {
    if (
      !Array.isArray(instruction) ||
      typeof instruction[0] !== "string" ||
      ![1, 2, 3].every((n) => Array.isArray(instruction[n]))
    )
      errors.push(`第 ${index} 条指令结构无效`);
    if (![1, 2, 3].every((slot) => Array.isArray(instruction?.[slot]))) continue;
    if (
      !instruction[1].every(Number.isInteger) ||
      !instruction[2].every(Number.isFinite) ||
      !instruction[3].every((value) => typeof value === "string")
    )
      errors.push(`第 ${index} 条参数类型无效：i 为整数，r 为实数，s 为字符串`);
    for (const slot of SOURCE_TARGETS[instruction[0]] || [])
      if (
        !Number.isInteger(instruction[1]?.[slot]) ||
        instruction[1][slot] < 0 ||
        instruction[1][slot] > document.program.ops.length
      )
        errors.push(`第 ${index} 条指令跳转地址越界`);
  }
  return errors;
}

function satisfied(project, banks, conditions = []) {
  const state = banks[storyBank(project)] || {};
  return conditions.every((condition) => {
    const variable = project.variables.find((v) => v.key === condition.variable);
    const value = state[variable?.slot] ?? variable?.initial ?? 0;
    switch (condition.operator || "=") {
      case "!=":
        return value !== condition.value;
      case ">=":
        return value >= condition.value;
      case "<=":
        return value <= condition.value;
      case ">":
        return value > condition.value;
      case "<":
        return value < condition.value;
      default:
        return value === condition.value;
    }
  });
}
export function applyStoryMap(project, source, banks = {}) {
  const map = copy(source);
  const all = [map.entities || [], ...Object.values(map.groups || {}).map((g) => g.entities || [])];
  for (const binding of project.bindings || []) {
    if (Number(binding.mapId) !== Number(map.id) || !satisfied(project, banks, binding.when))
      continue;
    const script = sceneName(project, binding.scene);
    if (binding.kind === "entry") {
      map.initializer = `story:${project.id}:entry:${map.id}`;
    } else if (binding.kind === "region") {
      map.entities.push({
        id: `story-region:${binding.id}`,
        kind: 2,
        x: binding.x,
        y: binding.y,
        layer: binding.layer || 0,
        script,
      });
    } else {
      for (const entities of all)
        for (const entity of entities)
          if (String(entity.id) === String(binding.entityId)) {
            entity.script = script;
            const variant = (binding.variants || []).find((v) => satisfied(project, banks, v.when));
            if (variant) Object.assign(entity, copy(variant.properties || {}));
          }
    }
  }
  return map;
}

// This adapter uses the existing VM and save shape. Normal campaign hosts do not import it.
export function withStoryProject(Base) {
  return class StoryGame extends Base {
    constructor({ project, overrides = [], ...options }) {
      const data = copy(options.data),
        battleData = copy(options.battleData || {}),
        compiled = compileStoryProject(project),
        baseMaps = new Map();
      Object.assign(data.programs, compiled.programs);
      Object.assign(data.messages, compiled.messages);
      Object.assign(data.speakers, compiled.speakers);
      for (const name of Object.keys(compiled.programs)) data.global[name] = name;
      for (const binding of project.bindings || [])
        if (binding.kind === "entry") {
          // The original map initializer is supplied by the map loader below.
          const name = `story:${project.id}:entry:${binding.mapId}`;
          data.global[name] = name;
        }
      for (const document of overrides) {
        if (validateSourceDocument(document).length)
          throw Error(validateSourceDocument(document).join("\n"));
        let id = document.source.programId;
        const original = JSON.stringify(document.source.program);
        if (JSON.stringify(data.programs[id]) !== original) {
          const matches = Object.keys(data.programs).filter(
            (key) => JSON.stringify(data.programs[key]) === original,
          );
          if (matches.length !== 1)
            throw Error(
              `原版 ${document.source.program.name} 已变化或归属不明确，请重新导入并核对覆盖`,
            );
          id = matches[0];
        }
        data.programs[id] = copy(document.program);
        for (const key of ["aiPrograms", "eventPrograms"]) {
          if (battleData[key]?.[document.source.program.name])
            battleData[key][document.source.program.name] = copy(document.program);
        }
        Object.assign(data.messages, document.messages);
        Object.assign(data.speakers, document.speakers);
        Object.assign((battleData.messages ??= {}), document.messages);
      }
      let host;
      super({
        ...options,
        data,
        battleData,
        loadMap: async (id) => {
          const source = await options.loadMap(id);
          baseMaps.set(Number(id), copy(source));
          const entries = (project.bindings || []).filter(
            (binding) =>
              binding.kind === "entry" &&
              Number(binding.mapId) === Number(id) &&
              satisfied(project, host?.banks || {}, binding.when),
          );
          if (entries.length) {
            const name = `story:${project.id}:entry:${id}`;
            data.programs[name] = {
              name,
              locals: [],
              ops: [
                ...(source.initializer ? [op("ChangeScript", [1], [], [source.initializer])] : []),
                ...entries.map((binding) =>
                  op("ChangeScript", [1], [], [sceneName(project, binding.scene)]),
                ),
                op("Exit"),
              ],
            };
          }
          return applyStoryMap(project, source, host?.banks || {});
        },
      });
      host = this;
      this.storyProject = project;
      this.storyCompiled = compiled;
      this.storyBaseMaps = baseMaps;
      this.banks[storyBank(project)] = Object.fromEntries(
        project.variables.map((v) => [v.slot, v.initial || 0]),
      );
      for (const message of compiled.warnings) this.warn(null, message);
    }
    write(category, index, value, task) {
      super.write(category, index, value, task);
      if (category === storyBank(this.storyProject)) this.refreshStoryWorld();
    }
    refreshStoryWorld() {
      const source = this.storyBaseMaps.get(this.mapId);
      if (!source) return;
      const previousMap = this.map;
      this.map = applyStoryMap(this.storyProject, source, this.banks);
      // Apply only declarative world variants; leave ordinary puppet motion alone.
      const entities = [
        this.map.entities,
        ...Object.values(this.map.groups || {}).map((g) => g.entities || []),
      ].flat();
      const previousEntities = [
        previousMap.entities,
        ...Object.values(previousMap.groups || {}).map((g) => g.entities || []),
      ].flat();
      for (const binding of this.storyProject.bindings || [])
        if (binding.kind === "npc" && Number(binding.mapId) === this.mapId) {
          const entity = entities.find((e) => String(e.id) === String(binding.entityId));
          const actor = this.actors.get(String(binding.entityId));
          const previous = previousEntities.find((e) => String(e.id) === String(binding.entityId));
          if (actor && entity)
            for (const key of ["script", "visible", "collision", "asset", "x", "y", "direction"]) {
              if (Object.is(previous?.[key], entity[key])) continue;
              if (Object.hasOwn(entity, key)) actor[key] = entity[key];
              else delete actor[key];
            }
        }
      this.event("story-world", {
        project: this.storyProject.id,
        values: copy(this.banks[storyBank(this.storyProject)] || {}),
      });
    }
    async restore(saved, options) {
      await super.restore(saved, options);
      this.refreshStoryWorld();
      return this;
    }
  };
}
