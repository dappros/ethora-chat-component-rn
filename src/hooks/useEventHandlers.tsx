import { useCallback } from 'react';
import { IConfig } from '../types/types';

interface MessageSentEvent {
  message: string;
  roomJID: string;
  user: any;
  messageType: 'text' | 'media';
  metadata?: any;
}

interface MessageFailedEvent {
  message: string;
  roomJID: string;
  error: Error;
  messageType: 'text' | 'media';
}

interface MessageEditedEvent {
  messageId: string;
  newMessage: string;
  roomJID: string;
  user: any;
}

interface MessageRetryEvent {
  messageId: string;
  roomJID: string;
  messageType: 'text' | 'media';
}

export interface EventHandlersHook {
  handleMessageSent: (event: MessageSentEvent) => Promise<void>;
  handleMessageFailed: (event: MessageFailedEvent) => void;
  handleMessageEdited: (event: MessageEditedEvent) => void;
  handleMessageRetry: (event: MessageRetryEvent) => void;
}

export const useEventHandlers = (config?: IConfig): EventHandlersHook => {
  const handleMessageSent = useCallback(
    async (event: MessageSentEvent) => {
      try {
        if (config?.eventHandlers?.onMessageSent) {
          await config.eventHandlers.onMessageSent(event);
        }
      } catch (error) {
        console.error('Error in message sent handler:', error);
        throw error;
      }
    },
    [config]
  );

  const handleMessageFailed = useCallback(
    (event: MessageFailedEvent) => {
      try {
        if (config?.eventHandlers?.onMessageFailed) {
          config.eventHandlers.onMessageFailed(event);
        }
        console.error('Message failed details:', {
          message: event.message,
          roomJID: event.roomJID,
          messageType: event.messageType,
          error: event.error?.message,
          timestamp: new Date().toISOString(),
        });
      } catch (handlerError) {
        console.error('Error in message failed handler:', handlerError);
      }
    },
    [config]
  );

  const handleMessageEdited = useCallback(
    (event: MessageEditedEvent) => {
      try {
        if (config?.eventHandlers?.onMessageEdited) {
          config.eventHandlers.onMessageEdited(event);
        }
      } catch (error) {
        console.error('Error in message edited handler:', error);
      }
    },
    [config]
  );

  const handleMessageRetry = useCallback(
    (event: MessageRetryEvent) => {
      try {
        config?.eventHandlers?.onMessageRetry?.(event);
      } catch (error) {
        console.error('Error in message retry handler:', error);
      }
    },
    [config]
  );

  return {
    handleMessageSent,
    handleMessageFailed,
    handleMessageEdited,
    handleMessageRetry,
  };
};
