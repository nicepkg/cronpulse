# Contributing to CronPulse

Thanks for your interest in contributing! CronPulse is maintained by a solo developer, so response times may vary. Please be patient — every issue and PR is read and appreciated.

## How to Help

### Reporting Bugs

1. Check [existing issues](https://github.com/nicepkg/cronpulse/issues) first
2. Include: what you expected, what happened, steps to reproduce
3. If relevant, include your browser/OS and any error messages

### Suggesting Features

Open an issue with the `feature-request` label. Describe the use case, not just the solution. "I need to monitor jobs that run every 2nd Tuesday" is more useful than "add cron expression parsing."

### Submitting Code

1. Fork the repo
2. Create a branch: `git checkout -b my-fix`
3. Make your changes
4. Run type checking: `npm run typecheck`
5. Test locally: `npm run dev`
6. Submit a PR with a clear description of what and why

## Development Setup

```bash
# Clone
git clone https://github.com/nicepkg/cronpulse.git
cd cronpulse

# Install
npm install

# Create local D1 database
npm run db:init

# Create .dev.vars with required secrets
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml with your Cloudflare resource IDs

cat > .dev.vars << 'EOF'
SESSION_SECRET=dev-secret-change-me
RESEND_API_KEY=
LEMONSQUEEZY_WEBHOOK_SECRET=
EOF

# Run locally
npm run dev
```

## Code Style

- TypeScript, strict mode
- No ORMs — raw SQL with D1's prepared statements
- No client-side JavaScript — SSR with template strings
- Keep dependencies minimal (currently: hono, nanoid)
- Every `try/catch` should be intentional — document why in a comment if not obvious

## What We're Looking For

Issues labeled `good first issue` are a great place to start. We especially welcome:

- Bug fixes
- Documentation improvements
- New notification channel integrations
- Performance improvements
- Test coverage

## What We Probably Won't Merge

- Large features without prior discussion in an issue
- Dependencies that significantly increase bundle size
- Breaking changes to the ping endpoint (backwards compatibility is critical)
- Client-side JavaScript frameworks (the SSR approach is intentional)

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 license.
