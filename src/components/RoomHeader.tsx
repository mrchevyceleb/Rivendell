import type { ReactNode } from 'react';

type RoomHeaderProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function RoomHeader({ eyebrow, title, subtitle, actions }: RoomHeaderProps) {
  return (
    <header className="room-header">
      <div>
        <p className="r-eyebrow-gold">{eyebrow}</p>
        <h1 className="room-title">{title}</h1>
        {subtitle ? <p className="room-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="room-actions">{actions}</div> : null}
    </header>
  );
}
