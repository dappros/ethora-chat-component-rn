import {Keyboard, KeyboardAvoidingView, Platform, TouchableOpacity, TouchableWithoutFeedback} from "react-native";
import { NavigationProps, ROUTES } from "../constants/routes";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import { CustomInput } from "../components/CustomInput";
import { LinearGradientButton } from "../components/LinearGradientButton";
import DatePicker from 'react-native-date-picker';
import moment from 'moment';
import Calendar from '../assets/Calendar.svg';
import { debounce } from "lodash";
import { LayoutRegister } from "../components/UI/LayoutRegister/LayoutRegister";
import axios from "axios";
import { basePerspectoURL } from "../components/ChatComponent/src/networking/apiClient";
import { showError } from "../components/Toast/toast";

const invalidCharactersRegex = /[^a-zA-Z0-9\s\-#&\.]/;

const RegistrationStepOneScreen = () => {
  const navigation = useNavigation<NavigationProps>();
  const [lastName, setLastName] = useState('');
  const [claimNumbers, setClaimNumbers] = useState('');
  const [openDatePicker, setOpenDatePicker] = useState(false);
  const [injuryDate, setInjuryDate] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({
    lastName: '',
    claimNumbers: '',
    injuryDate: false,
  });

  const ifNoErrors = useMemo(
    () => Object.values(errors).every(error => !error),
    [errors],
  );

  const validateValue = useCallback(
    debounce((value: string, name: 'lastName' | 'claimNumbers') => {
      if (value.length <= 2) {
        setErrors(error => ({
          ...error,
          [name]: 'Must be longer than 2 characters.',
        }));
        return;
      }

      if (invalidCharactersRegex.test(value)) {
        setErrors(error => ({
          ...error,
          [name]: 'Contains invalid characters.',
        }));
        return;
      }

      setErrors(error => ({...error, [name]: ''}));
    }, 1000),
    [],
  );

  const handleLastNameInput = (data: any) => {
    validateValue(data, 'lastName');
    setLastName(data);
  };


  const handleClaimNumbersInput = (data: any) => {
    validateValue(data, 'claimNumbers');
    setClaimNumbers(data);
  };
  const handleNext = async () => {
    if (lastName.length < 2 || claimNumbers.length < 2) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await axios.post(`${basePerspectoURL}/signup`, {
        claimNumber: claimNumbers.trim(),
        lastName: lastName?.toLowerCase().trim(),
        doi: moment(date, 'YYYY-MM-DD').format('DDMMYYYY').trim(),
      });
      
      const id = response.data.id;
      navigation.navigate(ROUTES.REGISTERTWO, { id });

    } catch(error) {
      showError('Error', 'there was an unintentional error.')
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{flex: 1}}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 42 : 0}>
      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
        <LayoutRegister>
          <CustomInput
            value={lastName}
            onChangeText={handleLastNameInput}
            placeholder="Last Name"
            isError={!!errors.lastName}
            helperText={errors.lastName}
          />

          <CustomInput
            value={claimNumbers}
            onChangeText={handleClaimNumbersInput}
            placeholder="Customer Number"
            isError={!!errors.lastName}
            helperText={errors.lastName}
          />

          <CustomInput
            value={injuryDate}
            onChangeText={setInjuryDate}
            placeholder="Injury Date"
            inputRightElement={
              <TouchableOpacity
                onPress={() => setOpenDatePicker(true)}
                style={{marginRight: 18, zIndex: 999}}>
                  <Calendar />
              </TouchableOpacity>
            }
            handlePressIn={() => setOpenDatePicker(true)}
          />

          <DatePicker
            modal
            open={openDatePicker}
            date={date || new Date(1999, 6, 7)}
            mode="date"
            onConfirm={date => {
              setDate(date);
              setInjuryDate(moment(date).format('YYYY/MM/DD'));
              setOpenDatePicker(false);
            }}
            onCancel={() => {
              setOpenDatePicker(false);
            }}
          />

          <LinearGradientButton
            loading={isLoading}
            onPress={handleNext}
            style={{width: '100%'}}
            title="Sign Up"
            disabled={
              !claimNumbers || !lastName || !date || !ifNoErrors
            }
          />
        </LayoutRegister>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

export default RegistrationStepOneScreen;