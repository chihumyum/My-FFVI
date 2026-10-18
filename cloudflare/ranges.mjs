// ASSETS.fetch currently returns complete files even for a Range request. Slice
// its stream after authentication, without buffering a music file in memory.
export async function rangeResponse(asset, request, knownSize) {
  const range = request.headers.get("range");
  if (
    !range ||
    asset.status !== 200 ||
    (!Number.isSafeInteger(knownSize) && !asset.headers.has("content-length"))
  )
    return asset;
  const ifRange = request.headers.get("if-range");
  if (
    ifRange &&
    ifRange !== asset.headers.get("etag") &&
    ifRange !== asset.headers.get("last-modified")
  )
    return asset;
  const size = knownSize ?? Number(asset.headers.get("content-length"));
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
  const end = match?.[1] && match?.[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  const headers = new Headers(asset.headers);
  headers.set("Accept-Ranges", "bytes");
  if (
    !match ||
    (!match[1] && !match[2]) ||
    (!match[1] && Number(match[2]) === 0) ||
    start >= size ||
    start > end
  ) {
    await asset.body?.cancel();
    headers.set("Content-Range", `bytes */${size}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  const reader = asset.body?.getReader();
  let position = 0;
  const stream =
    reader &&
    new ReadableStream({
      async pull(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          const from = Math.max(0, start - position),
            to = Math.min(value.length, end + 1 - position);
          position += value.length;
          if (to > from) controller.enqueue(value.subarray(from, to));
          if (position > end) {
            controller.close();
            await reader.cancel();
            return;
          }
          if (to > from) return;
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
  return new Response(stream || null, { status: 206, headers });
}
