import { useEffect, useState } from "react";
import { useLocalStorage } from "./useLocalStorage";

interface UseTranslationProps {
    loungeOtion?: string;
}

export const useTranslation = ({loungeOtion}: UseTranslationProps = {}) => {
    const [translatesValue, setTranslatesValue] = useState('');

    useEffect(() => {
        const getTranslationName = async () => {
        const translaiteName: string = (await useLocalStorage(
            'translates',
        ).get()) as string;

        setTranslatesValue(translaiteName);
        };

        getTranslationName();
    }, []);

    const set = loungeOtion
    ? useLocalStorage('translates').set(loungeOtion)
    : undefined;

  return {
    translatesValue,
    set
  };
}