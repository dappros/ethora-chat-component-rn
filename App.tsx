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
import AppLoginChatsRn from './AppLoginChatsRn';

function App(): React.JSX.Element {
  return <AppLoginChatsRn />;
}

export default App;
