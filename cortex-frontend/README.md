# Cortex — Mission Control (React frontend)

Talks directly to the two Lambda Function URLs — no middle-tier backend.
Requires `FunctionUrlConfig.Cors` on both stacks (see `template.yaml`).

## Run locally

```bash
npm install
cp .env.example .env   # already has both Function URLs filled in
npm run dev
```

## Deploy (Vercel or Netlify — either works, zero extra AWS config)

```bash
npm run build   # outputs dist/
```

Set the same two env vars in your host's dashboard before/at deploy:

- `VITE_LAMBDA_URL_EAST`
- `VITE_LAMBDA_URL_WEST`

**Vercel:** `npx vercel --prod` from this directory, or connect the repo
and set the env vars in Project Settings → Environment Variables.

**Netlify:** `npx netlify deploy --prod --dir=dist`, or connect the repo
(build command `npm run build`, publish dir `dist`) and set the env vars
in Site settings → Environment variables.

## What's here

- `src/lib/api.js` — fetch wrapper over both Function URLs, plus a
  helper that merges list responses from whichever region(s) are alive
  (tolerates one region being down mid kill-and-recover demo).
- `src/components/PipelineTrace.jsx` — the signature visual: the 6
  agents as spokes around a CockroachDB hub. Lights up and fires an
  animated packet at the hub the moment a real `incident_events` row
  lands for that stage. No fake/inferred state — every glow, packet,
  and meta line is read straight off a live event.
- `src/components/RegionHealthBar.jsx` — polls `/health` on both
  regions every 4s.
- `src/components/IncidentsTable.jsx` — `GET /incidents`, click a row
  to inspect it in the trace above.
- `src/components/LockPanel.jsx` — `GET /locks`, HELD / EXPIRED
  (stealable) / RELEASED — this is the kill-and-recover proof.
- `src/components/MissionLog.jsx` — merges the selected incident's
  events with `GET /audit-log` across both regions.
- `src/components/TriggerForm.jsx` — `POST {region}/incidents`.

Known, intentional shortcut for tonight: `FunctionUrlConfig.Cors` on
both stacks is `AllowOrigins: "*"`. Tighten to this app's real hosted
domain once you know it, post-deploy.
