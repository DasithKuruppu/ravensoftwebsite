import { monthLabel, shiftMonth, currentMonth } from '../format.js';
import { useT } from '../i18n/index.jsx';

export default function MonthNav({ month, setMonth, right = null, tight = false }) {
  const { t } = useT();
  return (
    <div className={`flex items-center gap-3 flex-wrap relative ${tight ? '' : 'mb-5'}`}>
      <div className="flex items-center gap-1">
        <button className="btn px-2.5" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t('month.prev')}>
          ‹
        </button>
        <span className="num text-base text-slate-100 min-w-[10rem] text-center">
          {monthLabel(month)}
        </span>
        <button className="btn px-2.5" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t('month.next')}>
          ›
        </button>
      </div>
      {month !== currentMonth() && (
        <button className="btn text-xs" onClick={() => setMonth(currentMonth())}>
          {t('month.today')}
        </button>
      )}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}
