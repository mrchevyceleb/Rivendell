# Security policy

## Supported version

Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Security → Report a vulnerability** flow for this repository. Do not include real credentials, private transcripts, or workspace documents in the report. If private reporting is unavailable, open a minimal issue requesting a secure contact channel without disclosing exploit details.

## Deployment boundary

Rivendell is a powerful local operator, not a public SaaS server:

- It has no app-layer authentication.
- It can read and edit files beneath its configured workspace.
- It can launch authenticated model CLIs and optional MCP tools.
- Some optional integrations can create drafts, jobs, or deployments.

The server therefore binds to `127.0.0.1` by default. Do not expose port `8091` directly to the internet. For remote access, use a private authenticated layer such as Tailscale and restrictive ACLs.

## Secrets

- Put secrets in environment variables or a secret manager.
- Keep environment files and `~/.rivendell/` outside Git with restrictive filesystem permissions.
- Never commit OAuth token files, chat event logs, screenshots containing private data, or a real workspace.
- Treat a provider token exposed in Git history as compromised and rotate it before rewriting history.

The repository's CI scans the full available Git history with Gitleaks. The allowlist contains only a public OAuth client identifier, never a client secret or access token.

## Safe defaults

A fresh clone:

- listens only on loopback,
- uses a dry-run worker,
- has no configured external MCP/admin backend,
- has no Railway deployment target,
- has no provider or database credentials,
- does not prewarm agent processes, and
- stores runtime state outside the repository.
