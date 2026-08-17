// Structured logging, and what must never reach a log.
//
// Two properties. The first is that a user-visible failure carries an id that
// finds the log line — without it, "it said something went wrong" is unanswerable
// and the whole exercise is decoration.
//
// The second is redaction, and it is the one worth being careful about. A
// construction project's artifacts are the customer's commercial position: rates,
// margins, subcontractor prices. A log aggregator is not where that belongs, and
// a leak there is quiet, permanent and discovered by somebody else.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  currentRequestId, enrichContext, logFailure, newRequestId, redact,
  requestIdFrom, runWithContext, log,
} from "@/lib/log";

const headers = (h: Record<string, string>) => ({ headers: { get: (n: string) => h[n] ?? null } });

describe("request ids", () => {
  it("is short enough to read down a phone line", () => {
    const id = newRequestId();
    expect(id).toMatch(/^rq_[a-f0-9]{12}$/);
  });

  it("is different every time", () => {
    expect(new Set(Array.from({ length: 200 }, newRequestId)).size).toBe(200);
  });

  it("honours an inbound id so a trace spans services", () => {
    expect(requestIdFrom(headers({ "x-request-id": "rq_abc123def456" }))).toBe("rq_abc123def456");
  });

  it("refuses one that is not ours", () => {
    /* An id echoed straight from a header is attacker-controlled. Accepting
       anything would let a caller forge another request's trace, or poison the
       logs with a value chosen to break whatever reads them. */
    for (const bad of ["../../etc", "<script>", "x".repeat(200), "", "abc", "rq_"]) {
      expect(requestIdFrom(headers({ "x-request-id": bad })), bad).toMatch(/^rq_[a-f0-9]{12}$/);
    }
  });

  it("makes one up when none is offered", () => {
    expect(requestIdFrom(headers({}))).toMatch(/^rq_/);
  });
});

describe("the ambient context", () => {
  it("is readable anywhere inside the request", async () => {
    await runWithContext({ requestId: "rq_test000001" }, async () => {
      await Promise.resolve();
      expect(currentRequestId()).toBe("rq_test000001");
    });
  });

  it("does not leak between requests", () => {
    runWithContext({ requestId: "rq_aaaaaaaaaaaa" }, () => {});
    expect(currentRequestId()).toBeUndefined();
  });

  it("can be enriched once the user is known", () => {
    runWithContext({ requestId: "rq_bbbbbbbbbbbb" }, () => {
      enrichContext({ tenantId: "t1", userId: "u1" });
      expect(currentRequestId()).toBe("rq_bbbbbbbbbbbb");
    });
  });
});

describe("redaction", () => {
  it("strips anything that looks like a credential, by key", () => {
    // By key name rather than by recognising a secret in a value: a token is
    // only identifiable as a token by where it sits.
    const out = redact({
      password: "hunter2",
      passwordHash: "$2b$...",
      ANTHROPIC_API_KEY: "sk-ant-real",
      authorization: "Bearer abc",
      cookie: "session=1",
      privateKey: "-----BEGIN",
      client_secret: "s",
    }) as Record<string, string>;
    for (const v of Object.values(out)) expect(v).toBe("[redacted]");
  });

  it("keeps identifiers, which are the point of logging at all", () => {
    const out = redact({ tenantId: "t-123", projectId: "p-456", jobId: "j-789" }) as Record<string, string>;
    expect(out).toEqual({ tenantId: "t-123", projectId: "p-456", jobId: "j-789" });
  });

  it("reduces customer content to its shape", () => {
    // "18 doors" is the useful part. The doors are the customer's drawing.
    const out = redact({
      payload: { rate: 1234, supplier: "Acme" },
      elements: [1, 2, 3],
      svg: "<svg>…</svg>",
    }) as Record<string, string>;
    expect(out.payload).toBe("{2 keys}");
    expect(out.elements).toBe("[3 items]");
    expect(out.svg).toMatch(/^\[\d+ chars\]$/);
    expect(JSON.stringify(out)).not.toContain("Acme");
    expect(JSON.stringify(out)).not.toContain("1234");
  });

  it("summarises a long array rather than printing it", () => {
    expect(redact({ ids: Array.from({ length: 500 }, (_, i) => `e${i}`) })).toEqual({ ids: "[500 items]" });
  });

  it("truncates a long string that arrived by accident", () => {
    const out = redact({ note: "x".repeat(5000) }) as Record<string, string>;
    expect(out.note.length).toBeLessThan(340);
    expect(out.note).toContain("5000 chars");
  });

  it("stops descending rather than walking a deep object forever", () => {
    let deep: any = "bottom";
    for (let i = 0; i < 30; i++) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain("[deep]");
  });

  it("redacts inside nested structures too", () => {
    const out = JSON.stringify(redact({ a: { b: { token: "secret-value" } } }));
    expect(out).not.toContain("secret-value");
    expect(out).toContain("[redacted]");
  });
});

describe("emitting", () => {
  let lines: string[] = [];
  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "log").mockImplementation((s: any) => void lines.push(String(s)));
    vi.spyOn(console, "error").mockImplementation((s: any) => void lines.push(String(s)));
    vi.spyOn(console, "warn").mockImplementation((s: any) => void lines.push(String(s)));
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON object per line", () => {
    // Machine-readable because the point is to filter a day of traffic by
    // request id, which nobody does by eye.
    log("info", "hello", { n: 1 });
    expect(() => JSON.parse(lines[0])).not.toThrow();
    expect(JSON.parse(lines[0])).toMatchObject({ level: "info", msg: "hello", n: 1 });
  });

  it("stamps every line with the request that produced it", () => {
    runWithContext({ requestId: "rq_cccccccccccc", tenantId: "t1", route: "POST /x" }, () => {
      log("info", "in context");
    });
    expect(JSON.parse(lines[0])).toMatchObject({ rq: "rq_cccccccccccc", tenant: "t1", route: "POST /x" });
  });

  it("redacts fields on the way out, not only when asked", () => {
    log("info", "with secret", { apiKey: "sk-ant-live", tenantId: "t1" });
    expect(lines[0]).not.toContain("sk-ant-live");
    expect(lines[0]).toContain("t1");
  });

  it("returns the id a failure should be reported under", () => {
    runWithContext({ requestId: "rq_dddddddddddd" }, () => {
      const id = logFailure("boom", new Error("kaboom"), { where: "test" });
      expect(id).toBe("rq_dddddddddddd");
    });
  });

  it("logs a stack, trimmed to the frames that matter", () => {
    runWithContext({ requestId: "rq_eeeeeeeeeeee" }, () => {
      logFailure("boom", new Error("kaboom"));
    });
    const line = JSON.parse(lines[0]);
    expect(line.err).toBe("kaboom");
    // A full stack in a structured field is what makes people stop reading logs.
    expect(String(line.stack).split(" | ").length).toBeLessThanOrEqual(6);
  });

  it("survives a thrown value that is not an Error", () => {
    runWithContext({ requestId: "rq_ffffffffffff" }, () => {
      expect(() => logFailure("boom", "just a string")).not.toThrow();
    });
    expect(JSON.parse(lines[0]).err).toBe("just a string");
  });
});
