import { tr } from "./i18n.js";
const originals = new WeakMap();
const baseline = (object) => {
  if (!originals.has(object)) originals.set(object, structuredClone(object));
  return originals.get(object);
};

// Only presentation fields change. IDs, scripts, rules and save identity are untouched.
export function localizeBattle(battle, catalog) {
  const original = baseline(battle);
  const names = catalog?.language === "zh-CN" ? {} : catalog?.battleNames || {};
  for (const group of ["characters", "monsters", "abilities", "commands", "magicStones"])
    for (const [id, entry] of Object.entries(battle[group] || {}))
      entry.name = names[group]?.[id] || original[group]?.[id]?.name || entry.name;
  for (const group of ["itemNames", "contentNames"])
    battle[group] = { ...original[group], ...names[group] };
  if (catalog) battle.messages = catalog.messages;
}

export function localizeGame(data, battle, catalog, game) {
  if (!catalog) return;
  data.messages = catalog.messages;
  data.speakers = catalog.speakers;
  localizeBattle(battle, catalog);
  for (const item of game?.shop?.stock || []) item.name = battle.contentNames[item.id] || item.name;
  for (const unit of Object.values(game?.roster || {})) {
    const aliases = catalog.characterAliases?.[unit.id] || [];
    if (!unit.customName && aliases.includes(unit.name))
      unit.name = battle.characters[unit.id]?.name || unit.name;
  }
  // Battles own copies of their combatants; preserve every numeric field.
  for (const unit of [...(game?.battle?.players || []), ...(game?.battle?.enemies || [])]) {
    const definition =
      unit.side === "player" ? battle.characters[unit.id] : battle.monsters[unit.id];
    if (definition && !unit.customName) {
      const actor = game.roster?.[unit.id];
      unit.name = unit.side === "player" ? actor?.name || definition.name : definition.name;
    }
  }
  const dialogue = game?.dialogue;
  if (dialogue) {
    if (dialogue.uiKey) {
      const values = { ...dialogue.uiValues };
      if (dialogue.contentId) values.v0 = battle.contentNames[dialogue.contentId] || values.v0;
      dialogue.text = tr(dialogue.uiKey, values);
    }
    if (dialogue.choiceKeys) dialogue.choices = dialogue.choiceKeys.map((key) => game.text(key));
    else if (dialogue.choiceUiKeys) dialogue.choices = dialogue.choiceUiKeys.map((key) => tr(key));
    else if (dialogue.key && Object.hasOwn(data.messages, dialogue.key)) {
      dialogue.text = game.text(dialogue.key);
      dialogue.speaker = data.speakers[dialogue.key] || "";
    }
  }
  const naming = game?.nameInput;
  if (naming && catalog.characterAliases?.[naming.id]?.includes(naming.original))
    naming.original = game.roster[naming.id]?.name || naming.original;
}

export function localizeSave(record, catalog) {
  if (!record || !catalog) return record;
  return {
    ...record,
    map: catalog.mapNames[record.snapshot?.mapId] || record.map,
    party: (record.party || []).map((unit) => ({
      ...unit,
      name:
        !record.snapshot?.roster?.[unit.id]?.customName &&
        catalog.characterAliases?.[unit.id]?.includes(unit.name)
          ? catalog.battleNames.characters[unit.id] || unit.name
          : unit.name,
    })),
  };
}

export function localizeExtras(extras, catalog) {
  const original = baseline(extras);
  for (const group of ["gallery", "music", "thumbnails", "bestiary"])
    for (let index = 0; index < (extras[group] || []).length; index++) {
      const entry = extras[group][index],
        translated = catalog?.extras?.[group]?.[entry.id];
      entry.name =
        (typeof translated === "string" ? translated : translated?.name) ||
        original[group][index].name;
      for (const habitat of entry.habitats || [])
        habitat.name = translated?.habitats?.[habitat.id] || habitat.name;
    }
}
