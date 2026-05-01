import { jobs, newJob, type JobStatus, type RivendellJob } from '../data/mock.ts';
import { JsonStore } from '../lib/jsonStore.ts';
import { supabase } from '../lib/supabase.ts';

const jobStore = new JsonStore<RivendellJob & { id: string }>('jobs.json', jobs);

export async function listJobs(): Promise<RivendellJob[]> {
  if (!supabase) return (await jobStore.list()).sort(sortNewest);
  const { data, error } = await supabase
    .from('rivendell_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    console.warn(`[jobs] Supabase read failed: ${error.message}`);
    return [...jobs].sort(sortNewest);
  }
  return (data ?? []) as RivendellJob[];
}

export async function enqueueJob(input: Partial<RivendellJob> & { skill: string }): Promise<RivendellJob> {
  const job = newJob(input);
  if (!supabase) {
    await jobStore.create(job);
    return job;
  }
  const { data, error } = await supabase.from('rivendell_jobs').insert(job).select('*').single();
  if (error) {
    console.warn(`[jobs] Supabase insert failed: ${error.message}`);
    jobs.unshift(job);
    return job;
  }
  return data as RivendellJob;
}

export async function nextQueuedJob(): Promise<RivendellJob | null> {
  if (!supabase) return (await jobStore.list()).find((job) => job.status === 'queued') ?? null;
  const { data, error } = await supabase
    .from('rivendell_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[jobs] Supabase queued read failed: ${error.message}`);
    return jobs.find((job) => job.status === 'queued') ?? null;
  }
  return (data as RivendellJob | null) ?? null;
}

export async function updateJob(id: string, patch: Partial<RivendellJob> & { status?: JobStatus }): Promise<void> {
  if (!supabase) {
    await jobStore.update(id, patch as any);
    return;
  }
  const { error } = await supabase.from('rivendell_jobs').update(patch).eq('id', id);
  if (error) console.warn(`[jobs] Supabase update failed: ${error.message}`);
}

function sortNewest(a: RivendellJob, b: RivendellJob) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}
