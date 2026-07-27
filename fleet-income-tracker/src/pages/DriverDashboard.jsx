import { useState } from 'react';
import { api } from '../api.js';
import { money, amount, count, monthLabel, dayLabel, todayLocal, rate as rateOf } from '../format.js';
import {
  dailyTarget,
  targetProgress,
  workingDaysLeft,
  tripsPerDay,
  bestRecordedDay,
  goalRungs,
  chargingForDay,
  rollingPace,
  lastLoggedDay,
} from '../display.js';
import MonthNav from '../components/MonthNav.jsx';
import TierLadder from '../components/TierLadder.jsx';
import MarginalRates from '../components/MarginalRates.jsx';
import PayBreakdown from '../components/PayBreakdown.jsx';
import DriverCosts, { DriverCostsTeaser } from '../components/DriverCosts.jsx';
import CashPocket from '../components/CashPocket.jsx';
import VehicleMap from '../components/VehicleMap.jsx';

/**
 * The driver's screen.
 *
 * Designed at 380px and read in five seconds, in that order:
 *
 *   1. one number — what to drive today;
 *   2. one chart — where the month sits against the two thresholds;
 *   3. four supporting stats — pay so far, yesterday, best day, days left.
 *
 * Then his own target, and the cash he is holding — the two things he has to
 * know that a number for today cannot tell him.
 *
 * Everything explanatory is one tap deep, split by question rather than by data
 * type: how the pay works, what the driving costs, where the car is. Costs have a
 * tab to themselves so a screen about earning never reads as half about spending.
 *
 * Voice is second person throughout: it is his pay, not a report about him.
 * Colour follows the app's contract — green is his money and nothing else, amber
 * is something outstanding, revenue and headings stay neutral.
 */
export default function DriverDashboard({ summary, month, setMonth, onRefresh }) {
  const target = dailyTarget(summary);
  const progress = targetProgress(summary);
  const daysLeft = workingDaysLeft(summary);
  // Which disclosure panel is open, held here so the cost teaser can open one.
  const [openPanel, setOpenPanel] = useState(null);

  return (
    <div className="space-y-4">
      {/* Order is the reading order: which month, then anything unusual about it,
          then the number he came for. Each sits in normal flow with its own
          stacking level, so nothing can lift over the banner or clip it — and no
          ancestor here hides overflow. */}
      <div className="relative z-20">
        <MonthNav month={month} setMonth={setMonth} tight />
      </div>

      {summary.prorationFactor < 1 && (
        <div className="relative z-10">
          <PartialMonth summary={summary} />
        </div>
      )}

      <Hero target={target} />

      <TierLadder
        variant="driver"
        revenue={summary.revenue}
        projected={summary.projectedRevenue}
        bandStart={summary.plan.bandStart}
        bandEnd={summary.plan.bandEnd}
        operatingDays={summary.operatingDays}
      />

      {/* Four supporting stats, two by two on a phone. They sit BELOW the hero
          and the ladder and can wrap freely; nothing here may push either of the
          first two zones down the screen. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Your pay so far" value={money(summary.driverPay)} accent />
        <Yesterday summary={summary} />
        <BestDay summary={summary} />
        {/* Called days, counted as shifts. A booked day off is not a day he can
            earn on, so it is out of this count — and out of the goal block's
            denominator and the hero's pace, which read the same function. The
            subtext says how many were taken out, because a bare number here read
            as calendar days to month end. */}
        <Stat
          label="Days left"
          value={count(daysLeft)}
          sub={
            summary.offDaysAhead > 0
              ? `+ ${count(summary.offDaysAhead)} day${summary.offDaysAhead === 1 ? '' : 's'} off booked`
              : 'no days off booked'
          }
        />
      </div>

      {/* Yesterday's charging. It belongs to the card above it and is written to
          be skipped — but a third of 380px cannot hold "2,400 · 14.72/km" without
          wrapping into three lines and deforming the stat row, so it sits under
          the grid at the same weight instead of inside it. */}
      <YesterdayCharging summary={summary} />

      <TargetBlock progress={progress} summary={summary} onSaved={onRefresh} />

      {/* Below the goal block and on the main screen: knowing what he is holding
          is the whole point, and a card one tap deep is a card nobody opens. It
          stays clear of the hero zone — no cash figure competes with the one
          instruction up there. */}
      <CashPocket summary={summary} hero={target} onChange={onRefresh} voice="driver" />

      {/* One line, and the last thing before the tabs: the cost card is worth
          knowing about, and is not what he came here to read. */}
      <DriverCostsTeaser summary={summary} onOpen={() => setOpenPanel('costs')} />

      <Details summary={summary} month={month} open={openPanel} setOpen={setOpenPanel} />
    </div>
  );
}

/**
 * Zone 1. One number, two to three times the size of anything else on the
 * screen, with a single line saying what it buys him.
 */
function Hero({ target }) {
  if (!target) return null;
  const settled = target.kind === 'done';
  return (
    <section
      className={`rounded-xl border px-5 py-6 ${
        target.celebratory ? 'border-accent/40 bg-accent/[0.06]' : 'border-ink-700 bg-ink-900'
      }`}
    >
      <div className="label">{settled ? 'Your pay this month' : 'Goal today'}</div>
      <div
        className={`num mt-1 leading-none tracking-tight text-[2.6rem] sm:text-6xl ${
          settled ? 'text-accent' : 'text-slate-50'
        }`}
      >
        {money(target.amount)}
      </div>
      <p className="text-sm text-slate-300 mt-2.5">{target.context}</p>
      {/* The pace that is NOT binding, in small type. It is the reason the
          headline can be trusted: the screen has already worked out which of the
          two asks is the harder one, and says what the other one was. */}
      {target.secondary && (
        <p className="text-xs text-slate-400 mt-1.5">
          {target.secondary.amount !== null && (
            <span className="num text-slate-300">{amount(target.secondary.amount)}</span>
          )}
          {target.secondary.amount !== null ? ' ' : ''}
          {target.secondary.text}
        </p>
      )}
    </section>
  );
}

/**
 * Yesterday: the last complete day, and the fairest read on recent form. Today is
 * still being driven, so it always reads low and would flatter nothing.
 *
 * Falls back to the best day rather than a dash — a card in this row that reads
 * "—" on a Monday morning is dead space in a position that should always be
 * earning it.
 */
function Yesterday({ summary }) {
  const y = summary.yesterday;
  if (y && !y.offDay && (y.revenue > 0 || y.trips)) {
    return (
      <Stat
        label="Yesterday"
        value={money(y.revenue)}
        sub={y.trips ? `${count(y.trips)} trips` : 'no trips logged'}
      />
    );
  }

  // Every morning until the evening's import lands, yesterday has nothing to
  // show — and on a Monday after a rest day it has nothing all day. The last day
  // he actually drove answers the same question and is never empty once the month
  // has started. No stat card on this screen prints a dash.
  const last = lastLoggedDay(summary);
  if (last) {
    return (
      <Stat
        label="Last logged day"
        value={money(last.revenue)}
        sub={[dayLabel(last.date), last.trips ? `${count(last.trips)} trips` : null]
          .filter(Boolean)
          .join(' · ')}
      />
    );
  }
  if (y?.offDay) return <Stat label="Yesterday" value="Day off" sub="rested" />;
  return <Stat label="Yesterday" value="Nothing yet" sub="your first day shows here" />;
}

/**
 * The best single day of the month — the figure the whole screen is calibrated
 * against.
 *
 * It reads the same helper the goal's reachability check uses, so the number he
 * is shown as his ceiling and the number the maths refuses to ask him to beat by
 * more than a third are always the same number. Two sources for that would be
 * two different ceilings.
 *
 * A best set in the last couple of days is worth marking: it is the one stat on
 * the screen that is pure good news, and it is the most recent thing he did.
 */
function BestDay({ summary }) {
  const best = bestRecordedDay(summary);
  if (!best) return <Stat label="Best day" value="Nothing yet" sub="your first day shows here" />;

  const fresh = isRecent(best.date, summary.month);
  return (
    <Stat
      label={best.source === 'lastMonth' ? 'Best day last month' : 'Best day this month'}
      value={money(best.revenue)}
      sub={[best.trips ? `${count(best.trips)} trips` : null, dayLabel(best.date)]
        .filter(Boolean)
        .join(' · ')}
      flag={fresh ? '▲ new best' : null}
    />
  );
}

/** Within the last two days of the month being viewed. */
function isRecent(date, month) {
  if (!date || !month) return false;
  const today = todayLocal();
  // Only meaningful while looking at the current month; a past month has no "new".
  if (today.slice(0, 7) !== month) return false;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
  return age >= 0 && age <= 2;
}

/**
 * What yesterday's charging cost, from logged sessions only.
 *
 * Omitted unless the day has both a logged cost and a distance: the configured
 * rate is identical every day, so "yesterday cost 2,600" would be the screen
 * stating a budget as a fact. Per km leads — a big-rupee day after a long shift
 * is a good day, and the rate is the part he can act on.
 *
 * Deliberately the quietest thing on the screen. It is a cost, on a screen whose
 * job is to say what to earn, and no cost figure may compete with the hero.
 */
function YesterdayCharging({ summary }) {
  const y = summary.yesterday;
  const charge = y ? chargingForDay(summary, y.date) : null;
  if (!charge) return null;
  return (
    <p className="text-[11px] text-slate-400 num px-1">
      Yesterday's charging {amount(charge.cost)} · {rateOf(charge.perKm)}/km over{' '}
      {amount(charge.km)} km
    </p>
  );
}

/**
 * What he wants to earn, and what it costs in driving — three rows, one
 * denominator.
 *
 * Everything here is per REMAINING day, the same denominator the hero uses. The
 * earlier version restated the goal over the whole month's days while measuring
 * the gap over the days that were left, so the screen carried two different "per
 * day" figures and the driver had no way to tell which one to act on.
 *
 * He states the figure himself, in take-home rupees, and the revenue behind it
 * comes from running the tier function backwards against the plan that applies
 * this month. A goal someone else sets is a quota; the edit control lives here
 * rather than in a settings page he cannot open.
 *
 * When the goal needs more than a stretch above his best day, the block stops
 * issuing an instruction it knows he cannot follow and reframes as a best case —
 * what a strong finish would actually pay, and what it beats. Aspirational,
 * never shaming, and never arithmetic nobody can act on.
 */
function TargetBlock({ progress, summary, onSaved }) {
  const [editing, setEditing] = useState(false);
  const pace = rollingPace(summary);

  if (editing || !progress) {
    return (
      <TargetEditor
        current={progress?.payStated ?? summary.payTarget ?? null}
        rungs={goalRungs(summary)}
        lastMonth={summary.lastMonth}
        onCancel={progress ? () => setEditing(false) : null}
        onSaved={() => {
          setEditing(false);
          onSaved?.();
        }}
      />
    );
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label">What you want to earn</h2>
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-slate-300 underline underline-offset-2"
        >
          Change
        </button>
      </div>

      <dl className="mt-3 space-y-2">
        <Row
          label="Your goal"
          hint={
            progress.prorated
              ? `${amount(progress.payStated)} a month, scaled to your ${count(summary.operatingDays)} days`
              : 'paid at the end of the month'
          }
          value={money(progress.payWanted)}
        />
        <Row
          label="This pace pays you"
          hint="at month end"
          value={money(progress.payAtPace)}
          tone="text-accent"
        />

        {/* His pace, and the only place on this screen it appears. Rolling over
            the last worked shifts rather than month-to-date: by the 25th a
            month average is mostly days he cannot change, and it barely moves
            however he drives today. Revenue, so it stays neutral. */}
        {pace && (
          <Row
            label="Your pace"
            hint={`over your last ${count(pace.shifts)} shift${pace.shifts === 1 ? '' : 's'}`}
            value={amount(pace.perShift)}
            trend={pace}
          />
        )}

        {progress.banked ? (
          <Row label="Already banked" value="✓" tone="text-accent" />
        ) : progress.reachable ? (
          <Row
            label="Gap per shift"
            hint={`× ${count(progress.daysLeft)} day${progress.daysLeft === 1 ? '' : 's'} left`}
            value={amount(progress.gapPerDay)}
            tone="text-warn"
          />
        ) : (
          <Row
            label="Gap per shift"
            hint={`above your best day of ${amount(progress.best.revenue)}`}
            value={amount(progress.gapPerDay)}
            tone="text-warn"
          />
        )}
      </dl>

      {/* Out of reach: say what IS reachable instead of repeating the ask. */}
      {!progress.banked && !progress.reachable && progress.bestCasePay !== null && (
        <dl className="mt-3 pt-3 border-t border-ink-700 space-y-2">
          <Row
            label={`${count(progress.daysLeft)} best days would pay`}
            hint={`at ${amount(progress.best.revenue)} a day`}
            value={money(progress.bestCasePay)}
            tone="text-accent"
          />
          <Row
            label="Better than this pace by"
            value={money(progress.bestCaseGain)}
            tone="text-accent"
          />
        </dl>
      )}
    </div>
  );
}

/**
 * Setting the goal.
 *
 * The rungs are anchored on what he actually took home last month, because that
 * is the only figure that makes the choice a decision rather than a guess: "same
 * again", "a bit more", "a stretch", "a reach". The box stays, for a figure of
 * his own that no rung offers.
 */
function TargetEditor({ current, rungs, lastMonth, onCancel, onSaved }) {
  const [value, setValue] = useState(current ? String(Math.round(current)) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e, amountToSave = value) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.saveTarget(amountToSave === '' ? null : Number(amountToSave));
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card">
      <h2 className="label">What do you want to earn a month?</h2>
      <p className="text-xs text-slate-400 mt-1">
        Your own goal — in your pocket, after the plan. Nothing else changes when you move it.
      </p>

      {rungs.length > 0 && (
        <>
          <p className="text-xs text-slate-400 mt-3">
            You took home <span className="num text-slate-200">{money(lastMonth.driverPay)}</span> in{' '}
            {monthLabel(`${lastMonth.month}-01`)}
            {lastMonth.partial ? ' (a part month)' : ''}.
          </p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {rungs.map((rung) => (
              <button
                key={rung.value}
                type="button"
                disabled={busy}
                onClick={() => setValue(String(rung.value))}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  Number(value) === rung.value
                    ? 'border-slate-400 bg-ink-800'
                    : 'border-ink-700 bg-ink-950/40'
                }`}
              >
                <span className="num block text-sm text-slate-100">{amount(rung.value)}</span>
                <span className="block text-[11px] text-slate-400">{rung.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center gap-2 mt-3">
        <span className="text-sm text-slate-400">LKR</span>
        <input
          type="number"
          step="5000"
          min="0"
          inputMode="numeric"
          className="num flex-1 min-w-0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="100000"
        />
      </div>
      {error && <p className="text-sm text-danger mt-2">{error}</p>}
      <div className="flex items-center gap-2 mt-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save goal'}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * One line, no mechanism.
 *
 * The old banner explained proration in four clauses and three figures, which
 * is a conversation to have once, not a permanent fixture above the number he
 * came to read. What he needs is that the targets are smaller on purpose and
 * that it ends.
 */
function PartialMonth({ summary }) {
  const started = summary.startDate ? dayLabel(summary.startDate).replace(/^\w+,\s*/, '') : null;
  const next = nextMonthName(summary.month);
  return (
    <p className="rounded-lg border border-warn/30 bg-warn/[0.06] px-3.5 py-2.5 text-sm text-slate-200">
      <span className="text-warn font-medium">Partial month</span>
      {started ? ` — started ${started}.` : '.'} Targets scaled to your{' '}
      <span className="num">{count(summary.operatingDays)}</span> days. Full plan from {next}.
    </p>
  );
}

function nextMonthName(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
}

/**
 * Progressive disclosure. Everything explanatory lives behind one of these,
 * closed by default so the main screen stays a five-second read.
 */
function Details({ summary, month, open, setOpen }) {
  // Three panels, and the split is by question rather than by data type: how the
  // pay works, what the driving costs, where the car is. Costs get a tab of their
  // own so a screen about earning is never half about spending — and cash lives
  // on the main screen, because knowing what he is holding is not a detail.
  const panels = [
    { key: 'pay', label: 'How your pay works' },
    { key: 'costs', label: 'What it costs' },
    { key: 'car', label: 'The car' },
  ];

  return (
    <section>
      <div className="grid grid-cols-3 gap-2">
        {panels.map((p) => (
          <button
            key={p.key}
            onClick={() => setOpen(open === p.key ? null : p.key)}
            aria-expanded={open === p.key}
            className={`rounded-lg border px-2 py-2.5 text-xs leading-snug transition-colors ${
              open === p.key
                ? 'border-slate-500 bg-ink-800 text-slate-100'
                : 'border-ink-700 bg-ink-900 text-slate-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {open === 'pay' && (
        <div className="mt-3 space-y-4">
          <div className="card">
            <MarginalRates summary={summary} />
          </div>
          <PayBreakdown summary={summary} />
          <Projected summary={summary} month={month} />
        </div>
      )}

      {/* Everything that takes money off the fare, and nothing else. */}
      {open === 'costs' && (
        <div className="mt-3">
          <DriverCosts summary={summary} />
        </div>
      )}

      {open === 'car' && (
        <div className="mt-3">
          <VehicleMap />
        </div>
      )}
    </section>
  );
}

/**
 * Where the month lands if nothing changes.
 *
 * Deliberately thin: the take-home at month end and the pace behind it already
 * have a home in the target block above, and printing them twice is how the old
 * dashboard ended up with the same figure in three places. What is left here is
 * what is not said anywhere else — the revenue total, and the two per-trip
 * lenses on how it is being earned.
 */
function Projected({ summary, month }) {
  const trips = tripsPerDay(summary);
  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="label">If this pace holds</h2>
        <span className="text-xs text-slate-400">{monthLabel(`${month}-01`)}</span>
      </div>
      <dl className="mt-3 space-y-2">
        <Row label="Month-end revenue" value={amount(summary.projectedRevenue)} />
        {trips && <Row label="Trips a shift" value={String(trips)} />}
        {summary.push?.revenuePerTrip && (
          <Row label="Revenue a trip" value={amount(summary.push.revenuePerTrip)} />
        )}
      </dl>
    </div>
  );
}

/**
 * One supporting stat. The unit belongs to the number and wraps with it — a
 * floating "LKR" on its own line below the figure read as a third, unlabelled
 * row of the card. At 380px the value drops to the smaller size rather than
 * being truncated, because a clipped amount is worse than a small one.
 */
function Stat({ label, value, sub, flag, accent = false }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-3 min-w-0">
      <div className="text-[11px] text-slate-400 leading-tight">{label}</div>
      {/* One line, always. `break-words` folded the unit into the number as
          asked but then broke the number itself ("LKR 19,35 / 5"), which is
          worse than the floating unit it replaced. Three cards across 380px
          leaves ~100px each, so the figure shrinks instead of wrapping. */}
      <div
        className={`num mt-1 text-[13px] sm:text-lg leading-tight whitespace-nowrap ${
          accent ? 'text-accent' : 'text-slate-100'
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-slate-400 leading-tight mt-0.5">{sub}</div>}
      {flag && <div className="text-[11px] text-slate-200 leading-tight mt-1">{flag}</div>}
    </div>
  );
}

function Row({ label, hint, value, tone = 'text-slate-100', trend }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-slate-300 min-w-0">
        {label}
        {hint && <span className="block text-xs text-slate-400 num">{hint}</span>}
      </dt>
      <dd className={`num shrink-0 text-right ${tone}`}>
        {value}
        {/* Against the seven shifts before these seven. A falling pace is the one
            thing here worth a colour; a rising one is simply good news. */}
        {trend?.direction && trend.direction !== 'flat' && (
          <span
            className={`block text-[11px] ${trend.direction === 'up' ? 'text-slate-300' : 'text-warn'}`}
          >
            {trend.direction === 'up' ? '▲' : '▼'} {amount(Math.abs(trend.delta))} on the{' '}
            {trend.previousShifts} before
          </span>
        )}
      </dd>
    </div>
  );
}
