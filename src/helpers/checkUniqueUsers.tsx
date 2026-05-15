import { IMessage, RoomMember } from '../types/types';
import { store } from '../roomStore';
import { fixUnnamedArrayFromApi, getUnnamedUsers } from './getUnnamedUsers';
import { getUserByXmppUsername } from '../networking/api-requests/roomMembers.api';

export const checkUniqueUsers = (messages: IMessage[]) => {
  const unnamedUsers = getUnnamedUsers(messages);

  if (unnamedUsers.length > 0) {
    const getApiUsers = async () => {
      const fixedUsers = await fixUnnamedArrayFromApi(unnamedUsers);
      return fixedUsers;
    };
    const newUsers = getApiUsers();
    return newUsers;
  }
};

export const checkSingleUser = async (
  usersSet: Record<string, RoomMember>,
  xmppUsername: string
) => {
  if (usersSet[xmppUsername]) {return;}

  const fixedUser = await getUserByXmppUsername(
    xmppUsername,
    store.getState().chatSettingStore.user.token
  );

  return fixedUser;
};
