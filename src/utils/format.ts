export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function timeAgo(input: string | number): string {
  const ts = typeof input === 'number' ? input : new Date(input).getTime();
  if (!Number.isFinite(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}
