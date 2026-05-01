export function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export function hasEnv(name: string): boolean {
  return Boolean(process.env[name]);
}
