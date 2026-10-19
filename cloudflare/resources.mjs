// Only immutable exported files belong here. No save, identity or admin routes.
export async function serveResource(request, bucket, { headers: security, publicSite, ctx } = {}) {
  const key = decodeURIComponent(new URL(request.url).pathname).slice("/resources/".length);
  if (
    !/^(data|audio|atlases|previews|fonts)\//.test(key) ||
    key.split("/").some((p) => p.startsWith(".") || p.includes("\\"))
  )
    return new Response(null, { status: 404, headers: security });
  if (!bucket) return new Response("资源存储未配置", { status: 503, headers: security });
  const cache = publicSite && globalThis.caches?.default;
  if (cache && request.method === "GET" && !request.headers.has("range")) {
    const cached = await cache.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set(
        "Access-Control-Expose-Headers",
        "Content-Length, Content-Range, ETag, Accept-Ranges",
      );
      return new Response(cached.body, { status: cached.status, headers });
    }
  }
  let range;
  const metadata =
    request.method === "HEAD" || request.headers.has("range") ? await bucket.head(key) : null;
  if ((request.method === "HEAD" || request.headers.has("range")) && !metadata)
    return new Response(null, { status: 404, headers: security });
  const ifRange = request.headers.get("if-range");
  if (
    request.headers.has("range") &&
    (!ifRange || ifRange === metadata.httpEtag || ifRange === metadata.uploaded.toUTCString())
  ) {
    const value = request.headers.get("range").match(/^bytes=(\d*)-(\d*)$/);
    const start = value?.[1] ? Number(value[1]) : Math.max(0, metadata.size - Number(value?.[2]));
    const end =
      value?.[1] && value?.[2] ? Math.min(metadata.size - 1, Number(value[2])) : metadata.size - 1;
    if (
      !value ||
      (!value[1] && !value[2]) ||
      (!value[1] && Number(value[2]) === 0) ||
      !Number.isSafeInteger(start) ||
      start >= metadata.size ||
      start > end
    )
      return new Response(null, {
        status: 416,
        headers: {
          ...security,
          "Content-Range": `bytes */${metadata.size}`,
          "Content-Length": "0",
        },
      });
    range = { offset: start, length: end - start + 1 };
  }
  const object =
    request.method === "HEAD" ? metadata : await bucket.get(key, range ? { range } : {});
  if (!object) return new Response(null, { status: 404, headers: security });
  const headers = new Headers(security);
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set(
    "Cache-Control",
    publicSite ? "public, max-age=31536000, immutable" : "private, no-cache",
  );
  if (publicSite) {
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, ETag, Accept-Ranges",
    );
  }
  headers.set("Content-Length", String(range?.length ?? object.size));
  if (range)
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
    );
  const response = new Response(request.method === "HEAD" ? null : object.body, {
    status: range ? 206 : 200,
    headers,
  });
  if (cache && ctx && request.method === "GET" && !range)
    ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}
