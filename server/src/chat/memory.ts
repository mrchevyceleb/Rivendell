import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { freemem, platform, totalmem } from 'node:os';

// When available system memory drops below this, spawning another agent child
// is likely to make macOS kill the new process. On macOS, raw "free" pages are
// often tiny even when memory pressure is healthy, so include reclaimable page
// classes instead of gating on Pages free alone.
const MIN_AVAILABLE_MEMORY_BYTES = 750 * 1024 * 1024; // 750 MB
const MIN_AVAILABLE_MEMORY_RATIO = 0.05;

type MemorySource = 'memory_pressure' | 'vm_stat' | 'meminfo' | 'os';
type MemorySnapshot = { availableBytes: number; source: MemorySource };
type MemoryGuardResult =
  | { ok: true }
  | { ok: false; availableMb: number; totalMb: number; source: MemorySource };

export class MemoryPressureSpawnError extends Error {
  readonly code = 'RIVENDELL_MEMORY_PRESSURE';

  constructor(cli: string, result: Exclude<MemoryGuardResult, { ok: true }>) {
    super(
      `system memory pressure too high to spawn ${cli} ` +
      `(${result.availableMb} MB available via ${result.source} of ${result.totalMb} MB total). ` +
      'Close some apps or wait for the load to drop, then try again.',
    );
    this.name = 'MemoryPressureSpawnError';
  }
}

export function assertMemoryAvailableForSpawn(cli: string): void {
  const guard = checkMemoryGuard();
  if (!guard.ok) {
    const error = new MemoryPressureSpawnError(cli, guard);
    console.warn(`[chat ${cli}] memory-guard refused spawn: ${error.message}`);
    throw error;
  }
}

function checkMemoryGuard(): MemoryGuardResult {
  const snapshot =
    readMacVmStatAvailableMemory() ??
    readMacMemoryPressure() ??
    readLinuxMemAvailable() ??
    { availableBytes: freemem(), source: 'os' as const };
  const minimumBytes = Math.max(MIN_AVAILABLE_MEMORY_BYTES, totalmem() * MIN_AVAILABLE_MEMORY_RATIO);
  if (snapshot.availableBytes >= minimumBytes) return { ok: true };
  return {
    ok: false,
    availableMb: Math.round(snapshot.availableBytes / (1024 * 1024)),
    totalMb: Math.round(totalmem() / (1024 * 1024)),
    source: snapshot.source,
  };
}

// Reads a cgroup numeric file. Returns null for missing files, blanks, or the
// "max" / huge-sentinel values that mean "no limit".
function readCgroupInt(path: string): number | null {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw === '' || raw === 'max') return null;
    const n = Number(raw);
    // cgroup v1 encodes "unlimited" as a value near 2^63, well past the safe
    // integer range; treat anything that large as no limit.
    if (!Number.isFinite(n) || n >= Number.MAX_SAFE_INTEGER) return null;
    return n;
  } catch {
    return null;
  }
}

// Host-level allocatable memory from /proc/meminfo (kernel's own estimate, far
// better than `free` alone). Reports kB; convert to bytes.
function readProcMemAvailable(): number | null {
  try {
    const out = readFileSync('/proc/meminfo', 'utf8');
    const match = out.match(/^MemAvailable:\s+(\d+)\s*kB/m);
    if (!match) return null;
    const kb = Number(match[1]);
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

// If TARDIS runs under a cgroup memory limit (container or systemd
// MemoryMax), the host MemAvailable can look healthy while this process's own
// cgroup is near OOM. Return the cgroup's available bytes (limit - current)
// when a finite limit is set, else null. cgroup v2 first, then v1.
function readCgroupAvailableBytes(): number | null {
  const v2Max = readCgroupInt('/sys/fs/cgroup/memory.max');
  if (v2Max !== null) {
    const v2Cur = readCgroupInt('/sys/fs/cgroup/memory.current') ?? 0;
    return Math.max(0, v2Max - v2Cur);
  }
  const v1Max = readCgroupInt('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if (v1Max !== null) {
    const v1Cur = readCgroupInt('/sys/fs/cgroup/memory/memory.usage_in_bytes') ?? 0;
    return Math.max(0, v1Max - v1Cur);
  }
  return null;
}

// Linux equivalent of the macOS readers above. Take the tighter of host
// MemAvailable and the process's cgroup headroom so a memory-capped service
// can't green-light a spawn that the cgroup would immediately OOM-kill.
function readLinuxMemAvailable(): MemorySnapshot | null {
  if (platform() !== 'linux') return null;
  const host = readProcMemAvailable();
  if (host === null) return null;
  const cgroup = readCgroupAvailableBytes();
  const availableBytes = cgroup === null ? host : Math.min(host, cgroup);
  return { availableBytes, source: 'meminfo' };
}

function readMacMemoryPressure(): MemorySnapshot | null {
  if (platform() !== 'darwin') return null;
  try {
    const out = execFileSync('/usr/bin/memory_pressure', [], { encoding: 'utf8', timeout: 1000 });
    const match = out.match(/System-wide memory free percentage:\s+(\d+(?:\.\d+)?)%/);
    if (!match) return null;
    const ratio = Number(match[1]) / 100;
    if (!Number.isFinite(ratio)) return null;
    return {
      availableBytes: Math.max(0, Math.min(totalmem(), totalmem() * ratio)),
      source: 'memory_pressure',
    };
  } catch {
    return null;
  }
}

function readMacVmStatAvailableMemory(): MemorySnapshot | null {
  if (platform() !== 'darwin') return null;
  try {
    const out = execFileSync('/usr/bin/vm_stat', [], { encoding: 'utf8', timeout: 1000 });
    const pageSizeMatch = out.match(/page size of (\d+) bytes/);
    if (!pageSizeMatch) return null;
    const pageSize = Number(pageSizeMatch[1]);
    if (!Number.isFinite(pageSize)) return null;
    const freePages = readVmStatPages(out, 'Pages free');
    if (freePages === null) return null;
    const availablePages =
      freePages +
      (readVmStatPages(out, 'Pages inactive') ?? 0) +
      (readVmStatPages(out, 'Pages speculative') ?? 0) +
      (readVmStatPages(out, 'Pages purgeable') ?? 0);
    return { availableBytes: pageSize * availablePages, source: 'vm_stat' };
  } catch {
    return null;
  }
}

function readVmStatPages(out: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = out.match(new RegExp(`${escaped}:\\s+([\\d,]+)\\.`));
  if (!match) return null;
  const pages = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(pages) ? pages : null;
}
