/**
 * @format
 *
 * Expo entry — registerRootComponent handles both Expo Go and bare/
 * prebuild flows. The gesture-handler import has to be the very first
 * thing the app evaluates.
 */

import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
