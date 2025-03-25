import {FC, SetStateAction} from 'react';
import {Box, Icon, Select} from 'native-base';
import {Iso639_1Codes} from '../ChatComponent/src/types/types';
import DownArrow from '../../assets/DownArrow.svg';

const languageOptions: {name: string; id: Iso639_1Codes}[] = [
  {name: 'English', id: 'en'},
  {name: 'Spanish', id: 'es'},
  {name: 'Portuguese', id: 'pt'},
  {name: 'Haitian Creole', id: 'ht'},
  {name: 'Chinese', id: 'zh'},
];

interface SelectLanguageProps {
  loungeOtion: string;
  setLoungeOtion: (value: SetStateAction<string>) => void;
  backgroundColor?: string;
}

export const SelectLanguage: FC<SelectLanguageProps> = ({
  backgroundColor,
  loungeOtion,
  setLoungeOtion,
}) => {
  return (
    <Box
      style={{
        marginBottom: 16,
        borderRadius: 16,
        padding: 4,
        paddingRight: 20,
        backgroundColor: backgroundColor || '#F5F5F5',
        width: '100%',
        height: 56,
        justifyContent: 'center'
      }}
      variant="unstyled">
      <Select
        borderRadius={16}
        style={{
          borderRadius: 16,
        }}
        color="#53575A"
        placeholderTextColor='#AEB3B6'
        fontWeight="600"
        fontSize={16}
        borderWidth={0}
        placeholder={'Select your language'}
        selectedValue={loungeOtion}
        onValueChange={itemValue => setLoungeOtion(itemValue)}
        _selectedItem={{
          bg: '#2962FF',
          borderRadius: 12,
          _text: {
            color: '#FFFFFF',
            fontWeight: 'bold',
          },
        }}
        dropdownIcon={
          <Icon as={DownArrow} name="chevron-down" size="sm" color="#53575A" />
        }>
        {languageOptions.map(option => (
          <Select.Item key={option.id} label={option.name} value={option.id} />
        ))}
      </Select>
    </Box>
  );
};
