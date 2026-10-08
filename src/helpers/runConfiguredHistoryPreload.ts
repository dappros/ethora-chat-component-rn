import XmppClient from '../networking/xmppClient';
import { store } from '../roomStore';
import { IConfig } from '../types/types';
import { runHistoryPreloadScheduler } from './historyPreloadScheduler';
import {
  resolveHistoryPreloadConfig,
  TEASER_ROOM_FACTOR,
} from './historyPreloadConfig';

export interface ConfiguredPreloadOptions {
  client: XmppClient;
  config?: Pick<IConfig, 'historyPreload' | 'historyQoS' | 'defaultRooms'> | null;
  signal?: AbortSignal;
}

/**
 * The preload a host's config asks for, in one place (the provider's
 * initBeforeLoad bootstrap and any other start point share it):
 * - 'off': nothing, rooms load when opened.
 * - 'all': every room, one pass (the old behaviour for small accounts).
 * - 'staged' (default): rooms still lacking a list preview get a one-message
 *   page first, then the top-N rooms by activity get a full first page;
 *   everything else loads when opened.
 * - 'legacy' (historyQoS.stagedPreloadEnabled === false): the previous single
 *   pass over every room (capped by preloadTopKRooms when set).
 */
export const runConfiguredHistoryPreload = async ({
  client,
  config,
  signal,
}: ConfiguredPreloadOptions): Promise<void> => {
  const cfg = resolveHistoryPreloadConfig(config as any);
  if (cfg.mode === 'off') {return;}

  const common = {
    client,
    signal,
    concurrency: cfg.concurrency,
    selectedRoomJid: store.getState().rooms.activeRoomJID || null,
    defaultRoomJids: (config?.defaultRooms || [])
      .map((room: any) => (typeof room === 'string' ? room : room?.jid))
      .filter(Boolean) as string[],
  };

  if (cfg.mode === 'legacy') {
    await runHistoryPreloadScheduler({
      ...common,
      pageSize: config?.historyQoS?.stagedPreloadFirstPassSize,
      roomLimit: config?.historyQoS?.preloadTopKRooms,
    });
    return;
  }

  if (cfg.mode === 'staged') {
    // Pass 1 (preview): a one-message page for rooms the list cannot render
    // a preview for yet. Rooms with an API `lastMessage` cost nothing.
    await runHistoryPreloadScheduler({
      ...common,
      pageSize: cfg.firstPassSize,
      retryLimit: 2,
      roomLimit: cfg.topRooms ? cfg.topRooms * TEASER_ROOM_FACTOR : undefined,
      skipApiPreview: true,
      // 'partial' so pass 2 still fetches the real page for these rooms.
      completionState: 'partial',
    });
  }

  // Pass 2: the real page, for the top-N rooms only (all rooms in 'all').
  await runHistoryPreloadScheduler({
    ...common,
    pageSize: cfg.secondPassSize,
    roomLimit: cfg.topRooms || undefined,
  });
};

export default runConfiguredHistoryPreload;
