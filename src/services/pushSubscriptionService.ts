import { Client } from '@xmpp/client';
import { User } from '../types/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subscribeToPushNotifications } from '../networking/api-requests/push.api';
import { subscribeToRoomMessages } from '../networking/xmpp/subscribeToRoomMessages.xmpp';

const SUBSCRIBED_ROOMS_KEY = 'ethora_subscribed_rooms';
// Legacy storage key from before the rename. Read on first load and
// migrated into SUBSCRIBED_ROOMS_KEY so installed apps don't lose
// their subscriptions. Safe to remove on the next major version.
const LEGACY_SUBSCRIBED_ROOMS_KEY = 'preshent_subscribed_rooms';

export class PushSubscriptionService {
  private subscribedRooms: Set<string> = new Set();
  private isPushSubscribed: boolean = false;
  private lastSubscriptionKey: string | null = null;
  private isInitialized: boolean = false;

  private async loadSubscribedRoomsFromStorage(): Promise<void> {
    if (this.isInitialized) {return;}

    try {
      let storedRooms = await AsyncStorage.getItem(SUBSCRIBED_ROOMS_KEY);
      if (!storedRooms) {
        // One-time migration from the legacy key.
        try {
          const legacy = await AsyncStorage.getItem(LEGACY_SUBSCRIBED_ROOMS_KEY);
          if (legacy) {
            await AsyncStorage.setItem(SUBSCRIBED_ROOMS_KEY, legacy);
            await AsyncStorage.removeItem(LEGACY_SUBSCRIBED_ROOMS_KEY);
            storedRooms = legacy;
          }
        } catch (migrationError) {
          console.error(
            '[PushService] Legacy storage-key migration failed (subscriptions on this device may be lost):',
            migrationError
          );
        }
      }
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
      console.log('Successfully Subscribed to room', roomJID);
      return result;
    } catch (error) {
      console.error(`[PushService] Failed to subscribe to room ${roomJID}:`, error);
      return false;
    }
  }

  async subscribeToRooms(
    client: Client,
    roomJIDs: string[],
    userNick?: string
  ): Promise<void> {
    let successful = 0;
    let failed = 0;

    console.log('test roomJIDs', roomJIDs);

    for (const roomJID of roomJIDs) {
      try {
        const result = await this.subscribeToRoom(client, roomJID, userNick);
        console.log('test roomJID-1', result);
        if (result) {
          successful++;
        } else {
          failed++;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        failed++;
        console.error(`Failed to subscribe to room ${roomJID}:`, error);
      }
    }

    console.log(`Subscribed to ${successful} rooms, ${failed} failed`);
  }

  async reset(): Promise<void> {
    this.subscribedRooms.clear();
    this.isPushSubscribed = false;
    this.lastSubscriptionKey = null;
    this.isInitialized = false;

    try {
      await AsyncStorage.removeItem(SUBSCRIBED_ROOMS_KEY);
      // Defensive: also clear the legacy key if it somehow survived
      // the migration (e.g. migration failed on first load).
      await AsyncStorage.removeItem(LEGACY_SUBSCRIBED_ROOMS_KEY);
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

