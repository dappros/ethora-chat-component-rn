/** @format */

import React from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { defaultUser } from "./api.config";
import { ReduxWrapper } from "./src/components/MainComponents/ReduxWrapper";

function App(): React.JSX.Element {
  return (
    <SafeAreaView>
      <ReduxWrapper
        config={{
          userLogin: { enabled: true, user: null },
          disableHeader: false,
        }}
      />
    </SafeAreaView>
  );
}

export default App;
