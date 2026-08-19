// Transmittals.
//
// The transmittal is frequently the evidence in a dispute — it is how a
// contractor shows the consultant held the revised drawing on the 14th. These
// pin the rules that keep it honest: it carries revisions rather than documents,
// sending freezes it, recall never deletes, and status is derived from the
// acknowledgements that justify it.

import { describe, it, expect } from "vitest";
import {
  validateForSending, canSend, canEdit, editBlockedReason,
  derivedStatus, acknowledgementSummary, isOverdue,
  canRecall, recallBlockedReason, describe as describeTransmittal,
  type Transmittal, type TransmittalItem, type Recipient,
} from "@/lib/doc/transmittal";

const item = (n: string, rev: string, id = `${n}-${rev}`, state: TransmittalItem["revisionState"] = "current"): TransmittalItem =>
  ({ revisionId: id, documentNumber: n, revisionCode: rev, revisionState: state });

const rec = (party: string, requiresAck = true, ack: Recipient["ack"] = "pending"): Recipient =>
  ({ party, requiresAck, ack });

const draft = (over: Partial<Transmittal> = {}): Transmittal => ({
  id: "t1",
  number: "TR-0001",
  status: "draft",
  purpose: "For construction",
  items: [item("DXB01-ABC-ZZ-04-DR-M-0103", "C01")],
  recipients: [rec("ABC Consultants")],
  ...over,
});

describe("what a transmittal may be sent with", () => {
  it("accepts a well-formed draft", () => {
    expect(validateForSending(draft())).toEqual([]);
    expect(canSend(draft())).toBe(true);
  });

  it("refuses an empty transmittal", () => {
    expect(validateForSending(draft({ items: [] })).some((i) => /at least one document/i.test(i.message))).toBe(true);
  });

  it("refuses one with no recipients", () => {
    expect(validateForSending(draft({ recipients: [] })).some((i) => /at least one recipient/i.test(i.message))).toBe(true);
  });

  it("requires a purpose of issue", () => {
    /* Without it the recipient does not know whether they may review it, build
       from it, or only file it. */
    expect(validateForSending(draft({ purpose: "  " })).some((i) => /purpose of issue/i.test(i.message))).toBe(true);
  });

  it("refuses to transmit a draft revision", () => {
    /* Issuing work in progress is how unapproved design reaches site. If it is
       genuinely meant to go out it should be a real revision at a WIP
       suitability, not a draft. */
    const t = draft({ items: [item("DXB01-ABC-ZZ-04-DR-M-0103", "P01", "x", "draft")] });
    expect(validateForSending(t).some((i) => /still a draft/i.test(i.message))).toBe(true);
  });

  it("allows transmitting a superseded revision", () => {
    // Re-issuing a superseded revision is legitimate: a recipient lost their copy.
    const t = draft({ items: [item("DXB01-ABC-ZZ-04-DR-M-0103", "P01", "x", "superseded")] });
    expect(canSend(t)).toBe(true);
  });

  it("catches the same revision listed twice", () => {
    const t = draft({ items: [item("D-1", "A", "same"), item("D-1", "A", "same")] });
    expect(validateForSending(t).some((i) => /twice/i.test(i.message))).toBe(true);
  });

  it("catches one document at two different revisions", () => {
    /* Nearly always a mistake, and the recipient cannot tell which one
       governs. */
    const t = draft({ items: [item("D-1", "A"), item("D-1", "B")] });
    expect(validateForSending(t).some((i) => /more than one revision/i.test(i.message))).toBe(true);
  });

  it("catches a duplicated recipient", () => {
    const t = draft({ recipients: [rec("ABC"), rec("abc")] });
    expect(validateForSending(t).some((i) => /listed twice/i.test(i.message))).toBe(true);
  });

  it("reports every problem at once", () => {
    const t = draft({ items: [], recipients: [], purpose: "" });
    expect(validateForSending(t).length).toBeGreaterThanOrEqual(3);
  });

  it("refuses to send something already sent", () => {
    expect(canSend(draft({ status: "sent" }))).toBe(false);
  });
});

describe("sending freezes it", () => {
  it("allows editing a draft", () => {
    expect(canEdit(draft())).toBe(true);
  });

  it("blocks editing once sent", () => {
    /* The recipients hold copies. A register that disagrees with the copy on
       someone else's desk is worse than no register. */
    const t = draft({ status: "sent" });
    expect(canEdit(t)).toBe(false);
    expect(editBlockedReason(t)).toMatch(/recipients hold copies/i);
  });

  it("blocks editing a recalled transmittal", () => {
    expect(editBlockedReason(draft({ status: "recalled" }))).toMatch(/stays as a record/i);
  });
});

describe("status follows the acknowledgements", () => {
  it("stays sent while any are outstanding", () => {
    const t = draft({ status: "sent", recipients: [rec("A", true, "acknowledged"), rec("B")] });
    expect(derivedStatus(t)).toBe("sent");
  });

  it("becomes acknowledged when everyone who owed one has given it", () => {
    const t = draft({ status: "sent", recipients: [rec("A", true, "acknowledged"), rec("B", true, "acknowledged")] });
    expect(derivedStatus(t)).toBe("acknowledged");
  });

  it("ignores recipients who never owed an acknowledgement", () => {
    // A copied-in party does not hold the transmittal open.
    const t = draft({ status: "sent", recipients: [rec("A", true, "acknowledged"), rec("CC", false)] });
    expect(derivedStatus(t)).toBe("acknowledged");
  });

  it("is sent when nobody owes one", () => {
    const t = draft({ status: "sent", recipients: [rec("CC", false)] });
    expect(derivedStatus(t)).toBe("sent");
  });

  it("does not un-close a closed transmittal", () => {
    /* Closing is a decision somebody made. A late acknowledgement does not
       reopen it. */
    const t = draft({ status: "closed", recipients: [rec("A")] });
    expect(derivedStatus(t)).toBe("closed");
  });

  it("leaves a recalled transmittal recalled", () => {
    const t = draft({ status: "recalled", recipients: [rec("A", true, "acknowledged")] });
    expect(derivedStatus(t)).toBe("recalled");
  });

  it("does not treat a decline as an acknowledgement", () => {
    const t = draft({ status: "sent", recipients: [rec("A", true, "declined")] });
    expect(derivedStatus(t)).toBe("sent");
  });
});

describe("who still owes a response", () => {
  it("names them", () => {
    const t = draft({ status: "sent", recipients: [rec("A", true, "acknowledged"), rec("B"), rec("C")] });
    const s = acknowledgementSummary(t);
    expect(s.outstanding).toEqual(["B", "C"]);
    expect(s.summary).toMatch(/1 of 3 acknowledged; 2 outstanding/);
  });

  it("counts declines separately from pending", () => {
    const t = draft({ status: "sent", recipients: [rec("A", true, "declined"), rec("B")] });
    const s = acknowledgementSummary(t);
    expect(s.declined).toBe(1);
    expect(s.pending).toBe(1);
  });

  it("says so plainly when none is required", () => {
    expect(acknowledgementSummary(draft({ recipients: [rec("CC", false)] })).summary)
      .toMatch(/no acknowledgement required/i);
  });
});

describe("overdue", () => {
  const past = "2020-01-01T00:00:00Z";
  const future = "2999-01-01T00:00:00Z";

  it("is overdue when the date has passed with acknowledgements outstanding", () => {
    const t = draft({ status: "sent", requiredResponseAt: past, recipients: [rec("A")] });
    expect(isOverdue(t)).toBe(true);
  });

  it("is not overdue before the date", () => {
    const t = draft({ status: "sent", requiredResponseAt: future, recipients: [rec("A")] });
    expect(isOverdue(t)).toBe(false);
  });

  it("is not overdue once everyone has acknowledged", () => {
    const t = draft({ status: "sent", requiredResponseAt: past, recipients: [rec("A", true, "acknowledged")] });
    expect(isOverdue(t)).toBe(false);
  });

  it("is not overdue with no response date set", () => {
    expect(isOverdue(draft({ status: "sent", recipients: [rec("A")] }))).toBe(false);
  });

  it("survives an unparseable date rather than throwing", () => {
    const t = draft({ status: "sent", requiredResponseAt: "not a date", recipients: [rec("A")] });
    expect(isOverdue(t)).toBe(false);
  });
});

describe("recall", () => {
  it("is allowed on a sent transmittal", () => {
    expect(canRecall(draft({ status: "sent" }))).toBe(true);
  });

  it("is refused on a draft, which was never issued", () => {
    expect(recallBlockedReason(draft())).toMatch(/nothing to recall/i);
  });

  it("cannot happen twice", () => {
    expect(recallBlockedReason(draft({ status: "recalled" }))).toMatch(/already been recalled/i);
  });

  it("is refused on a closed record", () => {
    expect(recallBlockedReason(draft({ status: "closed" }))).toMatch(/raise a new one/i);
  });
});

describe("register line", () => {
  it("reads as one line", () => {
    expect(describeTransmittal(draft({ status: "sent" })))
      .toBe("TR-0001 — 1 document to ABC Consultants (sent)");
  });

  it("counts multiples", () => {
    const t = draft({ status: "sent", items: [item("D-1", "A"), item("D-2", "A")], recipients: [rec("A"), rec("B")] });
    expect(describeTransmittal(t)).toMatch(/2 documents to 2 recipients/);
  });
});
