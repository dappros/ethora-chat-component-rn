import {View, Text, VStack, Center, Spinner} from "native-base";
import { AtomLogo } from "../components/svg/AtomLogo";
import { LargeTitle } from "../components/LargeTitle";
import { LinearGradientButton } from "../components/LinearGradientButton";

import PreviewPerson from '../assets/PreviewPerson.svg';
import Hipaa from '../assets/previewIcons/Hipaa.svg';
import Aicpa from '../assets/previewIcons/Aicpa.svg';
import GDPR from '../assets/previewIcons/GDPR.svg';
import { useStores } from "../stores/context";
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Loading from "../components/UI/Loading/Loading.tsx";

export const PreviewScreen = async () => {
  const {loginStore} = useStores();
  const preview = await AsyncStorage.getItem('preview');

  const handleChangePreview = () => {
    loginStore.changePreview();
  }
  if (preview) {
    return;
  }

  if(loginStore.loading) {
    return (
      <Loading/>
    )
  }

  return (
    <View style={{
      backgroundColor: '#FFFFFF',
      flex: 1,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
    }}>
        <AtomLogo width={240} height={56}/>
        <LargeTitle
          text="Connected Care. Simplified."
          style={{
            fontSize: 32,
            lineHeight: 32,
            color: '#424242',
            textAlign: 'center'
          }}
        />
      <VStack>
        <PreviewPerson/>
      </VStack>
      <LinearGradientButton
        onPress={handleChangePreview}
        style={{width: '100%'}}
        title="Let's Get Started"
      />
      <VStack style={{
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <Hipaa/>
        <Aicpa/>
        <GDPR/>
      </VStack>
    </View>    
  );
}