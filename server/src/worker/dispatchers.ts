import type { RivendellJob } from '../data/mock.ts';

export type DispatcherResult = {
  status?: 'done' | 'needs_review';
  needs_review_reason?: string;
  result: unknown;
};

export async function dispatchDryRun(job: RivendellJob): Promise<DispatcherResult> {
  const reviewSkills = new Set(['draft-customer-reply', 'draft-email', 'dispatch-to-autofix-bot']);
  await new Promise((resolve) => setTimeout(resolve, 900));
  return {
    status: reviewSkills.has(job.skill) ? 'needs_review' : 'done',
    needs_review_reason: reviewSkills.has(job.skill) ? 'Human approval required before sending or handing off.' : undefined,
    result: {
      mode: 'dry-run',
      skill: job.skill,
      summary: `Prepared ${job.skill} work item.`,
    },
  };
}
