/** @format */

import React from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { defaultUser } from "./api.config";
import { ReduxWrapper } from "./src/components/MainComponents/ReduxWrapper";
import { BG } from "./src/assets/BG";
import { ForzaCare } from "./src/assets/ForzaCare";

function App(): React.JSX.Element {
  return (
    <SafeAreaView>
      <ReduxWrapper
        config={{
          userLogin: { enabled: true, user: null },
          disableHeader: false,
          // defaultLogin: true,
          // refreshTokens: { enabled: true },
          backgroundChat: {
            color: "#fff",
            // image: BG,
          },
          colors: { primary: "#60269E", secondary: "#F2E6F6" },
          messageColor: {
            backgroundMessage: "#F2E6F6",
            backgroundMessageUser: "#A34EC1",
            colorUser: "#FFFFFF",
            color: "#53575A",
          },
          setRoomJidInPath: true,
          enableTranslates: true,
          // headerLogo: ForzaCare,
          // headerMenu: () => navigation.dispatch(DrawerActions.openDrawer()),
        }}
      />
    </SafeAreaView>
  );
}

export default App;
