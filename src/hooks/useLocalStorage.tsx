import AsyncStorage from '@react-native-async-storage/async-storage';

// Plain key-scoped AsyncStorage helper (NOT a React hook). Callable from
// reducers, helpers, and React code alike. The `use*` name (now
// `asyncLocalStorage`) was renamed to stop ESLint's `react-hooks/rules-of-hooks`
// firing in every non-React call site. `useLocalStorage` is kept below
// as a back-compat alias.
export function asyncLocalStorage<T>(key: string) {
  const get = async (): Promise<T | null> => {
    try {
      const storedValue = await AsyncStorage.getItem(key);
      if (!storedValue) {return null;}
      return JSON.parse(storedValue) as T;
    } catch (error) {
      console.error('Failed to read from AsyncStorage', error);
      return null;
    }
  };

  const set = async (value: T) => {
    try {
      const stringValue = JSON.stringify(value);
      await AsyncStorage.setItem(key, stringValue);
    } catch (error) {
      console.error('Failed to write to AsyncStorage', error);
    }
  };

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

// Back-compat alias for old call sites. New code: use asyncLocalStorage.
export const useLocalStorage = asyncLocalStorage;
