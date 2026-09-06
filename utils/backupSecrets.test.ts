import { describe, it, expect } from 'vitest';
import { stripBackupSecrets, hasBackupSecrets } from './backupSecrets';

const apiConfig = () => ({
  baseUrl: 'https://api.example.dev/v1',
  apiKey: 'sk-live',
  model: 'm',
  minimaxApiKey: 'mm-live',
  fishAudioApiKey: 'fish-live',
  elevenLabsApiKey: 'el-live',
  aceStepApiKey: 'r8-live',
  latentImageKey: 'lat-live',
  visionApi: { enabled: true, baseUrl: 'https://v.example.dev', apiKey: 'v-live', model: 'vm' },
});

describe('backup secrets redaction', () => {
  it('blanks keys in apiConfig/checkPhoneApi/presets but keeps the rest', () => {
    const data: any = {
      apiConfig: apiConfig(),
      checkPhoneApi: apiConfig(),
      apiPresets: [{ id: 'p1', name: 'P', config: apiConfig() }],
    };
    expect(hasBackupSecrets(data)).toBe(true);
    const redacted = stripBackupSecrets(data);
    expect(redacted).toBe(true);
    for (const cfg of [data.apiConfig, data.checkPhoneApi, data.apiPresets[0].config]) {
      expect(cfg.apiKey).toBe('');
      expect(cfg.minimaxApiKey).toBe('');
      expect(cfg.fishAudioApiKey).toBe('');
      expect(cfg.elevenLabsApiKey).toBe('');
      expect(cfg.aceStepApiKey).toBe('');
      expect(cfg.latentImageKey).toBe('');
      expect(cfg.visionApi.apiKey).toBe('');
      // 非密钥字段原样保留，恢复后不用重填地址模型
      expect(cfg.baseUrl).toBe('https://api.example.dev/v1');
      expect(cfg.model).toBe('m');
    }
    expect(hasBackupSecrets(data)).toBe(false);
  });

  it('blanks per-character secondary/emotion keys and service configs', () => {
    const data: any = {
      characters: [{
        id: 'c1',
        proactiveConfig: { enabled: true, secondaryApi: { baseUrl: 'u', apiKey: 'sk-c', model: 'm' } },
        emotionConfig: { enabled: true, api: { baseUrl: 'u', apiKey: 'sk-e', model: 'm' } },
      }],
      pushVapid: { vapidPublicKey: 'pub', vapidPrivateKey: 'PRIV', vapidEmail: 'a@b.c' },
      instantPushConfig: { enabled: true, workerUrl: 'w', clientToken: 'tok' },
      cloudBackupConfig: { enabled: true, username: 'u', password: 'pw', githubToken: 'gh' },
      remoteVectorConfig: { enabled: true, supabaseUrl: 'u', supabaseAnonKey: 'anon' },
      memoryPalaceConfig: {
        embedding: { baseUrl: 'u', apiKey: 'emb', model: 'm' },
        lightLLM: { baseUrl: 'u', apiKey: 'llm', model: 'm' },
      },
      amsg2GlobalConfig: { userId: 'u', workerUrl: 'w', serverToken: 'st', masterKey: 'mk' },
      studyApiConfig: { baseUrl: 'u', apiKey: 'sk-s', model: 'm' },
    };
    expect(stripBackupSecrets(data)).toBe(true);
    expect(data.characters[0].proactiveConfig.secondaryApi.apiKey).toBe('');
    expect(data.characters[0].emotionConfig.api.apiKey).toBe('');
    expect(data.pushVapid.vapidPrivateKey).toBe('');
    expect(data.pushVapid.vapidPublicKey).toBe('pub');
    expect(data.instantPushConfig.clientToken).toBe('');
    expect(data.cloudBackupConfig.password).toBe('');
    expect(data.cloudBackupConfig.githubToken).toBe('');
    expect(data.cloudBackupConfig.username).toBe('u');
    expect(data.remoteVectorConfig.supabaseAnonKey).toBe('');
    expect(data.memoryPalaceConfig.embedding.apiKey).toBe('');
    expect(data.memoryPalaceConfig.lightLLM.apiKey).toBe('');
    expect(data.amsg2GlobalConfig.serverToken).toBe('');
    expect(data.amsg2GlobalConfig.masterKey).toBe('');
    expect(data.amsg2GlobalConfig.workerUrl).toBe('w');
    expect(data.studyApiConfig.apiKey).toBe('');
  });

  it('blanks secret-looking keys in opaque local maps, keeps the rest', () => {
    const data: any = {
      opencodeLocal: { host: 'h', password: 'pw', token: 't' },
      worldHomeLocal: { world_home_api: '{"apiKey":"sk-w"}', world_custom_styles: '[]' },
      mcpLocal: { servers: '[]' },
    };
    expect(stripBackupSecrets(data)).toBe(true);
    expect(data.opencodeLocal).toEqual({ host: 'h', password: '', token: '' });
    expect(data.mcpLocal).toEqual({ servers: '[]' });
    // world_home_api 整段 JSON 含 key：整值清空比留下半截安全
    expect(data.worldHomeLocal.world_home_api).toBe('');
    expect(data.worldHomeLocal.world_custom_styles).toBe('[]');
  });

  it('returns false and touches nothing when there is nothing secret', () => {
    const data: any = { theme: { id: 't' }, notes: 'hello' };
    expect(stripBackupSecrets(data)).toBe(false);
    expect(data).toEqual({ theme: { id: 't' }, notes: 'hello' });
    expect(hasBackupSecrets(data)).toBe(false);
  });
});
