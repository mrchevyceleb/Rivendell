import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'ghost' | 'gold' | 'elf' | 'danger';
};

export function Button({ tone = 'ghost', className = '', ...props }: ButtonProps) {
  return <button className={`r-btn r-btn-${tone} ${className}`} {...props} />;
}

export function Metric({ label, value, tone = 'gold' }: { label: string; value: string | number; tone?: 'gold' | 'elf' | 'emerald' | 'rose' }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'gold' | 'elf' | 'rose' | 'emerald' }) {
  return <span className={`r-chip ${tone === 'neutral' ? '' : `r-chip-${tone}`}`}>{children}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <p className="r-display">{title}</p>
      <span>{body}</span>
    </div>
  );
}

export function Surface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`r-card surface ${className}`}>{children}</section>;
}
