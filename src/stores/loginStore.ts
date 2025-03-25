import AsyncStorage from '@react-native-async-storage/async-storage';
import {makeAutoObservable, runInAction, action} from 'mobx';
import {DOMAIN_NAME, httpGetConfig} from '../config/apiService';
import {asyncStorageSetItem} from '../helpers/cache/asyncStorageSetItem';

import {rootStore, RootStore} from './context';
import {asyncStorageGetItem} from '../helpers/cache/asyncStorageGetItem';
import {InitialDataProps} from './types';
import {wsClient} from '../api/wsClient';
import {getRoomList} from '../api/apiClient';
import {loginEmail } from '../components/ChatComponent/src/networking/api-requests/auth.api';
import {BackHandler, Platform} from "react-native";

export class LoginStore {
  authData: any;
  prewview: boolean = true;
  config: any = null;
  isFetching: boolean = false;
  loading: boolean = false;
  error: boolean = false;
  errorMessage: string = '';
  loungeOtion: string = '';
  initialData: InitialDataProps = {
    __v: 0,
    _id: '',
    createdAt: '',
    email: '',
    chatUsername: '',
    chatPassword: '',
    updatedAt: '',
    caseIds: [],
    userFirstName: '',
    userLastName: '',
    fullName: '',
  };
  userToken: string = '';
  refreshToken: string = '';
  xmppUsername: string = '';
  cases: any = [];
  stores: RootStore;

  constructor(stores: RootStore) {
    makeAutoObservable(this);
    this.stores = stores;
  }

  setInitialState = () => {
    runInAction(() => {
      this.isFetching = false;
      this.loading = false;
      this.error = false;
      this.errorMessage = '';
      (this.loungeOtion = ''),
        (this.initialData = {
          __v: 0,
          _id: '',
          createdAt: '',
          email: '',
          chatPassword: '',
          chatUsername: '',
          caseIds: [],
          updatedAt: '',
          userFirstName: '',
          userLastName: '',
          fullName: '',
        });
      this.userToken = '';
      this.refreshToken = '';
      this.xmppUsername = '';
      this.authData = null;
      this.prewview = true;
      this.config = null;
    });
  };

  async logOut() {
    runInAction(() => {
      this.isFetching = true;
    });
    try {
      await AsyncStorage.clear(() => console.log('cleared async storage'));
      await asyncStorageSetItem('pushNotificationsRequested', true);
    } catch (error: any) {
      runInAction(() => {
        this.isFetching = false;
        this.error = true;
        this.errorMessage = error;
      });
      runInAction(() => rootStore.chatStore.setLastViewedTimestamp(undefined));
      wsClient.actionSetTimestampToPrivateStore(
        rootStore.chatStore.currentRoom.localJid,
        new Date().getTime(),
      );
    } finally {
      rootStore.resetStore();
    }
    runInAction(() => {
      this.prewview = false;
    });

    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else if (Platform.OS === 'ios') {
      throw new Error('App forced to close');
    }
  }

  changePreview = async () => {
    await asyncStorageSetItem('preview', true);
    runInAction(() => {
      this.prewview = false;
    });
  }

  casesHandler = async (token: string) => {
    runInAction(() => {
      this.loading = true;
    });

    try {
      const result = await getRoomList(token);

      const fetchedRooms = result.data.results.filter((elF: any) => !elF.deleted).map(
        (el: {roomJid: string; claimNumber: string}) => ({
          jid: `${el.roomJid}`,
          title: `Chat with CW - ${el.claimNumber}`,
        }),
      ) || [];

      runInAction(() => {
        this.cases = fetchedRooms;
      });
    } catch (error) {
      this.error = true;
      console.error(error);
    } finally {
      runInAction(() => {
        this.loading = false;
      });
    }
  }

  loginHandler = async (data: any) => {
    runInAction(() => {
      this.loading = true;
    });

    // const dataForStorage = {
    //   ...data,
    //   caseIds: claimNumber,
    //   userFirstName: data.fullName.split(' ')?.[0] || '',
    //   userLastName: data.fullName.split(' ')?.[1] || '',
    //   dateOfInjury,
    // };

    //iw5555@mailinator.com
  // 12345678


    await asyncStorageSetItem('loginData', data);
    await asyncStorageSetItem('userToken', data.token);

    runInAction(() => {
      this.authData = data;
      this.userToken = data.token;
      this.isFetching = false;
      this.loading = false;
    });
  };

  login = async ({
    lastName,
    claimNumber,
  }: {
    lastName: string;
    claimNumber: string;
  }) => {
    const authData = await loginEmail(lastName, claimNumber);
    await this.loginHandler(authData.data);
    await this.casesHandler(authData.data.token);
  };

  getConfig = async () => {
    const result = await httpGetConfig(DOMAIN_NAME);

    if(result.status !== 200) {
      return console.log('config status', result.status);
    }

    runInAction(() => {
      this.config = result.data;
    });
  }

  setTokenFromAsyncStorage = async () => {
    runInAction(() => {
      this.loading = true;
    });

    const userToken = await asyncStorageGetItem('userToken');
    // const refreshToken = await asyncStorageGetItem('refreshToken');

    runInAction(() => {
      this.userToken = userToken;
      // this.refreshToken = refreshToken;
      this.loading = false;
    });
  };

  setInitialDetailsFromAsyncStorage = async () => {
    this.isFetching = true;
    const dateString = await asyncStorageGetItem("validTokenDate");
    const date =  new Date(dateString);
    const currentDate = new Date();
    const twoHoursInMs = 2 * 60 * 60 * 1000;

    if (currentDate.getTime() < date.getTime() + twoHoursInMs)  {
      console.log("dateValid 2 hours", currentDate.getTime() < date.getTime() + twoHoursInMs);
      return await AsyncStorage.getItem('loginData').then(
        action( async (data: any) => {
          if (data) {
            const result = JSON.parse(data);
            this.prewview = false;
            this.authData = result;
            const parsedData = result;
            await this.casesHandler(result.token);
            await this.setTokenFromAsyncStorage();
            this.initialData = {
              ...parsedData,
              userFirstName: parsedData.fullName.split(' ')?.[0] || '',
              userLastName: parsedData.fullName.split(' ')?.[1] || '',
            };
          }
          this.isFetching = false;
        }),
      );
    } else {
      await this.logOut();
    }
  };

  

  setIsLoading = async (value: boolean) => {
    runInAction(() => {
      this.loading = value;
    });
  };
}
