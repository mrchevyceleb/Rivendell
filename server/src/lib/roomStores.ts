import { cronJobs, emails, family, messages, plEntries } from '../data/mock.ts';
import { JsonStore } from './jsonStore.ts';

export const emailStore = new JsonStore('email.json', emails);
export const messageStore = new JsonStore('messages.json', messages);
export const familyStore = new JsonStore('family.json', family.map((item) => ({ ...item, completed: false })));
export const plStore = new JsonStore('pl-entries.json', plEntries);
export const cronStore = new JsonStore('cron-jobs.json', cronJobs);
