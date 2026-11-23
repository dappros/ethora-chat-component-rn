import { useSelector } from 'react-redux';
import type { RootState } from '../roomStore';
import { isUserBlockEnabled } from '../helpers/userBlock';

const NONE: string[] = [];

export const useBlockedUserIds = (): string[] =>
  useSelector((state: RootState) =>
    isUserBlockEnabled(state.chatSettingStore.config)
      ? state.chatSettingStore.blockedUserIds || NONE
      : NONE
  );
