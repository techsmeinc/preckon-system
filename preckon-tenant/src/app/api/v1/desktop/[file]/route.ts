import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { route } from "@/lib/http";
import { requirePermission } from "@/lib/context";
import { errNotFound } from "@/lib/errors";
import { resolveBuild } from "@/lib/desktopBuilds";

// GET /desktop/{file} — the installer itself.
//
// Streamed, not read into memory: these are ~100 MB, and buffering one per
// concurrent download is how a workspace with ten new starters falls over on
// their first morning.
//
// The filename is validated in resolveBuild before it reaches the filesystem —
// see the three checks there. Nothing else in this route touches a path.
export const GET = route<{ file: string }>(async (_req, ctx, { file }) => {
  requirePermission(ctx, "artifact.read");

  const full = await resolveBuild(decodeURIComponent(file));
  if (!full) throw errNotFound("desktop build");

  const { size } = await stat(full);
  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(size),
      "content-disposition": `attachment; filename="${file.replace(/["\\]/g, "_")}"`,
      // An installer is immutable — a new build is a new filename — so it can be
      // cached hard. Private: this sits behind a session and must not be held by
      // a shared proxy where the next person gets it without one.
      "cache-control": "private, max-age=604800, immutable",
    },
  });
});
