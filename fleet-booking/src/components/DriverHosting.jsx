import { money } from '../format.js';
import { useT } from '../i18n/index.jsx';

/**
 * "I'll feed and house the driver."
 *
 * Offered because on a hotel tour there is usually a staff room going spare, and
 * a customer already paying for rooms and meals can cover the driver's at close
 * to no marginal cost — while the fleet would be paying for them in cash. Both
 * sides are better off, so the saving belongs on the screen where the customer
 * can see it and choose.
 *
 * Only rendered when the hire actually has nights in it. A checkbox offering to
 * house a driver on a day trip that is home by six is a question the customer
 * has to stop and work out the meaning of.
 */
export default function DriverHosting({ rates, nights, checked, onChange }) {
  const { t } = useT();
  if (!nights || nights < 1) return null;

  const full = rates?.overnightStay ?? 5000;
  const hosted = Math.min(rates?.overnightStayHosted ?? 2000, full);
  const savingPerNight = full - hosted;
  if (savingPerNight <= 0) return null;

  const currency = rates?.currency;

  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
        checked ? 'border-brand bg-brand-soft' : 'border-line bg-canvas hover:border-ink-400'
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-brand"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">
          {t('hosting.label')}
        </span>
        <span className="block text-xs text-ink-500">
          {checked ? (
            <>
              {/* With the charge waived entirely there is no "a night" rate to
                  name, and saying "LKR 0 a night instead of LKR 5,000" reads as
                  a bug rather than a saving. */}
              {hosted === 0
                ? t('hosting.savingAll', { total: money(savingPerNight * nights, currency) })
                : t('hosting.savingPartial', {
                    total: money(savingPerNight * nights, currency),
                    hosted: money(hosted, currency),
                    full: money(full, currency),
                  })}{' '}
              {t('hosting.hotelNote', { nights: t('quote.nightsAway', { count: nights }) })}
            </>
          ) : (
            <>
              {t('hosting.saves', {
                perNight: money(savingPerNight, currency),
                total: money(savingPerNight * nights, currency),
                nights: t('quote.nightsAway', { count: nights }),
              })}
            </>
          )}
        </span>
      </span>
    </label>
  );
}
