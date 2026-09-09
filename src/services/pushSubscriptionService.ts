import { Client } from '@xmpp/client';
import { User } from '../types/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subscribeToPushNotifications } from '../networking/api-requests/push.api';
import { subscribeToRoomMessages } from '../networking/xmpp/subscribeToRoomMessages.xmpp';

const SUBSCRIBED_ROOMS_KEY = 'ethora_subscribed_rooms';

export class PushSubscriptionService {
  private subscribedRooms: Set<string> = new Set();
  private isPushSubscribed: boolean = false;
  private lastSubscriptionKey: string | null = null;
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

  async subscribeToPush(
    fcmToken: string,
    user: User,
    projectName: string,
  ): Promise<void> {
    const walletAddress = user.defaultWallet?.walletAddress || user.walletAddress;
    const subscriptionKey = `${fcmToken}_${walletAddress}`;

    if (this.isPushSubscribed && this.lastSubscriptionKey === subscriptionKey) {
      console.log('⚠️ Push already subscribed with this token, skipping...');
      return;
    }

    try {
      const userJid: string = user.xmppUsername || '';

      if (!userJid) {
        throw new Error('User JID is required for push subscription');
      }

      await subscribeToPushNotifications(fcmToken, userJid, projectName);
      this.isPushSubscribed = true;
      this.lastSubscriptionKey = subscriptionKey;
    } catch (error: any) {
      console.error('Failed to subscribe to push after all retries:', error);
    }
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
    this.isPushSubscribed = false;
    this.lastSubscriptionKey = null;
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

