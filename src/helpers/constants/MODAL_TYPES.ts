// Modal type-id constants only — no React imports.
//
// Previously this file also held the `MODAL_COMPONENTS` registry,
// which imported every modal component. Several of those components
// (ChatProfileModal, UserSettingsModal) reference MODAL_TYPES.* to
// dispatch sub-modals — creating a runtime require cycle that Metro
// surfaced as "Require cycle: MODAL_TYPES.ts -> ChatProfileModal.tsx
// -> MODAL_TYPES.ts" on app boot. Splitting the registry out into
// its own module (MODAL_COMPONENTS.tsx) means the modal components
// only depend on these constants, dissolving the cycle.

export const MODAL_TYPES = {
  SETTINGS: 'settings',
  PROFILE: 'profile',
  CHAT_PROFILE: 'chatprofile',
  MANAGE_DATA: 'managedata',
  VISIBILITY: 'visibility',

  PROFILE_SHARES: 'profile_shares',
  DOCUMENT_SHARES: 'document_shares',
  BLOCKED_USERS: 'blocked_users',

  REFERRALS: 'referrals',

  FILE_PREVIEW: 'file_preview',

  NEW_CHAT: 'new_chat',
};
