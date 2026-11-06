import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return <button type="button" {...props} className={clsx('button', variant, className)} />;
}
