const DOMESTIC_BASE = 'https://api.minimaxi.com';
const OVERSEAS_BASE = 'https://api.minimax.io';
const GET_VOICE_PATH = '/v1/get_voice';

const resolveTargetUrl = (req: any): string => {
  const header = typeof req?.headers?.['x-minimax-region'] === 'string'
    ? req.headers['x-minimax-region'].trim().toLowerCase()
    : '';
  const envRegion = typeof process.env.MINIMAX_REGION === 'string'
    ? process.env.MINIMAX_REGION.trim().toLowerCase()
    : '';
  const region = header || envRegion;
  const base = region === 'overseas' ? OVERSEAS_BASE : DOMESTIC_BASE;
  return `${base}${GET_VOICE_PATH}`;
};

function setCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-MiniMax-API-Key,X-MiniMax-Region');
}

function normalizeApiKey(raw?: string): string {
  if (!raw) return '';
  return raw.trim().replace(/^Bearer\s+/i, '').trim();
}

export default async function handler(req: any, res: any) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const incomingAuthRaw = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const customApiKeyRaw = typeof req.headers['x-minimax-api-key'] === 'string' ? req.headers['x-minimax-api-key'] : '';

    const incomingApiKey = normalizeApiKey(incomingAuthRaw);
    const customApiKey = normalizeApiKey(customApiKeyRaw);
    // 注意：不要回退到 MINIMAX_API_KEY 环境变量——CORS 全开 + 无鉴权时，部署者的 Key 会被公网任意调用烧掉。
    const finalApiKey = incomingApiKey || customApiKey;

    if (!finalApiKey) {
      res.status(400).json({ error: 'Missing API key. Provide Authorization or x-minimax-api-key.' });
      return;
    }

    const upstream = await fetch(resolveTargetUrl(req), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${finalApiKey}`,
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    res.status(upstream.status).send(text);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Proxy request failed' });
  }
}
