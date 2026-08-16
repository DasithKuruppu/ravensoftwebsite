import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { calculatePay } from '../../shared/commission.mjs';
import { money, amount } from '../format.js';
import ChargerEditor from '../components/ChargerEditor.jsx';
import CostEditor from '../components/CostEditor.jsx';
import StartingCash from '../components/StartingCash.jsx';

const CHECK_REVENUE = 406789.2;
const CHECK_EXPECTED = 121394.6;

const FIELDS = [
  { key: 'base', label: 'Tier 1 — base pay (LKR)', step: '1000' },
  { key: 'bandStart', label: 'Tier 2 — band start (LKR)', step: '10000' },
  { key: 'bandEnd', label: 'Tier 2 — band end (LKR)', step: '10000' },
  { key: 'bandRate', label: 'Tier 2 — rate (0–1)', step: '0.01' },
  { key: 'topRate', label: 'Tier 3 — rate above band end (0–1)', step: '0.01' },
];

export default function Settings() {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSaved(s);
        setForm(s);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const next = await api.saveSettings({
        ...form,
        startDate: form.startDate || null,
        capitalInvested: form.capitalInvested === '' ? null : Number(form.capitalInvested),
        alternativeRatePct: Number(form.alternativeRatePct) || 0,
        leasedPercent: Number(form.leasedPercent) || 0,
        holdingYears: Number(form.holdingYears) || 5,
        resaleValue: form.resaleValue === '' ? null : Number(form.resaleValue),
        driverName: (form.driverName || '').trim() || 'Driver',
        driverNameSi: (form.driverNameSi || '').trim(),
        revenueTarget: form.revenueTarget === '' ? null : Number(form.revenueTarget),
        revenueBasis: form.revenueBasis === 'gross' ? 'gross' : 'net',
        uberCommissionRate: Number(form.uberCommissionRate) || 0,
        base: Number(form.base),
        bandStart: Number(form.bandStart),
        bandEnd: Number(form.bandEnd),
        bandRate: Number(form.bandRate),
        topRate: Number(form.topRate),
      });
      setSaved(next);
      setForm(next);
      setStatus('Saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!form) {
    return error ? <Banner>{error}</Banner> : <p className="text-slate-400 text-sm">Loading…</p>;
  }

  // Live check against the same calc the API uses, with the *unsaved* form values.
  const live = calculatePay(CHECK_REVENUE, {
    base: Number(form.base),
    bandStart: Number(form.bandStart),
    bandEnd: Number(form.bandEnd),
    bandRate: Number(form.bandRate),
    topRate: Number(form.topRate),
  });
  const matches = live.total === CHECK_EXPECTED;

  return (
    <div className="max-w-6xl space-y-5">
      {error && <Banner>{error}</Banner>}

      <form onSubmit={save} className="card space-y-4">
        <h2 className="label">Commission plan</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="grid gap-1">
              <label className="label" htmlFor={f.key}>
                {f.label}
              </label>
              <input
                id={f.key}
                type="number"
                step={f.step}
                className="num"
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="grid gap-1 max-w-xs">
          <label className="label" htmlFor="driverName">
            Driver name
          </label>
          <input
            id="driverName"
            value={form.driverName || ''}
            onChange={(e) => setForm({ ...form, driverName: e.target.value })}
            placeholder="Driver"
          />
          <p className="text-xs text-slate-400">
            Used throughout the app, and accepted as a sign-in name as well as “driver”.
          </p>
        </div>

        <div className="grid gap-1 max-w-xs">
          <label className="label" htmlFor="driverNameSi">
            Driver name in Sinhala
          </label>
          <input
            id="driverNameSi"
            value={form.driverNameSi || ''}
            onChange={(e) => setForm({ ...form, driverNameSi: e.target.value })}
            placeholder="චන්දිම"
          />
          <p className="text-xs text-slate-400">
            Optional. Shown in place of the name above when the app is being read in Sinhala. Leave
            it blank and the Latin spelling is used in both languages — nothing is transliterated
            automatically, because a guessed spelling of somebody's name is worse than none. Sign-in
            still uses the Latin name; a phone offers a Latin keyboard at the login screen.
          </p>
        </div>

        <div className="grid gap-1 max-w-xs">
          <label className="label" htmlFor="revenueTarget">
            Driver's monthly revenue goal (LKR)
          </label>
          <input
            id="revenueTarget"
            type="number"
            step="5000"
            min="0"
            className="num"
            value={form.revenueTarget ?? ''}
            onChange={(e) => setForm({ ...form, revenueTarget: e.target.value })}
          />
          <p className="text-xs text-slate-400">
            What he wants to drive in a month — revenue, not take-home. Nothing in payroll is
            calculated from it: his screen prorates it for the month he started and works out what
            the plan pays on it. He sets this himself on his own screen; this box is here for the
            first one, or when he asks.
          </p>
        </div>

        <div className="grid gap-1 max-w-xs">
          <label className="label" htmlFor="startDate">
            Start date
          </label>
          <input
            id="startDate"
            type="date"
            value={form.startDate || ''}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
          <p className="text-xs text-slate-400">
            The month containing this date is prorated to the days actually worked — base
            and both band edges scale down. Every later month runs the plan at full value.
            Leave blank to treat every month as complete.
          </p>
        </div>

        <div className="border-t border-ink-800 pt-4">
          <h3 className="label mb-3">Uber's cut</h3>
          <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
            <div className="grid gap-1">
              <label className="label" htmlFor="revenueBasis">
                Imported revenue is
              </label>
              <select
                id="revenueBasis"
                value={form.revenueBasis || 'net'}
                onChange={(e) => setForm({ ...form, revenueBasis: e.target.value })}
              >
                <option value="gross">The full fare — Uber charges a subscription</option>
                <option value="net">Net of a percentage commission</option>
              </select>
            </div>
            <div className="grid gap-1">
              <label className="label" htmlFor="uberCommissionRate">
                Uber's service fee (0–1)
              </label>
              <input
                id="uberCommissionRate"
                type="number"
                step="0.01"
                min="0"
                max="0.9"
                className="num"
                value={form.uberCommissionRate ?? ''}
                onChange={(e) => setForm({ ...form, uberCommissionRate: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            On Drive Pass, Uber's cut is the subscription — a flat charge, not a share of each fare —
            and the import already captures it from the payments export along with the Flex Pay fee
            and any toll reimbursed. Those are measured figures; leave the fee at{' '}
            <span className="num">0</span> and nothing is modelled.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            Set a percentage only on an arrangement that really takes a share of the fare. The export
            states neither the gross fare nor a service fee, so the fare is then reconstructed as{' '}
            <span className="num">earnings ÷ (1 − fee)</span> and every figure derived from it is
            labelled an estimate. Nothing in the commission plan reads either field: the driver is
            paid on the revenue recorded.
          </p>
        </div>

        <div className="border-t border-ink-800 pt-4">
          <h3 className="label mb-3">Vehicle capital</h3>
          <div className="grid sm:grid-cols-4 gap-3">
            <div className="grid gap-1">
              <label className="label" htmlFor="capitalInvested">
                What the vehicle cost (LKR)
              </label>
              <input
                id="capitalInvested"
                type="number"
                step="10000"
                className="num"
                value={form.capitalInvested ?? ''}
                onChange={(e) => setForm({ ...form, capitalInvested: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <label className="label" htmlFor="leasedPercent">
                Share financed by lease (%)
              </label>
              <input
                id="leasedPercent"
                type="number"
                step="5"
                className="num"
                value={form.leasedPercent ?? ''}
                onChange={(e) => setForm({ ...form, leasedPercent: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <label className="label" htmlFor="holdingYears">
                Years you will run it
              </label>
              <input
                id="holdingYears"
                type="number"
                step="1"
                min="1"
                className="num"
                value={form.holdingYears ?? ''}
                onChange={(e) => setForm({ ...form, holdingYears: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <label className="label" htmlFor="resaleValue">
                Expected resale after those years
              </label>
              <input
                id="resaleValue"
                type="number"
                step="1000"
                min="0"
                className="num"
                value={form.resaleValue ?? ''}
                onChange={(e) => setForm({ ...form, resaleValue: e.target.value })}
              />
              <p className="text-xs text-slate-400">
                Entered instead of a depreciation cost. The lease is paid in full out of profit,
                and what that buys is a car owned outright — booking depreciation as well would
                charge for the same loss of value twice.
              </p>
            </div>
            <div className="grid gap-1">
              <label className="label" htmlFor="alternativeRatePct">
                Fixed deposit rate to compare (%)
              </label>
              <input
                id="alternativeRatePct"
                type="number"
                step="0.5"
                className="num"
                value={form.alternativeRatePct ?? ''}
                onChange={(e) => setForm({ ...form, alternativeRatePct: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Used to compare what the car returns against leaving the money on deposit. Interest is
            charged only on your own share, not the leased part, and costs that end — the lease —
            are averaged over the years you will run it rather than charged forever.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save plan & capital'}
          </button>
          {saved && (
            <button type="button" className="btn" onClick={() => setForm(saved)} disabled={busy}>
              Reset
            </button>
          )}
          {status && <span className="text-sm text-slate-100">{status}</span>}
        </div>
      </form>

      <div className={`card border ${matches ? 'border-ink-700' : 'border-warn/40'}`}>
        <h2 className="label mb-2">Live check</h2>
        <p className="text-sm text-slate-400">
          At revenue <span className="num text-slate-200">{money(CHECK_REVENUE)}</span> this plan
          pays{' '}
          <span className={`num ${matches ? 'text-slate-50' : 'text-warn'}`}>
            {money(live.total)}
          </span>
          .
        </p>
        <p className="text-xs mt-1">
          {matches ? (
            <span className="text-slate-200">Matches the reference figure of {money(CHECK_EXPECTED)}.</span>
          ) : (
            <span className="text-warn">
              Reference figure is {money(CHECK_EXPECTED)} — this plan differs by{' '}
              <span className="num">{amount(live.total - CHECK_EXPECTED)}</span>.
            </span>
          )}
        </p>
        <dl className="mt-3 space-y-1.5 border-t border-ink-800 pt-3">
          {live.tiers.map((t) => (
            <div key={t.key} className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-slate-400">{t.label}</dt>
              <dd className="num text-slate-300">{amount(t.amount)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Cash the owner hands over, and the costs the driver may pay out of it.
          Kept next to each other because they are two halves of one question:
          what cash is in his pocket that is not a fare. */}
      <StartingCash />

      <CostEditor />

      <ChargerEditor />

      {saved?.csvMapping && (
        <div className="card">
          <h2 className="label mb-2">Saved CSV column mapping</h2>
          <dl className="space-y-1.5">
            {Object.entries(saved.csvMapping).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-slate-400">{k}</dt>
                <dd className="num text-slate-300">{v || '—'}</dd>
              </div>
            ))}
          </dl>
          <button
            className="btn text-xs mt-3"
            onClick={async () => {
              const next = await api.saveSettings({ ...saved, csvMapping: null });
              setSaved(next);
              setForm(next);
            }}
          >
            Forget mapping
          </button>
        </div>
      )}
    </div>
  );
}

function Banner({ children }) {
  return (
    <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
      {children}
    </p>
  );
}
