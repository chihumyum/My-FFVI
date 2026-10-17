import { createHash } from "node:crypto";
import type { BattleRow } from "./battle.js";
import { hash, record } from "./content.js";
import { tableInteger } from "./table.js";
import { validateMagicStoneCatalog, type MagicStoneCatalog, type MagicStoneDefinition } from "../core/magic-stones.js";

type Tables = Record<string, Record<string, string>[]>;
type Reader = { row(table: string, id: string | number): BattleRow };
type Source = BattleRow["source"];

/** Reviewed complete export, not an arbitrary C file or a caller's claimed
 * dictionary. No extracted dictionary values are authored into this module. */
export const MAGIC_STONE_NATIVE_BINDING = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  manifestSha256: "03d27286c60e4e0a0b60350437c3ea85ba4780d16545d1c9caf485a64af401f2",
  constructorRva: "0x856d80",
  constructorRangeSha256: "da660b6fea520050f4bab6a4663423fbb2a9cdad9df001fd36825af5f0557b99",
  constructorSha256: "388e9f7130df0928fd87a1516721ceaac63cd236a07d32f8e3a7d1c499446f94",
} as const;

export type MagicStoneNativeEvidence = {
  receipt: unknown;
  constructorC: string;
  /** The caller verifies the complete table/source manifest before compiling. */
  sourceSetHash: string;
};
export type MagicStoneDictionaryRow = {
  contentId: number; summonAbilityId: number; parameterType: number; parameterValue: number;
};
export type MagicStoneCompilation = {
  catalog: MagicStoneCatalog;
  sources: Source[];
  report: {
    stones: number;
    learningRows: number;
    bonusStones: number;
    summonAdmitted: 0;
    ownershipGranted: false;
    originalGameExecuted: false;
    semanticsVerified: false;
    diagnostics: { code: "summon-unavailable"; contentId: number; reason: string }[];
  };
};

function integer(value: number, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid magic stone " + label);
  return value;
}
function sourceInteger(value: string | undefined, label: string, minimum = 0) {
  return integer(tableInteger(value), label, minimum);
}
const parameters = new Set([0, 2, 3, 4, 5, 6, 14]);

/** Only this entry point authenticates the reviewed native constructor. The
 * manifest hash binds every method/alias/digest in the complete nine-method
 * receipt, including the source DLL, symbols and generated header identities. */
export function compileMagicStoneDictionaries(evidence: MagicStoneNativeEvidence): MagicStoneDictionaryRow[] {
  const receipt = record(evidence.receipt);
  if (!/^[0-9a-f]{64}$/.test(evidence.sourceSetHash) || receipt.status !== "complete" ||
      receipt.semanticsVerified !== false || receipt.nativeSha256 !== MAGIC_STONE_NATIVE_BINDING.nativeSha256 ||
      receipt.symbolsSha256 !== MAGIC_STONE_NATIVE_BINDING.symbolsSha256 ||
      receipt.headerSha256 !== MAGIC_STONE_NATIVE_BINDING.headerSha256 ||
      hash(receipt) !== MAGIC_STONE_NATIVE_BINDING.manifestSha256)
    throw new Error("Missing or changed complete magic stone native evidence");
  if (typeof evidence.constructorC !== "string" ||
      createHash("sha256").update(evidence.constructorC).digest("hex") !== MAGIC_STONE_NATIVE_BINDING.constructorSha256)
    throw new Error("Changed magic stone constructor export");
  if (!Array.isArray(receipt.methods)) throw new Error("Missing magic stone constructor receipt");
  const constructor = receipt.methods.map(record).filter(method => method.rva === MAGIC_STONE_NATIVE_BINDING.constructorRva);
  if (constructor.length !== 1 || constructor[0]!.nativeRangeSha256 !== MAGIC_STONE_NATIVE_BINDING.constructorRangeSha256 ||
      constructor[0]!.decompiledSha256 !== MAGIC_STONE_NATIVE_BINDING.constructorSha256)
    throw new Error("Unbound magic stone constructor export");
  // Each assignment closes the dictionary populated by the preceding Add
  // calls. The fourth dictionary contains display-message pointers and is not
  // treated as an integer table or inferred from the content TypeValue.
  let offset = 0;
  const dictionaries = ["AbilityList", "ParamterTypeList", "ParameterValueList"].map(field => {
    const end = evidence.constructorC.indexOf("." + field, offset);
    if (end < 0) throw new Error("Missing magic stone constructor dictionary " + field);
    const text = evidence.constructorC.slice(offset, end);
    offset = end + field.length + 1;
    const entries = [...text.matchAll(/\bSystem_Collections_Generic_Dictionary_BattlePlayerData__BattleUIActSelect_DecisionDelegate___Add_1359140\s*\(pSVar5,(0x[0-9a-f]+|\d+),(0x[0-9a-f]+|\d+),_DAT_[0-9a-f]+\);/g)]
      .map(match => [Number(match[1]), Number(match[2])] as const);
    if (entries.length !== 27 || new Set(entries.map(([id]) => id)).size !== entries.length)
      throw new Error("Incomplete magic stone constructor dictionary " + field);
    return entries;
  });
  const [abilities, types, values] = dictionaries;
  return abilities!.map(([contentId, summonAbilityId], index) => {
    if (types![index]![0] !== contentId || values![index]![0] !== contentId)
      throw new Error("Mismatched magic stone constructor dictionary identities");
    return { contentId, summonAbilityId, parameterType: types![index]![1], parameterValue: values![index]![1] };
  });
}

/** Typed table binding shared by source compilation and authored unit inputs.
 * This function does not attest a native export. Call compileMagicStoneCatalog
 * for source admission; a supplied row set alone is not native evidence. */
export function compileMagicStoneRows(
  reader: Reader, tables: Tables, resolveName: (key: string) => string | null,
  dictionaries: readonly MagicStoneDictionaryRow[],
): MagicStoneCompilation {
  const sources: Source[] = [];
  const indexes = new Map<string, Map<number, Record<string, string>>>();
  const index = (table: string) => {
    const cached = indexes.get(table); if (cached) return cached;
    const values = tables[table];
    if (!Array.isArray(values)) throw new Error("Missing magic stone table: " + table);
    const found = new Map<number, Record<string, string>>();
    for (const value of values) {
      const id = sourceInteger(value.id, "source row identity", 1);
      if (found.has(id)) throw new Error("Duplicate magic stone source row: " + table + ":" + id);
      found.set(id, value);
    }
    indexes.set(table, found); return found;
  };
  const row = (table: string, id: number) => {
    const expected = index(table).get(id), found = reader.row(table, id);
    if (!expected || hash(expected) !== hash(found.values) || found.source.rowId !== String(id))
      throw new Error("Mismatched magic stone table enumeration: " + table + ":" + id);
    sources.push(structuredClone(found.source)); return found.values;
  };
  const dictionary = new Map<number, MagicStoneDictionaryRow>();
  for (const entry of dictionaries) {
    const id = integer(entry.contentId, "content identity", 1);
    integer(entry.summonAbilityId, "summon identity", 1);
    integer(entry.parameterType, "parameter type"); integer(entry.parameterValue, "parameter value");
    if (dictionary.has(id)) throw new Error("Duplicate magic stone dictionary identity");
    dictionary.set(id, structuredClone(entry));
  }
  const contents = [...index("content.csv").values()].filter(value => sourceInteger(value.type_id, "content type") === 9);
  if (!contents.length || dictionary.size !== contents.length ||
      contents.some(value => !dictionary.has(sourceInteger(value.id, "content identity", 1))))
    throw new Error("Incomplete magic stone content/dictionary binding");
  const report: MagicStoneCompilation["report"] = {
    stones: contents.length, learningRows: 0, bonusStones: 0, summonAdmitted: 0,
    ownershipGranted: false, originalGameExecuted: false, semanticsVerified: false, diagnostics: [],
  };
  const stones: MagicStoneCatalog["stones"] = {};
  for (const content of contents) {
    const contentId = sourceInteger(content.id, "content identity", 1);
    const value = row("content.csv", contentId), binding = dictionary.get(contentId)!;
    const summon = row("ability.csv", binding.summonAbilityId);
    if (sourceInteger(summon.type_id, "summon ability type") !== 9)
      throw new Error("Unresolved magic stone summon ability identity");
    if (!parameters.has(binding.parameterType)) throw new Error("Unresolved magic stone bonus parameter");
    const parameter = binding.parameterType as MagicStoneDefinition["bonus"]["parameter"];
    if (parameter === 0 ? binding.parameterValue !== 0 : parameter === 2 || parameter === 3
      ? ![10, 30, 50].includes(binding.parameterValue) : ![1, 2].includes(binding.parameterValue))
      throw new Error("Unresolved magic stone bonus value");
    if (typeof value.mes_id_name !== "string" || !value.mes_id_name)
      throw new Error("Missing magic stone name key");
    const name = value.mes_id_name === "None" ? null : resolveName(value.mes_id_name);
    if (typeof name !== "string" || !name.trim())
      throw new Error("Missing or ambiguous magic stone message: " + value.mes_id_name);
    const summonBlockers = ["Magic stone summon usage and action lifecycle are not admitted"];
    report.diagnostics.push({ code: "summon-unavailable", contentId, reason: summonBlockers[0]! });
    if (parameter !== 0) report.bonusStones++;
    stones[contentId] = { contentId, name, summonAbilityId: binding.summonAbilityId,
      bonus: { parameter, value: binding.parameterValue }, learning: [], summonBlockers };
  }
  const learnedContent = new Map<number, number>();
  // Source enumeration order is meaningful. Type2 matches the stone value,
  // independently of jobId, and each learning row's content resolves ability.
  for (const raw of index("learning.csv").values()) {
    if (sourceInteger(raw.type_id, "learning type") !== 2) continue;
    const learning = row("learning.csv", sourceInteger(raw.id, "learning identity", 1));
    const stoneId = sourceInteger(learning.value1, "learning stone", 1), stone = stones[stoneId];
    if (!stone) throw new Error("Unresolved learning magic stone identity");
    const contentId = sourceInteger(learning.content_id, "learning content", 1), content = row("content.csv", contentId);
    if (sourceInteger(content.type_id, "learning content type") !== 4)
      throw new Error("Unresolved magic stone learning content kind");
    const abilityId = sourceInteger(content.type_value, "learning ability", 1);
    row("ability.csv", abilityId);
    const previous = learnedContent.get(abilityId);
    if (previous !== undefined && previous !== contentId)
      throw new Error("Ambiguous magic stone learning ability content");
    learnedContent.set(abilityId, contentId);
    stone.learning.push({ id: sourceInteger(learning.id, "learning identity", 1), contentId, abilityId,
      rate: sourceInteger(learning.value2, "learning rate") });
    report.learningRows++;
  }
  const catalog: MagicStoneCatalog = { kind: "magic-stones-v1",
    rules: { kind: "magic-stone-rules-v1", maxSkillLevel: 100, excludedSourceIds: [13, 14],
      magicCommandId: 7, alternativeMagicCommandId: 31 }, stones };
  validateMagicStoneCatalog(catalog);
  return { catalog, sources: [...new Map(sources.map(source => [hash(source), source])).values()], report };
}

export function compileMagicStoneCatalog(
  reader: Reader, tables: Tables, resolveName: (key: string) => string | null,
  evidence: MagicStoneNativeEvidence,
): MagicStoneCompilation & { evidence: typeof MAGIC_STONE_NATIVE_BINDING & { sourceSetHash: string; semanticsVerified: false } } {
  const rows = compileMagicStoneDictionaries(evidence);
  return { ...compileMagicStoneRows(reader, tables, resolveName, rows),
    evidence: { ...MAGIC_STONE_NATIVE_BINDING, sourceSetHash: evidence.sourceSetHash, semanticsVerified: false } };
}
