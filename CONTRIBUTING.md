# Contributing

1. Fork and create a feature branch.
2. `npm install`, then `npm run typecheck && npm test` before opening a PR.
3. Game rules live in `src/systems` and must stay free of DOM/Three.js imports so they can be unit-tested.
4. Never commit secrets. Use `.env.local` (git-ignored).
5. Real ad/billing SDK code belongs behind the interfaces in `src/services`, never in UI code.
