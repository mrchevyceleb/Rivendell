import { isAgentThread } from './threadKey.ts';

/** Basic liveness belongs to the UI; this asks the model for the substantive
 * milestones that make a long task feel like an actual conversation. */
const CONVERSATIONAL_MILESTONE_GUIDANCE = [
  '<rivendell-conversation>',
  'Keep the user in the conversation during long work. Send brief user-facing updates at natural milestones when you have substantive information: a finding, decision, blocker, question, or meaningful course correction.',
  'Do not narrate every tool call or flood the chat with empty status. An interim message does not end the turn; continue working unless you genuinely need an answer, then finish with the result.',
  '</rivendell-conversation>',
].join('\n');

/** Only direct human turns in an agent home should receive conversational
 * milestone guidance. Peer deliveries and hidden automations remain quiet. */
export function conversationGuidanceForTurn(opts: {
  chatId: string;
  peerFrom?: string;
  peerFromRole?: string;
  hidden?: boolean;
}): string {
  if (
    !isAgentThread(opts.chatId)
    || opts.peerFrom
    || opts.peerFromRole === 'automation'
    || opts.hidden
  ) return '';
  return CONVERSATIONAL_MILESTONE_GUIDANCE;
}
