import { Inbox, ListChecks, MessageSquareText, Plus, RadioTower, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Surface } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import type { EmailItem, MessageItem, RivendellJob, ScribeEvent, Task } from '../data/types';
import { useEmails, useHallSummary, useMessages, useScribeEvents, useTasks, useWeavings } from '../hooks/useRoomData';
import { useScribeSocket } from '../hooks/useScribeSocket';
import { Corner, Evenstar, IlluminatedCapital } from '../theme/Ornaments';
import { timeAgo } from '../utils/format';

export function Dashboard() {
  const now = useNow();
  const { data: summary } = useHallSummary();
  const { data: tasks = [] } = useTasks();
  const { data: emails = [] } = useEmails();
  const { data: messages = [] } = useMessages();
  const { data: jobs = [] } = useWeavings();
  const { data: initialEvents = [] } = useScribeEvents();
  const { events, state: scribeState } = useScribeSocket(initialEvents);
  const eventFeed = events.length ? events : initialEvents;
  const latest = eventFeed.slice(-5).reverse();
  const activeJob = jobs.find((job) => job.status === 'running') ?? jobs.find((job) => job.status === 'queued');
  const recentJobs = useMemo(
    () => [...jobs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 4),
    [jobs],
  );
  const brief = buildExecutiveBrief({
    tasks,
    emails,
    messages,
    jobs,
    latestEvents: latest,
  });
  const metrics = buildMetrics({ summary, tasks, emails, messages, jobs });

  return (
    <div className="room-scroll r-scroll">
      <RoomHeader
        eyebrow="Dashboard"
        title="Today at a glance"
        subtitle="Your always-on office, awake on your private network."
        actions={
          <>
            <Button tone="gold" onClick={() => window.location.assign('/')}>
              <Plus size={15} />
              New errand
            </Button>
          </>
        }
      />

      <div className="hall-grid">
        <section className="illuminated-brief">
          <Corner position="tl" />
          <Corner position="tr" />
          <Corner position="bl" />
          <Corner position="br" />
          <IlluminatedCapital letter="E" />
          <div className="brief-copy">
            <div className="brief-heading-row">
              <div>
                <p className="r-eyebrow-gold">AI Executive Summary</p>
                <h2>{brief.headline}</h2>
              </div>
              <Chip tone={brief.tone}>{brief.posture}</Chip>
            </div>
            <p>{brief.summary}</p>
            <div className="brief-live-strip">
              <span className={`live-orb ${scribeState === 'open' ? 'is-live' : ''}`} />
              <Sparkles size={13} />
              <strong>{scribeState === 'open' ? 'Scribe stream live' : 'Scribe stream reconnecting'}</strong>
              <span>last activity {brief.updatedAt ? timeAgo(brief.updatedAt) : 'unknown'} ago</span>
              <span>{activeJob ? `${activeJob.skill} ${activeJob.status}` : 'queue standing watch'}</span>
            </div>
            <div className="brief-grid">
              <div>
                <span>Needs attention</span>
                <strong>{brief.attention}</strong>
              </div>
              <div>
                <span>Being handled</span>
                <strong>{brief.handled}</strong>
              </div>
              <div>
                <span>Recommended next move</span>
                <strong>{brief.nextMove}</strong>
              </div>
            </div>
          </div>
        </section>

        <div className="metric-grid">
          {metrics.map((metric) => (
            <LiveMetric key={metric.label} {...metric} />
          ))}
        </div>

        <Surface className="hall-card">
          <div className="card-heading">
            <div>
              <p className="r-eyebrow">At hand</p>
              <h3>The Council</h3>
            </div>
            <ListChecks size={18} />
          </div>
          <div className="stack-list">
            {tasks.slice(0, 4).map((task) => (
              <div className="list-row" key={task.id}>
                <span className={`priority-dot priority-${task.priority}`} />
                <div>
                  <strong>{task.title}</strong>
                  <small>
                    {task.project} · {task.due}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </Surface>

        <Surface className="hall-card">
          <div className="signet-row">
            <span className="signet-small">
              <Evenstar size={18} color="var(--r-gold)" />
            </span>
            <div>
              <p className="r-eyebrow">Elrond</p>
              <h3>Return to the Hall</h3>
            </div>
          </div>
          <p>The Hall is the live chat cockpit for Claude Code and Codex inside ASSISTANT-HUB.</p>
          <Button tone="elf" onClick={() => window.location.assign('/')}>
            Open Hall
          </Button>
        </Surface>

        <Surface className="hall-card">
          <div className="card-heading">
            <div>
              <p className="r-eyebrow">Weavings</p>
              <h3>Employee queue</h3>
            </div>
            <div className={`queue-radar ${activeJob ? 'is-active' : ''}`}>
              <RadioTower size={18} />
            </div>
          </div>
          {activeJob ? (
            <div className="featured-job">
              <Chip tone={activeJob.status === 'running' ? 'elf' : 'gold'}>{activeJob.status}</Chip>
              <strong>{activeJob.skill}</strong>
              <span>{activeJob.prompt || activeJob.source || 'Queued work'}</span>
            </div>
          ) : (
            <div className="featured-job quiet">
              <Chip tone="emerald">watching</Chip>
              <strong>No active queue item</strong>
              <span>Last activity {latest[0] ? timeAgo(latest[0].ts) : timeAgo(now)} ago. New work will appear here as it moves.</span>
            </div>
          )}
          <div className="queue-counts">
            <span>{summary?.queuedJobs ?? 0} queued</span>
            <span>{summary?.runningJobs ?? 0} running</span>
          </div>
          <div className="queue-trail">
            {recentJobs.map((job) => (
              <div key={job.id}>
                <span className={`status-pin status-${job.status}`} />
                <strong>{job.skill}</strong>
                <small>{job.status}</small>
              </div>
            ))}
          </div>
        </Surface>

        <Surface className="hall-card wide">
          <div className="card-heading">
            <div>
              <p className="r-eyebrow">Scribe</p>
              <h3>Latest activity</h3>
            </div>
            <div className="scribe-state">
              <span className={`live-orb ${scribeState === 'open' ? 'is-live' : ''}`} />
              <Inbox size={18} />
            </div>
          </div>
          <div className="log-list compact-log">
            {latest.map((event, index) => (
              <div className={index === 0 ? 'fresh-event' : ''} key={event.id}>
                <code>{timeAgo(event.ts)}</code>
                <Chip tone={event.level === 'error' ? 'rose' : event.level === 'tool' ? 'elf' : 'neutral'}>{event.level}</Chip>
                <span>{event.text}</span>
              </div>
            ))}
          </div>
        </Surface>

        <Surface className="hall-card">
          <div className="card-heading">
            <div>
              <p className="r-eyebrow">Messages</p>
              <h3>Messages</h3>
            </div>
            <MessageSquareText size={18} />
          </div>
          <p className="muted">Draft-only message actions are wired through the server route. Nothing sends without review.</p>
        </Surface>
      </div>
    </div>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return now;
}

function LiveMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: 'gold' | 'elf' | 'emerald' | 'rose';
}) {
  return (
    <div className={`metric live-metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function buildMetrics({
  summary,
  tasks,
  emails,
  messages,
  jobs,
}: {
  summary?: {
    tasksDue: number;
    unreadEmail: number;
    pendingMessages: number;
    needsReview: number;
  };
  tasks: Task[];
  emails: EmailItem[];
  messages: MessageItem[];
  jobs: RivendellJob[];
}) {
  const dueTask = tasks.find((task) => task.due === 'overdue') ?? tasks.find((task) => task.due === 'today');
  const unread = emails.find((email) => email.unread);
  const pendingMessage = messages.find((message) => message.status === 'needs_reply');
  const reviewJob = jobs.find((job) => job.status === 'needs_review');

  return [
    {
      label: 'Tasks due',
      value: summary?.tasksDue ?? 0,
      detail: dueTask ? `${dueTask.project}: ${dueTask.due}` : 'board is clear',
      tone: 'gold',
    },
    {
      label: 'Unread mail',
      value: summary?.unreadEmail ?? 0,
      detail: unread ? `latest from ${unread.from}` : 'no unread priority mail',
      tone: 'elf',
    },
    {
      label: 'Messages',
      value: summary?.pendingMessages ?? 0,
      detail: pendingMessage ? `${pendingMessage.source} needs reply` : 'channels quiet',
      tone: 'emerald',
    },
    {
      label: 'Needs review',
      value: summary?.needsReview ?? 0,
      detail: reviewJob ? reviewJob.skill : 'nothing waiting',
      tone: 'rose',
    },
  ] as const;
}

function buildExecutiveBrief({
  tasks,
  emails,
  messages,
  jobs,
  latestEvents,
}: {
  tasks: Task[];
  emails: EmailItem[];
  messages: MessageItem[];
  jobs: RivendellJob[];
  latestEvents: ScribeEvent[];
}) {
  const urgentTasks = tasks.filter((task) => task.due === 'today' || task.due === 'overdue' || task.priority === 'high');
  const overdueTasks = tasks.filter((task) => task.due === 'overdue');
  const unread = emails.filter((email) => email.unread);
  const draftReplies = emails.filter((email) => email.status === 'drafted');
  const pendingMessages = messages.filter((message) => message.status === 'needs_reply');
  const reviewJobs = jobs.filter((job) => job.status === 'needs_review');
  const runningJobs = jobs.filter((job) => job.status === 'running');
  const queuedJobs = jobs.filter((job) => job.status === 'queued');
  const latestNote = latestEvents.find((event) => event.level === 'note' || event.level === 'system');
  const latestEvent = latestEvents[0];

  const pressure =
    overdueTasks.length > 0 || reviewJobs.length > 1
      ? 'High attention'
      : urgentTasks.length > 2 || unread.length > 2 || pendingMessages.length > 0
        ? 'Active day'
        : 'Stable';

  const tone = pressure === 'High attention' ? 'rose' : pressure === 'Active day' ? 'gold' : 'emerald';
  const leadTask = urgentTasks[0];
  const leadEmail = unread[0] ?? draftReplies[0];
  const leadMessage = pendingMessages[0];
  const leadReview = reviewJobs[0];
  const leadQueue = runningJobs[0] ?? queuedJobs[0];

  const attentionParts = [
    leadTask ? `${leadTask.title} (${leadTask.project})` : null,
    leadReview ? `${leadReview.skill} is waiting for review` : null,
    leadEmail ? `${leadEmail.from}: ${leadEmail.subject}` : null,
    leadMessage ? `${leadMessage.sender} in ${leadMessage.channel}` : null,
  ].filter(Boolean);

  const handledParts = [
    leadQueue ? `${leadQueue.skill} is ${leadQueue.status}` : null,
    latestNote?.text,
  ].filter(Boolean);

  return {
    headline: leadTask ? `${leadTask.project} is the first decision point.` : 'The house is quiet and watchful.',
    posture: pressure,
    tone,
    summary:
      `There are ${urgentTasks.length} priority task${urgentTasks.length === 1 ? '' : 's'}, ` +
      `${unread.length} unread inbox item${unread.length === 1 ? '' : 's'}, ` +
      `${pendingMessages.length} message${pendingMessages.length === 1 ? '' : 's'} needing reply, and ` +
      `${reviewJobs.length} employee item${reviewJobs.length === 1 ? '' : 's'} awaiting review.`,
    attention: attentionParts.length ? attentionParts.slice(0, 2).join(' · ') : 'Nothing is currently blocking you.',
    handled: handledParts.length ? handledParts.slice(0, 2).join(' · ') : 'No background queue item is active.',
    updatedAt: latestEvent?.ts,
    nextMove: leadReview
      ? `Review ${leadReview.skill}.`
      : leadTask
        ? `Clear ${leadTask.project}: ${leadTask.title}.`
        : leadEmail
          ? `Read ${leadEmail.from}'s thread.`
          : 'Keep the queue moving; no immediate intervention needed.',
  } as const;
}
