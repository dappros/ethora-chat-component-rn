// ---------------------------------------------------------------------------
// Ambient module declarations for untyped and shimmed/optional packages.
// ---------------------------------------------------------------------------

// ========================  Untyped but installed  ==========================

declare module "@xmpp/client" {
  const client: any;
  export default client;
  export const xml: any;
  export const jid: any;
  export type Client = any;
}

declare module "ltx" {
  export class Element {
    attrs: any;
    name: string;
    children: any[];
    is(name: string, xmlns?: string): boolean;
    getChild(name: string): Element | undefined;
    getChildren(name: string): Element[];
    getText(): string;
    toString(): string;
  }
}

declare module "uuid" {
  export function v4(): string;
}

// ========================  JSX namespace  ==================================

declare namespace JSX {
  interface Element extends React.ReactElement<any, any> {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

// ====================  Shimmed / optional packages  ========================
// As of 26.5.5 the SDK no longer statically imports `react-native-*` legacy
// pickers / clipboard / checkbox / permissions / audio-recorder, or
// `emoji-mart`. Their ambient shims are gone — the only entries left below
// are for packages still touched by the SDK source.

declare module "@react-native-firebase/messaging" {
  const content: any;
  export default content;
  export type FirebaseMessagingTypes = any;
}

declare module "@react-native-firebase/app" {
  const content: any;
  export default content;
  export function getApp(...args: any[]): any;
}

declare module "@xmpp/xml" {
  export class Element {
    attrs: any;
    name: string;
    children: any[];
    is(name: string, xmlns?: string): boolean;
    getChild(name: string): Element | undefined;
    getChildren(name: string): Element[];
    getText(): string;
    toString(): string;
  }
}

// expo-audio is an OPTIONAL peer dep (audio messages are opt-in), so this
// ambient shim keeps the SDK type-checking cleanly whether the consumer
// installs it or not. Real types win when the package is present.
declare module "expo-audio" {
  export type AudioPlayer = any;
  export type AudioStatus = any;
  export type AudioRecorder = any;
  export type RecorderState = any;
  export type RecordingStatus = any;
  export const RecordingPresets: any;
  export function createAudioPlayer(...args: any[]): any;
  export function useAudioPlayer(...args: any[]): any;
  export function useAudioRecorder(...args: any[]): any;
  export function useAudioRecorderState(...args: any[]): any;
  export function setAudioModeAsync(...args: any[]): Promise<void>;
  export function setIsAudioActiveAsync(...args: any[]): Promise<void>;
  export function requestRecordingPermissionsAsync(...args: any[]): Promise<any>;
  export function getRecordingPermissionsAsync(...args: any[]): Promise<any>;
  const content: any;
  export default content;
}

declare module "expo-media-library" {
  const content: any;
  export default content;
  export function requestPermissionsAsync(...args: any[]): Promise<any>;
  export function createAssetAsync(...args: any[]): Promise<any>;
  export function createAlbumAsync(...args: any[]): Promise<any>;
  export function getAlbumAsync(...args: any[]): Promise<any>;
  export function addAssetsToAlbumAsync(...args: any[]): Promise<any>;
  export function saveToLibraryAsync(...args: any[]): Promise<any>;
}
