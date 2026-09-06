let host: HTMLElement | null = null;

/** 桌面模式由 DesktopFrame 设为框内浮层容器；PiP 期间设为 PiP 文档 body。null = 回落 document.body。 */
export const setPortalHost = (el: HTMLElement | null): void => { host = el; };

export const getPortalHost = (): HTMLElement => {
    if (host && host.isConnected) return host;
    if (typeof document !== 'undefined' && document.body) return document.body;
    return host as unknown as HTMLElement;
};
