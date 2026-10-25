# DMBot

When someone comments a keyword on one of your Instagram reels, DMBot sends them a private reply (DM) and posts a public reply under their comment.
It runs on Zoho Catalyst: two Advanced I/O functions (`webhook`, `admin`), a Data Store, and a React admin page.

- Setup, limitations and troubleshooting: [docs/setup.md](docs/setup.md)
- Tests: `npm test` (backend) and `cd client && npx vitest run` (client)
- Deploy: `./deploy.sh` (`DEPLOY_DRY_RUN=1` to rehearse)

All logic lives in `shared/` and is copied into `functions/*/lib/` by `npm run sync-shared`. Edit `shared/`, never `lib/`.
