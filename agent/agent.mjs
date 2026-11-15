import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';
import { z } from 'zod';
import { realtime } from '@livekit/agents-plugin-openai';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { describe as describePose, metrics as poseMetrics, poseEnabled, startPoseWatcher } from './pose.mjs';
import { lastSession, phoneForCall, rememberPhone, saveSession } from './brick.mjs';

// Coaching instructions live in coach_prompt.md so they are easy to edit. Restart the agent after changing it.
const instructions = readFileSync(new URL('./coach_prompt.md', import.meta.url), 'utf8');
// Said once, as soon as FaceTime is ready. Keep it short: it is the first thing the caller hears.
const greeting = 'Say exactly this, and nothing else: "Brick Detector online. Let\'s debug your jumper."';

const agent = defineAgent({
  entry: async ctx => {
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    // Chert prepares a room before a caller exists. Join promptly so Chert can
    // find us, but wait before opening a paid model session. Doctor jobs may end
    // without a caller ever joining.
    const caller = await ctx.waitForParticipant();
    // Brick Report: find the caller's phone (identity is chert-bridge-<call id>) and their last session.
    let phone = null;
    try { phone = await phoneForCall(caller.identity.replace(/^chert-bridge-/, '')); } catch (e) { console.log('Brick Report: phone lookup failed:', e.message); }
    if (phone) rememberPhone(phone);
    const last = phone ? lastSession(phone) : null;
    const saveSessionTool = llm.tool({
      description: 'Save this caller\'s Brick Report data. Call it once at the end of the session, just before you say the Brick Report out loud.',
      parameters: z.object({
        mode: z.enum(['The Assassin', 'The Splash Chef', 'The Closer']),
        before: z.number().int().min(0).max(20).describe('Form Score before patches, out of 20'),
        after: z.number().int().min(0).max(20).describe('Form Score after patches, out of 20'),
        bug: z.string().describe('The #1 remaining bug, in plain words'),
        drill: z.string().describe('One drill to fix it'),
      }),
      execute: async args => {
        if (!phone) return 'Could not identify the caller, nothing saved. Carry on.';
        saveSession(phone, args);
        return 'Saved. Now tell the caller: Text me "report" and I\'ll send your Brick Report.';
      },
    });
    // OPTIONAL (POSE=on): measure elbow / knee / arm extension from the caller's video and expose it as a tool.
    // Off by default; any failure here just means the coach goes on without numbers.
    const tools = { save_session: saveSessionTool };
    let poseNote = '';
    if (poseEnabled()) {
      try {
        let watcher = null;
        const attach = track => { if (!watcher && track.kind === TrackKind.KIND_VIDEO) watcher = startPoseWatcher(track, { VideoStream, VideoBufferType }); };
        for (const pub of caller.trackPublications.values()) if (pub.track) attach(pub.track);
        ctx.room.on(RoomEvent.TrackSubscribed, (track, _pub, p) => { if (p.identity === caller.identity) attach(track); });
        ctx.addShutdownCallback(() => watcher?.stop());
        tools.get_pose_metrics = llm.tool({
          description: 'Get measured joint angles (elbow, knee bend, arm extension) from the most recent camera frame. Call it at each breakpoint after the player says "check". Treat the numbers as extra evidence next to what you see; if it returns nothing, just judge by sight.',
          parameters: z.object({ hand: z.enum(['right', 'left']).describe('The hand they shoot with') }),
          execute: async ({ hand }) => {
            const l = watcher?.latest();
            if (!l || Date.now() - l.at > 8000) return 'No fresh pose reading. Judge by sight.';
            return describePose(poseMetrics(l.kp, hand)) ?? 'Pose not clearly visible. Ask them to step back so the whole body is in frame.';
          },
        });
        poseNote = '\n\nPOSE NUMBERS: you have a get_pose_metrics tool. At each breakpoint, after they say "check", call it and weave ONE number into your feedback, e.g. "Elbow at 72 degrees, get it closer to 90." Targets: elbow about 90 degrees at the set point and 165+ at release; knee bend 110-140 in the load (180 is a straight leg); arm extension 95+ percent at release. Never read out all the numbers.';
        console.log('pose: POSE=on, pose metrics enabled');
      } catch (e) { console.log('pose: disabled for this call:', e.message); }
    }
    const returning = last ? `\n\nRETURNING CALLER: last session they scored ${last.after}/20 with ${last.mode}. Right after your opening line, say "Last time you were ${last.after} out of 20, let's beat it."` : '';
    const session = new voice.AgentSession({
      llm: new realtime.RealtimeModel({ model: 'gpt-realtime', voice: 'ash' }),
    });
    ctx.addShutdownCallback(() => session.close());
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions: instructions + returning + poseNote, tools }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: true,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });
    // Greet once when chert dev reports that FaceTime is ready (bridge_ready in the
    // room metadata): the Mac ends the call if it hears nothing within 10 seconds
    // of that. Participant arrival alone is not readiness, so there is no greeting
    // on it. Without the signal there is no greeting, and the caller speaks first.
    const stopGreeting = greetOnBridgeReady(ctx.room, () => session.generateReply({ instructions: greeting }));
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

// Your own LiveKit project when .env.local has its three LIVEKIT_ values; otherwise Chert rooms through chert dev.
runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'hoops-coach' });
