// Canonical IConfig now lives in `src/types/types.ts` (it's the surface
// the XMPP provider, ChatWrapper, useSendMessage, persistence, scheduler,
// and notification provider all import). This file re-exports it so the
// UI layer (which imports from `types/models/config.model`) keeps working
// without drifting from the flow layer.
//
// Add NEW fields to `src/types/types.ts:IConfig`, not here.

export type {
  IConfig,
  FBConfig,
  MessageBubble,
  PartialRoomWithMandatoryKeys,
  HistoryQoSConfig,
  InAppNotificationConfig,
} from '../types';
