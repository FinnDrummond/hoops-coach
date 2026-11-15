import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import { z } from 'zod';
import { realtime } from '@livekit/agents-plugin-openai';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
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
    let savedThisCall = false;
    const saveSessionTool = llm.tool({
      description: 'Save this caller\'s Brick Report data. Call it after EACH breakpoint with your running scores (so nothing is lost if the call drops), and again at the end, just before you say the Brick Report out loud. Later calls overwrite earlier ones.',
      parameters: z.object({
        mode: z.enum(['The Assassin', 'The Splash Chef', 'The Closer']),
        before: z.number().int().min(0).max(20).describe('Form Score before patches, out of 20'),
        after: z.number().int().min(0).max(20).describe('Form Score after patches, out of 20'),
        bug: z.string().describe('The #1 remaining bug, in plain words'),
        drill: z.string().describe('One drill to fix it'),
      }),
      execute: async args => {
        if (!phone) return 'Could not identify the caller, nothing saved. Carry on.';
        // `last` was read once at call start, so every save in this call compares against the same earlier session.
        saveSession(phone, { ...args, prevAfter: last && !last.partial ? last.after : null });
        savedThisCall = true;
        return 'Saved. Now tell the caller: Text me "report" and I\'ll send your Brick Report.';
      },
    });
    const returning = last ? `\n\nRETURNING CALLER: last session they scored ${last.after}/20 with ${last.mode}. Right after your opening line, say "Last time you were ${last.after} out of 20, let's beat it."` : '';
    const session = new voice.AgentSession({
      llm: new realtime.RealtimeModel({
        model: 'gpt-realtime',
        voice: 'ash',
        // Only react to the caller, not room noise: far-field noise reduction + a high server-VAD threshold and a longer pause before a turn ends.
        inputAudioNoiseReduction: { type: 'far_field' },
        turnDetection: { type: 'server_vad', threshold: 0.85, prefix_padding_ms: 300, silence_duration_ms: 800, create_response: true, interrupt_response: true },
      }),
    });
    ctx.addShutdownCallback(() => session.close());
    // If the call drops before the coach ever saved, leave a stub so "report" still answers (never overwrites an earlier real session).
    ctx.addShutdownCallback(async () => {
      if (phone && !savedThisCall && !last) saveSession(phone, { mode: 'The Splash Chef', before: 0, after: 0, bug: 'We got cut off before the wrap-up', drill: 'FaceTime me again and run the full set', partial: true });
    });
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions: instructions + returning, tools: { save_session: saveSessionTool } }),
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
