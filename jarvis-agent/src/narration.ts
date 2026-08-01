// Spoken narration for tool activity during long agentic turns. The model's
// own voice-mode prompt already announces most work; these fire only when the
// stream has gone quiet (see agent.ts thresholds), so Jarvis never doubles up
// on the model's own "let me check your calendar".

const TOOL_PHRASES: Array<[RegExp, string]> = [
  [/gmail|email/i, 'Checking your email.'],
  [/calendar/i, 'Checking the calendar.'],
  [/tasks/i, 'Looking at the task board.'],
  [/web_search|websearch|quick_search|deep_research/i, 'Searching the web.'],
  [/webfetch/i, 'Reading that page.'],
  [/memory|remember/i, 'Consulting my notes.'],
  [/generate_image|edit_image|sharp/i, 'Working on the image.'],
  [/supabase|sql|db/i, 'Querying the database.'],
  [/^bash$|^powershell$/i, 'Running that now.'],
  [/^read$|^grep$|^glob$|files?/i, 'Going through the files.'],
  [/^write$|^edit$/i, 'Making the changes.'],
  [/slack|telegram|twilio/i, 'Checking messages.'],
  [/stripe|plTracker|pl_/i, 'Looking at the numbers.'],
  [/railway|vercel|deploy|cloudflare/i, 'Checking the deployment.'],
];

export function phraseForTool(toolName: string): string {
  const short = toolName.replace(/^mcp__[^_]+(__)?/, '').replace(/^assistant-mcp__/, '');
  for (const [re, phrase] of TOOL_PHRASES) {
    if (re.test(short)) return phrase;
  }
  return 'Working on it.';
}

const KEEP_ALIVES = [
  'Still on it.',
  'Still working, sir.',
  'This one is taking a moment.',
  'Nearly there.',
];

let keepAliveIdx = 0;
export function nextKeepAlive(): string {
  const phrase = KEEP_ALIVES[keepAliveIdx % KEEP_ALIVES.length]!;
  keepAliveIdx += 1;
  return phrase;
}

const GREETINGS = ['Sir?', 'Yes, sir?', 'At your service.', 'Listening.'];
export function greeting(): string {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)]!;
}

// Spoken the instant a user turn commits, before the brain produces anything —
// Jarvis always acknowledges, then thinks.
const ACKS = ['On it, sir.', 'Right away.', 'Working on it.', 'One moment.', 'Let me see.'];
export function ack(): string {
  return ACKS[Math.floor(Math.random() * ACKS.length)]!;
}
