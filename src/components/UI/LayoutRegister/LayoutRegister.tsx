import { Text, View } from "react-native";
import { AtomLogo } from "../../svg/AtomLogo";
import { ReactNode } from "react";
import { TouchableOpacity } from "react-native";
import BackArrow from '../../../assets/ArrowBack.svg';
import { useNavigation } from "@react-navigation/native";

import Logo from "../../../assets/logo/Logo.svg";

interface LayoutRegisterProps {
    children: ReactNode;
}

export const LayoutRegister = ({children}: LayoutRegisterProps) => {
  const navigation = useNavigation();
  
  const handleBack = () => {
    navigation.goBack();
  }
  return (
    <View style={{
      position: 'relative',
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 16,
      backgroundColor: '#fff',
      gap: 16
    }}>
      <View>
        <AtomLogo width={240} height={56}/>
      </View>
      <Text>Sgin up to your account</Text>
      {children}
      <View style={{position: 'absolute', top: 16, left: 16}}>
        <TouchableOpacity
          onPress={handleBack}
          style={{
            width: 60,
            height: 60
          }}
        >
          <BackArrow width={45}/>
        </TouchableOpacity>
      </View>
    </View>
  )
}