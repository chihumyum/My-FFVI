import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const npcKey = (npc) => `${npc.mapId}:${npc.group}:${npc.entityId}`;
export const startContextKey = (start) =>
  JSON.stringify([
    start.file || start.startSave,
    start.mapId,
    start.time,
    [...(start.groups || [])].sort(),
  ]);
export function exactNPCConfirmation(npc, attempt) {
  return (
    attempt.status === "message-confirmed" &&
    attempt.exactDispatch === true &&
    attempt.messages?.length > 0 &&
    String(attempt.confirmPose?.mapId) === String(npc.mapId) &&
    npcKey(attempt.targetIdentity || {}) === npcKey(npc) &&
    (attempt.sourceScript === undefined || attempt.sourceScript === npc.script)
  );
}

// Summaries contain references, not substitute execution evidence. Walk those
// references and the batch's prior reports, retaining every actual attempt.
export async function loadNPCReports(files) {
  const seen = new Set(),
    reports = [],
    missingFiles = [],
    requested = new Set(files.map((file) => path.resolve(file))),
    inheritedRound = [];
  async function visit(file) {
    const absolute = path.resolve(file);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    let report;
    try {
      report = JSON.parse(await readFile(absolute, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missingFiles.push(path.relative(process.cwd(), absolute));
      return;
    }
    const dependencies = report.batches || report.inputs?.previousReports || [];
    if (requested.has(absolute) && Array.isArray(report.roundBatches))
      inheritedRound.push(...report.roundBatches);
    for (const dependency of dependencies) await visit(dependency);
    if (report.npcs?.some((npc) => Array.isArray(npc.attempts)))
      reports.push({ file: path.relative(process.cwd(), absolute), report });
    else if (!dependencies.length) throw new Error(`Not an NPC batch or linked summary: ${file}`);
  }
  for (const file of files) await visit(file);
  const direct = reports
    .filter(({ file }) => requested.has(path.resolve(file)))
    .map(({ file }) => file);
  return {
    reports,
    missingFiles,
    roundBatches: direct.length ? direct : [...new Set(inheritedRound)],
  };
}

const counts = (items, key) =>
  Object.fromEntries(
    [...new Set(items.map(key))]
      .sort()
      .map((value) => [value, items.filter((item) => key(item) === value).length]),
  );
export function mergeNPCReports(reports) {
  const rows = new Map(),
    receipts = new Set();
  for (const { file, report } of reports) {
    const contexts = new Map((report.starts || []).map((start) => [start.file, start]));
    for (const npc of report.npcs || []) {
      const key = npcKey(npc),
        prior = rows.get(key),
        evidence = prior?.evidence || [];
      for (const attempt of [...(npc.attempts || []), ...(npc.previousAttempts || [])]) {
        const batch = attempt.batch || file,
          context = attempt.startContext || contexts.get(attempt.startSave);
        const receipt = JSON.stringify([
          key,
          batch,
          attempt.startSave,
          attempt.status,
          attempt.ticks,
          attempt.confirmPose,
          attempt.reason,
          attempt.messages?.map((message) => message.key),
        ]);
        if (receipts.has(receipt)) continue;
        receipts.add(receipt);
        evidence.push({
          ...attempt,
          batch,
          sourceScript: attempt.sourceScript === undefined ? npc.script : attempt.sourceScript,
          startContext: context
            ? {
                file: attempt.startSave,
                mapId: context.mapId,
                time: context.time,
                groups: context.groups || [],
              }
            : null,
        });
      }
      const classification =
        typeof npc.classification === "string" ? { kind: npc.classification } : npc.classification;
      const row = {
        id: npc.id,
        mapId: npc.mapId,
        areaId: npc.areaId,
        area: npc.area,
        group: npc.group,
        entityId: npc.entityId,
        sourcePosition: npc.sourcePosition,
        script: npc.script,
        classification: classification.kind,
        deferralCategories: classification.categories || [],
        deferralReasons: classification.reasons || [],
        evidence,
        latestBatch: file,
        latestStatus: npc.status,
        stateRejectedStarts: npc.stateRejectedStarts || 0,
      };
      row.result = evidence.some((attempt) => exactNPCConfirmation(row, attempt))
        ? "message-confirmed"
        : "not-confirmed";
      row.attemptCount = evidence.length;
      row.observedBlockers = [
        ...new Set(
          evidence
            .filter((attempt) => !exactNPCConfirmation(row, attempt))
            .map((attempt) => attempt.reason || attempt.status),
        ),
      ];
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

export function summarizeNPCReports({ reports, missingFiles = [], roundBatches = [] }) {
  if (!reports.length) throw new Error("No actual NPC batch reports were found");
  const rows = mergeNPCReports(reports),
    latest = reports.at(-1).report;
  const remaining = rows.filter(
    (row) => row.classification === "pure-message" && row.result !== "message-confirmed",
  );
  const areas = (latest.areas || []).map((area) => {
    const local = rows.filter((row) => row.areaId === area.areaId),
      unconfirmed = local.filter(
        (row) => row.classification === "pure-message" && row.result !== "message-confirmed",
      );
    return {
      areaId: area.areaId,
      area: area.area,
      total: local.length,
      confirmedNPCs: local.filter((row) => row.result === "message-confirmed").map((row) => row.id),
      unconfirmedNPCs: local
        .filter((row) => row.result !== "message-confirmed")
        .map((row) => row.id),
      pureMessageRemaining: unconfirmed.map((row) => ({
        id: row.id,
        mapId: row.mapId,
        group: row.group,
        entityId: row.entityId,
        actualAttemptCount: row.attemptCount,
        latestStatus: row.latestStatus,
        blockers: row.observedBlockers,
      })),
      unattemptedPureMessageNPCs: unconfirmed
        .filter((row) => !row.attemptCount)
        .map((row) => row.id),
      observedBlockerEntities: counts(
        unconfirmed.flatMap((row) => [...new Set(row.evidence.map((attempt) => attempt.status))]),
        (status) => status,
      ),
      dedicatedCases: counts(
        local
          .filter((row) => row.classification === "dedicated-case")
          .flatMap((row) => row.deferralCategories),
        (category) => category,
      ),
    };
  });
  const round = roundBatches.length ? roundBatches : [reports.at(-1).file],
    roundFiles = new Set(round.map((file) => path.resolve(file)));
  const priorRows = mergeNPCReports(
    reports.filter(({ file }) => !roundFiles.has(path.resolve(file))),
  );
  const baseline = new Set(
    priorRows.filter((row) => row.result === "message-confirmed").map(npcKey),
  );
  return {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    batches: reports.map(({ file }) => file),
    roundBatches: round,
    missingFiles,
    scope:
      "Exact map/group/entity confirmations in real saved states only. Historical attempts are retained and deduplicated; source script changes invalidate old confirmations. Not every dialogue branch or quest is assessed. Dedicated cases are deferred, not failures. Blocker categories may overlap.",
    summary: {
      declaredNPCs: rows.length,
      classifications: counts(rows, (row) => row.classification),
      trustedStarts: latest.summary.trustedStarts,
      skippedStarts: latest.summary.skippedStarts,
      attemptedUniqueNPCs: rows.filter((row) => row.attemptCount).length,
      actualAttempts: rows.reduce((sum, row) => sum + row.attemptCount, 0),
      priorConfirmedNPCs: baseline.size,
      newlyConfirmedNPCs: rows.filter(
        (row) => row.result === "message-confirmed" && !baseline.has(npcKey(row)),
      ).length,
      confirmedUniqueNPCs: rows.filter((row) => row.result === "message-confirmed").length,
      confirmedAreas: areas.filter((area) => area.confirmedNPCs.length).length,
      unconfirmedPureMessageNPCs: remaining.length,
      unattemptedPureMessageNPCs: remaining.filter((row) => !row.attemptCount).length,
      unconfirmedAttemptsByStatus: counts(
        remaining.flatMap((row) => row.evidence),
        (attempt) => attempt.status,
      ),
      unconfirmedEntitiesByObservedStatus: counts(
        remaining.flatMap((row) => [...new Set(row.evidence.map((attempt) => attempt.status))]),
        (status) => status,
      ),
      dedicatedCategories: counts(
        rows
          .filter((row) => row.classification === "dedicated-case")
          .flatMap((row) => row.deferralCategories),
        (category) => category,
      ),
    },
    originalSaves: latest.originalSaves || null,
    areas,
    npcs: rows,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      report: { type: "string", multiple: true },
      out: { type: "string", default: "build/play/optional-npc-summary.json" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "node tools/play/optional-npc-summary.mjs [--report BATCH_OR_SUMMARY.json ...] [--out SUMMARY.json]\nPreserves linked historical batch evidence; writes summary JSON, entity CSV and region CSV.",
    );
    process.exit(0);
  }
  const input = [...(values.report || []), ...positionals];
  const summary = summarizeNPCReports(
    await loadNPCReports(input.length ? input : ["build/play/optional-npc-summary.json"]),
  );
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = (rows) =>
    "\uFEFF" + rows.map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
  const entityRows = [
    [
      "npc",
      "map",
      "area",
      "group",
      "entity",
      "classification",
      "result",
      "attempts",
      "latestStatus",
      "deferralCategories",
      "observedBlockers",
    ],
    ...summary.npcs.map((row) => [
      row.id,
      row.mapId,
      row.area,
      row.group,
      row.entityId,
      row.classification,
      row.result,
      row.attemptCount,
      row.latestStatus,
      row.deferralCategories.join("|"),
      row.observedBlockers.join("|"),
    ]),
  ];
  const regionRows = [
    [
      "areaId",
      "area",
      "declared",
      "confirmed",
      "pureMessageRemaining",
      "unattemptedPure",
      "observedEntityStatuses",
      "dedicatedCategories",
    ],
    ...summary.areas.map((area) => [
      area.areaId,
      area.area,
      area.total,
      area.confirmedNPCs.length,
      area.pureMessageRemaining.length,
      area.unattemptedPureMessageNPCs.length,
      JSON.stringify(area.observedBlockerEntities),
      JSON.stringify(area.dedicatedCases),
    ]),
  ];
  await mkdir(path.dirname(values.out), { recursive: true });
  for (const [file, content] of [
    [values.out, JSON.stringify(summary, null, 2) + "\n"],
    [values.out.replace(/\.json$/i, "") + ".csv", csv(entityRows)],
    [values.out.replace(/\.json$/i, "") + "-areas.csv", csv(regionRows)],
  ]) {
    await writeFile(file + ".tmp", content);
    await rename(file + ".tmp", file);
  }
  console.log(
    JSON.stringify(
      { report: values.out, ...summary.summary, missingFiles: summary.missingFiles },
      null,
      2,
    ),
  );
}
