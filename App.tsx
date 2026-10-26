/**
 * Entry point.
 *
 * The testbed app `AppLoginChatsRn` mirrors `web/src/AppLoginChatsNpm.tsx`:
 * a paste-a-JWT login, then a 3-tab room view (Description / Other / Chat)
 * that mounts the local `<ReduxWrapper>` (the RN chat component) under
 * the Chat tab via `initBeforeLoad + jwtLogin`.
 *
 * To run the old defaultUser smoke instead, replace the import below with:
 *   import {defaultUser} from './api.config';
 *   import {ReduxWrapper} from './src/components/MainComponents/ReduxWrapper';
 *   ...
 *   <ReduxWrapper config={{userLogin: {enabled: true, user: defaultUser}}} />
 */
import React, { useEffect } from 'react';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  configureScheduledCallLinks,
  handleScheduledCallUrl,
} from './src/booking';
import AppLoginChatsRn from './AppLoginChatsRn';
import AppUnreadRepro from './AppUnreadRepro';
// import AppLoginChatsRn from './AppLoginChatsRn';

// Hermes/RN error reporter — log full stack so we can find the
// `Cannot read property 'toString' of undefined` that fires after
// XMPP comes online.
const ErrorUtils = (global as any).ErrorUtils;
if (ErrorUtils && !(global as any).__claudeErrTrap) {
  (global as any).__claudeErrTrap = true;
  const prev = ErrorUtils.getGlobalHandler?.();
  ErrorUtils.setGlobalHandler?.((err: any, isFatal: boolean) => {
    try {
      console.log('🔥 [GlobalError]', {
        message: err?.message,
        name: err?.name,
        isFatal,
        stack: (err?.stack || '').split('\n').slice(0, 15).join('\n'),
      });
    } catch {}
    if (prev) {prev(err, isFatal);}
  });
}

// Which links belong to this app: https://app.chat.ethora.com/call/<slug>
// (the associated domain / intent filter in app.json) and the app's own
// scheme, ethorachatcomponentrn://call/<slug>. Set before anything renders
// so a link that launches the app is already recognised.
configureScheduledCallLinks({
  hosts: ['app.chat.ethora.com'],
  schemes: ['ethorachatcomponentrn'],
});

function App(): React.JSX.Element {
  // A scheduled-call link opens the app (cold start) or arrives while it
  // runs. The SDK holds it until the user is signed in and <Chat> is up,
  // then opens the room and the pre-join screen.
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) {handleScheduledCallUrl(url);}
    });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleScheduledCallUrl(url);
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      {/* <AppUnreadRepro /> */}
      <AppLoginChatsRn/>
    </SafeAreaProvider>
  );
}

export default App;
