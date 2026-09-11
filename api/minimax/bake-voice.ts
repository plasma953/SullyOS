import { runBakeVoice } from './_bakeVoiceCore';
import { applyCors } from '../_cors';

/**
 * Vercel serverless function: POST /api/minimax/bake-voice
 *
 * Accepts JSON body:
 * {
 *   apiKey: string,
 *   voiceId: string,       // desired custom voice_id
 *   model: string,
 *   ttsPayload: object,    // the T2A payload (voice_setting, timber_weights, etc.)
 *   groupId?: string,
 * }
 *
 * 三步编排见 ./_bakeVoiceCore.runBakeVoice（与 server/bake-voice-middleware.ts 共用）。
 */
export default async function handler(req: any, res: any) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { apiKey, voiceId, model, ttsPayload, groupId, region } = req.body || {};
    const headerRegion = typeof req?.headers?.['x-minimax-region'] === 'string'
      ? req.headers['x-minimax-region']
      : '';

    const result = await runBakeVoice(
      { apiKey, voiceId, model, ttsPayload, groupId, region, regionHeader: headerRegion },
    );
    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    console.error('[bake-voice] error:', error?.message);
    res.status(500).json({ error: error?.message || 'bake-voice failed' });
  }
}
