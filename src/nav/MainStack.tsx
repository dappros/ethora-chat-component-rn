import React, { useState } from 'react';
import ChatScreen from '../screens/ChatScreen';
import AccountScreen from '../screens/AccountScreen';
import {ROUTES} from '../constants/routes';
import {createDrawerNavigator} from '@react-navigation/drawer';
import NoRoomScreen from '../screens/NoRoomScreen';
import { useEventSource } from '../hooks/useEventSource';

const Drawer = createDrawerNavigator();

const MainStack = () => {
  // const [link, setLink] = useState('');

  // const { data } = useEventSource(link);


  return (
    <Drawer.Navigator >
      <Drawer.Screen
        name={ROUTES.CHAT}
        component={ChatScreen}
        options={() => ({
          headerShown: false,
          headerTitle: '',
        })}
      />
      <Drawer.Screen
        name={ROUTES.ACCOUNT}
        component={AccountScreen}
        options={() => ({
          headerShown: false,
          headerTitle: '',
        })}
      />
    </Drawer.Navigator>
  );
};

export default MainStack;
