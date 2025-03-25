import React from 'react';
import {View} from "react-native";
import {Center, Spinner} from "native-base";

const Loading = () => {
  return (
    <View style={{flex: 1}}>
      <Center>
        <Spinner />
      </Center>
    </View>
  );
};

export default Loading;