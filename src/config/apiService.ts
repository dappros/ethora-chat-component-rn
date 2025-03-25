/*
Copyright 2019-2022 (c) Dappros Ltd, registered in England & Wales, registration number 11455432. All rights reserved.
You may not use this file except in compliance with the License.
You may obtain a copy of the License at https://github.com/dappros/pericon/blob/main/LICENSE.
Note: linked open-source libraries and components may be subject to their own licenses.
*/

import axios from 'axios';

const http = axios.create();

export const httpGet = async (
  url: string,
  token: string | null,
  params = {},
) => {
  return await http.get(url, {
    headers: {
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/json',
      Authorization: token,
    },
    params,
  });
};

export const httpPost = async (
  url: string,
  body?: any,
  token?: string,
  email?: string,
) => {
  return await http.post(`${VITE_API_URL}${url}`, body, {
    headers: {
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/json',
      Authorization: email ? email : token,
    },
  });
};

export function httpGetConfig(domainName?: string) {
  let path = '/apps/get-config';
  if (domainName) {
    path += `?domainName=${domainName}`;
  }

  return http.get(path);
}

export const DOMAIN_NAME= 'ethora';
export const VITE_API_URL = 'https://dev.perspecto.api.atomwcapps.com/v1';
export const VITE_APP_XMPP_SERVICE =
  'wss://case-any-place-iframe-xmpp-dev.atomwcapps.com:5443/ws';
export const VITE_XMPP_SERVICE =
  'conference.case-any-place-iframe-xmpp-dev.atomwcapps.com';
export const VITE_XMPP_HOST = 'case-any-place-iframe-xmpp-dev.atomwcapps.com';
