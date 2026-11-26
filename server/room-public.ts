// Mount the independent public room API behind the existing loopback proxy. The service
// reads only the catalog packaged with this release and writes its own room database.
import { statfsSync } from "node:fs";
import { join } from "node:path";
import { ROOM_SCHEMA } from "../shared/room.ts";
import { LIMITS } from "./limits.ts";
import { createRoomApi } from "./room-api.ts";
import { openPublicRoomLibrary } from "./room-public-library.ts";
import { blockKey, LOCAL_HOSTS, RateWindow, startServer, visitorKey, type StreamPlace } from "./server.ts";

const prefix = "/api/room";
const fail = (status: number, code: string, message: string) =>
  Response.json({ ok: false, error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

startServer(({ release, dataDir, mode, revision }) => {
  const roomData = join(dataDir, "rooms");
  const { catalog, files } = openPublicRoomLibrary(release, roomData);
  const api = createRoomApi({ dataDir: roomData, catalog, publicMode: true, standardsPath: join(release, "server", "standards", "workstation-screening.md") });
  const reads = new RateWindow(LIMITS.queriesPerMinutePerVisitor, 60_000);
  const writes = new RateWindow(LIMITS.editsPerMinutePerVisitor, 60_000);
  const blockWrites = new RateWindow(LIMITS.editsPerSecondPerBlock, 1_000);
  const allWrites = new RateWindow(LIMITS.editsPerSecondTotal, 1_000);
  const creates = new RateWindow(LIMITS.workspacesPerHourPerVisitor, 3_600_000);
  const blockCreates = new RateWindow(LIMITS.workspacesPerHourPerBlock, 3_600_000);
  const allCreates = new RateWindow(LIMITS.workspacesPerDayTotal, 86_400_000);
  const windows = [reads, writes, blockWrites, allWrites, creates, blockCreates, allCreates];
  const sweep = setInterval(() => windows.forEach(w => w.sweep()), 60_000);
  const streams = new Set<StreamPlace>();

  return {
    streamPlaces: () => streams,
    close() { clearInterval(sweep); api.close(); },
    async fetch(req, ip, stationStreams) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith(prefix + "/") && url.pathname !== prefix) return undefined;
      if (mode === "local" && !LOCAL_HOSTS.test(req.headers.get("host") ?? ""))
        return fail(403, "host", "Use the loopback address of the preview.");
      // Caddy terminates TLS, preserves Host, and sets the original scheme. The service binds loopback.
      if (req.headers.get("x-forwarded-proto") === "https") url.protocol = "https:";
      if (req.headers.has("origin") && req.headers.get("origin") !== url.origin)
        return fail(403, "origin", "Cross-origin room request refused.");
      if (url.pathname.startsWith(prefix + "/library/")) {
        if (!["GET", "HEAD"].includes(req.method)) return new Response(null, {status: 405, headers: {allow: "GET, HEAD"}});
        const asset = files.get(url.pathname);
        if (!asset) return new Response("Unknown edition file", {status: 404});
        const file = Bun.file(asset);
        return new Response(req.method === "HEAD" ? null : file, { headers: {
          "content-type": file.type || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable",
          "content-length": String(file.size),
        } });
      }
      url.pathname = "/api" + url.pathname.slice(prefix.length);
      const path = url.pathname.replace(/\/$/, "");
      const visitor = visitorKey(ip, req.headers.get("x-forwarded-for")), block = blockKey(visitor);
      if (req.method === "GET" || req.method === "HEAD") {
        if (!reads.hit(visitor)) return fail(429, "rate_limited", "Too many reads. Try again in a minute.");
        if (path === "/api/health")
          return Response.json({ ok: true, revision, mode, format: ROOM_SCHEMA }, { headers: { "cache-control": "no-store" } });
      } else {
        if (!writes.hit(visitor) || !blockWrites.hit(block) || !allWrites.hit("*"))
          return fail(429, "rate_limited", "Too many writes. Try again later.");
        if (path === "/api/workspaces" && req.method === "POST" && (!creates.hit(visitor) || !blockCreates.hit(block) || !allCreates.hit("*")))
          return fail(429, "rate_limited", "The room creation limit has been reached. Try again later.");
        const disk = statfsSync(roomData);
        if (disk.bavail * disk.bsize < LIMITS.diskMinFreeBytes || disk.bavail / disk.blocks < LIMITS.diskMinFreeFraction)
          return fail(507, "disk_low", "The service has insufficient free disk space.");
      }
      const inner = new Request(url, req);
      if (req.method !== "GET" || !path.endsWith("/live")) return api.fetch(inner);
      const places = [...stationStreams(), ...streams];
      if (places.length >= LIMITS.streamsTotal) return fail(503, "too_many_streams", "The live connection limit has been reached.");
      if (places.filter(p => p.visitor === visitor).length >= LIMITS.streamsPerVisitor || places.filter(p => p.block === block).length >= LIMITS.streamsPerBlock)
        return fail(429, "too_many_streams", "Close another viewer before opening a live connection.");
      const place = { visitor, block };
      streams.add(place);
      try {
        const response = await api.fetch(inner);
        if (!response.ok || !response.body) { streams.delete(place); return response; }
        const reader = response.body.getReader();
        const free = () => { streams.delete(place); req.signal.removeEventListener("abort", cancel); };
        const cancel = () => { free(); void reader.cancel().catch(() => {}); };
        req.signal.addEventListener("abort", cancel, { once: true });
        if (req.signal.aborted) cancel();
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { value, done } = await reader.read();
              if (done) { free(); controller.close(); return; }
              controller.enqueue(value);
              sent += value.byteLength;
              if (sent >= LIMITS.streamBytesMax) {
                await reader.cancel();
                controller.close();
                setTimeout(free, LIMITS.streamDrainMs).unref();
              }
            } catch (error) { free(); controller.error(error); }
          },
          cancel,
        });
        return new Response(body, { headers: response.headers });
      } catch (error) { streams.delete(place); throw error; }
    },
  };
});
