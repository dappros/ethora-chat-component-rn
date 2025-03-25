import {IMessage} from 'react-native-gifted-chat';

export interface Message extends IMessage {
  text: string;
  FN: string;
  username: string;
  id: string;
}

export interface Room {
  localJid: string;
  jid: string;
  title: string;
  lastViewedTimestamp?: number;
  noMessages?: boolean;
}

export interface InitialDataProps {
  __v: number | string;
  _id: string;
  createdAt: string;
  email: string;
  chatUsername: string;
  chatPassword: string;
  caseIds: string[];
  updatedAt: string;
  userFirstName: string;
  userLastName: string;
  fullName: string;
}

export interface ChatProps {
  token: string;
  caseIds: string[];
}

export interface LoginState {
  isFetching: boolean;
  loading: boolean;
  error: boolean;
  errorMessage: string;
  initialData: InitialDataProps;
  userToken: string;
  refreshToken: string;
  xmppUsername: string;
}
