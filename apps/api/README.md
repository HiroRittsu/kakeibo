```txt
npm install
npm run dev
```

```txt
npm run deploy
```

## D1 migrations

Create a new migration file:

```txt
npm run migrate:create -- <migration-name>
```

Apply migrations to local D1 (uses .wrangler/state):

```txt
npm run migrate:local
```

Apply migrations to remote D1:

```txt
npm run migrate:remote
```

Note: the initial migration assumes an empty database. If you already created tables,
reset the local D1 state or create a baseline migration before applying.

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
