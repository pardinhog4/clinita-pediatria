import type { LucideIcon } from 'lucide-react';
export function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <div className="metric card">
      <span className="metric-label">
        <Icon size={16} />
        {title}
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
