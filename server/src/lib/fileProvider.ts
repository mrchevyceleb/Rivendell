const TRANSIENT_FILE_PROVIDER_CODES = new Set(['EAGAIN', 'EDEADLK', 'EBUSY']);
const TRANSIENT_FILE_PROVIDER_MESSAGE =
  /(unknown system error -11|resource deadlock avoided|os error 11|resource temporarily unavailable)/i;

export function isTransientFileProviderError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | undefined;
  const message = String((e as Error | undefined)?.message ?? err ?? '');
  return Boolean(
    (e?.code && TRANSIENT_FILE_PROVIDER_CODES.has(e.code)) ||
    e?.errno === -11 ||
    e?.errno === 11 ||
    e?.errno === -35 ||
    e?.errno === 35 ||
    TRANSIENT_FILE_PROVIDER_MESSAGE.test(message),
  );
}

export function fileProviderErrorMessage(err: unknown): string {
  return String((err as Error | undefined)?.message ?? err ?? 'unknown file-provider error');
}
