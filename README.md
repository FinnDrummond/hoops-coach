# hoops-coach
basketball form coach for emoryhacks

## How to run

After the Codespace stops, open **three terminals**, all in `agent/`. Keys live in `agent/.env.local` (gitignored, never commit it).

Terminal 1, the agent:

```bash
cd /workspaces/hoops-coach/agent
npm install   # only needed if node_modules is missing
npm start
```

Terminal 2, connect it to the FaceTime line:

```bash
cd /workspaces/hoops-coach/agent
npx --yes @trychert/facetime@0.1.0-beta.20 dev --agent hoops-coach
```

Terminal 3, the Brick Report text watcher (replies to "report" texts):

```bash
cd /workspaces/hoops-coach/agent
npm run texts
```

Wait for `"hoops-coach" is in a waiting room`, then FaceTime Video **+1 628-278-8831**.

After editing `coach_prompt.md` or `agent.mjs`, stop all three with Ctrl+C and start them again.
Check Chert minutes left: `npx --yes @trychert/facetime@0.1.0-beta.20 doctor` (see the `minutes` line).
If `chert dev` says you're signed out, run `npx --yes @trychert/facetime@0.1.0-beta.20 login`.
