import { statusLabels } from '@/lib/types';
export function Badge({ value, label }: { value: string; label?: string }) {
  const tone =
    value === 'CONFIRMED'
      ? 'blue'
      : ['APPROVED', 'COMPLETED', 'SETTLED', 'MANUAL', 'DONE'].includes(value)
        ? 'green'
        : ['CANCELLED', 'ABSENT', 'REJECTED', 'HIGH'].includes(value)
          ? 'red'
          : ['PENDING', 'REVIEW', 'RETURNED'].includes(value)
            ? 'amber'
            : 'neutral';
  return <span className={'badge ' + tone}>{label || statusLabels[value] || value}</span>;
}
