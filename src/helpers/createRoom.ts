import {IRoom} from '../types/types';

interface RoomInput {
  jid: string;
  title: string;
}

export function createIRoomRoom(input: RoomInput): IRoom {
  return {
    jid: input.jid || '',
    name: input.title || '',
    title: input.title || '',
    usersCnt: 2,
    messages: [],
    isLoading: false,
    roomBg: '',
    icon: '',
    unreadMessages: 0,
    lastViewedTimestamp: 0,
  };
}
