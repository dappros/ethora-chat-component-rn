// Optional fixture used by the commented-out `defaultUser` smoke path in
// the web testbed (web/src/App.tsx). The web testbed's primary
// configuration surface is the runtime Setup tab (see
// web/src/AppLoginChats.tsx). All values below are placeholders.

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
