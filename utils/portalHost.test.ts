// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getPortalHost } from './portalHost';

describe('portalHost', () => {
    it('返回 document.body', () => {
        expect(getPortalHost()).toBe(document.body);
    });
});
