import type { compileOpeningBattle } from "./battle.js";
import type { BattleCatalog, CombatantDefinition } from "../core/battle-content.js";
import { compileGameCatalogModules, assembleGameCatalog } from "./game-catalog.js";

/** Compatibility adapter for the explicit Narshe development checkpoint.
 * Shared source construction calls neither this adapter nor its seed decoder. */
export async function compileOpeningPlayable(
  root: string,
  source: Awaited<ReturnType<typeof compileOpeningBattle>>,
): Promise<BattleCatalog> {
  const modules = await compileGameCatalogModules(root, source);
  const checkpoint = source.entryProviders.ownedConditionCheckpoint;
  const checkpointIds = [...checkpoint.selectedSourceIds].sort((a, b) => a - b);
  const initialIds = source.initialParty.map((p) => p.characterId).sort((a, b) => a - b);
  if (checkpoint.scope !== "narshe-development-checkpoint-non-advertisement" ||
      checkpoint.target !== "selected-party" || checkpoint.conditionType !== 607 ||
      JSON.stringify(checkpointIds) !== JSON.stringify(initialIds) ||
      modules.common.conditions.rules.definitions.find((d) => d.id === checkpoint.conditionId)?.type !== checkpoint.conditionType)
    throw new Error("Unbound owned condition checkpoint");
  const players: CombatantDefinition[] = source.initialParty.map((c) => {
    const definition = modules.ordinaryDefinitions.find((p) => p.sourceId === c.characterId);
    if (!definition) throw new Error("Missing initial ordinary battle template");
    // A source-bound state at the existing development checkpoint. It is not
    // the AddFromMaster initial state or a replay of the skipped prelude.
    return { ...structuredClone(definition), conditionIds: [checkpoint.conditionId] };
  });
  // These are the existing checkpoint's acknowledged omissions. Bind both the
  // source name and row values; selecting another party never grants an unknown
  // script/flag capability. No encounter IDs select runtime behavior.
  const legacyScript = source.encounters.find((e) => e.metadata.scriptId === 8010 &&
    source.tables["script.csv"]?.["8010"]?.values.script_name === "sc_b_0239" &&
    e.script?.source.assetPath.endsWith("/sc_b_0239.json"))?.script;
  const legacyFlags = source.encounters.find((e) => e.metadata.battleFlagGroupId === 11 &&
    e.metadata.battleFlags.length === 1 &&
    e.metadata.battleFlags[0]!.values.id === "16" &&
    e.metadata.battleFlags[0]!.values.group_id === "11" &&
    e.metadata.battleFlags[0]!.values.battle_flag_id === "14")?.metadata.battleFlags;
  return assembleGameCatalog(modules, {
    kind: "development-checkpoint", players,
    development: {
      scripts: legacyScript ? [{ id: 8010, source: legacyScript.source,
        reason: "Existing development checkpoint omits source sc_b_0239 battle lifecycle; it is not executed" }] : [],
      flagGroups: legacyFlags ? [{ id: 11, rows: legacyFlags,
        reason: "Existing development checkpoint omits battle flag group 11 / flag 14" }] : [],
    },
    limitations: [
      "纳尔谢街道可玩开发规则；未经原版一致性验收，不代表完整战斗系统。",
      "战斗指令由当前持有能力、条件与来源入战资格动态投影；607魔导状态、装甲外观和剧情增删共用持有状态。开发检查点直接装载来源绑定的片头状态，尚未完整执行新游戏前导。未知地图/步行/兽原依赖仍阻塞。",
      "已准入的数值分支、ATB、蓄力与时钟门控已按本版来源接入；即时/等待模式及技能、道具菜单已接入，时速固定为 1。固定 10 ms 推进与 400/900 ms 动作表现仍是临时策略，原生动态语义尚未验证。初始持有能力已来源绑定，活动战斗能力仍限受控子集，完整成长/学习未完成。",
      "初始数值使用分阶段属性确认；来源追加经验、普通成长和自然等级学习已接入共享持有状态。特殊学习、魔石、Correction、临时与被动提供器仍未完整恢复，新持有角色的战斗动作独立准入。",
      "普通前后排伤害、加速/减速及普通商店买卖已接入。战斗换列、远程与双持装备、特殊商店和完整菜单仍待迁移。",
      "当前开放三种射线和治愈原力，以及来源普通 HP/MP 恢复、玩家复活、解除沉默和普通毒的道具；道具目前限我方目标。普通毒的战斗周期、属性相性、地图步伤和解除已接入；开场 currentTransport=6 由来源初始化与前导脚本闭合，该交通跳过普通步伤。完整上下车、特殊毒 row 88、其他活动状态、特殊道具、逃跑与完整战斗脚本仍阻塞。",
      "角色、库存、普通换装与奖励由共享状态保存，可在稳定地图检查点保存/读取。剧情普通物品授予/移除和部分收费指令已接入；普通死亡顺序掉落、两种 MP 饰品及被动持有已贯通；其他特殊装备、奖励与脚本商店尚未完成，开场没有额外发放测试药品或备用装备。",
      "魔导装甲的默认/死亡/濒死姿态使用来源别名、UV和像素偏移；站位、夹击队形、动作与光束仍为临时二维表现，原版音效、特效与完整动画时序尚未接入。",
      "敌方行动使用来源 AI、独立回合与变量，连续行动整组入队。普通反击按命中结果触发并优先执行，保留原行动条；最终攻击、恢复专用反应、完整自动目标及特殊指令仍未接入，未知依赖会明确停止。",
    ],
  });
}
