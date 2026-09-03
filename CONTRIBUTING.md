# Contributing

Thanks for helping improve Rivendell.

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

Use only test credentials and a disposable workspace while developing. Rivendell can launch local agent CLIs and read files beneath `ELROND_WORKSPACE_PATH`.

Before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
cd jarvis-agent && npm install && npm run typecheck
```

## Pull requests

- Keep each PR focused on one concern.
- Explain user-visible behavior and operational risk.
- Include screenshots for visible UI changes, using synthetic data only.
- Do not commit `.env` files, runtime state, transcripts, OAuth data, browser profiles, or real workspace content.
- Preserve the rule that external side effects remain draft/review-first.
- Do not add an internet-facing deployment default or weaken the loopback/private-network trust boundary.
- Add only focused tests for behavior that is easy to regress.

## Code style

- TypeScript and ESM.
- Server-relative imports use explicit `.ts` extensions.
- New HTTP APIs live under `/api/<noun>`; WebSockets live under `/ws/...` or the existing `/api/ws` chat transport.
- Use the JSON store helpers for state beneath `~/.rivendell`.
- Keep frontend interactions tactile, responsive, and accessible.

## Security

Do not open a public issue for a vulnerability that could expose credentials, workspace data, or agent-control access. Follow [SECURITY.md](SECURITY.md).
