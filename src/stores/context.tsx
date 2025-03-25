import React, {createContext, useContext} from 'react';
import {ChatStore} from './chatStore';
import {LoginStore} from './loginStore';
import {makeAutoObservable} from 'mobx';

export class RootStore {
  loginStore: LoginStore;
  chatStore: ChatStore;

  constructor() {
    makeAutoObservable(this);
    this.loginStore = new LoginStore(this);
    this.chatStore = new ChatStore();
  }

  resetStore() {
    this.loginStore.setInitialState();
    this.chatStore.setInitialState();
  }
}

export const rootStore = new RootStore();

const StoreContext = createContext<RootStore>(rootStore);

export const StoreProvider = ({children}: any) => {
  return (
    <StoreContext.Provider value={rootStore}>{children}</StoreContext.Provider>
  );
};

export const useStores = () => useContext(StoreContext);
