/** @format */

import { useEffect, useState, useRef } from "react";
import { AppState } from "react-native";
import { useXmppClient } from "../context/xmppProvider";
import { setBaseURL } from "../networking/apiClient";
import { loginViaJwt } from "../networking/api-requests/auth.api";
import { walletToUsername } from "../helpers/walletUsername";
import { xmppSettingsInterface } from "../types/types";
import { useAppDispatch } from "./hooks";
import { setUser } from "../roomStore/chatSettingsSlice";

interface UseXmppInitializationOptions {
  chatToken?: string | null;
  xmppSettings?: xmppSettingsInterface;
  baseURL?: string;
  enabled?: boolean;
}

interface UseXmppInitializationResult {
  isInitializing: boolean;
  initializationError: string | null;
  isInitialized: boolean;
}

/**
 * Hook for initializing XMPP client via JWT token
 * Used for preloading chat before opening workspace
 */
export const useXmppInitialization = (
  options: UseXmppInitializationOptions = {}
): UseXmppInitializationResult => {
  const {
    chatToken,
    xmppSettings = {
      devServer: "wss://xmpp.ethoradev.com/ws",
      host: "xmpp.ethoradev.com",
      conference: "conference.xmpp.ethoradev.com",
    },
    baseURL = "https://api.ethoradev.com/v1",
    enabled = true,
  } = options;

  const { client, initializeClient } = useXmppClient();
  const dispatch = useAppDispatch();
  const [isInitializing, setIsInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    if (baseURL) {
      setBaseURL(baseURL, undefined);
      console.log("🚀 useXmppInitialization: Base URL set for chat", baseURL);
    }
  }, [baseURL]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const initXmppClient = async () => {
      if (client) {
        console.log("useXmppInitialization: Client already initialized");
        return;
      }

      if (!chatToken) {
        console.log("useXmppInitialization: Waiting for chatToken...");
        return;
      }

      if (isInitializing) {
        console.log("useXmppInitialization: Initialization in progress...");
        return;
      }

      if (AppState.currentState !== "active") {
        console.log("useXmppInitialization: App not active, skip init");
        return;
      }

      try {
        setIsInitializing(true);
        setInitializationError(null);
        console.log("useXmppInitialization: Starting XMPP client initialization...");

        const user = await loginViaJwt(chatToken);
        console.log("useXmppInitialization: User data received", {
          hasXmppUsername: !!user.xmppUsername,
          hasXmppPassword: !!user.xmppPassword,
        });

        dispatch(setUser(user));
        console.log("useXmppInitialization: User saved to store");

        const xmppUsername =
          user.xmppUsername ||
          walletToUsername(user.defaultWallet?.walletAddress || "");

        if (!xmppUsername || !user.xmppPassword) {
          throw new Error("Missing XMPP credentials (username or password)");
        }

        console.log("useXmppInitialization: Initializing XMPP client...");
        const initializedClient = await initializeClient(
          xmppUsername,
          user.xmppPassword,
          xmppSettings
        );

        console.log("useXmppInitialization: XMPP client initialized successfully", {
          status: initializedClient.status,
        });
      } catch (error: any) {
        console.error("useXmppInitialization: Failed to initialize XMPP client", error);
        if (isMountedRef.current) {
          setInitializationError(error?.message || "Unknown error");
        }
      } finally {
        if (isMountedRef.current) {
          setIsInitializing(false);
        }
      }
    };

    initXmppClient();
  }, [
    chatToken,
    client,
    initializeClient,
    isInitializing,
    enabled,
    xmppSettings,
  ]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    isInitializing,
    initializationError,
    isInitialized: !!client && client.status === "online",
  };
};