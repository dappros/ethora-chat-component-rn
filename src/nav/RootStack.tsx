import React, {useEffect} from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useStores} from '../stores/context';
import {RootStackParamList, ROUTES} from '../constants/routes';
import AuthStack from './AuthStack';
import {observer} from 'mobx-react-lite';
import MainStack from './MainStack';
import NoRoomScreen from '../screens/NoRoomScreen';
import Loading from "../components/UI/Loading/Loading.tsx";

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootStack = observer(() => {
  const {loginStore} = useStores();
  const {userToken, loading} = loginStore;

  useEffect(() => {
    loginStore.setInitialDetailsFromAsyncStorage();
    return () => {};
  }, []);

  console.log('userToken', userToken);

  return (
    <>
      {loading ? (
        <Loading/>
      ) : (
        <Stack.Navigator>
          {userToken ? (
            <>
              <Stack.Screen
                name={ROUTES.MAINSTACK}
                component={MainStack}
                options={{headerShown: false}}
              />
              <Stack.Screen
                name={ROUTES.NOROOM}
                component={NoRoomScreen}
                options={() => ({
                  headerShown: false,
                  headerTitle: '',
                })}
              />
            </>
          ) : (
            <Stack.Screen
              options={{headerShown: false}}
              name={ROUTES.AUTHSTACK}
              component={AuthStack}
            />
          )}
        </Stack.Navigator>
      )}
    </>
  );
});

export default RootStack;
