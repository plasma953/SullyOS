import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useOS } from '../../context/OSContext';
import {
    bleEngine,
    normalizeUuidInput,
    type BleEngineSnapshot,
    type BleGattCharInfo,
    type BleGattServiceInfo,
} from '../../utils/bleEngine';
import {
    loadBleDevices,
    removeBleDevice,
    removeCommandFromDevice,
    saveCommandToDevice,
    touchBleDeviceConnected,
    upsertBleDevice,
    type BlePayloadFormat,
    type BleSavedCommand,
    type BleSavedDevice,
    type BleWriteMode,
} from '../../utils/bleRegistry';

const shortUuid = (uuid: string): string => {
    const u = (uuid || '').toLowerCase();
    if (!u) return '';
    if (u.startsWith('0x') || u.length <= 8) return u;
    const m = u.match(/^([0-9a-f]{4,8})-0000-1000-8000-00805f9b34fb$/);
    if (m) return `0x${m[1].slice(-4)}`;
    return `${u.slice(0, 8)}…`;
};

const formatLastConnected = (ts?: number): string => {
    if (!ts) return '从未连接';
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return '从未连接';
    }
};

const ConnDot: React.FC<{ state: string }> = ({ state }) => (
    <span
        title={state === 'connected' ? '已连接' : state === 'connecting' ? '连接中' : '未连接'}
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${
            state === 'connected'
                ? 'bg-emerald-500'
                : state === 'connecting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-slate-300'
        }`}
    />
);

const copyText = async (
    text: string,
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void,
): Promise<void> => {
    try {
        await navigator.clipboard.writeText(text);
        addToast('已复制', 'success');
    } catch {
        addToast('复制失败', 'error');
    }
};

/** 特征行：读 / 写 / 订阅 / 保存为指令。 */
const GattCharRow: React.FC<{
    deviceId: string;
    conn: string;
    serviceUuid: string;
    char: BleGattCharInfo;
    onSaved: () => void;
}> = ({ deviceId, conn, serviceUuid, char, onSaved }) => {
    const { addToast } = useOS();
    const lowered = useMemo(() => char.props.map(p => p.toLowerCase()), [char.props]);
    const canRead = lowered.some(p => p.includes('read'));
    const canWrite = lowered.some(p => p.includes('write'));
    const canNotify = lowered.some(p => p.includes('notify') || p.includes('indicate'));

    const [readResult, setReadResult] = useState<{ hex: string; text: string } | null>(null);
    const [reading, setReading] = useState(false);
    const [writeFormat, setWriteFormat] = useState<BlePayloadFormat>('hex');
    const [writePayload, setWritePayload] = useState('');
    const [writeMode, setWriteMode] = useState<BleWriteMode>('withResponse');
    const [writing, setWriting] = useState(false);
    const [notifying, setNotifying] = useState(false);
    const [lastNotify, setLastNotify] = useState<{ hex: string; text: string } | null>(null);
    const stopRef = useRef<(() => void) | null>(null);
    const [saveOpen, setSaveOpen] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [saveNote, setSaveNote] = useState('');
    const [saveFormat, setSaveFormat] = useState<BlePayloadFormat>('hex');
    const [savePayload, setSavePayload] = useState('');
    const [saveMode, setSaveMode] = useState<BleWriteMode>('withResponse');
    const [saving, setSaving] = useState(false);

    // 切设备 / 卸载时退订，避免泄漏到别的特征上。
    useEffect(() => () => {
        try {
            stopRef.current?.();
        } catch { /* ignore */ }
        stopRef.current = null;
    }, [deviceId, serviceUuid, char.uuid]);
    // 断开时退订。
    useEffect(() => {
        if (conn !== 'connected' && stopRef.current) {
            try {
                stopRef.current();
            } catch { /* ignore */ }
            stopRef.current = null;
            setNotifying(false);
        }
    }, [conn]);

    const handleRead = async () => {
        if (reading) return;
        setReading(true);
        try {
            setReadResult(await bleEngine.readValue(deviceId, serviceUuid, char.uuid));
        } catch (e: any) {
            addToast(e?.message || '读取失败', 'error');
        } finally {
            setReading(false);
        }
    };

    const handleWrite = async () => {
        if (writing) return;
        if (!writePayload.trim()) {
            addToast('请填写要发送的内容', 'error');
            return;
        }
        setWriting(true);
        try {
            await bleEngine.writeValue(deviceId, serviceUuid, char.uuid, writeFormat, writePayload.trim(), writeMode);
            addToast('已发送', 'success');
        } catch (e: any) {
            addToast(e?.message || '发送失败', 'error');
        } finally {
            setWriting(false);
        }
    };

    const handleNotifyToggle = async () => {
        if (notifying) {
            try {
                stopRef.current?.();
            } catch { /* ignore */ }
            stopRef.current = null;
            setNotifying(false);
            return;
        }
        try {
            const stop = await bleEngine.startNotify(deviceId, serviceUuid, char.uuid, setLastNotify);
            stopRef.current = stop;
            setNotifying(true);
        } catch (e: any) {
            addToast(e?.message || '订阅失败', 'error');
        }
    };

    const handleSave = async () => {
        const name = saveName.trim();
        if (!name) {
            addToast('请填写指令名称', 'error');
            return;
        }
        if (!savePayload.trim()) {
            addToast('请填写要发送的内容', 'error');
            return;
        }
        if (saving) return;
        setSaving(true);
        try {
            await saveCommandToDevice(deviceId, {
                id: `cmd_${Date.now()}`,
                name,
                serviceUuid,
                characteristicUuid: char.uuid,
                format: saveFormat,
                payload: savePayload.trim(),
                writeMode: saveMode,
                ...(saveNote.trim() ? { note: saveNote.trim() } : {}),
            });
            addToast(`已保存指令「${name}」`, 'success');
            setSaveOpen(false);
            setSaveName('');
            setSaveNote('');
            setSavePayload('');
            onSaved();
        } catch (e: any) {
            addToast(e?.message || '保存失败', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white/70 border border-slate-200/80 rounded-xl p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-slate-600 truncate" title={char.uuid}>{shortUuid(char.uuid)}</span>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        onClick={() => void copyText(char.uuid, addToast)}
                        title="复制完整 UUID"
                        className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md active:scale-95 transition-transform"
                    >复制</button>
                    {char.props.map(p => (
                        <span key={p} className="text-[9px] font-bold bg-sky-50 text-sky-600 border border-sky-100 px-1.5 py-0.5 rounded-full">{p}</span>
                    ))}
                </div>
            </div>
            {canRead && (
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void handleRead()}
                        disabled={reading}
                        className="text-[11px] font-bold text-sky-600 bg-sky-100 px-2.5 py-1 rounded-lg active:scale-95 transition-transform disabled:opacity-60"
                    >{reading ? '读取中…' : '读'}</button>
                    {readResult && (
                        <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-slate-500" title={`${readResult.hex}${readResult.text ? ` / ${readResult.text}` : ''}`}>
                            {readResult.hex}{readResult.text ? ` / ${readResult.text}` : ''}
                        </span>
                    )}
                </div>
            )}
            <div
                className="flex flex-wrap items-center gap-1.5"
                title={canWrite ? undefined : '该特征不支持写入'}
            >
                <select
                    value={writeFormat}
                    onChange={e => setWriteFormat(e.target.value as BlePayloadFormat)}
                    disabled={!canWrite}
                    className="text-[11px] bg-white border border-slate-200 rounded-lg px-1.5 py-1 disabled:opacity-40"
                >
                    <option value="hex">hex</option>
                    <option value="text">text</option>
                </select>
                <input
                    type="text"
                    value={writePayload}
                    onChange={e => setWritePayload(e.target.value)}
                    disabled={!canWrite}
                    placeholder={canWrite ? '要发送的内容' : '该特征不支持写入'}
                    className="min-w-0 flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-mono disabled:opacity-40"
                />
                <select
                    value={writeMode}
                    onChange={e => setWriteMode(e.target.value as BleWriteMode)}
                    disabled={!canWrite}
                    className="text-[11px] bg-white border border-slate-200 rounded-lg px-1.5 py-1 disabled:opacity-40"
                >
                    <option value="withResponse">withResponse</option>
                    <option value="withoutResponse">withoutResponse</option>
                </select>
                <button
                    type="button"
                    onClick={() => void handleWrite()}
                    disabled={!canWrite || writing}
                    title={canWrite ? undefined : '该特征不支持写入'}
                    className="text-[11px] font-bold text-white bg-sky-500 px-2.5 py-1 rounded-lg active:scale-95 transition-transform disabled:opacity-40"
                >{writing ? '发送中…' : '发送'}</button>
            </div>
            {canNotify && (
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void handleNotifyToggle()}
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg active:scale-95 transition-transform ${notifying ? 'text-amber-700 bg-amber-100' : 'text-emerald-600 bg-emerald-100'}`}
                    >{notifying ? '取消订阅' : '订阅'}</button>
                    {lastNotify && (
                        <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-emerald-600" title={`${lastNotify.hex}${lastNotify.text ? ` / ${lastNotify.text}` : ''}`}>
                            {lastNotify.hex}{lastNotify.text ? ` / ${lastNotify.text}` : ''}
                        </span>
                    )}
                </div>
            )}
            <div>
                <button
                    type="button"
                    onClick={() => {
                        setSavePayload(writePayload);
                        setSaveFormat(writeFormat);
                        setSaveMode(writeMode);
                        setSaveOpen(v => !v);
                    }}
                    className="text-[11px] font-bold text-violet-600 bg-violet-100 px-2.5 py-1 rounded-lg active:scale-95 transition-transform"
                >保存为指令</button>
                {saveOpen && (
                    <div className="mt-2 space-y-1.5 bg-violet-50/60 border border-violet-100 rounded-xl p-2.5">
                        <input
                            type="text"
                            value={saveName}
                            onChange={e => setSaveName(e.target.value)}
                            placeholder="指令名称（必填）"
                            className="w-full bg-white border border-violet-200 rounded-lg px-2 py-1.5 text-xs"
                        />
                        <input
                            type="text"
                            value={saveNote}
                            onChange={e => setSaveNote(e.target.value)}
                            placeholder="用途说明（选填，告诉角色什么时候用）"
                            className="w-full bg-white border border-violet-200 rounded-lg px-2 py-1.5 text-xs"
                        />
                        <div className="flex items-center gap-1.5">
                            <select
                                value={saveFormat}
                                onChange={e => setSaveFormat(e.target.value as BlePayloadFormat)}
                                className="text-[11px] bg-white border border-violet-200 rounded-lg px-1.5 py-1"
                            >
                                <option value="hex">hex</option>
                                <option value="text">text</option>
                            </select>
                            <select
                                value={saveMode}
                                onChange={e => setSaveMode(e.target.value as BleWriteMode)}
                                className="text-[11px] bg-white border border-violet-200 rounded-lg px-1.5 py-1"
                            >
                                <option value="withResponse">withResponse</option>
                                <option value="withoutResponse">withoutResponse</option>
                            </select>
                        </div>
                        <input
                            type="text"
                            value={savePayload}
                            onChange={e => setSavePayload(e.target.value)}
                            placeholder="要发送的内容"
                            className="w-full bg-white border border-violet-200 rounded-lg px-2 py-1.5 text-xs font-mono"
                        />
                        <button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={saving}
                            className="w-full py-1.5 bg-violet-500 text-white text-[11px] font-bold rounded-lg active:scale-95 transition-transform disabled:opacity-60"
                        >{saving ? '保存中…' : '保存'}</button>
                    </div>
                )}
            </div>
        </div>
    );
};

/** 设备详情视图：指令芯片 + GATT 枚举 + 特征操作 + 日志。 */
const DeviceDetail: React.FC<{
    device: BleSavedDevice;
    snapshot: BleEngineSnapshot;
    onBack: () => void;
    onReload: () => void;
}> = ({ device, snapshot, onBack, onReload }) => {
    const { addToast } = useOS();
    const conn = snapshot.states[device.id] ?? 'disconnected';
    const [services, setServices] = useState<BleGattServiceInfo[] | null>(null);
    const [enumerating, setEnumerating] = useState(false);
    const [busy, setBusy] = useState(false);
    const logs = useMemo(
        () => snapshot.logs.filter(l => l.deviceId === device.id).slice(-20),
        [snapshot.logs, device.id],
    );

    const handleConnect = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await bleEngine.connect(device.id);
            await touchBleDeviceConnected(device.id);
            addToast(`已连接「${device.name}」`, 'success');
            onReload();
        } catch (e: any) {
            const msg = e?.message || '连接失败';
            if (/重新配对/.test(msg)) addToast('浏览器授权已变更，请删除该设备后重新添加配对', 'error');
            else addToast(msg, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleDisconnect = () => {
        bleEngine.disconnect(device.id);
        addToast('已断开', 'info');
    };

    const handleSendCommand = async (cmd: BleSavedCommand) => {
        try {
            await bleEngine.writeValue(device.id, cmd.serviceUuid, cmd.characteristicUuid, cmd.format, cmd.payload, cmd.writeMode);
            addToast(`已发送「${cmd.name}」`, 'success');
        } catch (e: any) {
            addToast(e?.message || '发送失败', 'error');
        }
    };

    const handleDeleteCommand = async (cmd: BleSavedCommand) => {
        if (!window.confirm(`删除指令「${cmd.name}」？`)) return;
        await removeCommandFromDevice(device.id, cmd.id);
        addToast('已删除指令', 'success');
        onReload();
    };

    const handleEnum = async () => {
        if (conn !== 'connected') {
            addToast('请先连接该设备', 'error');
            return;
        }
        if (enumerating) return;
        setEnumerating(true);
        try {
            setServices(await bleEngine.listGatt(device.id));
        } catch (e: any) {
            const msg = e?.message || '枚举服务失败';
            if (e?.name === 'SecurityError' || /权限|permission|whitelist|disallowed|blocked/i.test(msg)) {
                addToast('服务不在配对白名单里：去列表删除该设备，添加时在服务 UUID 框填入该服务 UUID 后重新配对', 'error');
            } else {
                addToast(msg, 'error');
            }
        } finally {
            setEnumerating(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onBack}
                    className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg active:scale-95 transition-transform"
                >← 返回</button>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">{device.name}</span>
                <ConnDot state={conn} />
                {conn === 'connected' ? (
                    <button
                        type="button"
                        onClick={handleDisconnect}
                        className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg active:scale-95 transition-transform"
                    >断开</button>
                ) : (
                    <button
                        type="button"
                        onClick={() => void handleConnect()}
                        disabled={busy || conn === 'connecting'}
                        className="text-[11px] font-bold text-white bg-sky-500 px-2.5 py-1 rounded-lg active:scale-95 transition-transform disabled:opacity-60"
                    >{conn === 'connecting' ? '连接中…' : '连接'}</button>
                )}
            </div>

            <div>
                <p className="text-[10px] font-bold text-slate-400 mb-1.5">已保存指令（{device.commands.length}）</p>
                {device.commands.length ? (
                    <div className="flex flex-wrap gap-1.5">
                        {device.commands.map(cmd => (
                            <span
                                key={cmd.id}
                                title={cmd.note || `${shortUuid(cmd.serviceUuid)} / ${shortUuid(cmd.characteristicUuid)}`}
                                className="inline-flex items-center gap-1 bg-violet-50 border border-violet-100 rounded-full pl-2.5 pr-1 py-0.5"
                            >
                                <span className="text-[11px] font-bold text-violet-700 max-w-24 truncate">{cmd.name}</span>
                                <button
                                    type="button"
                                    onClick={() => void handleSendCommand(cmd)}
                                    className="text-[10px] font-bold text-white bg-violet-500 px-2 py-0.5 rounded-full active:scale-95 transition-transform"
                                >发送</button>
                                <button
                                    type="button"
                                    onClick={() => void handleDeleteCommand(cmd)}
                                    title={`删除指令「${cmd.name}」`}
                                    className="w-5 h-5 flex items-center justify-center rounded-full text-violet-300 hover:text-red-500 active:scale-90 transition-all"
                                >×</button>
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-[11px] text-slate-400">还没有保存指令：在下方枚举服务后，把常用特征存成指令，角色也能一键调用。</p>
                )}
            </div>

            <div>
                <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-bold text-slate-400">GATT 服务</p>
                    <button
                        type="button"
                        onClick={() => void handleEnum()}
                        disabled={enumerating}
                        className="text-[11px] font-bold text-sky-600 bg-sky-100 px-2.5 py-1 rounded-lg active:scale-95 transition-transform disabled:opacity-60"
                    >{enumerating ? '枚举中…' : '枚举服务'}</button>
                </div>
                {services ? (
                    services.length ? (
                        <div className="space-y-2">
                            {services.map(svc => (
                                <div key={svc.uuid} className="bg-slate-50/70 border border-slate-100 rounded-xl p-2 space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-mono font-bold text-slate-600 truncate" title={svc.uuid}>{shortUuid(svc.uuid)}</span>
                                        <button
                                            type="button"
                                            onClick={() => void copyText(svc.uuid, addToast)}
                                            title="复制完整 UUID"
                                            className="text-[10px] text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md active:scale-95 transition-transform shrink-0"
                                        >复制</button>
                                    </div>
                                    {svc.characteristics.length ? (
                                        svc.characteristics.map(c => (
                                            <GattCharRow
                                                key={`${svc.uuid}|${c.uuid}`}
                                                deviceId={device.id}
                                                conn={conn}
                                                serviceUuid={svc.uuid}
                                                char={c}
                                                onSaved={onReload}
                                            />
                                        ))
                                    ) : (
                                        <p className="text-[10px] text-slate-400">该服务下没有特征。</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[11px] text-slate-400">没有枚举到服务。</p>
                    )
                ) : (
                    <p className="text-[11px] text-slate-400">点「枚举服务」查看该设备暴露的服务与特征。</p>
                )}
            </div>

            <div>
                <p className="text-[10px] font-bold text-slate-400 mb-1.5">最近日志</p>
                {logs.length ? (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                        {logs.map((l, i) => (
                            <p
                                key={`${l.ts}-${i}`}
                                className={`text-[10px] font-mono leading-relaxed px-2 py-1 rounded-lg break-all ${
                                    l.dir === 'tx'
                                        ? 'bg-sky-50 text-sky-700'
                                        : l.dir === 'rx'
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : 'bg-slate-50 text-slate-400'
                                }`}
                            >
                                <span className="opacity-70">{new Date(l.ts).toLocaleTimeString()}</span> {l.text}
                            </p>
                        ))}
                    </div>
                ) : (
                    <p className="text-[11px] text-slate-400">暂无日志。</p>
                )}
            </div>
        </div>
    );
};

/** 蓝牙管理面板：设备列表 + 设备控制台（设置 Modal 内挂载）。 */
const BluetoothPanel: React.FC = () => {
    const { addToast } = useOS();
    const subscribe = useMemo(() => bleEngine.subscribe.bind(bleEngine), []);
    const getSnapshot = useMemo(() => {
        // getSnapshot 每次返回新对象，直接传给 useSyncExternalStore 会无限重渲染；
        // 按 version 缓存，语义与直接订阅一致。
        let cache: BleEngineSnapshot | null = null;
        const get = bleEngine.getSnapshot.bind(bleEngine);
        return () => {
            const next = get();
            if (cache && cache.version === next.version) return cache;
            cache = next;
            return next;
        };
    }, []);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot);
    const [devices, setDevices] = useState<BleSavedDevice[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [svcInput, setSvcInput] = useState('');
    const [adding, setAdding] = useState(false);
    const supported = bleEngine.isSupported();

    const reload = useMemo(
        () => async () => {
            try {
                setDevices(await loadBleDevices());
            } catch { /* ignore */ }
        },
        [],
    );

    useEffect(() => {
        void reload();
        // 面板打开即尝试找回浏览器还记得的已配对设备，失败不打扰用户。
        try {
            void bleEngine.restoreKnown().catch(() => {});
        } catch { /* ignore */ }
    }, [reload]);

    const handleConnect = async (d: BleSavedDevice) => {
        try {
            await bleEngine.connect(d.id);
            await touchBleDeviceConnected(d.id);
            addToast(`已连接「${d.name}」`, 'success');
            await reload();
        } catch (e: any) {
            const msg = e?.message || '连接失败';
            if (/重新配对/.test(msg)) addToast('浏览器授权已变更，请删除该设备后重新添加配对', 'error');
            else addToast(msg, 'error');
        }
    };

    const handleDelete = async (d: BleSavedDevice) => {
        if (!window.confirm(`删除「${d.name}」？本机保存的指令会一并删除。`)) return;
        await removeBleDevice(d.id);
        setDevices(prev => prev.filter(x => x.id !== d.id));
        addToast('已删除设备', 'success');
    };

    const handleAdd = async () => {
        if (adding) return;
        const parts = svcInput.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
        const services: string[] = [];
        for (const part of parts) {
            const norm = normalizeUuidInput(part);
            if (!norm) {
                addToast(`服务 UUID「${part}」格式不对，已中止`, 'error');
                return;
            }
            services.push(norm);
        }
        setAdding(true);
        try {
            const paired = await bleEngine.requestPair(services);
            if (!paired) return;
            // 只存用户输入的 services：配对预设由 requestPair 内部处理，不进注册表。
            const next = await upsertBleDevice(paired.id, paired.name, services);
            setDevices(next);
            setSvcInput('');
            addToast(`已添加「${paired.name}」`, 'success');
        } catch (e: any) {
            addToast(e?.message || '配对失败', 'error');
        } finally {
            setAdding(false);
        }
    };

    if (!supported) {
        return (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold text-slate-500">当前浏览器不支持 Web Bluetooth</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                    需要桌面 Chrome / Edge 且页面跑在 HTTPS（或 localhost）下；iOS Safari 不支持 Web Bluetooth；
                    安卓 App 壳的 WebView 也不支持。请换桌面 Chrome 打开再试。
                </p>
            </div>
        );
    }

    const selected = selectedId ? devices.find(d => d.id === selectedId) ?? null : null;
    if (selected) {
        return (
            <DeviceDetail
                device={selected}
                snapshot={snapshot}
                onBack={() => setSelectedId(null)}
                onReload={() => void reload()}
            />
        );
    }

    return (
        <div className="space-y-3">
            {devices.length ? (
                <div className="space-y-2">
                    {devices.map(d => {
                        const state = snapshot.states[d.id] ?? 'disconnected';
                        return (
                            <div key={d.id} className="bg-white/70 border border-slate-200/80 rounded-xl p-3 space-y-1.5">
                                <div className="flex items-center gap-2">
                                    <ConnDot state={state} />
                                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{d.name}</span>
                                    <span className="text-[10px] text-slate-400 shrink-0">{d.commands.length} 条指令</span>
                                </div>
                                <p className="text-[10px] text-slate-400">上次连接：{formatLastConnected(d.lastConnectedAt)}</p>
                                <div className="flex items-center gap-1.5 pt-0.5">
                                    {state === 'connected' ? (
                                        <button
                                            type="button"
                                            onClick={() => bleEngine.disconnect(d.id)}
                                            className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg active:scale-95 transition-transform"
                                        >断开</button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => void handleConnect(d)}
                                            disabled={state === 'connecting'}
                                            className="text-[11px] font-bold text-white bg-sky-500 px-2.5 py-1 rounded-lg active:scale-95 transition-transform disabled:opacity-60"
                                        >{state === 'connecting' ? '连接中…' : '连接'}</button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setSelectedId(d.id)}
                                        className="text-[11px] font-bold text-sky-600 bg-sky-100 px-2.5 py-1 rounded-lg active:scale-95 transition-transform"
                                    >详情</button>
                                    <span className="flex-1" />
                                    <button
                                        type="button"
                                        onClick={() => void handleDelete(d)}
                                        className="text-[11px] font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-lg active:scale-95 transition-transform"
                                    >删除</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className="text-[11px] text-slate-400 leading-relaxed">还没有配对过设备。点下方「添加设备」，在弹出的浏览器选择器里选中你的 BLE 外设。</p>
            )}
            <div className="bg-slate-50/70 border border-slate-100 rounded-xl p-3 space-y-2">
                <label className="text-[10px] font-bold text-slate-400 block">服务 UUID（逗号分隔，可选，高级）</label>
                <input
                    type="text"
                    value={svcInput}
                    onChange={e => setSvcInput(e.target.value)}
                    placeholder="例如：0x180f, battery_service（留空=只用默认预设）"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-700"
                />
                <button
                    type="button"
                    onClick={() => void handleAdd()}
                    disabled={adding}
                    className="w-full py-2 bg-sky-500 text-white text-xs font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-60"
                >{adding ? '等待浏览器配对…' : '添加设备'}</button>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                    只有设备文档里写了「需要先声明服务 UUID 才能连上」时才填；枚举时若报白名单错误，按提示把对应 UUID 填这里重配一次。
                </p>
            </div>
        </div>
    );
};

export default BluetoothPanel;
