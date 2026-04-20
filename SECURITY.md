# Security

## Reporting a vulnerability

If you believe you've found a security vulnerability in Operator Studio, please **do not open a public issue**. Instead, email **me@davidlinclark.com** with:

- A clear description of the vulnerability
- Steps to reproduce
- The impact you believe it has
- Any fix ideas (optional)

We'll acknowledge within 48 hours and work with you on a timeline for disclosure.

## Scope

This project is source-available under PolyForm Small Business 1.0.0. It's designed to be self-hosted on infrastructure you control. The threat model assumes:

- **You own the database.** Postgres is yours; credentials don't leave your perimeter.
- **You own the deployment.** There is no hosted Operator Studio service we operate on your behalf.
- **The bundled password gate is not a security boundary.** It's a convenience for local / trusted-network use. Production deployments must swap the session route for a real auth provider — see the README's "Going to production" section.

## Known posture notes

These aren't bugs — they're design choices with tradeoffs you should understand before deploying to a less-trusted environment:

- **Admin routes trust `authorizeRequest` + `isAdmin`.** With no `OPERATOR_STUDIO_ADMINS` allowlist set, every authenticated caller can mint tokens. For multi-user deployments, set the allowlist or replace `isAdmin()` with a real role check.
- **No CSRF protection on state-changing cookie-authenticated POSTs.** Bearer-token requests aren't affected. For a self-hosted private deployment this is acceptable; for anything public-facing, add a CSRF middleware (Auth.js provides one).
- **Webhook receivers should verify the HMAC signature.** The `X-OperatorStudio-Signature` header is set when a subscription has a secret. Don't trust webhook bodies without verification. See `examples/webhooks/slack-announce.ts` for the pattern.
- **Rate limiting is not built in.** If you expose `/api/operator-studio/ingest` to the public internet, put a rate limiter (Cloudflare, nginx, a Next.js middleware) in front of it.

## Dependencies

We periodically update dependencies. If you notice a known-CVE dep, flag it the same way — email, not a public issue.
