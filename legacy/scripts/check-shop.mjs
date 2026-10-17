// Source rows and controlled Web host transactions. These do not certify that
// every shop's map or story prerequisites are playable, or execute the native game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2),
  sourceOnly = args.includes("--source-only");
let build = resolve(root, "dist");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--source-only") continue;
  assert.equal(args[i], "--build-dir", "Unknown shop check option");
  assert.ok(args[i + 1] && !args[i + 1].startsWith("--"));
  build = resolve(root, args[++i]);
}
const module = (name) => import(pathToFileURL(build + "/src/" + name + ".js"));
const { loadCorpus } = await module("compiler/corpus");
const { loadSystemSource } = await module("compiler/system-source");
const { loadSystemMessages } = await module("compiler/system-messages");
const { compileShopCatalog, compileShopInteraction } =
  await module("compiler/shop");
const { compileEntityGroup, entityProperties } = await module(
  "compiler/entity-group",
);
const { shopBuyOptions, shopSellOptions, projectShopTrade } =
  await module("core/shop");
const { decodeFieldOp } = await module("compiler/field");
const { hash } = await module("compiler/content");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const reportPath =
  root + `build/reports/shop-${sourceOnly ? "source-" : ""}check.json`;
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
execFileSync(process.execPath, [root + "scripts/check-shop-native.mjs"], {
  cwd: root,
  stdio: "pipe",
});
const nativeBytes = await readFile(
    root + "build/reports/shop-native-check.json",
  ),
  native = JSON.parse(nativeBytes);
assert.equal(native.semanticsVerified, false);
const corpus = await loadCorpus(root),
  source = await loadSystemSource(root, corpus.manifest.parentSourceSetHash);
const messages = await loadSystemMessages(
  root,
  corpus.manifest.parentSourceSetHash,
  corpus.manifest.sources,
);
assert.equal(source.sourceSetHash, corpus.sourceSetHash);
assert.ok(
  corpus.manifest.sources.some(
    (row) =>
      row.file === "GameAssembly.dll" && row.sha256 === native.nativeSha256,
  ),
);
const compiled = compileShopCatalog(
  source.reader,
  source.tables,
  (key) => messages.messages[key],
);
const catalog = compiled.catalog;
assert.deepEqual(compiled.blockers, []);
assert.equal(catalog.groups.length, 92);
assert.equal(catalog.products.length, 595);
assert.equal(catalog.contents.length, 273);
assert.equal(compiled.excludedProducts.length, 38);
const byId = (table, id) => {
  const rows = corpus.tables[table].filter((row) => Number(row.id) === id);
  assert.equal(rows.length, 1, `${table}:${id}`);
  return rows[0];
};
let buyProbes = 0,
  sellProbes = 0;
const productKinds = { item: 0, weapon: 0, armor: 0 };
for (const group of catalog.groups) {
  assert.deepEqual(
    group.productIds,
    corpus.tables["product.csv"]
      .filter((row) => Number(row.group_id) === group.id)
      .map((row) => Number(row.id)),
  );
  assert.equal(
    group.name,
    messages.messages[byId("product_group.csv", group.id).mes_id_name],
  );
}
for (const product of catalog.products) {
  const raw = byId("product.csv", product.id),
    content = byId("content.csv", product.contentId);
  const kind = { 1: "item", 2: "weapon", 3: "armor" }[content.type_id];
  const data = byId(kind + ".csv", Number(content.type_value));
  productKinds[kind]++;
  const price = Number(data.buy) + Number(raw.coefficient),
    heldKind = kind === "item" ? "item" : "equipment";
  assert.equal(product.buy, price);
  assert.equal(product.limit, Number(raw.purchase_limit));
  // Independent source oracle: total Count (including worn gear), money and
  // MAX_ITEM constrain the reachable confirmation, before any owned write.
  for (const [gil, count, equipped] of [
    [0, 0, 0],
    [price * 2 - 1, 0, 0],
    [
      catalog.gilLimit,
      catalog.itemLimit,
      heldKind === "equipment" ? catalog.itemLimit : 0,
    ],
    [
      price * 2,
      catalog.itemLimit - 1,
      heldKind === "equipment" ? catalog.itemLimit - 1 : 0,
    ],
  ]) {
    const inventory = {
      gil,
      entries: [{ id: product.contentId, kind: heldKind, count, equipped }],
    };
    const before = structuredClone(inventory),
      expected = Math.min(Math.floor(gil / price), catalog.itemLimit - count);
    const option = shopBuyOptions(catalog, product.groupId, inventory).find(
      (row) => row.productId === product.id,
    );
    assert.equal(option.maxCount, expected);
    assert.throws(
      () =>
        projectShopTrade(
          catalog,
          product.groupId,
          { kind: "buy", productId: product.id, count: expected + 1 },
          inventory,
        ),
      /available quantity/,
    );
    if (expected > 0) {
      const plan = projectShopTrade(
        catalog,
        product.groupId,
        { kind: "buy", productId: product.id, count: expected },
        inventory,
      );
      assert.deepEqual(plan.commands, [
        {
          kind: heldKind === "item" ? "grant-item" : "grant-equipment",
          id: product.contentId,
          count: expected,
        },
        { kind: "pay-gil", amount: price * expected },
      ]);
      assert.equal(plan.gilAfter, gil - price * expected);
      assert.equal(plan.countAfter, count + expected);
    }
    assert.deepEqual(inventory, before);
    buyProbes++;
  }
}
for (const content of catalog.contents) {
  const raw = byId("content.csv", content.id),
    table = { 1: "item", 2: "weapon", 3: "armor" }[raw.type_id];
  const data = byId(table + ".csv", Number(raw.type_value));
  const sellable =
    Number(data.type_id) === 1 && Number(data.sales_not_possible) !== 1;
  assert.equal(content.sellable, sellable);
  assert.equal(content.sell, Number(data.sell));
  for (const nearCap of [false, true]) {
    const gil = nearCap
      ? catalog.gilLimit - Math.max(0, Number(data.sell) - 1)
      : 0;
    const equipped = content.kind === "equipment" ? 2 : 0;
    const inventory = {
      gil,
      entries: [{ id: content.id, kind: content.kind, count: 3, equipped }],
    };
    const options = shopSellOptions(catalog, catalog.groups[0].id, inventory);
    const expected = sellable
      ? Math.min(
          3 - equipped,
          Math.floor((catalog.gilLimit - gil) / Number(data.sell)),
        )
      : 0;
    assert.equal(options.length, sellable ? 1 : 0);
    if (sellable) assert.equal(options[0].maxCount, expected);
    assert.throws(() =>
      projectShopTrade(
        catalog,
        catalog.groups[0].id,
        { kind: "sell", contentId: content.id, count: expected + 1 },
        inventory,
      ),
    );
    if (expected > 0) {
      const plan = projectShopTrade(
        catalog,
        catalog.groups[0].id,
        { kind: "sell", contentId: content.id, count: expected },
        inventory,
      );
      assert.equal(plan.gilAfter, Number(data.sell) * expected);
      assert.equal(plan.countAfter, 3 - expected);
    }
    sellProbes++;
  }
}
const entities = [],
  scriptShops = [];
for (const asset of corpus.assets) {
  let group;
  for (const [li, layer] of (asset.data?.layers ?? []).entries())
    for (const [oi, object] of (layer.objects ?? []).entries()) {
      const properties = entityProperties(object.properties ?? []);
      if (properties.action_id !== 8) continue;
      const pointer = `/layers/${li}/objects/${oi}`;
      group ??= compileEntityGroup(
        basename(asset.source.assetPath, ".json"),
        asset,
        corpus.tables,
        corpus.messages,
      );
      const entity = group.entities.find(
        (row) => row.source.pointer === pointer,
      );
      assert.equal(entity?.kind, 17);
      assert.ok(entity.npc);
      let interaction,
        reason = null;
      try {
        interaction = compileShopInteraction(
          properties,
          corpus.tables,
          corpus.messages,
        );
      } catch (error) {
        reason = error.message;
      }
      if (interaction) assert.deepEqual(entity.npc.interaction, interaction);
      else {
        assert.equal(entity.npc.interaction.kind, "blocked");
        assert.equal(entity.npc.interaction.reason, reason);
      }
      entities.push({
        asset: asset.id,
        source: entity.source,
        groupId: properties.product_group_id,
        interactionAdmitted: !!interaction,
        blockers: group.blockers.filter((b) => b.source.pointer === pointer),
        entity,
      });
    }
  for (const [index, raw] of (asset.data?.Mnemonics ?? []).entries()) {
    if (
      raw.mnemonic !== "SysCall" ||
      !String(raw.operands?.sValues?.[0]).startsWith("ショップを開く:")
    )
      continue;
    const site = {
      script: basename(asset.source.assetPath, ".json"),
      index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` },
    };
    const decoded = decodeFieldOp(raw, site, corpus.messages, corpus.tables);
    assert.equal(
      decoded.kind,
      "blocked",
      "Unresolved script selector must not open an ordinary group by inference",
    );
    scriptShops.push({
      ...site,
      selector: raw.operands.sValues[0],
      reason: decoded.reason,
    });
  }
}
assert.equal(entities.length, 71);
assert.equal(entities.filter((e) => e.interactionAdmitted).length, 69);
assert.equal(entities.filter((e) => e.blockers.length === 0).length, 64);
assert.equal(scriptShops.length, 49);
let host = null;
if (!sourceOnly) {
  const { GameSession } = await module("core/game-session");
  const { verifyContent } = await module("core/content-integrity");
  const battle = await verifyContent(
    JSON.parse(
      await readFile(root + "build/game/opening-playable.json", "utf8"),
    ),
  );
  assert.deepEqual(
    battle.gameState.shops,
    catalog,
    "Published shop catalog differs from the source compiler",
  );
  const sourceEntity = entities.find(
    (e) => e.groupId === 19 && e.blockers.length === 0,
  ).entity;
  // Keep the exact source ShopNPC and native prices. Only this logic test's
  // map envelope/player position is controlled; no money/items are granted.
  const width = sourceEntity.x + 3,
    height = sourceEntity.y + 4;
  const fieldInput = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: battle.common.fieldSourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    map: {
      id: "controlled-source-shop",
      width,
      height,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { [sourceEntity.layer]: Array(width * height).fill(0) },
      entities: [sourceEntity],
      source: sourceEntity.source,
    },
    characters: {},
    scripts: {},
    entry: {
      player: {
        x: sourceEntity.x,
        y: sourceEntity.y + 1,
        layer: sourceEntity.layer,
        direction: "up",
        asset: "controlled-player",
        mount: "",
      },
      description: "Controlled source shop host; not a migrated map",
      evidence: [sourceEntity.source],
    },
    limitations: ["Controlled map envelope; no story or media coverage"],
  };
  const field = { ...fieldInput, contentHash: hash(fieldInput) },
    session = new GameSession(field, battle),
    before = session.state.snapshot();
  const game = session.field;
  game.confirm();
  assert.equal(game.currentShop, null);
  assert.ok(game.dialogue);
  assert.equal(session.checkpointReady, false);
  assert.throws(
    () => session.tradeShop({ kind: "buy", productId: 118, count: 1 }),
    /No ordinary shop/,
  );
  game.confirm();
  assert.equal(game.currentShop.groupId, 19);
  const offer = session.shopOptions().buy.find((row) => row.maxCount > 0);
  assert.ok(
    offer,
    "Source initial Gil must fund this controlled check without injected money",
  );
  const bought = session.tradeShop({
    kind: "buy",
    productId: offer.productId,
    count: 1,
  });
  assert.equal(session.gil, before.gil - offer.unitPrice);
  assert.equal(
    session.state
      .snapshot()
      .equipmentStock.find((row) => row.id === offer.contentId).count,
    bought.countAfter,
  );
  const sold = session.tradeShop({
    kind: "sell",
    contentId: offer.contentId,
    count: 1,
  });
  assert.equal(session.gil, before.gil - offer.unitPrice + sold.totalPrice);
  assert.equal(
    session.state.snapshot().totalGil,
    before.totalGil + sold.totalPrice,
  );
  for (const stock of session
    .shopOptions()
    .sell.filter((row) => row.equipped === row.count))
    assert.throws(
      () =>
        session.tradeShop({
          kind: "sell",
          contentId: stock.contentId,
          count: 1,
        }),
      /available quantity/,
    );
  assert.equal(session.closeShop(session.field.currentShop?.id), true);
  assert.equal(session.closeShop(session.field.currentShop?.id), false);
  assert.ok(game.dialogue);
  assert.equal(session.checkpointReady, false);
  assert.throws(() => session.checkpoint(), /Cannot save/);
  game.confirm();
  assert.equal(session.checkpointReady, true);
  const saved = session.checkpoint(),
    restored = GameSession.restore(
      JSON.parse(JSON.stringify(saved)),
      field,
      battle,
    );
  assert.deepEqual(restored.state.snapshot(), session.state.snapshot());
  assert.equal(restored.field.currentShop, null);
  assert.throws(
    () =>
      restored.tradeShop({ kind: "buy", productId: offer.productId, count: 1 }),
    /No ordinary shop/,
  );
  host = {
    lane: "controlled-source-shop-entity-and-owned-state",
    battleCatalogHash: battle.contentHash,
    fieldContentHash: field.contentHash,
    source: sourceEntity.source,
    initialGil: before.gil,
    finalGil: session.gil,
    bought,
    sold,
    restoredSnapshotHash: hash(restored.state.snapshot()),
    injectedMoney: false,
    storyReachability: false,
  };
}
const report =
  JSON.stringify(
    {
      lane: "source-ordinary-shops",
      sourceSetHash: corpus.sourceSetHash,
      nativeReportSha256: sha(nativeBytes),
      semanticsVerified: false,
      catalogHash: hash(catalog),
      counts: {
        groups: catalog.groups.length,
        products: catalog.products.length,
        contents: catalog.contents.length,
        excludedServiceProducts: compiled.excludedProducts.length,
        productKinds,
        buyProbes,
        sellProbes,
        actionSites: entities.length,
        interactionAdmitted: 69,
        entityAdmitted: 64,
        blockedScriptSites: scriptShops.length,
      },
      sources: compiled.sources,
      excludedProducts: compiled.excludedProducts,
      entities,
      scriptShops,
      host,
      limitations: [
        "Logical actor admission is not map or story reachability",
        "Five source ShopNPCs still need movement controllers 2/3 and two need inline messages",
        "Special script shops, nonzero limits, magic/Esper purchases and separate service rows remain blocked",
        "Manual inventory sort order and original menu presentation are not reproduced",
        "No original runtime comparison",
      ],
    },
    null,
    2,
  ) + "\n";
await writeFile(reportPath, report);
console.log(
  JSON.stringify(
    {
      ...JSON.parse(report).counts,
      host: host?.lane ?? null,
      reportSha256: sha(report),
      semanticsVerified: false,
    },
    null,
    2,
  ),
);
