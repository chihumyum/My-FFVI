import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const numberRow = row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key, typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value]));
const dictionary = rows => Object.fromEntries(rows.map(row => [row.id, row]));

export async function buildPlayBattle({ input = 'build/import/tables.json',
  battleInput = 'build/battle/battle.json', output = 'build/play/battle.json' } = {}) {
  const tables = JSON.parse(await fs.readFile(input, 'utf8'));
  const media = JSON.parse(await fs.readFile(battleInput, 'utf8'));
  const rows = name => (tables[`${name}.csv`] ?? []).map(numberRow);
  const byId = name => dictionary(rows(name));
  const contents = byId('content'), functions = byId('function_group'), conditions = byId('condition');
  const weapons = byId('weapon'), armors = byId('armor'), aiNames = byId('monster_ai_script');
  const spriteEntries = Object.entries(media.sprites ?? {});
  const sprite = suffix => {
    const entry = spriteEntries.find(([name]) => name.toLowerCase().endsWith(suffix.toLowerCase()));
    return entry ? { url: `/battle/${entry[1].file}`, width: entry[1].width, height: entry[1].height } : null;
  };
  const sprites = Object.fromEntries(spriteEntries.map(([name, value]) => [name, {
    url: `/battle/${value.file}`, width: value.width, height: value.height,
  }]));
  const attrs = group => Object.fromEntries(rows('attribute_group')
    .filter(row => row.group_id === group).map(row => [row.attribute_id, row.type_id]));
  const flags = group => rows('content_flag_group').filter(row => row.group_id === group).map(row => row.content_flag_id);
  const names = { 1: '蒂娜', 2: '洛克', 3: '加源', 4: '影忍', 5: '埃德加', 6: '马修',
    7: '莎莉丝', 8: '斯特拉格斯', 9: '莉姆', 10: '西捷亚', 11: '莫古', 12: '嘎',
    17: '幽灵', 18: '幽灵', 31: '魏吉', 32: '比格斯' };
  const abilityNames = { 1: '战斗', 2: '防御', 31: '疗伤', 32: '中疗伤', 33: '大疗伤', 40: '火焰', 41: '寒冰', 42: '雷电',
    218: '火焰光束', 219: '雷电光束', 220: '寒冰光束', 221: '生化冲击', 222: '回复之力',
    223: '混乱', 224: '消融射线', 225: '魔导导弹', 310: '网', 321: '百万伏特', 1406: '百万伏特' };
  const abilities = dictionary(rows('ability').map(row => {
    const fn = functions[row.battle_function_group_id] ?? {};
    const content = Object.values(contents).find(c => c.type_id === 4 && c.type_value === row.id);
    const physical = row.id === 1 || row.process_prog?.toLowerCase() === 'multiply' || fn.function1_id === 2;
    const healing = fn.function1_id === 1;
    return { id: row.id, name: abilityNames[row.id] ?? `技能 ${row.id}`, nameKey: content?.mes_id_name,
      power: row.standard_value, mp: row.use_value, accuracy: row.accuracy_rate,
      kind: row.id === 2 ? 'defend' : healing ? 'heal' : physical ? 'physical' : 'magic',
      target: healing ? 'ally' : 'enemy', all: [4, 8, 16].includes(row.battle_renge_id),
      flags: flags(row.content_flag_group_id), elements: row.attribute_id ? [row.attribute_id] : [],
      process: row.process_prog, multiplier: row.process_prog?.toLowerCase() === 'multiply' ? row.data_a / 100 : 1,
      functionId: fn.function1_id ?? 0, groupId: row.ability_group_id, range: row.battle_renge_id,
      condition: fn.function1_id === 9 && conditions[fn.function1_value1] ? {
        id: fn.function1_value1, type: conditions[fn.function1_value1].condition_type,
        duration: conditions[fn.function1_value1].until_value } : null,
      dataA: row.data_a, dataB: row.data_b };
  }));
  const characterAssets = byId('character_asset'), monsterAssets = byId('monster_asset');
  const characters = dictionary(rows('character_status').map(row => {
    const equipment = Array.from({ length: 6 }, (_, index) => contents[row[`content_id${index + 1}`]])
      .filter(Boolean).map(c => c.type_id === 2 ? weapons[c.type_value] : c.type_id === 3 ? armors[c.type_value] : null).filter(Boolean);
    const sum = key => equipment.reduce((total, item) => total + (item[key] ?? 0), 0);
    const growth = rows('growth_curve').filter(g => g.group_id === row.growth_curve_group_id && g.lv <= row.lv);
    const weapon = equipment.find(item => item.attack > 0);
    const asset = characterAssets[row.character_asset_id]?.asset_name;
    const learned = rows('learning').filter(l => l.job_id === row.job_id && l.type_id === 1 && l.value1 <= row.lv)
      .map(l => contents[l.content_id]).filter(c => c?.type_id === 4).map(c => c.type_value);
    return { id: row.id, name: names[row.id] ?? (row.id >= 19 && row.id <= 28 ? `莫古 ${row.id - 18}` : `角色 ${row.id}`),
      level: row.lv, baseHp: row.hp, baseMp: row.mp,
      maxHp: row.hp + growth.reduce((sum, level) => sum + level.hp_value1, 0),
      maxMp: row.mp + growth.reduce((sum, level) => sum + level.mp_value1, 0),
      strength: row.strength + sum('strength'), magic: row.magic + sum('magic'), speed: row.agility + sum('agility'),
      attack: row.attack + (weapon?.attack ?? 0), defense: row.defense + sum('defense'),
      magicDefense: row.ability_defense + sum('ability_defense'), evasion: row.evasion_rate + sum('evasion_rate'),
      magicEvasion: row.magic_evasion_rate + sum('ability_evasion_rate'), accuracy: weapon?.accuracy_rate || 100,
      criticalRate: weapon?.critical_rate ?? 3, exp: row.exp,
      // The first two Terra spells and Celes's Blizzard precede PR learning.csv's rows.
      // SNES NaturalMagic supplies those initial levels (1, 3 and 1 respectively).
      abilities: [...new Set([1, 2, ...(row.id === 1 ? [31, ...(row.lv >= 3 ? [40] : [])] : row.id === 7 ? [41] : []), ...learned])],
      naturalLearning: rows('learning').filter(l => l.job_id === row.job_id && l.type_id === 1)
        .map(l => ({ level: l.value1, abilityId: contents[l.content_id]?.type_value })).filter(l => l.abilityId),
      sprite: asset ? sprite(`/${asset}/Default_00.png`) : null,
      magitekSprite: sprite('/BC_FF6_P019/Default_00.png'),
      equipment: Array.from({ length: 6 }, (_, index) => row[`content_id${index + 1}`]),
      commands: Array.from({ length: 6 }, (_, index) => row[`command_id${index + 1}`]).filter(Boolean) };
  }));
  const monsters = dictionary(rows('monster').map(row => {
    const aiName = aiNames[row.script_id]?.script_name ?? '';
    const ai = Object.values(media.assets ?? {}).find(asset => asset.data?.Name === `${aiName}.json`)?.data;
    const acts = ai?.Mnemonics?.find(m => m.mnemonic === 'Act');
    const asset = monsterAssets[row.monster_asset_id];
    const role = aiName === 'sc_ai_100_Ymir' ? 'ymir-shell' : aiName === 'sc_ai_134_Ymir' ? 'ymir-head' : null;
    return { id: row.id, name: role === 'ymir-shell' ? '尤弥尔（壳）' : role === 'ymir-head' ? '尤弥尔' :
      (aiName.replace(/^sc_ai_[^_]+_/, '').replace(/([a-z])([A-Z])/g, '$1 $2') || `怪物 ${row.id}`),
      nameKey: row.mes_id_name, hp: row.hp, maxHp: row.hp, mp: row.mp, maxMp: row.mp,
      level: row.lv, strength: row.strength, magic: row.ability_attack, attack: row.attack,
      speed: row.agility, defense: row.defense, magicDefense: row.ability_defense,
      evasion: row.evasion_rate, magicEvasion: row.magic_evasion_rate, accuracy: row.accuracy_rate,
      criticalRate: row.critical_rate, exp: row.exp, gil: row.gill, boss: Boolean(row.boss),
      elementResistances: attrs(row.resistance_attribute), role,
      ai: acts ? acts.operands.iValues.map((id, index) => ({ id, weight: acts.operands.rValues[index] ?? 0 })).filter(a => a.weight > 0) : [{ id: 1, weight: 100 }],
      drops: Array.from({ length: 8 }, (_, index) => ({ id: row[`drop_content_id${index + 1}`],
        count: row[`drop_content_id${index + 1}_value`] })).filter(d => d.id > 0 && d.count > 0), dropRate: row.drop_rate,
      sprite: asset ? sprite(`/${asset.group_name}/${asset.group_name}_${asset.asset_name}.png`) : null };
  }));
  const backgrounds = dictionary(rows('battle_background_asset').map(row => ({ id: row.id, sprite: sprite(`/${row.asset_name}/${row.asset_name}.png`) })));
  const parties = dictionary(rows('monster_party').map(row => ({ id: row.id, backgroundId: row.battle_background_asset_id,
    bgmId: row.battle_bgm_asset_id, ap: row.get_ap, script: String(row.script_name),
    members: Array.from({ length: 9 }, (_, index) => ({ monsterId: row[`monster${index + 1}`], slot: index,
      x: row[`monster${index + 1}_x_position`], y: row[`monster${index + 1}_y_position`] })).filter(m => m.monsterId > 0) })));
  const result = { monsters, parties, abilities, characters, commands: byId('command'), items: byId('item'), contents,
    weapons, armors, backgrounds, sprites, growth: rows('growth_curve'), expTable: rows('exp_table'),
    warnings: [
      'Enemy AI uses the first PR Act choice table; branching, status attacks and final actions outside Ymir are deferred.',
      'Ymir head hides/emerges every 10 battle seconds from PR AI; shell counters immediately and either part defeat ends the fight.',
      'Initial ATB randomizes a speed-based gauge; browser actions resolve immediately without SNES animation and command wait queues.',
      'Unimplemented zero-power abilities warn and consume a turn; story execution continues.',
      'Ability and character names without an extracted battle translation use short fallback names.',
    ] };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPlayBattle({ output: process.argv[2] ?? 'build/play/battle.json' });
  console.log(`Battle data: ${Object.keys(result.monsters).length} monsters, ${Object.keys(result.parties).length} formations.`);
}
