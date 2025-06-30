import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function useLocalStorage<T>(key: string) {
  const get = useCallback(async (): Promise<T | null> => {
    try {
      const storedValue = await AsyncStorage.getItem(key);
      if (!storedValue) return null;
      return JSON.parse(storedValue) as T;
    } catch (error) {
      console.error('Failed to read from AsyncStorage', error);
      return null;
    }
  }, [key]);

  const set = useCallback(async (value: T) => {
    try {
      const stringValue = JSON.stringify(value);
      await AsyncStorage.setItem(key, stringValue);
    } catch (error) {
      console.error('Failed to write to AsyncStorage', error);
    }
  }, [key]);

  const update = async (updates: Partial<T>) => {
    try {
      const currentValue = await get();
      const newValue = currentValue
        ? { ...currentValue, ...updates }
        : (updates as T);
      await set(newValue);
    } catch (error) {
      console.error('Failed to update AsyncStorage value', error);
    }
  };

  const remove = async () => {
    try {
      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to remove AsyncStorage value', error);
    }
  };

  return { get, set, update, remove };
}
