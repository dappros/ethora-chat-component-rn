export const accountNameOf = (
  user:
    | { xmppUsername?: string; userJID?: string; id?: string; _id?: string }
    | null
    | undefined,
  appId: string
): string => {
  for (const raw of [user?.xmppUsername, user?.userJID, user?.id, user?._id]) {
    const value = String(raw || '').split('@')[0]!.trim();
    if (!value) {continue;}
    if (value.includes('_')) {return value;}
    if (appId) {return `${appId}_${value}`;}
  }
  return '';
};
