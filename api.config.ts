// Optional fixture used by the commented-out `defaultUser` smoke path in
// App.tsx. The testbed's primary configuration surface is the runtime Setup
// tab (see AppLoginChatsRn.tsx), or — for one-shot config — `npx @ethora/setup`.
//
// All values below are placeholders. Replace them locally if you want to
// exercise the `defaultUser` smoke path; do NOT commit real credentials.

export const appToken = 'PLACEHOLDER_APP_TOKEN'; // 'JWT eyJ...' from your Ethora app

export const defaultUser = {
  _id: 'PLACEHOLDER_USER_ID',
  firstName: 'Test',
  lastName: 'User',
  xmppPassword: 'PLACEHOLDER_XMPP_PASSWORD',
  walletAddress: 'PLACEHOLDER_WALLET_ADDRESS',
  token: 'PLACEHOLDER_ACCESS_TOKEN',
  refreshToken: 'PLACEHOLDER_REFRESH_TOKEN',
  profileImage: '',
  isProfileOpen: true,
  isAssetsOpen: true,
  referrerId: '',
  isAllowedNewAppCreate: false,
  isAgreeWithTerms: false,
  company: [],
  appId: 'PLACEHOLDER_APP_ID',
  homeScreen: '',
  defaultWallet: {
    walletAddress: 'PLACEHOLDER_WALLET_ADDRESS',
  },
  email: 'test@example.com',
  username: '',
};

export const defRoom = {
  jid: 'PLACEHOLDER_ROOM_ID@conference.xmpp.example.com',
};
