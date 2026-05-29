export type MediaFile = {
  uri: string;
  type: string;
  name: string;
  // Byte size when the picker can report it (images/videos/documents).
  // Used to enforce the client-side upload cap before hitting the server.
  size?: number;
};
