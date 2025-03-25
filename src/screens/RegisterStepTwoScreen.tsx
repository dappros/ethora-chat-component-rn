import { NavigationProps, RootStackParamList, ROUTES } from "../constants/routes";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useState } from "react";
import { CustomInput } from "../components/CustomInput";
import { LinearGradientButton } from "../components/LinearGradientButton";
import { LayoutRegister } from "../components/UI/LayoutRegister/LayoutRegister";
import { basePerspectoURL } from "../components/ChatComponent/src/networking/apiClient";
import axios from "axios";
import { showError, showSuccess } from "../components/Toast/toast";
import {Keyboard, KeyboardAvoidingView, Platform, TouchableWithoutFeedback} from "react-native";

type ChatScreenRouteProp = RouteProp<RootStackParamList, "RegisterStepTwoScreen">;

const RegisterStepTwoScreen = () => {
    const navigation = useNavigation<NavigationProps>();
    const route = useRoute<ChatScreenRouteProp>();
    const { id } = route.params;
    const [password, setPassword] = useState('');
    const [repPassword, setRepPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleRegister = async () => {
      setIsLoading(true);
      try {
        await axios.post(`${basePerspectoURL}/set-password`, {
          id: id,
          password: password,
        });

        showSuccess('Success', 'you have been successfully registered');
        navigation.navigate(ROUTES.LOGIN);
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
              isPassword
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              // isError={!!errors.lastName}
              // helperText={errors.lastName}
            />

            <CustomInput
              isPassword
              value={repPassword}
              onChangeText={setRepPassword}
              placeholder="Confirm Password"
              // isError={!!errors.lastName}
              // helperText={errors.lastName}
            />

            <LinearGradientButton
              loading={isLoading}
              onPress={handleRegister}
              style={{width: '100%'}}
              title="Sign Up"
              disabled={
                password !== repPassword || !password || !repPassword
              }
            />
          </LayoutRegister>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    );
};

export default RegisterStepTwoScreen;