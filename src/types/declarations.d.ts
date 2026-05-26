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

declare module "emoji-mart" {
  export const Picker: any;
  export default Picker;
}

declare module "react-native-audio-recorder-player" {
  const content: any;
  export default content;
}

declare module "react-native-image-crop-picker" {
  const content: any;
  export default content;
}

declare module "react-native-permissions" {
  const content: any;
  export default content;
  export const PERMISSIONS: any;
  export const RESULTS: any;
  export function check(...args: any[]): any;
  export function request(...args: any[]): any;
  export type Permission = any;
}

declare module "react-native-document-picker" {
  const content: any;
  export default content;
  export function pick(...args: any[]): any;
  export const types: any;
}

declare module "react-native-emoji-selector" {
  const content: any;
  export default content;
}

declare module "@react-native-clipboard/clipboard" {
  const content: any;
  export default content;
}

declare module "@react-native-community/checkbox" {
  const content: any;
  export default content;
}

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

declare module "react-native-fs" {
  const content: any;
  export default content;
  export const ExternalStorageDirectoryPath: string;
  export const DocumentDirectoryPath: string;
  export const DownloadDirectoryPath: string;
  export function mkdir(path: string): Promise<void>;
  export function downloadFile(options: any): { promise: Promise<any> };
}
