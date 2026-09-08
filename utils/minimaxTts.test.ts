import { describe, it, expect } from 'vitest';
import { describeMiniMaxErrorMessage } from './minimaxTts';

describe('describeMiniMaxErrorMessage', () => {
    it('余额不足给中文充值指引', () => {
        expect(describeMiniMaxErrorMessage('insufficient balance')).toBe(
            'MiniMax 余额不足，请到 MiniMax 控制台充值后重试。',
        );
    });
    it('鉴权失败给中文 Key 指引', () => {
        expect(describeMiniMaxErrorMessage('login fail')).toBe(
            'MiniMax 鉴权失败，请检查 MiniMax Key 是否正确、是否有权限。',
        );
        expect(describeMiniMaxErrorMessage('authorization failed')).toBe(
            'MiniMax 鉴权失败，请检查 MiniMax Key 是否正确、是否有权限。',
        );
    });
    it('其他错误原样透传，带 trace_id 则追加', () => {
        expect(describeMiniMaxErrorMessage('boom')).toBe('boom');
        expect(describeMiniMaxErrorMessage('boom', 't123')).toBe('boom（trace_id: t123）');
    });
});
