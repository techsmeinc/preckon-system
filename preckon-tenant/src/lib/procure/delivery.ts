// Delivery tracking: the gap between "ordered" and "on site".
//
// commitments.ts tracks the money — what was ordered, varied and paid. This
// tracks the material, and they are not the same thing. A package can be fully
// ordered, fully committed and completely unable to start, because the steel
// has a fourteen-week lead time and nobody counted backwards from the
// programme.
//
// ── WHY LEAD TIME IS A PROGRAMME PROBLEM, NOT A PROCUREMENT ONE ──────────────
//
// The date that matters is not the delivery date. It is the ORDER-BY date: the
// last day an order can be placed and still arrive before the activity needs
// it. That date is delivery-required minus lead time minus any approval cycle,
// and it is almost always earlier than anyone expects.
//
// Missing it is uniquely bad because it is silent. Nothing fails on the day it
// is missed. The consequence arrives weeks later as an activity that cannot
// start, by which time the only remedies are expensive: air freight, a
// different supplier at a worse rate, or acceleration elsewhere.
//
// So the primary output here is not "what has arrived". It is "what must be
// ordered this week, and what is already too late".
//
// ── APPROVALS ARE PART OF THE LEAD TIME ──────────────────────────────────────
//
// Long-lead items usually need a submittal approved before fabrication starts.
// A fourteen-week steel lead time with a three-week approval cycle is a
// seventeen-week commitment, and treating approval as free is how a procurement
// schedule that looks comfortable turns out not to be.

export type DeliveryState =
  | "not_ordered"
  | "awaiting_approval"
  | "ordered"
  | "in_production"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface DeliveryItem {
  id: string;
  package: string;
  description: string;
  /** Supplier lead time in days, from order to arrival on site. */
  leadTimeDays: number;
  /** Days needed to get a submittal approved before fabrication starts. */
  approvalDays?: number;
  /** Day the material is needed on site, from commencement. */
  requiredDay: number;
  state: DeliveryState;
  /** Day the order was actually placed, where it has been. */
  orderedDay?: number | null;
  /** Supplier's promised date, where given. */
  promisedDay?: number | null;
  /** Day it actually arrived. */
  deliveredDay?: number | null;
  /** Activity this feeds, so a slip can be traced to a programme effect. */
  activityKey?: string | null;
  /** Float on that activity — how much lateness the programme can absorb. */
  activityFloat?: number;
}

export type Urgency = "delivered" | "on_track" | "due_now" | "late_to_order" | "will_be_late" | "cancelled";

export interface DeliveryStatus {
  id: string;
  package: string;
  description: string;
  state: DeliveryState;
  /** Total commitment: approval plus manufacture plus transit. */
  totalLeadDays: number;
  /** Last day an order can be placed and still arrive in time. */
  orderByDay: number;
  /** Expected arrival, from the order date or the promise. */
  expectedDay: number | null;
  /** Days late against the required date. Negative is early. */
  slipDays: number | null;
  /** Slip the activity's float cannot absorb — the part that hits the programme. */
  criticalSlipDays: number;
  urgency: Urgency;
  activityKey: string | null;
  why: string;
  /** What to do about it, where there is something to do. */
  action: string | null;
}

export interface DeliveryReport {
  items: DeliveryStatus[];
  /** Must be ordered now or the programme moves. Soonest deadline first. */
  orderNow: DeliveryStatus[];
  /** Already past the order-by date. */
  lateToOrder: DeliveryStatus[];
  /** Ordered, but arriving after they are needed. */
  arrivingLate: DeliveryStatus[];
  /** Delivered against total. */
  deliveredCount: number;
  totalCount: number;
  /** Worst programme impact in days across everything. */
  worstSlipDays: number;
  warnings: string[];
  summary: string;
}

const SETTLED = new Set<DeliveryState>(["delivered", "cancelled"]);

/**
 * Status for one item at a given day.
 *
 * `today` is passed in rather than read from the clock: this has to be
 * reproducible in a test and re-runnable against a past data date when somebody
 * asks what the position was at the end of last month.
 */
export function statusOf(item: DeliveryItem, today: number): DeliveryStatus {
  const approval = Math.max(0, item.approvalDays ?? 0);
  const lead = Math.max(0, item.leadTimeDays);
  const totalLeadDays = approval + lead;
  const orderByDay = item.requiredDay - totalLeadDays;
  const float = Math.max(0, item.activityFloat ?? 0);

  const base = {
    id: item.id, package: item.package, description: item.description, state: item.state,
    totalLeadDays, orderByDay, activityKey: item.activityKey ?? null,
  };

  if (item.state === "cancelled") {
    return {
      ...base, expectedDay: null, slipDays: null, criticalSlipDays: 0, urgency: "cancelled",
      why: "Cancelled.", action: null,
    };
  }

  if (item.state === "delivered") {
    const delivered = item.deliveredDay ?? today;
    const slip = delivered - item.requiredDay;
    return {
      ...base, expectedDay: delivered, slipDays: slip, criticalSlipDays: 0,
      urgency: "delivered",
      why: slip > 0
        ? `Delivered on day ${delivered}, ${slip} day(s) after it was needed.`
        : `Delivered on day ${delivered}${slip < 0 ? `, ${-slip} day(s) early` : ", on time"}.`,
      action: null,
    };
  }

  /* Expected arrival.

     The supplier's promise beats the calculated date where one exists: a
     promise is information about this order, and the lead time is an average
     across all of them. Where nothing is ordered, arrival is measured from
     TODAY — ordering it now is the earliest anything can happen, and measuring
     from the order-by date would show an unordered item as on time right up
     until the day it becomes impossible. */
  const expectedDay =
    item.promisedDay != null ? item.promisedDay
    : item.orderedDay != null ? item.orderedDay + totalLeadDays
    : today + totalLeadDays;

  const slipDays = expectedDay - item.requiredDay;
  const criticalSlipDays = Math.max(0, slipDays - float);

  let urgency: Urgency;
  let why: string;
  let action: string | null = null;

  /* Awaiting approval counts as NOT YET COMMITTED.

     Fabrication has not started, so the full lead time still lies ahead and the
     order-by date still governs. Treating an approval in progress as "ordered"
     is how a long-lead item sits in a submittal queue for six weeks looking
     comfortable — the process has begun, but nothing is being made. */
  const notCommitted = item.orderedDay == null;
  const awaiting = item.state === "awaiting_approval";

  if (notCommitted) {
    const noun = awaiting ? "Awaiting approval" : "Not ordered";
    const clock = awaiting
      ? ` The ${approval}-day approval cycle is already inside the ${totalLeadDays}-day commitment, so nothing is being made yet.`
      : "";

    if (today > orderByDay) {
      urgency = "late_to_order";
      why = `${noun}, and the order-by date was day ${orderByDay} — ${today - orderByDay} day(s) ago. With a ${totalLeadDays}-day lead time it now arrives on day ${expectedDay}, ${slipDays} day(s) after it is needed.${clock}`;
      action = awaiting
        ? `Approval is on the critical path for this delivery. ${criticalSlipDays > 0 ? `Every day it waits is a day of programme delay — ${criticalSlipDays} already.` : "Float still absorbs the delay, but not for long."}`
        : criticalSlipDays > 0
          ? `Order today and expect ${criticalSlipDays} day(s) of programme delay, or find a shorter route: expedited supply, an alternative supplier, or a partial delivery to start the activity.`
          : "Order today. The activity's float absorbs the delay, but there is none left after this.";
    } else if (today >= orderByDay - 7) {
      urgency = "due_now";
      why = `Must be ordered by day ${orderByDay} — ${orderByDay - today} day(s) from now — for a ${totalLeadDays}-day lead time to land it by day ${item.requiredDay}.${clock}`;
      action = awaiting ? "Get the approval back this week." : "Place the order this week.";
    } else {
      urgency = "on_track";
      why = `${noun}. Order by day ${orderByDay}; ${orderByDay - today} day(s) of room.${clock}`;
    }
  } else if (slipDays > 0) {
    urgency = "will_be_late";
    why = item.promisedDay != null
      ? `Supplier promises day ${item.promisedDay}, which is ${slipDays} day(s) after it is needed.`
      : `Ordered on day ${item.orderedDay}; with a ${totalLeadDays}-day lead time it arrives on day ${expectedDay}, ${slipDays} day(s) late.`;
    action = criticalSlipDays > 0
      ? `${criticalSlipDays} day(s) of that cannot be absorbed by float. Expedite, or reschedule the activity now rather than on the day it cannot start.`
      : `Float absorbs this. Worth watching — the activity has ${float} day(s) and this uses ${slipDays}.`;
  } else {
    urgency = "on_track";
    why = `Due day ${expectedDay}, ${-slipDays} day(s) before it is needed.`;
  }

  return { ...base, expectedDay, slipDays, criticalSlipDays, urgency, why, action };
}

/**
 * The procurement schedule as a report.
 *
 * Ordered by what needs doing rather than by package or by date. A procurement
 * report that reads as a list of everything is a report nobody acts on; the
 * question is always "what do I have to do this week".
 */
export function deliveries(items: DeliveryItem[], today: number): DeliveryReport {
  const statuses = items.map((i) => statusOf(i, today));
  const warnings: string[] = [];

  const lateToOrder = statuses
    .filter((s) => s.urgency === "late_to_order")
    .sort((a, b) => b.criticalSlipDays - a.criticalSlipDays);
  const orderNow = statuses
    .filter((s) => s.urgency === "due_now")
    .sort((a, b) => a.orderByDay - b.orderByDay);
  const arrivingLate = statuses
    .filter((s) => s.urgency === "will_be_late")
    .sort((a, b) => b.criticalSlipDays - a.criticalSlipDays);

  const worstSlipDays = statuses.reduce((m, s) => Math.max(m, s.criticalSlipDays), 0);

  // An order-by date already in the past at the moment the item is created
  // means the programme was never achievable for it — worth saying, because it
  // is a planning failure rather than a procurement one.
  const impossible = items.filter((i) => {
    const s = statuses.find((x) => x.id === i.id)!;
    return !SETTLED.has(i.state) && s.orderByDay < 0;
  });
  if (impossible.length) {
    warnings.push(
      `${impossible.length} item(s) have an order-by date before the project started. Their lead times cannot be met by any order date — the programme, not the procurement, is what has to move.`,
    );
  }

  const noFloatData = items.filter((i) => i.activityKey && i.activityFloat == null);
  if (noFloatData.length) {
    warnings.push(
      `${noFloatData.length} item(s) name an activity but carry no float, so their delay is assumed to hit the programme in full. That is the safe assumption and may overstate the impact.`,
    );
  }

  return {
    items: statuses,
    orderNow,
    lateToOrder,
    arrivingLate,
    deliveredCount: statuses.filter((s) => s.urgency === "delivered").length,
    totalCount: statuses.filter((s) => s.urgency !== "cancelled").length,
    worstSlipDays,
    warnings,
    summary: summarise(lateToOrder.length, orderNow.length, arrivingLate.length, worstSlipDays, statuses.length),
  };
}

function summarise(late: number, now: number, arriving: number, worst: number, total: number): string {
  if (!total) return "Nothing to track.";
  if (!late && !now && !arriving) return `All ${total} item(s) on track.`;
  const parts: string[] = [];
  if (late) parts.push(`${late} item(s) past their order-by date`);
  if (now) parts.push(`${now} to order this week`);
  if (arriving) parts.push(`${arriving} ordered but arriving late`);
  const s = parts.join(", ");
  return worst > 0
    ? `${s}. Worst programme impact ${worst} day(s) after float.`
    : `${s}. Float absorbs all of it so far.`;
}

/**
 * Work backwards from the programme to the procurement dates.
 *
 * The calculation nobody does until it is too late, and the reason a package
 * that is "fully ordered" can still stop the job. Returned as a schedule so it
 * can sit beside the programme rather than in a separate spreadsheet that
 * disagrees with it.
 */
export function procurementSchedule(
  items: DeliveryItem[],
): { id: string; description: string; approveBy: number; orderBy: number; requiredDay: number; totalLeadDays: number }[] {
  return items
    .map((i) => {
      const approval = Math.max(0, i.approvalDays ?? 0);
      const totalLeadDays = approval + Math.max(0, i.leadTimeDays);
      return {
        id: i.id,
        description: i.description,
        // Approval has to finish before fabrication starts, so its deadline is
        // the order-by date plus the approval window — not the other way round.
        approveBy: i.requiredDay - Math.max(0, i.leadTimeDays),
        orderBy: i.requiredDay - totalLeadDays,
        requiredDay: i.requiredDay,
        totalLeadDays,
      };
    })
    .sort((a, b) => a.orderBy - b.orderBy);
}
