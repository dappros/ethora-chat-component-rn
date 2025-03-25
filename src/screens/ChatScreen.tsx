import {View} from 'react-native';
import React, {FC, useEffect, useMemo, useState} from 'react';
import {observer} from 'mobx-react-lite';
import {useStores} from '../stores/context';
import {ActionModal} from '../components/UI/ActionModal/ActionModal';
import notificationsImage from '../assets/NotificationsImage.png';
import {ReduxWrapper} from '../components/ChatComponent/src/components/MainComponents/ReduxWrapper';
import {DrawerActions, useNavigation} from '@react-navigation/native';
import {Room} from '../stores/types';
import {useTranslation} from '../hooks/useTranslation';
import {AtomLogo} from '../components/svg/AtomLogo';
import { NavigationProps } from '../constants/routes';
import {runInAction, toJS} from 'mobx';
import {refresh} from "../components/ChatComponent/src/networking/apiClient.ts";
import Loading from "../components/UI/Loading/Loading.tsx";

interface ChatScreenProps {
  token?: string;
  caseIds?: any[];
}

const ChatScreen: FC<ChatScreenProps> = observer(() => {
  const DEVSERVER = 'wss://dev.xmpp.platform.atomwcapps.com:5443/ws';
  const SERVICE = 'conference.dev.xmpp.platform.atomwcapps.com';
  const HOST = 'dev.xmpp.platform.atomwcapps.com';

  const {loginStore, chatStore} = useStores();
  const navigation = useNavigation<NavigationProps>();
  const [isModalVisible, setModalVisible] = useState<boolean>(false);
  const [customRooms, setCustomRooms] = useState<Room[] | []>(toJS(loginStore.cases));
  const toggleModal = () => {
    setModalVisible(!isModalVisible);
  };
  
  const handleNotified = () => {
    // logic needs to be implemented
  };

  useEffect(() => {
    chatStore.setCurrentUser(loginStore.initialData.chatUsername);
    loginStore.setIsLoading(false);
  }, [loginStore.initialData.chatUsername]);

  const {translatesValue} = useTranslation();

  useEffect(() => {
    chatStore.setChangeLanguage(translatesValue);
  }, [translatesValue]);

  useEffect(() => {
    setCustomRooms(toJS(loginStore.cases))
  }, [loginStore.cases.length]);

  const userData = useMemo(() => {
    return {
      ...loginStore.authData.user,
      token: loginStore.authData.token,
      refreshToken: loginStore.authData.refreshToken,
    };
  }, [loginStore.authData]);

  const configMemo = useMemo(() => {
    return {
      userLogin: {
        enabled: true,
        user: userData,
      },
      colors: {primary: '#2962FF', secondary: '#D9E7FF'},
      refreshTokens: {
        refreshFunction: () => refresh(),
        enabled: true,
      },
      headerChatMenu: customRooms.length === 1 ? () => navigation.dispatch(DrawerActions.openDrawer()) : false,
      disableRooms: customRooms.length === 1,
      enableTranslates: chatStore.langSouece,
      bubleMessage: {
        backgroundMessage: '#D9E7FF',
        backgroundMessageUser: '#2962FF',
        color: '#424242',
        colorUser: '#FFFFFF',
      },
      chatListStyles: {
        background: '#FFFFFF',
        searchbackground: '#F5F5F5',
      },
      xmppSettings: {
        devServer: DEVSERVER,
        host: HOST,
        conference: SERVICE,
      },
      headerMenu: () => navigation.dispatch(DrawerActions.openDrawer()),
      backgroundChat: {color: '#fff'},
      clearStoreBeforeInit: true,
      headerLogo: <AtomLogo />,
      disableProfilesInteractions: true,
      disableRoomMenuModal: true,
      customRooms: {
        rooms: customRooms,
        singleRoom: customRooms.length === 1,
        disableGetRooms: customRooms.length === 1,
      },
    }
  }, [userData, chatStore.langSouece, customRooms.length]);

  if(loginStore.loading) {
    return (
      <Loading/>
    )
  }

  if(!loginStore.loading && (!customRooms || !customRooms.length)) {
    requestAnimationFrame(() => navigation.navigate("NoRoomScreen"));
  }

  return (
    <View style={{flex: 1}}>
      <ReduxWrapper
        config={configMemo}
      />
      <ActionModal
        image={notificationsImage}
        title="Get Notified"
        description="Don't miss out on any important information and messages - keep in touch."
        topButtonText="Turn On Notifications"
        botButtonText="Not Now"
        topButtonColor="#60269E"
        isModalVisible={isModalVisible}
        toggleModal={toggleModal}
        onClick={handleNotified}
      />
    </View>
  );
});

export default ChatScreen;
