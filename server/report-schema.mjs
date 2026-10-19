// Shared diagnostic privacy rules; never copy browser storage, cookies or credentials.
const secretField =
  /^(?:authorization|cookie|set-cookie|password|recoveryKey|recovery_key|accessToken|refreshToken|sessionToken|token)$/i;
const recoveryKey = /ffvi_[a-f0-9]{64}/gi;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const MAX_REPORT_BYTES = 8 * 1024 * 1024;

export function privateReportValue(value, depth = 0) {
  if (depth > 32) return "[nested diagnostic truncated]";
  if (typeof value === "string")
    return value
      .replace(recoveryKey, "[recovery key removed]")
      .replace(/\b(?:cookie|set-cookie|authorization):[^\r\n]+/gi, "[credential header removed]");
  if (Array.isArray(value)) return value.map((item) => privateReportValue(item, depth + 1));
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      secretField.test(key) ? "[credential removed]" : privateReportValue(item, depth + 1),
    ]),
  );
}

export function validateSubmittedReport(input) {
  if (!object(input) || input.schema !== "ffvi-bug-report" || input.version !== 1)
    throw fail("报告格式不正确");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      input.submissionId,
    )
  )
    throw fail("报告编号不正确");
  if (typeof input.createdAt !== "string" || !Number.isFinite(Date.parse(input.createdAt)))
    throw fail("报告时间不正确");
  if (
    typeof input.description !== "string" ||
    !input.description.trim() ||
    input.description.length > 6000
  )
    throw fail("请填写问题说明，最多 6000 字");
  for (const name of ["map", "script", "player"])
    if (input[name] !== null && !object(input[name])) throw fail(`报告缺少 ${name}`);
  for (const name of ["actors", "party", "events"])
    if (!Array.isArray(input[name])) throw fail(`报告缺少 ${name}`);
  if (input.events.length > 20) throw fail("报告只能包含最近 20 条事件");
  const screenshot = input.screenshot;
  const prefix = "data:image/png;base64,";
  if (
    !object(screenshot) ||
    screenshot.mimeType !== "image/png" ||
    typeof screenshot.dataURL !== "string" ||
    !screenshot.dataURL.startsWith(prefix)
  )
    throw fail("报告必须包含已捕获的 PNG 截图");
  const encoded = screenshot.dataURL.slice(prefix.length);
  if (
    !encoded ||
    encoded.length % 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    encoded.length > 7 * 1024 * 1024
  )
    throw fail("报告截图过大或格式不正确");
  let bytes;
  try {
    bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    throw fail("截图编码不正确");
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 33 ||
    signature.some((byte, i) => bytes[i] !== byte) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  )
    throw fail("截图不是有效的 PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    !view.getUint32(16) ||
    !view.getUint32(20) ||
    view.getUint32(16) > 8192 ||
    view.getUint32(20) > 8192
  )
    throw fail("截图尺寸不正确");
  const report = privateReportValue(input);
  // Only a path is useful here. Search/hash may contain user-provided secrets.
  if (report.location) {
    try {
      const location = new URL(report.location);
      report.location = location.origin + location.pathname;
    } catch {
      report.location = null;
    }
  }
  report.description = report.description.trim();
  return report;
}
