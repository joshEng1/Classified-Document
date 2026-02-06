# Security Notes

This project is designed so hosted-model API keys stay server-side.

## Secret Handling

- Put secrets in `server/.env` only.
- Never place API keys in frontend code (`public/*`).
- `.env` files are ignored by git.
- Error strings returned by the API are sanitized to redact token/key patterns.

## Public Deployment Defaults

- `CORS_ALLOW_ALL=false`
- `CORS_ORIGINS=<your-portfolio-domain>`
- `PUBLIC_API_RATE_LIMIT_ENABLED=true`
- `API_NO_STORE=true`
- `VERBOSE_SERVER_LOGS=false`
- `LLAMA_DEBUG=false`
- `TRUST_PROXY=true` only when actually behind a trusted proxy/load balancer

## Sensitive File Retention

Uploaded/session/redacted artifacts are pruned on a timer:

- `UPLOAD_RETENTION_MINUTES` (default `120`)
- `UPLOAD_CLEANUP_INTERVAL_MINUTES` (default `15`)

## Operational Guidance

- Rotate provider keys periodically.
- Use provider-side quotas and spend limits.
- Prefer short-lived OAuth access tokens for Google Document AI.
- Keep dependencies patched and review logs for repeated 4xx/5xx abuse patterns.
