import { useSelector } from 'react-redux';
import { RootState } from '../roomStore';

export const useFileToken = (): string =>
  useSelector(
    (state: RootState) => state.chatSettingStore.user?.fileToken || ''
  );
