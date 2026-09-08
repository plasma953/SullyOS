import { describe, expect, it, vi, afterEach } from 'vitest';
// @ts-expect-error The deployed Worker entry is intentionally plain runtime JavaScript.
import worker from './index.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const webdavPost = (target: string) =>
    new Request(`https://worker.example/webdav?url=${encodeURIComponent(target)}`, {
        method: 'POST',
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });

describe('/webdav SSRF guard', () => {
    it('rejects private-network targets without touching upstream', async () => {
        const upstream = vi.fn();
        vi.stubGlobal('fetch', upstream);
        for (const target of [
            'https://192.168.1.1/dav/backup.zip',
            'https://10.0.0.5/dav/',
            'https://169.254.169.254/latest/meta-data/',
            'https://[::1]/dav/',
        ]) {
            const res = await worker.fetch(webdavPost(target), {}, {} as any);
            expect(res.status, target).toBe(400);
        }
        expect(upstream).not.toHaveBeenCalled();
    });

    it('rejects non-HTTPS targets', async () => {
        const upstream = vi.fn();
        vi.stubGlobal('fetch', upstream);
        const res = await worker.fetch(webdavPost('http://127.0.0.1:8080/dav/'), {}, {} as any);
        expect(res.status).toBe(400);
        expect(upstream).not.toHaveBeenCalled();
    });

    it('still proxies public HTTPS targets', async () => {
        const upstream = vi.fn().mockResolvedValue(
            new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
        );
        vi.stubGlobal('fetch', upstream);
        const res = await worker.fetch(webdavPost('https://dav.example.com/remote.php/dav/backup.zip'), {}, {} as any);
        expect(res.status).toBe(200);
        expect(upstream).toHaveBeenCalledTimes(1);
        expect(String(upstream.mock.calls[0][0])).toBe('https://dav.example.com/remote.php/dav/backup.zip');
    });

    it('blocks 302 redirect to metadata IP without fetching body', async () => {
        const upstream = vi.fn().mockResolvedValue(
            new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } }),
        );
        vi.stubGlobal('fetch', upstream);
        const res = await worker.fetch(webdavPost('https://dav.example.com/remote.php/dav/backup.zip'), {}, {} as any);
        expect(res.status).toBe(400);
        expect(upstream).toHaveBeenCalledTimes(1);
    });

    it('follows a normal public 302 once', async () => {
        const upstream = vi.fn().mockImplementation(async (input: any) => {
            const target = String(input);
            if (target === 'https://dav.example.com/remote.php/dav/backup.zip') {
                return new Response(null, { status: 302, headers: { Location: 'https://dav2.example.com/dav/backup.zip' } });
            }
            if (target === 'https://dav2.example.com/dav/backup.zip') {
                return new Response('ok2', { status: 200, headers: { 'Content-Type': 'text/plain' } });
            }
            throw new Error(`unexpected upstream request: ${target}`);
        });
        vi.stubGlobal('fetch', upstream);
        const res = await worker.fetch(webdavPost('https://dav.example.com/remote.php/dav/backup.zip'), {}, {} as any);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('ok2');
        expect(upstream).toHaveBeenCalledTimes(2);
        expect(String(upstream.mock.calls[1][0])).toBe('https://dav2.example.com/dav/backup.zip');
    });
});
