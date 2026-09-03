/**
 * Codex `exec --image` is variadic on fresh sessions. Passing
 * `--image`, `path`, `prompt` makes the parser consume the prompt as another
 * image and then fall back to empty stdin. The equals form binds exactly one
 * path per option and leaves the positional prompt intact.
 */
export function codexImageArgs(paths: readonly string[]): string[] {
  return paths.map((path) => `--image=${path}`);
}

export function shouldRetryEmptyCodexTurn(input: {
  code: number | null;
  signal: NodeJS.Signals | null;
  producedAgentMessage: boolean;
  sawActionableItem: boolean;
  sawTurnCompleted: boolean;
  stderr: string;
  transientProjectConfigError: boolean;
  retryDepth: number;
}): boolean {
  return input.retryDepth < 1
    && (input.code !== 0 || !input.sawTurnCompleted)
    && !input.producedAgentMessage
    && !input.sawActionableItem
    && !input.stderr.trim()
    && !input.transientProjectConfigError
    && input.signal !== 'SIGKILL'
    && input.code !== 137;
}
