import { Check, Filter, GripVertical, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Chip } from '../components/Primitives';
import { RoomHeader } from '../components/RoomHeader';
import { apiJson } from '../data/api';
import type { Task } from '../data/types';
import { useTasks } from '../hooks/useRoomData';
import { statusLabel } from '../utils/format';

const columns: Array<{ key: Task['status']; title: string; detail: string }> = [
  { key: 'in_hand', title: 'In Hand', detail: 'Owned by you' },
  { key: 'horizon', title: 'On the Horizon', detail: 'Upcoming' },
  { key: 'delegated', title: "In Council's Care", detail: 'With Elrond' },
  { key: 'done', title: 'Done', detail: 'Closed' },
];

type NewTaskDraft = {
  title: string;
  project: string;
  due: string;
  priority: Task['priority'];
  status: Task['status'];
};

type DragTarget = { status: Task['status']; index: number } | null;
type PriorityFilter = 'all' | Task['priority'];

const emptyDraft: NewTaskDraft = {
  title: '',
  project: '',
  due: 'today',
  priority: 'medium',
  status: 'in_hand',
};

export function Council() {
  const queryClient = useQueryClient();
  const { data: taskList = [] } = useTasks();
  const [boardTasks, setBoardTasks] = useState<Task[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<NewTaskDraft>(emptyDraft);
  const [filterOpen, setFilterOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);

  useEffect(() => {
    setBoardTasks(sortTasks(taskList));
  }, [taskList]);

  const visibleTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return boardTasks.filter((task) => {
      if (!showDone && task.status === 'done') return false;
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
      if (!q) return true;
      return task.title.toLowerCase().includes(q) || task.project.toLowerCase().includes(q) || task.due.toLowerCase().includes(q);
    });
  }, [boardTasks, priorityFilter, query, showDone]);

  const openCount = boardTasks.filter((task) => task.status !== 'done').length;
  const doneCount = boardTasks.length - openCount;

  const replaceTasks = (next: Task[]) => {
    const sorted = sortTasks(next);
    setBoardTasks(sorted);
    queryClient.setQueryData(['tasks'], sorted);
  };

  const move = async (id: string, status: Task['status'], index: number) => {
    const previous = boardTasks;
    const optimistic = moveInList(previous, id, status, index);
    replaceTasks(optimistic);
    try {
      const saved = await apiJson<Task[]>('/api/tasks/move', {
        method: 'POST',
        body: JSON.stringify({ id, status, index }),
      });
      replaceTasks(saved);
    } catch {
      replaceTasks(previous);
    }
  };

  const submitTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    const created = await apiJson<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(draft),
    });
    replaceTasks([created, ...boardTasks]);
    setDraft(emptyDraft);
    setCreating(false);
  };

  const completeTask = (task: Task) => {
    const doneIndex = boardTasks.filter((item) => item.status === 'done').length;
    void move(task.id, 'done', doneIndex);
  };

  const reopenTask = (task: Task) => {
    const inHandIndex = boardTasks.filter((item) => item.status === 'in_hand').length;
    void move(task.id, 'in_hand', inHandIndex);
  };

  const handleDrop = (status: Task['status'], index: number, event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const droppedId = event.dataTransfer.getData('text/plain') || draggingId;
    if (!droppedId) return;
    const target = dragTarget?.status === status ? dragTarget : { status, index };
    void move(droppedId, target.status, target.index);
    setDraggingId(null);
    setDragTarget(null);
  };

  return (
    <div className="room-scroll r-scroll">
      <RoomHeader
        eyebrow="The Council"
        title="Tasks and decisions"
        subtitle={`${openCount} open matters across the board${doneCount ? ` · ${doneCount} done` : ''}.`}
        actions={
          <>
            <Button tone="ghost" className={filterOpen ? 'is-active' : ''} onClick={() => setFilterOpen((value) => !value)}>
              <Filter size={15} />
              Filter
            </Button>
            <Button tone="gold" onClick={() => setCreating((value) => !value)}>
              <Plus size={15} />
              New task
            </Button>
          </>
        }
      />

      {filterOpen ? (
        <section className="council-panel">
          <label>
            Search
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Task, project, due date" />
          </label>
          <label>
            Priority
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}>
              <option value="all">All priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="toggle-field">
            <input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
            Show done
          </label>
          <Button
            tone="ghost"
            onClick={() => {
              setQuery('');
              setPriorityFilter('all');
              setShowDone(true);
            }}
          >
            <RotateCcw size={14} />
            Reset
          </Button>
        </section>
      ) : null}

      {creating ? (
        <form className="council-panel new-task-form" onSubmit={submitTask}>
          <label className="wide-field">
            Task
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What needs doing?" autoFocus />
          </label>
          <label>
            Project
            <input value={draft.project} onChange={(event) => setDraft({ ...draft, project: event.target.value })} placeholder="Personal" />
          </label>
          <label>
            Due
            <input value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} placeholder="today" />
          </label>
          <label>
            Priority
            <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Task['priority'] })}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            Column
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Task['status'] })}>
              {columns.map((column) => (
                <option key={column.key} value={column.key}>{column.title}</option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <Button tone="ghost" type="button" onClick={() => setCreating(false)}>
              <X size={14} />
              Cancel
            </Button>
            <Button tone="gold" type="submit">
              <Plus size={14} />
              Add
            </Button>
          </div>
        </form>
      ) : null}

      <div className="kanban-grid">
        {columns.map((column) => {
          const items = visibleTasks.filter((task) => task.status === column.key);
          return (
            <section
              className={`kanban-column ${dragTarget?.status === column.key ? 'is-drop-target' : ''}`}
              key={column.key}
              data-status={column.key}
              onDragOver={(event) => {
                event.preventDefault();
                setDragTarget({ status: column.key, index: items.length });
              }}
              onDrop={(event) => handleDrop(column.key, items.length, event)}
            >
              <header>
                <div>
                  <h2>{column.title}</h2>
                  <span>{column.detail}</span>
                </div>
                <code>{items.length}</code>
              </header>
              <div className="kanban-stack">
                {items.length ? (
                  items.map((task, index) => (
                    <article
                      className={`task-card priority-${task.priority} ${draggingId === task.id ? 'is-dragging' : ''}`}
                      key={task.id}
                      data-task-id={task.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', task.id);
                        setDraggingId(task.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragTarget(null);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDragTarget({ status: column.key, index });
                      }}
                      onDrop={(event) => handleDrop(column.key, index, event)}
                    >
                      <div className="task-card-head">
                        <GripVertical size={15} />
                        <div>
                          <strong>{task.title}</strong>
                          <p>{task.project}</p>
                        </div>
                      </div>
                      <div className="task-meta">
                        <Chip tone={task.priority === 'high' ? 'rose' : task.priority === 'medium' ? 'gold' : 'neutral'}>
                          {task.priority}
                        </Chip>
                        <span>{task.due}</span>
                      </div>
                      <div className="task-actions">
                        {task.status === 'done' ? (
                          <button type="button" onClick={() => reopenTask(task)}>
                            <RotateCcw size={13} />
                            Reopen
                          </button>
                        ) : (
                          <button type="button" onClick={() => completeTask(task)}>
                            <Check size={13} />
                            Complete
                          </button>
                        )}
                        {task.status !== 'delegated' && task.status !== 'done' ? (
                          <button type="button" onClick={() => void move(task.id, 'delegated', boardTasks.filter((item) => item.status === 'delegated').length)}>
                            Send to Elrond
                          </button>
                        ) : null}
                        {task.status === 'horizon' ? (
                          <button type="button" onClick={() => void move(task.id, 'in_hand', boardTasks.filter((item) => item.status === 'in_hand').length)}>
                            Start
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="column-empty">No tasks marked {statusLabel(column.key)}.</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function moveInList(tasks: Task[], id: string, status: Task['status'], index: number): Task[] {
  const moving = tasks.find((task) => task.id === id);
  if (!moving) return tasks;
  const rest = tasks.filter((task) => task.id !== id);
  const target = rest.filter((task) => task.status === status);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, {
    ...moving,
    status,
    completedAt: status === 'done' ? moving.completedAt ?? new Date().toISOString() : null,
  });
  const byStatus = columns.flatMap((column) => {
    const source = column.key === status ? target : rest.filter((task) => task.status === column.key);
    return source.map((task, order) => ({ ...task, order }));
  });
  return sortTasks(byStatus);
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const statusDelta = columns.findIndex((column) => column.key === a.status) - columns.findIndex((column) => column.key === b.status);
    if (statusDelta) return statusDelta;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}
