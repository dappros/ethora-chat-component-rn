import React, { FC, useCallback, useMemo } from "react";
import { View, StyleSheet, Image, Text } from "react-native";
import { ProfileImagePlaceholder } from "../MainComponents/ProfileImagePlaceholder";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import {
  AddNewIcon,
  BurgerMenuIcon,
  ProfileIcon,
  SettingIcon,
} from "../../assets/icons";
import { useDispatch } from "react-redux";
import { logout, setActiveModal } from "../../roomStore/chatSettingsSlice";
import { MODAL_TYPES } from "../../helpers/constants/MODAL_TYPES";
import { useXmppClient } from "../../context/xmppProvider";
import { setLogoutState } from "../../roomStore/roomsSlice";
import DropdownMenu from "../DropdownMenu/DropdownMenu";
import Button from "../styled/Button";

interface HeaderRoomListProps {
  setDrawerOpen: () => void;
}

export const HeaderRoomList: FC<HeaderRoomListProps> = ({ setDrawerOpen }) => {
  const { config, user, selectedUser } = useChatSettingState();
  const { client, setClient } = useXmppClient();
  const dispatch = useDispatch();

  const modalUser: any = selectedUser ?? user;

  const handleLogout = useCallback(async () => {
    if (client) {
      await client.close();
      setClient(null);
    }
    dispatch(setLogoutState());
    dispatch(logout());
  }, [client, dispatch, setClient]);

  const menuOptions = useMemo(
    () => [
      {
        label: "New Chat",
        icon: <AddNewIcon color="#8C8C8C" />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.NEW_CHAT));
          console.log("New chat clicked");
        },
        styles: { color: "#141414" },
      },
      {
        label: "Profile",
        icon: <ProfileIcon color="#8C8C8C" />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.PROFILE));
          console.log("Profile clicked");
        },
      },
      {
        label: "Settings",
        icon: <SettingIcon color="#8C8C8C" />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.SETTINGS));
          console.log("Settings clicked");
        },
      },
      // {
      //   label: "Logout",
      //   onClick: handleLogout,
      // },
    ],
    [handleLogout]
  );

  const HeaderLogo = useMemo(() => {
    const image = config?.headerLogo;

    if (image) {
      if (typeof image === "function") {
        const SvgComponent = image as React.FC<React.SVGProps<SVGSVGElement>>;
        return <SvgComponent />;
        // return <image width="100%" height="100%" />
      } else {
        return <Image source={image} />;
      }
    }

    return <View />;
  }, [config?.backgroundChat?.image]);

  const openProfile = () => {
    dispatch(setActiveModal(MODAL_TYPES.PROFILE));
    console.log("Profile clicked");
  };

  return (
    <View style={styles.headerContainer}>
      {!config?.disableRoomMenu && (
        <Button
          style={{
            padding: 8,
            borderRadius: 16,
            backgroundColor: "transparent",
          }}
          color="black"
          unstyled
          EndIcon={<BurgerMenuIcon color={config?.colors?.primary} />}
          onPress={() => setDrawerOpen()}
        />
      )}
      <View>
        {config?.headerLogo ? (
          HeaderLogo
        ) : (
          <Text style={{ fontWeight: 500, fontSize: 18 }}>Chats</Text>
        )}
      </View>
      <ProfileImagePlaceholder
        icon={modalUser?.profileImage ?? null}
        name={modalUser?.name ?? modalUser?.firstName}
        size={30}
        click={{
          isClick: true,
          onPress: openProfile,
        }}
      />
      {/* <NewChatModal /> */}
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    justifyContent: "space-between",
  },
});
