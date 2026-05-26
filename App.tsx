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
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppLoginChatsRn from './AppLoginChatsRn';

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

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppLoginChatsRn />
    </SafeAreaProvider>
  );
}

export default App;
