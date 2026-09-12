/** 浮层统一挂到 document.body。2026-09-11 移除窗口化手机框后不再有「框内浮层宿主」。 */
export const getPortalHost = (): HTMLElement => document.body;
