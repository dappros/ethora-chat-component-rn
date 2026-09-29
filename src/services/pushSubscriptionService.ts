import { Client } from '@xmpp/client';
import { PushTokenRegistration, User } from '../types/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  subscribeToPushNotifications,
  unregisterPushToken as unregisterPushTokenApi,
} from '../networking/api-requests/push.api';
import { subscribeToRoomMessages } from '../networking/xmpp/subscribeToRoomMessages.xmpp';

const SUBSCRIBED_ROOMS_KEY = 'ethora_subscribed_rooms';

export class PushSubscriptionService {
  private subscribedRooms: Set<string> = new Set();
  // Registered device push tokens, keyed by `${provider}:${token}:${userIdentity}`
  // so the dedup check in `registerToken` doesn't skip a re-registration
  // after a user switch (same token/provider, different user still holding
  // the app). The value is the registration itself, not just a marker, so
  // `unregisterAllTokens` can send the real payload without re-parsing the
  // key.
  private registeredTokens: Map<string, PushTokenRegistration> = new Map();
  private isInitialized: boolean = false;

  private async loadSubscribedRoomsFromStorage(): Promise<void> {
    if (this.isInitialized) {return;}

    try {
      const storedRooms = await AsyncStorage.getItem(SUBSCRIBED_ROOMS_KEY);
      if (storedRooms) {
        const roomsArray = JSON.parse(storedRooms) as string[];
        this.subscribedRooms = new Set(roomsArray);
      }
      this.isInitialized = true;
    } catch (error) {
      console.error('[PushService] Failed to load subscribed rooms from storage:', error);
    }
  }

  private async saveSubscribedRoomsToStorage(): Promise<void> {
    try {
      const roomsArray = Array.from(this.subscribedRooms);
      await AsyncStorage.setItem(SUBSCRIBED_ROOMS_KEY, JSON.stringify(roomsArray));
    } catch (error) {
      console.error('[PushService] Failed to save subscribed rooms to storage:', error);
    }
  }

  private tokenKey(registration: PushTokenRegistration, user: User): string {
    const identity =
      user.xmppUsername || user.defaultWallet?.walletAddress || user.walletAddress || '';
    return `${registration.provider}:${registration.token}:${identity}`;
  }

  /**
   * Register one device push token (a device can hold several at once,
   * one per provider, e.g. expo for chat + apns-voip for calls). Idempotent:
   * the same provider/token pair for the same user is a no-op, so callers
   * (the `getPushTokens` bootstrap hook in particular) can call this on
   * every reconnect without hammering the backend.
   */
  async registerToken(
    registration: PushTokenRegistration,
    user: User,
    projectName: string
  ): Promise<void> {
    const key = this.tokenKey(registration, user);
    if (this.registeredTokens.has(key)) {
      return;
    }

    const userJid = user.xmppUsername || '';
    if (!userJid) {
      console.warn('[PushService] Cannot register push token: user JID is missing');
      return;
    }

    try {
      await subscribeToPushNotifications(registration, userJid, projectName);
      this.registeredTokens.set(key, registration);
    } catch (error) {
      console.error('[PushService] Failed to register push token:', error);
    }
  }

  /**
   * Unregister a single token. Matches by provider + token rather than the
   * dedup key above (which also folds in user identity), so this works
   * whether or not the caller still has the `User` object handy, e.g. a
   * host-triggered `unregisterPushToken` right after `useLogout` already
   * cleared the store user.
   */
  async unregisterToken(registration: PushTokenRegistration): Promise<void> {
    try {
      await unregisterPushTokenApi(registration);
    } catch (error) {
      console.error('[PushService] Failed to unregister push token:', error);
    } finally {
      for (const [key, value] of this.registeredTokens) {
        if (value.provider === registration.provider && value.token === registration.token) {
          this.registeredTokens.delete(key);
        }
      }
    }
  }

  /**
   * Unregister every token currently known for this device (all providers).
   * Used at logout, before `reset()` wipes the map. Best effort by design:
   * a failed DELETE for one token must not stop the others, and must never
   * throw back into `logoutService`, which cannot block on the network.
   */
  async unregisterAllTokens(): Promise<void> {
    const registrations = Array.from(this.registeredTokens.values());
    if (!registrations.length) {return;}

    await Promise.allSettled(
      registrations.map((registration) =>
        unregisterPushTokenApi(registration).catch((error) => {
          console.warn(
            `[PushService] unregisterAllTokens: failed for provider "${registration.provider}"`,
            error
          );
        })
      )
    );
    this.registeredTokens.clear();
  }

  async subscribeToRoom(
    client: Client,
    roomJID: string,
    userNick?: string
  ): Promise<boolean> {
    await this.loadSubscribedRoomsFromStorage();

    if (this.subscribedRooms.has(roomJID)) {
      return true;
    }

    try {
      const result = await subscribeToRoomMessages(client, roomJID, userNick);
      if (result) {
        this.subscribedRooms.add(roomJID);
        await this.saveSubscribedRoomsToStorage();
      }
      if (!result) {
        console.warn('[PushService] MucSub subscribe refused for', roomJID);
      }
      return result;
    } catch (error) {
      console.error(`[PushService] Failed to subscribe to room ${roomJID}:`, error);
      return false;
    }
  }

  async subscribeToRooms(
    client: Client,
    roomJIDs: string[],
    userNick?: string,
    concurrency = 8
  ): Promise<void> {
    let successful = 0;
    let failed = 0;

    await this.loadSubscribedRoomsFromStorage();
    const pending = roomJIDs.filter((jid) => !this.subscribedRooms.has(jid));
    if (!pending.length) {
      return;
    }

    for (let i = 0; i < pending.length; i += concurrency) {
      const batch = pending.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((roomJID) => this.subscribeToRoom(client, roomJID, userNick))
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          successful++;
        } else {
          failed++;
        }
      }
    }

    console.log(`[PushService] MucSub: ${successful} rooms subscribed, ${failed} failed`);
  }

  async reset(): Promise<void> {
    this.subscribedRooms.clear();
    this.registeredTokens.clear();
    this.isInitialized = false;

    try {
      await AsyncStorage.removeItem(SUBSCRIBED_ROOMS_KEY);
      console.log('[PushService] Subscribed rooms cleared from storage');
    } catch (error) {
      console.error('[PushService] Failed to clear subscribed rooms from storage:', error);
    }
  }

  isRoomSubscribed(roomJID: string): boolean {
    return this.subscribedRooms.has(roomJID);
  }

  getSubscribedRooms(): string[] {
    return Array.from(this.subscribedRooms);
  }
}

export const pushSubscriptionService = new PushSubscriptionService();
