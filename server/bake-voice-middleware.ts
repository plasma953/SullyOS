import type { IncomingMessage, ServerResponse } from 'http';
import { runBakeVoice } from '../api/minimax/_bakeVoiceCore';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Vite dev middleware: POST /api/minimax/bake-voice
 *
 * 三步编排见 ../api/minimax/_bakeVoiceCore.runBakeVoice（与 Vercel 函数共用）。
 */
export async function bakeVoiceMiddleware(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-MiniMax-Region');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const { apiKey, voiceId, model, ttsPayload, groupId, region } = body;
    const headerRaw = req.headers['x-minimax-region'];
    const headerRegion = typeof headerRaw === 'string' ? headerRaw : '';

    const result = await runBakeVoice(
      { apiKey, voiceId, model, ttsPayload, groupId, region, regionHeader: headerRegion },
    );
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, ...result }));
  } catch (err: any) {
    console.error('[bake-voice] error:', err?.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'bake-voice failed' }));
  }
}
