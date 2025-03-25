import {action, makeAutoObservable, runInAction} from 'mobx';
import {Message, Room} from '../stores/types';

export const isDateBefore = (date1: string, date2: string): boolean => {
  return new Date(date1) < new Date(date2);
};
export const isDateAfter = (date1: string, date2: string): boolean => {
  return new Date(date1) > new Date(date2);
};

class ChatStore {
  currentRoom: Room = {
    title: '',
    localJid: '',
    lastViewedTimestamp: undefined,
    noMessages: undefined,
  };
  messages: Message[] = [];
  rooms: Room[] = [];
  vCards: Record<string, string> = {};
  user: string = '';
  chatMessagesChanged: boolean = false;
  loading: boolean = false;
  isComposing: boolean = false;
  langSouece: string = '';

  constructor() {
    makeAutoObservable(this);
  }

  setCurrentRoom(room: Room) {
    this.currentRoom = room;
  }
  addVcard(username: string, FN: string) {
    this.vCards[username] = FN;
  }

  addRooms(rooms: Room[]) {
    this.rooms.push(...rooms);
  }

  setCurrentUser(name: string) {
    this.user = name;
  }

  setChatChanged() {
    runInAction(() => (this.chatMessagesChanged = !this.chatMessagesChanged));
  }

  setInitialState() {
    runInAction(() => {
      this.currentRoom = {
        title: '',
        localJid: '',
        noMessages: true,
      };
      this.messages = [];
      this.rooms = [];
      this.vCards = {};
      this.user = '';
      this.chatMessagesChanged = false;
      this.loading = false;
      this.isComposing = false;
    });
  }

  setChangeLanguage = action((language: string) => {
    this.langSouece = language;
  });

  setIsRoomLoading = action((value: boolean) => {
    this.loading = value;
  });

  setComposing = action((value: boolean) => {
    this.isComposing = value;
  });

  setLastViewedTimestamp = action((value: number | undefined) => {
    this.currentRoom.lastViewedTimestamp = value;
  });

  setCurrentRoomNoMessages = action((value: boolean | undefined) => {
    this.currentRoom.noMessages = value;
  });

  addMessages = action((newMessages: Message[], start?: boolean) => {
    if (this.currentRoom.noMessages) {
      // edit to work properly only 1 time
      this.currentRoom.noMessages = false;
    }
    const message = newMessages[0];
    runInAction(() => {
      const roomMessages = this.messages;

      // Check if the message already exists
      const existingMessage = roomMessages.find(msg => msg.id === message.id);

      if (roomMessages.length === 0 || start) {
        roomMessages.unshift(message);
      } else if (!existingMessage) {
        const lastMessageDate = roomMessages[roomMessages.length - 1].createdAt;
        const firstMessageDate = roomMessages[0].createdAt;
        const newMessageDate = message.createdAt;

        // Add message at the end if it's newer than the last message
        if (
          isDateAfter(newMessageDate.toString(), lastMessageDate.toString())
        ) {
          roomMessages.push(message);

          // Check for lastViewedTimestamp and insert delimiter if needed
          if (
            this.currentRoom.lastViewedTimestamp &&
            !roomMessages.some(msg => msg._id === 'delimiter-new')
          ) {
            const lastViewedTimestamp = new Date(
              this.currentRoom.lastViewedTimestamp,
            );

            // If the new message is after the last viewed timestamp
            if (
              isDateAfter(
                newMessageDate.toString(),
                lastViewedTimestamp.toString(),
              )
            ) {
              const delimiterIndex = roomMessages.findIndex(msg =>
                isDateAfter(
                  msg.createdAt.toString(),
                  lastViewedTimestamp.toString(),
                ),
              );

              // Insert the delimiter before the new messages
              if (delimiterIndex !== -1) {
                roomMessages.splice(delimiterIndex, 0, {
                  _id: 'delimiter-new',
                  text: 'New Messages',
                  createdAt: new Date(),
                  system: true,
                  FN: '',
                  username: '',
                  id: '',
                  user: {
                    _id: 'system',
                  },
                });
              }
            }
          }
        } else if (
          isDateBefore(newMessageDate.toString(), firstMessageDate.toString())
        ) {
          // Add message at the beginning if it's older than the first message
          roomMessages.unshift(message);
        } else {
          // Insert the message in the correct position based on the date
          for (let i = 0; i < roomMessages.length; i++) {
            if (
              isDateBefore(
                newMessageDate.toString(),
                roomMessages[i].createdAt.toString(),
              )
            ) {
              roomMessages.splice(i, 0, message);
              break;
            }
          }
        }
      }
    });
  });
}

export {ChatStore};
