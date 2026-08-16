import PlaceField from './PlaceField.jsx';
import DriverHosting from './DriverHosting.jsx';
import { DURATION_CHOICES } from '../../shared/pricing.mjs';
import { km as formatKm, money } from '../format.js';
import { useT } from '../i18n/index.jsx';
import { vehicleParts } from '../i18n/vehicles.js';

/**
 * Hiring the car by the day, with no itinerary.
 *
 * The other form asks a customer to describe a journey before it will name a
 * price. Plenty of people do not have one — they want the car and a driver for
 * four days and will decide where to go over breakfast. Making them invent a
 * route produces a number that is wrong the moment they change their minds.
 *
 * So this asks for four things: where to collect them, when, how many days, and
 * roughly how far. Everything else is the same rate card, so the two forms
 * cannot quote differently for the same days and kilometres.
 */
export default function DailyHireForm({
  rates,
  origin,
  setOrigin,
  startLocal,
  setStartLocal,
  minStart,
  days,
  setDays,
  allowanceKm,
  setAllowanceKm,
  passengers,
  setPassengers,
  seats,
  errorFor,
  nights,
  driverHosted,
  setDriverHosted,
}) {
  const { t } = useT();
  const included = days * (rates?.includedKmPerDay ?? 150);
  const choices = allowanceChoices(included, t);

  return (
    <>
      <section className="card p-5">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-500">
          {t('daily.heading')}
        </h2>
        <p className="mb-4 text-xs text-ink-500">
          {t('daily.intro', {
            vehicle: rates?.vehicleClasses?.[0] ? vehicleParts(t, rates.vehicleClasses[0])[0] : '—',
          })}
        </p>
        <div className="space-y-4">
          <PlaceField
            label={t('daily.collect')}
            value={origin}
            onChange={setOrigin}
            placeholder={t('route.fromPlaceholder')}
            error={errorFor('origin')}
            marker={<span className="block h-2.5 w-2.5 rounded-full bg-brand" />}
            autoFocus
          />
          <div className="sm:max-w-xs">
            <label className="label" htmlFor="daily-start">
              {t('daily.starting')}
            </label>
            <input
              id="daily-start"
              type="datetime-local"
              className={`input ${errorFor('startAt') ? 'border-danger' : ''}`}
              value={startLocal}
              min={minStart}
              onChange={(e) => setStartLocal(e.target.value)}
            />
            <p className={`mt-1 text-xs ${errorFor('startAt') ? 'text-danger' : 'text-ink-500'}`}>
              {errorFor('startAt') || t('when.timezone')}
            </p>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">
          {t('daily.lengthHeading')}
        </h2>

        <span className="label">{t('daily.days')}</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
          {DURATION_CHOICES.map((c) => (
            <button
              key={c.days}
              type="button"
              onClick={() => setDays(c.days)}
              aria-pressed={days === c.days}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                days === c.days
                  ? 'border-brand bg-brand-soft font-medium text-brand-dark'
                  : 'border-line text-ink-700 hover:border-ink-400'
              }`}
            >
              {t(`duration.${c.days}`)}
            </button>
          ))}
        </div>
        {errorFor('days') && <p className="mt-1.5 text-xs text-danger">{errorFor('days')}</p>}

        <div className="mt-5">
          <span className="label">{t('daily.distance')}</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Distance allowance">
            {choices.map((c) => (
              <button
                key={c.km}
                type="button"
                onClick={() => setAllowanceKm(c.km)}
                aria-pressed={allowanceKm === c.km}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  allowanceKm === c.km
                    ? 'border-brand bg-brand-soft font-medium text-brand-dark'
                    : 'border-line text-ink-700 hover:border-ink-400'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className={`mt-1.5 text-xs ${errorFor('allowanceKm') ? 'text-danger' : 'text-ink-500'}`}>
            {errorFor('allowanceKm') ||
              t('daily.allowanceNote', {
                km: formatKm(included),
                days: t('unit.days_other', { n: days, count: days }),
                rate: money(rates?.perKmOver ?? 90, rates?.currency),
              })}
          </p>
        </div>

        <div className="mt-5">
          <DriverHosting
            rates={rates}
            nights={nights}
            checked={driverHosted}
            onChange={setDriverHosted}
          />
        </div>

        <div className="mt-5">
          <span className="label">{t('who.passengers')}</span>
          {seats <= 6 ? (
            <div className="flex gap-1.5" role="group" aria-label="Passengers">
              {Array.from({ length: seats }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPassengers(n)}
                  aria-pressed={Number(passengers) === n}
                  className={`h-10 w-12 rounded-lg border text-sm font-medium transition ${
                    Number(passengers) === n
                      ? 'border-brand bg-brand-soft text-brand-dark'
                      : 'border-line text-ink-700 hover:border-ink-400'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <input
              type="number"
              className="input max-w-40"
              min="1"
              max={seats}
              value={passengers}
              onChange={(e) => setPassengers(e.target.value)}
            />
          )}
          <p className={`mt-1 text-xs ${errorFor('passengers') ? 'text-danger' : 'text-ink-500'}`}>
            {errorFor('passengers') || t('who.upTo', { n: seats })}
          </p>
        </div>
      </section>
    </>
  );
}

/**
 * The included distance, then round numbers above it.
 *
 * Offered as steps rather than a free number field for the same reason the
 * durations are: a customer guessing "1,347 km" is not being more accurate, and
 * every odd number has to be validated back down.
 */
function allowanceChoices(included, t) {
  const steps = [included, included + 200, included + 500, included + 1000];
  return steps.map((km, i) => ({
    km,
    label: i === 0 ? t('daily.included', { km: included }) : t('unit.km', { n: km }),
  }));
}
