# Brick Detector

**A basketball shooting coach you FaceTime.** Call the line, show your jump shot on camera, and an AI coach debugs your form step by step, like a developer debugging code. Afterwards, text "report" and get your Brick Report back with your score, your progress, and a drill video. Built for EmoryHacks.

**Try it:** FaceTime Video **+1 628-278-8831** (one caller at a time, calls are capped at 5 minutes).

## What it does
- **Live video coaching over FaceTime.** The coach sees your camera and talks to you in real time. No app to install.
- **A fixed 5-step script** (the BEEF method): Stance, Set point, Release, Follow-through, then the Brick Report. At each step you freeze for 3 seconds, say "check", and get ONE bug and ONE easy fix. The coach announces "Step N of 5" so neither of you loses your place.
- **Three coach personalities:** The Assassin, The Splash Chef, The Closer. Same coaching, different voice.
- **Form Score out of 20**, before and after the fixes.
- **Brick Report by text.** Text "report" to the line to get your mode, score, progress since last time (+N), your top bug, a drill, a rotating drill video, and a line of encouragement that depends on your score.
- **Remembers you.** Returning callers are greeted with their last score. Sessions are saved after every step, so a dropped call still leaves a report.

## How it works
```
FaceTime caller -> Chert (FaceTime bridge) -> LiveKit room -> agent.mjs (Node, LiveKit Agents)
                                                               |-> OpenAI Realtime (gpt-realtime): voice + camera frames
                                                               |-> save_session tool -> brick-sessions.json
texts.mjs (polls Chert messages API) <- "report" text -> replies with the Brick Report
```
- `agent/agent.mjs`: the voice agent, noise-reduced turn detection, and the `save_session` tool.
- `agent/coach_prompt.md`: the coaching script, modes and quips. Edit this to change the coach.
- `agent/brick.mjs`: session store, report formatting, score-tier copy, drill rotation.
- `agent/texts.mjs`: the text watcher that answers "report".

## Limitations (honest)
- The coach sees periodic camera snapshots, not continuous video, so you freeze at each step.
- One caller at a time. Session data is a local JSON file, not a database.
- **Experimental, not merged:** a computer-vision pose option (elbow angle, knee bend via MoveNet) lives on the `pose` branch. We tested it on still photos only, not live calls, so it is not part of the demo build.

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
