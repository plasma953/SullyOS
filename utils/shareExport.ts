export interface ShareOrDownloadOptions {
    /** 文件文本内容（目前导出都是文本，如 JSON / txt）。 */
    content: string;
    /** 带扩展名的文件名，如 `worldbook.json`。 */
    fileName: string;
    /** MIME 类型，默认 `application/json`。 */
    mimeType?: string;
    /** 系统 / Web 分享面板标题，默认取文件名。 */
    shareTitle?: string;
}

export interface ShareOrDownloadBlobOptions {
    blob: Blob;
    fileName: string;
    shareTitle?: string;
    /** 网页端明确显示为“下载”的入口跳过 Web Share。 */
    preferDownloadOnWeb?: boolean;
}

/** Fetch a downloadable blob. */
export async function fetchBlobForShare(sourceUrl: string, fallbackMimeType = 'application/octet-stream'): Promise<Blob> {
    void fallbackMimeType;
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('文件为空');
    return blob;
}

/**
 * 保存二进制媒体：移动浏览器优先 Web Share，桌面浏览器才使用 a.download。
 */
export async function shareOrDownloadBlob(options: ShareOrDownloadBlobOptions): Promise<'shared' | 'downloaded' | 'cancelled'> {
    const { blob, fileName, shareTitle = fileName, preferDownloadOnWeb = false } = options;
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error('文件为空，无法保存');

    try {
        const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
        const canShareFile = typeof navigator !== 'undefined'
            && !preferDownloadOnWeb
            && typeof navigator.share === 'function'
            && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
        if (canShareFile) {
            await navigator.share({ title: shareTitle, files: [file] });
            return 'shared';
        }
    } catch (error: any) {
        if (error?.name === 'AbortError') return 'cancelled';
        const expectedPermissionFallback = error?.name === 'NotAllowedError'
            || /permission denied|not allowed|user activation/i.test(String(error?.message || error));
        if (!expectedPermissionFallback) console.error('Web Blob Share Error', error);
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'downloaded';
}

/**
 * 强制拉起分享的文件导出：Web Share API → 浏览器下载兜底。
 *
 * 移动端浏览器 `<a download>` 往往不触发任何东西，直接下载会「点了没反应 = 导不出来」。
 * 所以先尝试调起系统 / 浏览器的分享面板把文件送出去，只有在没有 Web Share 能力时才退回下载。
 *
 * 与 apps/Character.tsx 的角色卡导出保持一致的两级兜底策略。
 *
 * @returns `'shared'` 已调起分享面板；`'downloaded'` 走了浏览器下载兜底。
 */
export async function shareOrDownloadFile(options: ShareOrDownloadOptions): Promise<'shared' | 'downloaded'> {
    const { content, fileName, mimeType = 'application/json', shareTitle = fileName } = options;

    try {
        const file = new File([content], fileName, { type: mimeType });
        const canShareFile = typeof navigator !== 'undefined'
            && typeof navigator.share === 'function'
            && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));

        if (canShareFile) {
            await navigator.share({
                title: shareTitle,
                files: [file],
            });
            return 'shared';
        }
    } catch (e: any) {
        // 用户取消（AbortError）与不支持的情况都继续走下载兜底，保证一定能拿到文件。
        if (e?.name !== 'AbortError') {
            console.error('Web Share Export Error', e);
        }
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return 'downloaded';
}
