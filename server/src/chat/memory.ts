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

// Linux (Moria) equivalent of the macOS readers above: MemAvailable from
// /proc/meminfo is the kernel's own estimate of allocatable memory, which is a
// far better signal than `free` alone. Reports kB; convert to bytes.
function readLinuxMemAvailable(): MemorySnapshot | null {
  if (platform() !== 'linux') return null;
  try {
    const out = readFileSync('/proc/meminfo', 'utf8');
    const match = out.match(/^MemAvailable:\s+(\d+)\s*kB/m);
    if (!match) return null;
    const kb = Number(match[1]);
    if (!Number.isFinite(kb)) return null;
    return { availableBytes: kb * 1024, source: 'meminfo' };
  } catch {
    return null;
  }
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
