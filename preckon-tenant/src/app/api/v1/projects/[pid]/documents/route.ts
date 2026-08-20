import { z } from "zod";
import { route, ok } from "@/lib/http";
import { requirePermission, requireProject } from "@/lib/context";
import { actorFromCtx, useCase } from "@/lib/usecase";
import { listRegister, registerDocument, listSchemes, resolveScheme } from "@/lib/doc/store";
import { validateValues, exampleNumber } from "@/lib/doc/numbering";

// The controlled document register.
//
// Registering allocates a number and creates the record. A file is deliberately
// NOT required: a register whose rows only appear once the document has arrived
// cannot tell anyone what is late, which is most of what a register is for.

const Register = z.object({
  title: z.string().min(1).max(500),
  scheme_id: z.string().max(64).nullish(),
  /** Segment values for the number. The sequence part is allocated, not supplied. */
  segments: z.record(z.string(), z.string()).default({}),
  /** Adopt an existing number instead of allocating one (legacy import). */
  document_number: z.string().max(255).optional(),
  doc_type: z.string().max(64).nullish(),
  discipline: z.string().max(64).nullish(),
  originator: z.string().max(128).nullish(),
  level: z.string().max(32).nullish(),
  zone: z.string().max(64).nullish(),
  package: z.string().max(128).nullish(),
  confidentiality: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
  required_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export const GET = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.read");
  await requireProject(ctx, pid);

  const url = new URL(req.url);
  const rows = await listRegister(ctx.tenantId, pid, {
    discipline: url.searchParams.get("discipline") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    search: url.searchParams.get("q") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 500),
  });

  const schemes = await listSchemes(ctx.tenantId, pid);

  return ok({
    documents: rows,
    // The register screen needs the scheme to render the registration form, and
    // an example so the person can see the shape before they fill it in.
    schemes: schemes.map((s) => ({
      id: s.id, key: s.key, name: s.name, separator: s.separator,
      segments: s.segments, is_default: s.isDefault, example: exampleNumber(s),
    })),
  });
});

export const POST = route<{ pid: string }>(async (req, ctx, { pid }) => {
  requirePermission(ctx, "artifact.edit");
  await requireProject(ctx, pid);
  const b = Register.parse(await req.json());

  const scheme = await resolveScheme(ctx.tenantId, pid, b.scheme_id ?? null);

  // Validate before allocating. Allocating a sequence number and then failing
  // validation burns a number for nothing, and gaps in a register are questions
  // somebody has to answer later.
  if (!b.document_number) {
    const seg = scheme.segments.find((s) => s.kind === "sequence");
    const probe = { ...b.segments, ...(seg ? { [seg.key]: "1" } : {}) };
    const issues = validateValues(scheme, probe);
    if (issues.length) {
      return ok({ error: "invalid_number", issues }, 422);
    }
  }

  const result = await useCase(actorFromCtx(ctx), async (_conn, audit) => {
    const created = await registerDocument(ctx.tenantId, pid, {
      title: b.title,
      schemeId: b.scheme_id ?? null,
      segments: b.segments,
      documentNumber: b.document_number,
      docType: b.doc_type ?? null,
      discipline: b.discipline ?? null,
      originator: b.originator ?? null,
      level: b.level ?? null,
      zone: b.zone ?? null,
      package: b.package ?? null,
      confidentiality: b.confidentiality,
      requiredBy: b.required_by ?? null,
      userId: ctx.user.id,
    });

    audit({
      action: "document.register",
      targetKind: "document",
      targetId: created.id,
      projectId: pid,
      summary: { document_number: created.documentNumber, title: b.title },
    });

    return created;
  });

  return ok({ id: result.id, document_number: result.documentNumber }, 201);
});
