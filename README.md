# hoops-coach
basketball form coach for emoryhacks

## How to run

After the Codespace stops, open two terminals. Your keys stay in `agent/.env.local` (gitignored).

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

Wait for `"hoops-coach" is in a waiting room`, then FaceTime Video **+1 628-278-8831**.

After editing `coach_prompt.md` or `agent.mjs`, stop both with Ctrl+C and start them again.
If `chert dev` says you're signed out, run `npx --yes @trychert/facetime@0.1.0-beta.20 login`.
