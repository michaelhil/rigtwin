// Limits of the rigtwin server, in one place. The guards apply in deployed mode only (step-1 design,
// "D1 guards in step 1"); a local server has none. Values from PLAN-v7 D1 unless noted.
export const LIMITS = {
  /** PLAN-v7 D1 "Request size": a command body is at most 64 kB (Caddy enforces the same with request_body). */
  bodyBytes: 64 * 1024,
  /** PLAN-v7 D1 "Live connections": 6 live streams per visitor ... */
  streamsPerVisitor: 6,
  /** ... and 150 in all (PLAN-v7 D1 said 300; lowered after host check H14 of 2026-11-24, with streamBytesMax: at most
   *  150 × 0.5 MB = 75 MB in socket buffers, well under the host's TCP memory pressure threshold of about 240 MB). */
  streamsTotal: 150,
  /** Security review S7: one network block (IPv6 /48, IPv4 /24) holds at most 12 live streams (was 30; H14) ... */
  streamsPerBlock: 12,
  /** Security review M2: bytes queued for one live stream before it is closed as too slow (the browser reconnects and catches up). */
  streamQueueBytes: 1024 * 1024,
  /** Host check H14 (2026-11-24): a live stream is ended after it has been given this many bytes in all, whether or not its
   *  client reads (Linux took about 770 kB per non-reading stream into socket buffers, so the queue limit above never
   *  triggered and TCP memory passed its pressure threshold). The browser reconnects with since=<version> and gets only
   *  the entries it missed. A stream that only gets heartbeats and a few changes lasts for hours. */
  streamBytesMax: 512 * 1024,
  /** ... and its place still counts in the stream limits until its connection is gone, at most this long (above
   *  idleTimeoutS, after which Bun ends a connection that takes no more bytes). */
  streamDrainMs: 45_000,
  /** PLAN-v7 D1 "Live connections": a heartbeat comment on every stream every 15 s. */
  heartbeatMs: 15_000,
  /** PLAN-v7 D1 (implied by the heartbeat): Bun closes a connection idle longer than this; must stay above the heartbeat. */
  idleTimeoutS: 40,
  /** PLAN-v7 D1 "Edits; queries": 60 edits a minute per visitor (view commands count as edits) ... */
  editsPerMinutePerVisitor: 60,
  /** ... 50 edits a second in all ... */
  editsPerSecondTotal: 50,
  /** ... and 600 queries a minute per visitor (every other request under api/ counts as a query). */
  queriesPerMinutePerVisitor: 600,
  /** Security review S7: ... and makes at most 10 edits a second. */
  editsPerSecondPerBlock: 10,
  /** Security review S3 (R3b): answers "no viewer with that code" per visitor and minute before view commands are refused. */
  unknownSessionsPerMinutePerVisitor: 5,
  /** Security review S2: a request body must arrive within this time. */
  bodyTimeoutMs: 10_000,
  /** Security review S5: doc.json is written at most this often (a change is written at once when the last write is older;
   *  a stop by systemd or a release switch writes what is pending; a crash can lose the last fraction of a second). */
  saveEveryMs: 250,
  /** PLAN-v7 D1 "Disk": refuse writes when the data disk is nearly full: less than 5 % ... */
  diskMinFreeFraction: 0.05,
  /** ... or less than 200 MB free (step-1 design). */
  diskMinFreeBytes: 200 * 1024 * 1024,
  /** PLAN-v7 D1 / step-1 design: a stream more than this many entries behind gets a fresh snapshot (the history kept, doc.ts). */
  snapshotBehind: 200,
  /** Step-1 design, release watch: how often the deployed server looks where `current` points (it exits when it moved). */
  releaseWatchMs: 2_000,
  /** Step-1 design, after a stream drops: the reconnect delay the browser is told (the `retry:` field of the live channel). */
  retryMs: 2_000,
  /** Agent interface v2: a picture a browser sends back for `look {picture: true}`, as JPEG, at most this large (under
   *  Caddy's 64 KiB request limit for api/, so the host needs no change; the page lowers size and quality to fit) ... */
  pictureBytes: 60 * 1024,
  /** ... how long `look` waits for it before it answers without a picture ... */
  pictureWaitMs: 8_000,
  /** ... and how many pictures may be waited for at once, in all. */
  picturesPending: 20,
  /** Agent interface v2: MCP sessions remembered (the viewer code given to `look`); the least recently used is forgotten. */
  mcpSessions: 500,
};
export type Limits = typeof LIMITS;
