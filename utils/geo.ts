/**
 * 取当前定位：浏览器走 navigator.geolocation。
 */
export interface GeoResult { longitude: number; latitude: number; accuracy: number; }

export const getCurrentPositionSmart = (): Promise<GeoResult> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
        return Promise.reject(new Error('当前环境不支持定位, 请选城市或手输坐标'));
    }
    return new Promise<GeoResult>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ longitude: pos.coords.longitude, latitude: pos.coords.latitude, accuracy: pos.coords.accuracy ?? 99999 }),
            (err) => reject(new Error(err.message || '定位失败')),
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    });
};
