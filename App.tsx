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
          backgroundChat: {
            color: "#fff",
            // image: BG,
            image: require("./src/assets/BG.png"),
          },
          colors: { primary: "#60269E", secondary: "#F2E6F6" },
          messageColor: {
            backgroundMessage: "#F2E6F6",
            backgroundMessageUser: "#A34EC1",
            colorUser: "#FFFFFF",
            color: "#53575A",
          },
          headerLogo: require("./src/assets/ForzaCare.png"),
        }}
      />
    </SafeAreaView>
  );
}

export default App;
