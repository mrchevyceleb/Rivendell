import { Router } from 'express';
import { fetchAdminEmails, fetchAdminTasks } from '../lib/assistantData.ts';
import { listJobs } from '../worker/store.ts';
import { asyncHandler } from './helpers.ts';

export const summaryRouter = Router();

summaryRouter.get('/', asyncHandler(async (_req, res) => {
  // Each upstream resolves independently; failures degrade to 0 for that
  // counter (with the failure recorded in `partial`) rather than fabricated
  // data. Messages/queue counters drop to 0 until a real source exists.
  const [tasksRes, emailsRes, jobsRes] = await Promise.allSettled([
    fetchAdminTasks(),
    fetchAdminEmails(),
    listJobs(),
  ]);

  const tasks = tasksRes.status === 'fulfilled' ? tasksRes.value : [];
  const emails = emailsRes.status === 'fulfilled' ? emailsRes.value : [];
  const jobs = jobsRes.status === 'fulfilled' ? jobsRes.value : [];

  const partial: Record<string, string> = {};
  if (tasksRes.status === 'rejected') partial.tasks = String((tasksRes.reason as any)?.message || tasksRes.reason);
  if (emailsRes.status === 'rejected') partial.emails = String((emailsRes.reason as any)?.message || emailsRes.reason);
  if (jobsRes.status === 'rejected') partial.jobs = String((jobsRes.reason as any)?.message || jobsRes.reason);

  res.json({
    tasksDue: tasks.filter((task) => task.due === 'today' || task.due === 'overdue').length,
    unreadEmail: emails.filter((email) => email.unread).length,
    pendingMessages: 0,
    queuedJobs: jobs.filter((job) => job.status === 'queued').length,
    runningJobs: jobs.filter((job) => job.status === 'running').length,
    needsReview: jobs.filter((job) => job.status === 'needs_review').length,
    partial: Object.keys(partial).length ? partial : undefined,
  });
}));
