import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types/types';
import { localStorageConstants } from './constants/LOCAL_STORAGE';

export const getLocalStorageUser = async (): Promise<User | null> => {
  try {
    const storedUser = await AsyncStorage.getItem(localStorageConstants.ETHORA_USER);
    if (!storedUser) return null;
    return JSON.parse(storedUser) as User;
  } catch (error) {
    console.error('Failed to retrieve or parse user from AsyncStorage', error);
    return null;
  }
};