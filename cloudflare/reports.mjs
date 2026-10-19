import { MAX_REPORT_BYTES, validateSubmittedReport } from "../server/report-schema.mjs";

const fail = (message, status) => Object.assign(new Error(message), { status });
const text = (value, max = 180) => (typeof value === "string" ? value.slice(0, max) : null);
export async function readReport(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw fail("报告需要 JSON 格式", 415);
  if (Number(request.headers.get("content-length")) > MAX_REPORT_BYTES)
    throw fail("报告超过 8 MB", 413);
  const reader = request.body?.getReader();
  if (!reader) throw fail("报告内容为空", 400);
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_REPORT_BYTES) {
      await reader.cancel();
      throw fail("报告超过 8 MB", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let input;
  try {
    input = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw fail("报告 JSON 格式不正确", 400);
  }
  return validateSubmittedReport(input);
}

export async function handleReports(request, env, { route, session, account, db, json, headers }) {
  if (!env.REPORTS) return json(503, { error: "报告服务尚未配置，请下载报告文件" });
  if (route.startsWith("/api/admin/reports")) {
    if (session.owner !== "legacy") return json(403, { error: "仅站点管理员可读取报告" });
    if (!["GET", "HEAD"].includes(request.method)) return json(405, { error: "仅支持读取" });
    if (route === "/api/admin/reports") {
      const offset = Number(new URL(request.url).searchParams.get("offset") || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
        return json(400, { error: "分页参数不正确" });
      const rows = await db
        .prepare(
          "SELECT id,created,captured,map_id,map_name,script_name,instruction,description,bytes FROM bug_reports ORDER BY created DESC,id DESC LIMIT 50 OFFSET ?",
        )
        .bind(offset)
        .all();
      return json(200, {
        reports: rows.results,
        nextOffset: rows.results.length === 50 ? offset + 50 : null,
      });
    }
    const match = route.match(/^\/api\/admin\/reports\/([a-f0-9-]{36})$/);
    if (!match) return json(404, { error: "报告不存在" });
    const row = await db
      .prepare("SELECT object_key FROM bug_reports WHERE id=?")
      .bind(match[1])
      .first();
    const object = row && (await env.REPORTS.get(row.object_key));
    if (!object) return json(404, { error: "报告不存在" });
    return new Response(request.method === "HEAD" ? null : object.body, {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ffvi-bug-${match[1]}.json"`,
        "Content-Length": String(object.size),
      },
    });
  }
  if (route !== "/api/reports") return json(404, { error: "接口不存在" });
  if (request.method !== "POST") return json(403, { error: "报告不提供公开读取" });
  if (request.headers.get("X-FFVI-Account") !== account)
    return json(403, { error: "身份已切换，请刷新此页；报告仍可下载" });
  const report = await readReport(request);
  const existing = await db
    .prepare("SELECT id FROM bug_reports WHERE owner=? AND submission=?")
    .bind(session.owner, report.submissionId)
    .first();
  if (existing) return json(200, { id: existing.id, duplicate: true });
  const now = Date.now();
  const window = Math.floor(now / 3600000);
  const quota = await db.batch([
    db.prepare("DELETE FROM report_limits WHERE window<?").bind(window - 24),
    db
      .prepare(
        "INSERT INTO report_limits VALUES (?,?,1) ON CONFLICT(owner,window) DO UPDATE SET count=count+1 RETURNING count",
      )
      .bind(session.owner, window),
  ]);
  if (quota[1].results[0].count > 10)
    return json(429, { error: "每个身份每小时最多发送 10 份报告，请稍后重试或下载文件" });
  const id = crypto.randomUUID();
  const key = `reports/${id}.json`;
  const content = JSON.stringify(report);
  const bytes = new TextEncoder().encode(content).byteLength;
  await env.REPORTS.put(key, content, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "private, no-store",
    },
  });
  try {
    const index = report.script?.lastInstruction;
    await db
      .prepare("INSERT INTO bug_reports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(
        id,
        session.owner,
        report.submissionId,
        now,
        report.createdAt,
        Number.isSafeInteger(report.map?.id) ? report.map.id : null,
        text(report.map?.name),
        text(index?.script || report.script?.story),
        Number.isSafeInteger(index?.index) ? index.index : null,
        report.description,
        bytes,
        key,
      )
      .run();
  } catch (error) {
    await env.REPORTS.delete(key);
    const raced = await db
      .prepare("SELECT id FROM bug_reports WHERE owner=? AND submission=?")
      .bind(session.owner, report.submissionId)
      .first();
    if (raced) return json(200, { id: raced.id, duplicate: true });
    throw error;
  }
  return json(201, { id });
}
