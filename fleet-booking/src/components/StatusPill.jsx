import { useT } from '../i18n/index.jsx';

/** Where a booking stands, in one word and one colour. */
const STYLES = {
  pending: 'bg-warn/10 text-warn',
  confirmed: 'bg-brand-soft text-brand-dark',
  declined: 'bg-danger/10 text-danger',
  cancelled: 'bg-line text-ink-500',
  completed: 'bg-line text-ink-700',
};

export default function StatusPill({ status }) {
  const { t } = useT();
  const className = STYLES[status] || 'bg-line text-ink-500';
  // An unknown status shows its own code rather than nothing — a blank pill
  // beside a booking is worse than an ugly one.
  const label = t(`status.${status}`);
  return <span className={`pill ${className}`}>{label === `status.${status}` ? status : label}</span>;
}
