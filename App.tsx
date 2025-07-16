/** @format */

import React, { useMemo } from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { defaultUser } from "./api.config";
import { ReduxWrapper } from "./src/components/MainComponents/ReduxWrapper";
import { BG } from "./src/assets/BG";
import { ForzaCare } from "./src/assets/ForzaCare";
import { IConfig } from "./src/types/models/config.model";

function App(): React.JSX.Element {
  const config: IConfig = useMemo(
    () => ({
      colors: { primary: '#5E3FDE', secondary: '#E1E4FE' },
      userLogin: { enabled: true, user: null },
      chatRoomStyles: { borderRadius: '16px' },
      roomListStyles: { borderRadius: '16px' },
      setRoomJidInPath: true,
    }),
    []
  );

  return (
    <SafeAreaView>
      <ReduxWrapper
        // roomJID="646cc8dc96d4a4dc8f7b2f2d_6824685682d635dba7522423@conference.xmpp.ethoradev.com"
        config={{
          xmppSettings: {
            devServer: 'wss://xmpp.ethoradev.com:5443/ws',
            host: 'xmpp.ethoradev.com',
            conference: 'conference.xmpp.ethoradev.com',
          },
          baseUrl: 'https://api.ethoradev.com/v1',
          newArch: true,
          setRoomJidInPath: true,
          qrUrl: 'https://beta.ethora.com/app/chat/?qrChatId=',
          // secondarySendButton: {
          //   enabled: true,
          //   messageEdit: `videoId:${window.location.href}`,
          //   buttonText: 'With Id',
          //   buttonStyles: {
          //     whiteSpace: 'nowrap',
          //     width: '60px',
          //   },
          // },
          initBeforeLoad: true,
          ...config,
        }}
      />
    </SafeAreaView>
  );
}

export default App;
