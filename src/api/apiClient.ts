import { client } from "../components/ChatComponent/src/networking/apiClient";

export function getRoomList(token: string){
  return client.get(
    '/case',
    {
      headers: {
        Authorization: token,
      },
    },
  );
}