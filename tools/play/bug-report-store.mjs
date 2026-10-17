import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const MAX_BUG_REPORT_BYTES = 8 * 1024 * 1024;
const project = path.resolve(import.meta.dirname, "../..");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const failure = (status, message) => Object.assign(new Error(message), { status });
const loopback = (address) =>
  address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";

function sameOrigin(req) {
  if (!loopback(req.socket?.remoteAddress)) return false;
  const host = req.headers.host,
    origin = req.headers.origin;
  if (typeof host !== "string" || typeof origin !== "string") return false;
  try {
    const expected = new URL(`${req.socket?.encrypted ? "https" : "http"}://${host}`),
      supplied = new URL(origin);
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname) &&
      supplied.origin === expected.origin &&
      supplied.pathname === "/" &&
      !supplied.search &&
      !supplied.hash &&
      !supplied.username &&
      !supplied.password &&
      (!req.headers["sec-fetch-site"] || req.headers["sec-fetch-site"] === "same-origin")
    );
  } catch {
    return false;
  }
}

function readBody(req, maximum) {
  const length = req.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    req.resume();
    throw failure(Number(length) > maximum ? 413 : 400, "Invalid or oversized report body");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      req.off("data", data);
      req.off("end", end);
      req.off("error", error);
      req.off("aborted", aborted);
    };
    const error = () => {
      cleanup();
      reject(failure(400, "Report request was interrupted"));
    };
    const aborted = error;
    const data = (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maximum) {
        cleanup();
        req.resume();
        reject(failure(413, `Report body exceeds ${maximum} bytes`));
      } else chunks.push(Buffer.from(chunk));
    };
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    req.on("data", data);
    req.once("end", end);
    req.once("error", error);
    req.once("aborted", aborted);
  });
}

function screenshotBytes(report) {
  if (!object(report) || report.schema !== "ffvi-bug-report" || report.version !== 1)
    throw failure(400, "Expected ffvi-bug-report schema version 1");
  if (typeof report.createdAt !== "string" || !Number.isFinite(Date.parse(report.createdAt)))
    throw failure(400, "Report createdAt must be a valid timestamp");
  for (const name of ["map", "script", "player", "actors", "party", "events"])
    if (!Object.hasOwn(report, name)) throw failure(400, `Report is missing ${name}`);
  if (report.player !== null && !object(report.player))
    throw failure(400, "Report player must be an object or null before a game starts");
  for (const name of ["actors", "events"])
    if (!Array.isArray(report[name])) throw failure(400, `Report ${name} must be an array`);
  if (!Array.isArray(report.party) && !object(report.party))
    throw failure(400, "Report party must be an array or object");
  const screenshot = report.screenshot,
    prefix = "data:image/png;base64,";
  if (
    !object(screenshot) ||
    screenshot.mimeType !== "image/png" ||
    typeof screenshot.dataURL !== "string" ||
    !screenshot.dataURL.startsWith(prefix)
  )
    throw failure(400, "Report screenshot must be a PNG base64 data URL");
  const encoded = screenshot.dataURL.slice(prefix.length);
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw failure(400, "Invalid screenshot base64 data");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || !bytes.subarray(0, 8).equals(pngSignature))
    throw failure(400, "Screenshot PNG signature is invalid");
  return bytes;
}

export function createBugReportMiddleware({
  directory = path.join(project, "bug-reports"),
  maxBytes = MAX_BUG_REPORT_BYTES,
  onError = console.error,
} = {}) {
  const output = path.resolve(directory);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error("Invalid report size limit");
  return async (req, res, next) => {
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      return next();
    }
    if (pathname !== "/__bug-reports") return next();
    const json = (status, value) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        throw failure(405, "Only POST is supported");
      }
      if (!sameOrigin(req)) throw failure(403, "Bug reports require a local same-origin request");
      if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json")
        throw failure(415, "Bug report Content-Type must be application/json");
      let report;
      try {
        report = JSON.parse(await readBody(req, maxBytes));
      } catch (error) {
        if (error.status) throw error;
        throw failure(400, "Invalid JSON report body");
      }
      const screenshot = screenshotBytes(report),
        name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
        folder = path.join(output, name);
      await mkdir(output, { recursive: true });
      await mkdir(folder);
      try {
        await Promise.all([
          writeFile(path.join(folder, "report.json"), JSON.stringify(report, null, 2) + "\n", {
            flag: "wx",
          }),
          writeFile(path.join(folder, "screenshot.png"), screenshot, { flag: "wx" }),
        ]);
      } catch (error) {
        await rm(folder, { recursive: true, force: true });
        throw error;
      }
      const relative = `bug-reports/${name}`;
      json(201, {
        directory: relative,
        json: `${relative}/report.json`,
        screenshot: `${relative}/screenshot.png`,
      });
    } catch (error) {
      req.resume();
      if (!error.status) onError(error);
      json(error.status || 500, {
        error: error.status ? error.message : "Could not save the local bug report",
      });
    }
  };
}
