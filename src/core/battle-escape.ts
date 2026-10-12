/** Explicit Web development rule: a requested retreat completes after the
 * already executing action, cancels unstarted actions, and grants no rewards
 * or learning. This is not the source escape probability or timing. */
export type FrameworkBattleEscapePolicy = {
  kind: "framework-battle-escape-v1";
  id: string;
};

export function parseBattleEscapePolicy(raw: unknown): FrameworkBattleEscapePolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
    throw new Error("Invalid development battle escape policy");
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== 2 || Object.keys(fields).sort().join(",") !== "id,kind" ||
      Object.values(fields).some(d => !("value" in d) || !d.enumerable) ||
      fields.kind!.value !== "framework-battle-escape-v1" ||
      typeof fields.id!.value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(fields.id!.value))
    throw new Error("Invalid development battle escape policy");
  return { kind: "framework-battle-escape-v1", id: fields.id!.value };
}
