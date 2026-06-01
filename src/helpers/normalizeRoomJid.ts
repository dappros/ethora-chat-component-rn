export const normalizeRoomJid = (roomJID: string, conference?: string) => {
  if (!roomJID) {return roomJID;}
  if (roomJID.includes('@')) {return roomJID;}
  if (!conference) {return roomJID;}
  return `${roomJID}@${conference}`;
};
