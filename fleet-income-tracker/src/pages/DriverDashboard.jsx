import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import {
  money,
  amount,
  count,
  monthLabel,
  monthName,
  dayLabel,
  dateLabel,
  todayLocal,
  rate as rateOf,
  ago,
} from '../format.js';
import { useT } from '../i18n/index.jsx';
import {
  dailyTarget,
  targetProgress,
  workingDaysLeft,
  tripsPerDay,
  averageDays,
  offDaysCost,
  bestRecordedDay,
  goalRungs,
  chargingForDay,
  rollingPace,
  lastLoggedDay,
  nextZone,
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
 *   3. the supporting stats — the next rate line, revenue, the daily average,
 *      yesterday, the best day, and the days left.
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
  const { t } = useT();
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
        // His own goal, prorated for the month, so the chart shows the line he
        // chose alongside the two the plan sets. Absent when no goal is set.
        goal={progress?.goalRevenue}
        bandStart={summary.plan.bandStart}
        bandEnd={summary.plan.bandEnd}
        bandRate={summary.push?.bandRate}
        topRate={summary.push?.topRate}
      />

      {/* The supporting stats, two by two on a phone. They sit BELOW the hero and
          the ladder and can wrap freely; nothing here may push either of the first
          two zones down the screen.
          Every figure here is neutral, because none of them is his money: this row
          is what the car did. His pay lives under "How your pay works", where the
          breakdown that explains it is — a green total sitting among six grey
          cards drew the eye to the one number that needs no watching. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <NextZone summary={summary} />
        <Stat
          label={t('stat.revenueMonth')}
          value={money(summary.revenue)}
          sub={t('stat.trips', { count: count(summary.trips) })}
        />
        {/* The month to date, over complete shifts with days off taken out —
            `averageDays`, the same denominator the server divided by. Labelled
            against it, because the goal block carries a rolling average over the
            last few days and the two are different questions: this one is the
            month's record, that one is current form. */}
        <Stat
          label={t('stat.averageDay')}
          value={money(summary.dailyAverage)}
          sub={
            tripsPerDay(summary)
              ? t('stat.average.withTrips', {
                  days: count(averageDays(summary)),
                  trips: tripsPerDay(summary),
                })
              : t('stat.average.days', {
                  count: averageDays(summary),
                })
          }
        />
        {/* Today, beside the average it is being judged against. Incomplete by
            definition — the car is still out — so it carries how fresh it is
            rather than being read as a finished figure. It sits next to the
            average deliberately: "18,360 a day" means something different when
            today already shows 21,000 than when it shows nothing. */}
        <Today summary={summary} />
        <Yesterday summary={summary} />
        <BestDay summary={summary} />
        {/* Called days, counted as shifts. A booked day off is not a day he can
            earn on, so it is out of this count — and out of the goal block's
            denominator and the hero's pace, which read the same function. The
            subtext says the count is shifts, because a bare number here read as
            calendar days to month end; the days themselves are their own tile. */}
        <Stat label={t('stat.daysLeft')} value={count(daysLeft)} sub={t('stat.daysLeftHint')} />
        <OffDays summary={summary} />
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

      {/* The pay document, last on the screen. It is something he fetches at
          month end rather than a figure he reads daily, so it sits below
          everything he came for and takes no room until he wants it. */}
      <Link
        to="/payslip"
        className="block text-center text-sm text-slate-300 underline underline-offset-2 py-2"
      >
        {t('payslip.link')}
      </Link>
    </div>
  );
}

/**
 * Zone 1. One number, two to three times the size of anything else on the
 * screen, with a single line saying what it buys him.
 */
function Hero({ target }) {
  const { t, tx } = useT();
  if (!target) return null;
  const settled = target.kind === 'done';
  return (
    <section
      className={`rounded-xl border px-5 py-6 ${
        target.celebratory ? 'border-accent/40 bg-accent/[0.06]' : 'border-ink-700 bg-ink-900'
      }`}
    >
      <div className="label">{t(settled ? 'hero.label.pay' : 'hero.label.goal')}</div>
      <div
        className={`num mt-1 leading-none tracking-tight text-[2.6rem] sm:text-6xl ${
          settled ? 'text-accent' : 'text-slate-50'
        }`}
      >
        {money(target.amount)}
      </div>
      {/* The goal the ask divides toward, named in the line that promises it.
          Both figures are revenue, so the arithmetic is visible: today's ask,
          times the days left, is the distance to this number — and the pay
          beside it is what the revenue is actually for. */}
      <p className="text-sm text-slate-300 mt-2.5 leading-relaxed">
        {target.goal
          ? tx(target.contextKey, {
              // `count` selects the plural form and is never printed; `days`
              // is the one the sentence shows. Plain numbers, not styled spans:
              // a day count is not one of the money figures the eye stops on.
              count: target.daysLeft,
              days: target.daysLeft,
              // The headline figure again, inside the sentence that explains it.
              ask: <span className="num text-slate-100">{money(target.amount)}</span>,
              pct: target.pct,
              goal: <span className="num text-slate-100">{money(target.goal)}</span>,
              pay: <span className="num text-accent">{money(target.pay)}</span>,
            })
          : t(target.contextKey)}
      </p>
      {/* The pace that is NOT binding, in small type. It is the reason the
          headline can be trusted: the screen has already worked out which of the
          two asks is the harder one, and says what the other one was. */}
      {target.secondary && (
        <p className="text-xs text-slate-400 mt-1.5">
          {target.secondary.amount !== null && (
            <span className="num text-slate-300">{amount(target.secondary.amount)}</span>
          )}
          {target.secondary.amount !== null ? ' ' : ''}
          {t(target.secondary.textKey, { pct: target.secondary.pct })}
        </p>
      )}
    </section>
  );
}

/**
 * The next line that changes what a rupee is worth.
 *
 * Read off revenue banked rather than the forecast, so it names the threshold the
 * next rupee actually crosses — and off `displayThreshold`, so it is the same
 * figure as the ladder axis and the hero's small print.
 */
function NextZone({ summary }) {
  const { t } = useT();
  const zone = nextZone(summary);
  if (!zone) {
    // Nothing left to unlock: say what he is on.
    return (
      <Stat
        label={t('stat.rateNow')}
        value={`${Math.round((summary.push?.topRate || 0.5) * 100)}%`}
        sub={t('stat.rateNowSub')}
      />
    );
  }
  const pct = Math.round(zone.rate * 100);
  return (
    <Stat
      label={t('stat.toZone', { pct })}
      value={money(zone.remaining)}
      // The band has a ceiling — past it the rate steps up again — so say what the
      // 30% actually applies to rather than implying it runs forever.
      sub={
        zone.width
          ? t('stat.thenPctOfNext', { pct, amount: amount(zone.width) })
          : t('stat.thenPctOfEvery', { pct })
      }
    />
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
  const { t } = useT();
  const y = summary.yesterday;
  if (y && !y.offDay && (y.revenue > 0 || y.trips)) {
    return (
      <Stat
        label={t('stat.yesterday')}
        value={money(y.revenue)}
        sub={y.trips ? t('stat.trips', { count: count(y.trips) }) : t('stat.noTrips')}
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
        label={t('stat.lastLoggedDay')}
        value={money(last.revenue)}
        sub={[dayLabel(last.date), last.trips ? t('stat.trips', { count: count(last.trips) }) : null]
          .filter(Boolean)
          .join(' · ')}
      />
    );
  }
  if (y?.offDay)
    return <Stat label={t('stat.yesterday')} value={t('stat.dayOff')} sub={t('stat.rested')} />;
  return (
    <Stat label={t('stat.yesterday')} value={t('stat.nothingYet')} sub={t('stat.firstDayHint')} />
  );
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
  const { t } = useT();
  const best = bestRecordedDay(summary);
  if (!best)
    return <Stat label={t('stat.bestDay')} value={t('stat.nothingYet')} sub={t('stat.firstDayHint')} />;

  const fresh = isRecent(best.date, summary.month);
  return (
    <Stat
      label={t(best.source === 'lastMonth' ? 'stat.bestLastMonth' : 'stat.bestThisMonth')}
      value={money(best.revenue)}
      sub={[best.trips ? t('stat.trips', { count: count(best.trips) }) : null, dayLabel(best.date)]
        .filter(Boolean)
        .join(' · ')}
      flag={fresh ? t('stat.newBest') : null}
    />
  );
}

/**
 * What today has brought in so far, and how current that is.
 *
 * The freshness matters more here than anywhere else on the screen. Every other
 * figure is about finished days; this one is a running total that only moves
 * when an import lands, so a driver who has done six hours and sees nothing
 * needs to know whether the answer is "you earned nothing" or "nothing has come
 * through yet". Amber past a day, because by then it is the import that is
 * broken rather than the driving.
 */
function Today({ summary }) {
  const { t } = useT();
  const today = summary.today;
  const last = summary.lastUpdated;
  const { text, minutes } = last ? ago(last.at) : { text: null, minutes: null };
  const stale = minutes !== null && minutes >= 1440;

  const earned = today && !today.offDay ? today.revenue || 0 : 0;
  return (
    <Stat
      label={t('stat.today')}
      value={today?.offDay ? t('stat.dayOff') : earned > 0 ? money(earned) : t('stat.nothingYet')}
      sub={
        today?.offDay
          ? t('stat.rested')
          : earned > 0
            ? t('stat.trips', { count: count(today.trips || 0) })
            : t('stat.todayNothingYet')
      }
      flag={
        text ? (
          <span
            className={stale ? 'text-warn' : 'text-slate-400'}
            title={last.date ? t('stat.updatedFor', { date: dayLabel(last.date) }) : undefined}
          >
            {t('stat.updated', { ago: text })}
          </span>
        ) : (
          <span className="text-slate-400">{t('stat.neverUpdated')}</span>
        )
      }
    />
  );
}

/**
 * Days off, on their own tile.
 *
 * It used to be a subtitle under "Days left", which put two different facts on
 * one card and made the count read as a correction to the number above it. It is
 * a fact about the month in its own right: what he has already taken, and what is
 * still booked ahead of him.
 */
function OffDays({ summary }) {
  const { t } = useT();
  const taken = summary.offDaysElapsed || 0;
  const ahead = summary.offDaysAhead || 0;
  const cost = offDaysCost(summary);
  return (
    <Stat
      label={t('stat.offDays')}
      value={count(taken + ahead)}
      // What the days still booked will cost, at his own daily average. Not a
      // discouragement — the card exists so time off does not read as a bad day
      // — but a booked day is a decision, and this is the figure it turns on.
      flag={cost === null ? null : t('stat.offDaysCost', { amount: money(cost) })}
      // Each half only appears when it has something to say: "0 taken · 2 booked"
      // spends a line on a zero, and a month with neither says so in words.
      sub={
        taken + ahead === 0
          ? t('stat.noDaysOff')
          : [
              taken ? t('stat.offDaysTaken', { count: taken }) : null,
              ahead ? t('stat.offDaysAhead', { count: ahead }) : null,
            ]
              .filter(Boolean)
              .join(' · ')
      }
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
  const { t } = useT();
  const y = summary.yesterday;
  const charge = y ? chargingForDay(summary, y.date) : null;
  if (!charge) return null;
  return (
    <p className="text-[11px] text-slate-400 num px-1">
      {t('stat.yesterdayCharging', {
        cost: amount(charge.cost),
        rate: rateOf(charge.perKm),
        km: amount(charge.km),
      })}
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
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const pace = rollingPace(summary);

  if (editing || !progress) {
    return (
      <TargetEditor
        current={progress?.revenueStated ?? summary.revenueTarget ?? null}
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
      {/* The heading says what the card is about, so it has to show it: the
          figure he actually set. The rows below open on his pace, which is what
          "this pace pays you" needs in front of it — leaving the heading to
          promise a goal the card did not display until the third row. */}
      {/* Laid out like the rows beneath it — label left, figure hard right — so
          the goal lines up in the same column as every figure it is read
          against. The edit link travels with the heading rather than sitting in
          that column, where it would be the one thing in the stack that is not
          money. */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
          {/* Lifted off the shared `.label` microstyle. Every other card heading
              is a caption over figures the driver only reads; this one names the
              single thing on the screen he SETS, and at 12px muted grey it read
              as chrome rather than as the control it introduces. */}
          <h2 className="text-sm font-semibold text-slate-100">{t('target.heading')}</h2>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-slate-300 underline underline-offset-2"
          >
            {t('target.change')}
          </button>
        </div>
        <span className="num text-base text-slate-100 shrink-0">
          {money(progress.revenueStated)}
        </span>
      </div>

      {/* The pace comes first, and "this pace" then has something to point at.
          The row used to sit under the goal, where it named neither which pace
          nor what it was measured against, and read as though it might be
          describing the goal itself.

          Top to bottom it is one argument: what hitting the goal pays, what the
          current pace pays, the pace itself, the difference, and what closing it
          costs a day. The prize leads, because it is the reason to read on. */}
      <dl className="mt-3 space-y-2">
        {/* What the goal pays. Derived from the plan rather than asked for, so
            it answers the question the revenue figure raises — a goal in revenue
            is the number he can watch during a shift, and this is the number he
            actually takes home for hitting it. Conditional in its own hint,
            because it is the one figure here he has not earned yet. */}
        <Row
          label={t('target.goalPays')}
          hint={t('target.goalPaysHint')}
          value={money(progress.payWanted)}
          tone="text-accent"
        />

        <Row
          label={t('target.paysYou')}
          hint={t('target.takeHome')}
          value={money(progress.payAtPace)}
          tone="text-accent"
        />

        {/* The goal in revenue, ONLY when proration makes it a different figure
            from the one in the heading. In a full month the heading already says
            it and this row was the same number twice; in the month he starts,
            the heading carries the goal he set and this carries the share of it
            that this month can be asked for. */}
        {progress.prorated && (
          <Row
            label={t('target.goalThisMonth')}
            hint={t('target.proratedHint', { days: count(summary.operatingDays) })}
            value={money(progress.goalRevenue)}
          />
        )}

        {pace && (
          <Row
            label={t('target.pace')}
            hint={t('target.paceHint', { count: pace.shifts })}
            value={amount(pace.perShift)}
            trend={pace}
          />
        )}

        {progress.banked ? (
          <Row label={t('target.banked')} value="✓" tone="text-accent" />
        ) : progress.shortfall > 0 ? (
          <>
            <Row
              label={t('target.shortBy')}
              hint={t('target.inTakeHome')}
              value={money(progress.shortfall)}
              tone="text-warn"
            />
            <Row
              label={t('target.toClose')}
              hint={t('target.toCloseHint', { count: progress.daysLeft })}
              value={amount(progress.gapPerDay)}
              tone="text-warn"
            />
            {/* The same ask, said as a difference. The row above is what a day
                has to bring; this is how much more that is than the days he is
                already driving — the figure that decides whether the goal is one
                more fare or a different month. Absent when the pace covers it. */}
            {progress.liftPerDay > 0 && (
              <Row
                label={t('target.lift')}
                hint={t('target.liftHint')}
                value={`+${amount(progress.liftPerDay)}`}
                tone="text-warn"
              />
            )}
          </>
        ) : (
          <Row
            label={t('target.pastGoalBy')}
            hint={t('target.inTakeHome')}
            value={money(Math.abs(progress.shortfall))}
            tone="text-accent"
          />
        )}
      </dl>
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
  const { t } = useT();
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
      <h2 className="label">{t('editor.heading')}</h2>
      <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t('editor.blurb')}</p>

      {rungs.length > 0 && (
        <>
          <p className="text-xs text-slate-400 mt-3">
            {t('editor.lastMonth', {
              revenue: money(lastMonth.revenue),
              pay: money(lastMonth.driverPay),
              month: monthLabel(`${lastMonth.month}-01`),
              partial: lastMonth.partial ? t('editor.partMonth') : '',
            })}
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
                <span className="block text-[11px] text-slate-400">{t(rung.labelKey)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center gap-2 mt-3">
        <span className="text-sm text-slate-400">{t('unit.currency')}</span>
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
          {busy ? t('editor.saving') : t('editor.save')}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {t('editor.cancel')}
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
  const { t } = useT();
  const started = summary.startDate ? dateLabel(summary.startDate) : null;
  return (
    <p className="rounded-lg border border-warn/30 bg-warn/[0.06] px-3.5 py-2.5 text-sm text-slate-200 leading-relaxed">
      <span className="text-warn font-medium">{t('partial.tag')}</span>
      {started ? t('partial.started', { date: started }) : '.'}
      {t('partial.scaled', {
        days: count(summary.operatingDays),
        next: nextMonthName(summary.month),
      })}
    </p>
  );
}

function nextMonthName(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return monthName(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
}

/**
 * Progressive disclosure. Everything explanatory lives behind one of these,
 * closed by default so the main screen stays a five-second read.
 */
function Details({ summary, month, open, setOpen }) {
  const { t } = useT();
  // Three panels, and the split is by question rather than by data type: how the
  // pay works, what the driving costs, where the car is. Costs get a tab of their
  // own so a screen about earning is never half about spending — and cash lives
  // on the main screen, because knowing what he is holding is not a detail.
  const panels = [
    { key: 'pay', label: t('details.pay') },
    { key: 'costs', label: t('details.costs') },
    { key: 'car', label: t('details.car') },
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
  const { t } = useT();
  const trips = tripsPerDay(summary);
  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="label">{t('projected.heading')}</h2>
        <span className="text-xs text-slate-400">{monthLabel(`${month}-01`)}</span>
      </div>
      <dl className="mt-3 space-y-2">
        <Row label={t('projected.monthEnd')} value={amount(summary.projectedRevenue)} />
        {trips && <Row label={t('projected.tripsShift')} value={String(trips)} />}
        {summary.push?.revenuePerTrip && (
          <Row label={t('projected.revenueTrip')} value={amount(summary.push.revenuePerTrip)} />
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
  const { t } = useT();
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
            {trend.direction === 'up' ? '▲' : '▼'} {amount(Math.abs(trend.delta))}{' '}
            {t('target.trend', { shifts: trend.previousShifts })}
          </span>
        )}
      </dd>
    </div>
  );
}
