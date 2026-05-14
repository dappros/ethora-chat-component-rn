import { Iso639_1Codes } from "../../types/types";

type LanguageOption = {
  name: string;
  id: Iso639_1Codes;
};

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { name: 'English', id: 'en' },
  { name: 'Spanish', id: 'es' },
  { name: 'Portuguese', id: 'pt' },
  { name: 'Haitian Creole', id: 'ht' },
  { name: 'Chinese', id: 'zh' },
];
