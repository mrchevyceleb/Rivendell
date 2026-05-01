import { Router } from 'express';
import { fetchAdminEmails, fetchAdminQueueJobs, fetchAdminTasks } from '../lib/assistantData.ts';
import { emailStore, messageStore } from '../lib/roomStores.ts';
import { listTasks } from '../lib/taskStore.ts';
import { listJobs } from '../worker/store.ts';
import { asyncHandler } from './helpers.ts';

export const summaryRouter = Router();

summaryRouter.get('/', asyncHandler(async (_req, res) => {
  const [tasks, emails, messages, localJobs, remoteJobs] = await Promise.all([
    fetchAdminTasks().catch(() => listTasks()),
    fetchAdminEmails().catch(() => emailStore.list()),
    messageStore.list(),
    listJobs(),
    fetchAdminQueueJobs().catch(() => []),
  ]);
  const jobs = [...remoteJobs, ...localJobs];
  res.json({
    tasksDue: tasks.filter((task) => task.due === 'today' || task.due === 'overdue').length,
    unreadEmail: emails.filter((email) => email.unread).length,
    pendingMessages: messages.filter((message) => message.status === 'needs_reply').length,
    queuedJobs: jobs.filter((job) => job.status === 'queued').length,
    runningJobs: jobs.filter((job) => job.status === 'running').length,
    needsReview: jobs.filter((job) => job.status === 'needs_review').length,
  });
}));
