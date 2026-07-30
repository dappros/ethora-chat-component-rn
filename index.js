/**
 * @format
 *
 * Expo entry — registerRootComponent handles both Expo Go and bare/
 * prebuild flows. The gesture-handler import has to be the very first
 * thing the app evaluates.
 */

import 'react-native-gesture-handler';
// Polyfill `crypto.getRandomValues()` before anything that pulls in
// uuid — RN's JS runtime doesn't ship one, and uuid throws
// "crypto.getRandomValues() not supported" on the first send.
// The library entry (src/main.ts) loads this too, but the testbed
// here mounts the chat directly without going through that entry, so
// we need it again at the testbed root.
import 'react-native-get-random-values';
// Configure LogBox before App (and its expo-audio / styled-components
// imports) evaluate, so import-time dev warnings don't flash the on-screen
// "view warnings" toast over the chat UI. Testbed-only.
import './setupLogBox';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
