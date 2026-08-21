import { createSlice, PayloadAction, type Slice } from '@reduxjs/toolkit';
import type { WritableDraft } from 'immer';
import {
  DeleteModal,
  EditAction,
  IConfig,
  IUser,
  ModalFile,
  ModalType,
  User,
} from '../types/types';
import { Iso639_1Codes } from '../types/models/language.model';
import type { TranslateMode } from '../utils/translateModePolicy';
import { localStorageConstants } from '../helpers/constants/LOCAL_STORAGE';
import { asyncLocalStorage } from '../hooks/useLocalStorage';

export interface ChatState {
  user: User;
  config?: IConfig;
  activeModal?: ModalType;
  deleteModal?: DeleteModal;
  selectedUser?: IUser;
  activeFile?: ModalFile;
  client?: any;
  langSource?: Iso639_1Codes;
  /**
   * The reader's own auto/manual pick from the language modal's switcher.
   * Undefined until they touch it, at which point it wins over the host's
   * `config.translates.mode` default (unless the host pinned `forceType`).
   * See utils/translateModePolicy.
   */
  translateMode?: TranslateMode;
}

export const unpackAndTransform = (input?: User): User => {
  return {
    description: '',
    token: input?.token || '',
    profileImage: input?.profileImage || '',
    _id: input?._id || '',
    walletAddress: input?.defaultWallet?.walletAddress || '',
    xmppPassword: input?.xmppPassword || '',
    fileToken: input?.fileToken || '',
    refreshToken: input?.refreshToken || '',
    firstName: input?.firstName || '',
    lastName: input?.lastName || '',
    defaultWallet: {
      walletAddress: input?.defaultWallet?.walletAddress || '',
    },
    email: input?.email || '',
    username: input?.username || '',
    appId: input?.appId || '',
    homeScreen: input?.homeScreen || '',
    registrationChannelType: input?.registrationChannelType || '',
    updatedAt: input?.updatedAt || '',
    authMethod: input?.authMethod || '',
    resetPasswordExpires: input?.resetPasswordExpires || '',
    resetPasswordToken: input?.resetPasswordToken || '',
    xmppUsername: input?.xmppUsername || '',
    roles: input?.roles || [],
    tags: input?.tags || [],
    __v: input?.__v || 0,
    isProfileOpen: input?.isProfileOpen || false,
    isAssetsOpen: input?.isAssetsOpen || false,
    isAgreeWithTerms: input?.isAgreeWithTerms || false,
  };
};

const initialState: ChatState = {
  user: {
    description: '',
    token: '',
    profileImage: '',
    _id: '',
    walletAddress: '',
    xmppPassword: '',
    fileToken: '',
    refreshToken: '',
    firstName: '',
    lastName: '',
    defaultWallet: {
      walletAddress: '',
    },
    email: '',
    username: '',
    appId: '',
    homeScreen: '',
    registrationChannelType: '',
    updatedAt: '',
    authMethod: '',
    resetPasswordExpires: '',
    resetPasswordToken: '',
    xmppUsername: '',
    roles: [],
    tags: [],
    __v: 0,
    isProfileOpen: true,
    isAssetsOpen: true,
    isAgreeWithTerms: false,
  },
  deleteModal: {
    isDeleteModal: false,
    roomJid: '',
    messageId: '',
  },
  config: { colors: { primary: '#0052CD', secondary: '#F3F6FC' } },
};

// Reducers extracted as a named const so the slice can be annotated
// with Slice<State, typeof reducers, Name>. Without this, tsc inlines
// immer's internal WritableNonArrayDraft type in the emitted .d.ts and
// declaration emission fails with TS4023.
const reducers = {
  setUser: (state: WritableDraft<ChatState>, action: PayloadAction<User>) => {
    state.user = unpackAndTransform(action.payload);
    asyncLocalStorage(localStorageConstants.ETHORA_USER).set(
      unpackAndTransform(action.payload)
    );
  },
  updateUser(state: WritableDraft<ChatState>, action: PayloadAction<{ updates: Partial<User> }>) {
    const { updates } = action.payload;
    const user = state.user;
    if (user) {
      state.user = {
        ...user,
        ...updates,
      };
    }
  },
  setConfig: (state: WritableDraft<ChatState>, action: PayloadAction<IConfig | undefined>) => {
    // Cast away immer's WritableDraft — IConfig contains callable
    // fields (eventHandlers, customComponent) that confuse the draft
    // type inference but are inert at write-time.
    state.config = action.payload as any;
  },
  setActiveModal: (state: WritableDraft<ChatState>, action: PayloadAction<ModalType | undefined>) => {
    state.activeModal = action.payload;
  },
  setActiveFile: (state: WritableDraft<ChatState>, action: PayloadAction<ModalFile>) => {
    state.activeFile = action.payload;
  },
  setDeleteModal: (state: WritableDraft<ChatState>, action: PayloadAction<DeleteModal | undefined>) => {
    state.deleteModal = action.payload;
  },
  setStoreClient: (state: WritableDraft<ChatState>, action: PayloadAction<any>) => {
    state.client = action.payload;
  },
  setSelectedUser: (state: WritableDraft<ChatState>, action: PayloadAction<IUser | undefined>) => {
    state.selectedUser = action.payload;
  },
  /**
   * Token rotation. Dispatched from ONE place only — `authRefresh` —
   * which awaits the AsyncStorage write immediately afterwards, before
   * resolving its promise.
   *
   * The reducer used to fire its own best-effort write here. That was
   * both redundant and racy (two writers, no ordering), and a
   * fire-and-forget write can be lost if the app dies right after a
   * rotation — which on a backend with reuse detection means the next
   * launch presents a burned token. Persistence now belongs to the
   * caller, which can actually await it.
   */
  refreshTokens: (
    state: WritableDraft<ChatState>,
    action: PayloadAction<{
      token: string;
      refreshToken: string;
      xmppPassword?: string;
      fileToken?: string;
    }>
  ) => {
    state.user.refreshToken = action.payload.refreshToken;
    state.user.token = action.payload.token;

    if (action.payload.xmppPassword) {
      state.user.xmppPassword = action.payload.xmppPassword;
    }

    if (action.payload.fileToken) {
      state.user.fileToken = action.payload.fileToken;
    }
  },
  logout: (state: WritableDraft<ChatState>) => {
    state.user = unpackAndTransform();
    state.config = undefined;
    state.client = undefined;
    state.langSource = undefined;
    state.translateMode = undefined;
    asyncLocalStorage(localStorageConstants.ETHORA_USER).remove();
  },
  setLangSource: (
    state: WritableDraft<ChatState>,
    action: PayloadAction<Iso639_1Codes | undefined>
  ) => {
    state.langSource = action.payload;
  },
  setTranslateMode: (
    state: WritableDraft<ChatState>,
    action: PayloadAction<TranslateMode | undefined>
  ) => {
    state.translateMode = action.payload;
  },
};

export const chatSlice: Slice<ChatState, typeof reducers, 'chat'> = createSlice({
  name: 'chat',
  initialState,
  reducers,
});

export const {
  setUser,
  setConfig,
  refreshTokens,
  logout,
  setActiveModal,
  setDeleteModal,
  setSelectedUser,
  updateUser,
  setActiveFile,
  setStoreClient,
  setLangSource,
  setTranslateMode,
} = chatSlice.actions;

export default chatSlice.reducer;
