/** @format */

import "./gesture-handler";
import "react-native-gesture-handler";
import * as React from "react";
import RootStack from "./nav/RootStack";
import { StoreProvider } from "./stores/context";
import { StyleSheet } from "react-native";
import CustomSplashScreen from "./screens/CustomSplashScreen";
import { XmppProvider } from "./components/ChatComponent/src/context/xmppProvider.tsx";

const App = () => {
  const [isAppReady, setAppReady] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setAppReady(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  if (!isAppReady) {
    return <CustomSplashScreen />;
  }

  return (
    <XmppProvider>
      <StoreProvider>
        <RootStack />
      </StoreProvider>
    </XmppProvider>
  );
};
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
});
export default App;
