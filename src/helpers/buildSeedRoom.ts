import { IRoom } from '../types/types';

export const buildSeedRoom = (jid: string): IRoom => ({
  id: jid.split('@')[0],
  jid,
  name: '',
  title: '',
  usersCnt: 0,
  messages: [],
  isLoading: false,
  roomBg: null,
});
