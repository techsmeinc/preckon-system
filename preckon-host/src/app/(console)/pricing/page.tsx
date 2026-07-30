"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  useApi,
  unwrap,
  errMessage,
  useToast,
  useCan,
  fmtMoney,
  currencyMinor,
  StatusChip,
  Drawer,
  Field,
  Segmented,
  CURRENCIES,
  Skeleton,
  ErrorBox,
  EmptyState,
} from "../_ui";

interface PriceRow {
  currency_code: string;
  interval?: string;
  amount_minor: number;
}
interface EditionPricing {
  id: string;
  key: string;
  name: string;
  status?: string;
  is_public?: boolean;
  prices?: PriceRow[];
}
interface UsageRate {
  feature_key: string;
  name?: string;
  unit?: string;
  rates?: PriceRow[];
}
interface Currency {
  code: string;
  name?: string;
  symbol?: string;
  minor_unit?: number;
  is_active?: number;
}
interface PricingData {
  currencies?: Currency[];
  editions?: EditionPricing[];
  usage_rates?: UsageRate[];
}

// Pick the amount for a given currency (+ optional interval) from a rows array.
function amountFor(rows: PriceRow[] | undefined, cur: string, interval?: string): number | null {
  if (!rows) return null;
  const match = rows.find(
    (r) => r.currency_code === cur && (interval ? r.interval === interval : true)
  );
  return match ? match.amount_minor : null;
}

// minor units → editable major-unit string, e.g. 9900 → "99.00".
function minorToInput(minor: number | null, code: string): string {
  if (minor === null || minor === undefined) return "";
  return (minor / Math.pow(10, currencyMinor(code))).toFixed(currencyMinor(code));
}
// major-unit string → integer minor units, or null when blank/invalid.
function inputToMinor(val: string, code: string): number | null {
  const n = parseFloat(val);
  if (!val.trim() || Number.isNaN(n)) return null;
  return Math.round(n * Math.pow(10, currencyMinor(code)));
}

export default function PricingPage() {
  const { data, loading, error, reload } = useApi<any>("/pricing");
  const coupons = useApi<any>("/coupons");
  const canPrice = useCan("pricing.write");
  const canCoupon = useCan("coupon.write");
  const [cur, setCur] = useState("USD");
  const [priceEd, setPriceEd] = useState<EditionPricing | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);

  const p: PricingData = data ?? {};
  const currencyCodes = p.currencies && p.currencies.length ? p.currencies.map((c) => c.code) : CURRENCIES;
  const editions: EditionPricing[] = p.editions ?? [];
  const usageRates: UsageRate[] = p.usage_rates ?? [];
  const couponRows: any[] = unwrap(coupons.data) ?? [];

  function discountText(c: any): string {
    if (c.discount_type === "percent" && c.percent_off != null) return `${Number(c.percent_off)}% off`;
    if (c.amount_off_minor != null) return `${fmtMoney(c.amount_off_minor, c.currency_code ?? cur)} off`;
    if (c.percent_off != null) return `${Number(c.percent_off)}% off`;
    return "—";
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Pricing</h2>
          <p>Real numbers per edition — plan price plus usage rates. Set here; the tenant app and site read from it.</p>
        </div>
        <div className="range">
          {currencyCodes.map((c) => (
            <button key={c} className={c === cur ? "on" : ""} onClick={() => setCur(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Skeleton rows={4} />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : editions.length === 0 ? (
        <EmptyState title="No pricing configured" sub="Set plan prices per edition to populate this screen." />
      ) : (
        <div className="ecards">
          {editions.map((e) => {
            const monthly = amountFor(e.prices, cur, "monthly");
            const annual = amountFor(e.prices, cur, "annual");
            return (
              <div className="ecard" key={e.id ?? e.key}>
                <div className="etop">
                  <span className="en">{e.name}</span>
                  <StatusChip status={e.status ?? "published"} />
                </div>
                <div className="bigprice">
                  {monthly != null ? fmtMoney(monthly, cur) : "Custom"}
                  {monthly != null && <span className="per"> /seat/mo</span>}
                </div>
                <div className="annual">
                  {annual != null ? (
                    <>{fmtMoney(annual, cur)}/seat/yr billed annually</>
                  ) : (
                    "Monthly billing"
                  )}
                </div>
                {canPrice && (
                  <div className="eact">
                    <button className="mini" onClick={() => setPriceEd(e)}>
                      Edit pricing
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="row two2">
        <div className="card">
          <div className="chead">
            <div>
              <h3>Usage rates</h3>
              <div className="csub">Metered per unit of work · {cur}</div>
            </div>
            {canPrice && usageRates.length > 0 && (
              <button className="mini" onClick={() => setUsageOpen(true)}>
                Edit
              </button>
            )}
          </div>
          {loading ? (
            <Skeleton rows={4} />
          ) : usageRates.length === 0 ? (
            <div className="csub" style={{ padding: "16px 0" }}>No metered usage rates configured.</div>
          ) : (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Metered unit</th>
                  <th className="r">Rate</th>
                </tr>
              </thead>
              <tbody>
                {usageRates.map((r) => (
                  <tr key={r.feature_key}>
                    <td>
                      {r.name ?? r.feature_key} <span className="fkey">per {r.unit ?? "unit"}</span>
                    </td>
                    <td className="r">
                      <span className="rate-price">{fmtMoney(amountFor(r.rates, cur), cur)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="chead">
            <div>
              <h3>Discounts &amp; coupons</h3>
              <div className="csub">Applied at checkout</div>
            </div>
            {canCoupon && (
              <button className="mini" onClick={() => setCouponOpen(true)}>
                + New
              </button>
            )}
          </div>
          {coupons.loading ? (
            <Skeleton rows={3} />
          ) : coupons.error ? (
            <div className="csub" style={{ padding: "16px 0" }}>{coupons.error}</div>
          ) : couponRows.length === 0 ? (
            <div className="csub" style={{ padding: "16px 0" }}>No coupons yet.</div>
          ) : (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Redeemed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {couponRows.map((c) => (
                  <tr key={c.id ?? c.code}>
                    <td>
                      <span className="code">{c.code}</span>
                    </td>
                    <td className="num">{discountText(c)}</td>
                    <td className="num">{c.redeemed_count ?? 0}</td>
                    <td>
                      <StatusChip status={c.status ?? "active"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {priceEd && (
        <EditionPriceDrawer
          edition={priceEd}
          currencyCodes={currencyCodes}
          initialCur={cur}
          onClose={() => setPriceEd(null)}
          onSaved={() => {
            setPriceEd(null);
            reload();
          }}
        />
      )}
      {usageOpen && (
        <UsageRateDrawer
          rates={usageRates}
          currencyCodes={currencyCodes}
          initialCur={cur}
          onClose={() => setUsageOpen(false)}
          onSaved={() => {
            setUsageOpen(false);
            reload();
          }}
        />
      )}
      {couponOpen && (
        <CouponDrawer
          currencyCodes={currencyCodes}
          initialCur={cur}
          onClose={() => setCouponOpen(false)}
          onSaved={() => {
            setCouponOpen(false);
            coupons.reload();
          }}
        />
      )}
    </>
  );
}

/* ── Edit a single edition's plan prices ───────────────────────────────────*/

function EditionPriceDrawer({
  edition,
  currencyCodes,
  initialCur,
  onClose,
  onSaved,
}: {
  edition: EditionPricing;
  currencyCodes: string[];
  initialCur: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [curr, setCurr] = useState(initialCur);
  const [monthly, setMonthly] = useState(() => minorToInput(amountFor(edition.prices, initialCur, "monthly"), initialCur));
  const [annual, setAnnual] = useState(() => minorToInput(amountFor(edition.prices, initialCur, "annual"), initialCur));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function switchCur(c: string) {
    setCurr(c);
    setMonthly(minorToInput(amountFor(edition.prices, c, "monthly"), c));
    setAnnual(minorToInput(amountFor(edition.prices, c, "annual"), c));
  }

  async function save() {
    setErr(null);
    const prices: { currency_code: string; interval: string; amount_minor: number }[] = [];
    const mv = inputToMinor(monthly, curr);
    const av = inputToMinor(annual, curr);
    if (mv != null) prices.push({ currency_code: curr, interval: "monthly", amount_minor: mv });
    if (av != null) prices.push({ currency_code: curr, interval: "annual", amount_minor: av });
    if (prices.length === 0) {
      setErr("Enter at least a monthly or annual price.");
      return;
    }
    setBusy(true);
    try {
      await api.put(`/editions/${edition.id}/prices`, { prices });
      toast("Pricing saved");
      onSaved();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title={`Edit pricing · ${edition.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save pricing"}
          </button>
        </>
      }
    >
      <Field label="Currency">
        <Segmented options={currencyCodes.map((c) => ({ value: c, label: c }))} value={curr} onChange={switchCur} />
      </Field>
      <div className="two-col">
        <Field label="Monthly / seat">
          <input type="text" className="mono" placeholder="99.00" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </Field>
        <Field label="Annual / seat">
          <input type="text" className="mono" placeholder="990.00" value={annual} onChange={(e) => setAnnual(e.target.value)} />
        </Field>
      </div>
      <div className="csub">Amounts are per seat in {curr}. Leave a field blank to skip it.</div>
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>}
    </Drawer>
  );
}

/* ── Edit metered usage rates for the selected currency ────────────────────*/

function UsageRateDrawer({
  rates,
  currencyCodes,
  initialCur,
  onClose,
  onSaved,
}: {
  rates: UsageRate[];
  currencyCodes: string[];
  initialCur: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [curr, setCurr] = useState(initialCur);
  const [vals, setVals] = useState<Record<string, string>>(() => build(rates, initialCur));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function build(rs: UsageRate[], c: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of rs) out[r.feature_key] = minorToInput(amountFor(r.rates, c, undefined), c);
    return out;
  }
  function switchCur(c: string) {
    setCurr(c);
    setVals(build(rates, c));
  }

  async function save() {
    setErr(null);
    const payload: { feature_key: string; currency_code: string; amount_minor: number }[] = [];
    for (const r of rates) {
      const minor = inputToMinor(vals[r.feature_key] ?? "", curr);
      if (minor != null) payload.push({ feature_key: r.feature_key, currency_code: curr, amount_minor: minor });
    }
    if (payload.length === 0) {
      setErr("Enter at least one rate.");
      return;
    }
    setBusy(true);
    try {
      await api.put(`/usage-rates`, { rates: payload });
      toast("Usage rates saved");
      onSaved();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title="Edit usage rates"
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save rates"}
          </button>
        </>
      }
    >
      <Field label="Currency">
        <Segmented options={currencyCodes.map((c) => ({ value: c, label: c }))} value={curr} onChange={switchCur} />
      </Field>
      <label className="fl" style={{ marginBottom: 8 }}>
        Rate per unit ({curr})
      </label>
      <div className="two-col">
        {rates.map((r) => (
          <Field key={r.feature_key} label={`${r.name ?? r.feature_key}`}>
            <input
              type="text"
              className="mono"
              placeholder="0.00"
              value={vals[r.feature_key] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [r.feature_key]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>}
    </Drawer>
  );
}

/* ── Create a coupon ───────────────────────────────────────────────────────*/

function CouponDrawer({
  currencyCodes,
  initialCur,
  onClose,
  onSaved,
}: {
  currencyCodes: string[];
  initialCur: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState("percent");
  const [percentOff, setPercentOff] = useState("");
  const [amountOff, setAmountOff] = useState("");
  const [curr, setCurr] = useState(initialCur);
  const [duration, setDuration] = useState("once");
  const [durationMonths, setDurationMonths] = useState("3");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!code.trim()) {
      setErr("Coupon code is required.");
      return;
    }
    const body: any = {
      code: code.trim().toUpperCase(),
      discount_type: discountType,
      duration,
    };
    if (name.trim()) body.name = name.trim();
    if (discountType === "percent") {
      const pct = parseFloat(percentOff);
      if (Number.isNaN(pct) || pct <= 0 || pct > 100) {
        setErr("Enter a percentage between 0 and 100.");
        return;
      }
      body.percent_off = pct;
    } else {
      const minor = inputToMinor(amountOff, curr);
      if (minor == null || minor <= 0) {
        setErr("Enter a fixed discount amount.");
        return;
      }
      body.amount_off_minor = minor;
      body.currency_code = curr;
    }
    if (duration === "repeating") {
      const months = parseInt(durationMonths, 10);
      if (Number.isNaN(months) || months <= 0) {
        setErr("Repeating coupons need a month count.");
        return;
      }
      body.duration_months = months;
    }
    setBusy(true);
    try {
      await api.post("/coupons", body);
      toast("Coupon created");
      onSaved();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title="New coupon"
      onClose={onClose}
      footer={
        <>
          <button className="mini" onClick={onClose}>
            Cancel
          </button>
          <button className="mini pri" onClick={save} disabled={busy}>
            {busy ? "Creating…" : "Create coupon"}
          </button>
        </>
      }
    >
      <div className="two-col">
        <Field label="Code">
          <input type="text" className="mono" placeholder="WELCOME50" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Name">
          <input type="text" placeholder="$50 off first invoice" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field label="Discount type">
        <Segmented
          options={[
            { value: "percent", label: "Percent" },
            { value: "fixed", label: "Fixed" },
          ]}
          value={discountType}
          onChange={setDiscountType}
        />
      </Field>
      {discountType === "percent" ? (
        <Field label="Percent off (%)">
          <input type="number" className="mono" placeholder="20" value={percentOff} onChange={(e) => setPercentOff(e.target.value)} />
        </Field>
      ) : (
        <div className="two-col">
          <Field label="Amount off">
            <input type="text" className="mono" placeholder="50.00" value={amountOff} onChange={(e) => setAmountOff(e.target.value)} />
          </Field>
          <Field label="Currency">
            <Segmented options={currencyCodes.map((c) => ({ value: c, label: c }))} value={curr} onChange={setCurr} />
          </Field>
        </div>
      )}
      <Field label="Duration">
        <Segmented
          options={[
            { value: "once", label: "Once" },
            { value: "repeating", label: "Repeating" },
            { value: "forever", label: "Forever" },
          ]}
          value={duration}
          onChange={setDuration}
        />
      </Field>
      {duration === "repeating" && (
        <Field label="Duration (months)">
          <input type="number" className="mono" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} />
        </Field>
      )}
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 12 }}>{err}</div>}
    </Drawer>
  );
}
