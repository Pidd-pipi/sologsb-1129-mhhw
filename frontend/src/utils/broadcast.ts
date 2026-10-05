/**
 * 跨页面（浏览器标签页）信号：
 * 同一应用开两个页面编辑同一只字盘时，一边保存布局或改变字模可用性，
 * 另一边需要立即察觉并重算合并 / 失效状态，而不是等刷新。
 *
 * 优先用 BroadcastChannel；个别环境不支持时退化为 localStorage storage 事件。
 * 信号只在页面之间传递，不回送发送方（同页内的状态变化由各自 store 直接更新）。
 */

export type ArchiveSignalType = 'matrices-changed' | 'cases-changed';

export interface ArchiveSignal {
  type: ArchiveSignalType;
  /** 触发变更的实体 id（可选，接收方只做整表静默刷新，不依赖它） */
  id?: string;
  at: number;
}

const CHANNEL_NAME = 'gbmovabletype-signal';
const STORAGE_KEY = 'gbmovabletype-signal';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }
  return channel;
}

/** 向其它打开的页面广播变更信号（不触发本页回调） */
export function broadcastSignal(type: ArchiveSignalType, id?: string): void {
  const signal: ArchiveSignal = { type, id, at: Date.now() };
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(signal);
      return;
    } catch {
      /* 落到 localStorage 兜底 */
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(signal));
  } catch {
    /* localStorage 不可用时静默降级（同页状态仍一致） */
  }
}

/** 订阅其它页面的变更信号；返回退订函数 */
export function subscribeSignal(handler: (signal: ArchiveSignal) => void): () => void {
  const ch = getChannel();
  const onMessage = (ev: MessageEvent) => {
    const data = ev.data as ArchiveSignal | null;
    if (data && (data.type === 'matrices-changed' || data.type === 'cases-changed')) handler(data);
  };
  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== STORAGE_KEY || !ev.newValue) return;
    try {
      const data = JSON.parse(ev.newValue) as ArchiveSignal;
      if (data.type === 'matrices-changed' || data.type === 'cases-changed') handler(data);
    } catch {
      /* 忽略无法解析的信号 */
    }
  };
  ch?.addEventListener('message', onMessage);
  if (!ch) window.addEventListener('storage', onStorage);

  return () => {
    ch?.removeEventListener('message', onMessage);
    if (!ch) window.removeEventListener('storage', onStorage);
  };
}
