// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { getPortalHost, setPortalHost } from './portalHost';

describe('portalHost', () => {
    afterEach(() => setPortalHost(null));
    it('默认返回 document.body', () => {
        expect(getPortalHost()).toBe(document.body);
    });
    it('设置后返回宿主，清空后恢复', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        setPortalHost(host);
        expect(getPortalHost()).toBe(host);
        setPortalHost(null);
        expect(getPortalHost()).toBe(document.body);
        host.remove();
    });
    it('宿主游离后回落 body', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        setPortalHost(host);
        host.remove();
        expect(getPortalHost()).toBe(document.body);
    });
});
