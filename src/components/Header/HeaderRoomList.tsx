import React, { FC, useMemo } from "react";
import { View, StyleSheet, Image, Text } from "react-native";
import { ProfileImagePlaceholder } from "../MainComponents/ProfileImagePlaceholder";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import { BurgerMenuIcon } from "../../assets/icons";
import Button from "../styled/Button";

interface HeaderRoomListProps {
  setDrawerOpen: () => void;
}

export const HeaderRoomList: FC<HeaderRoomListProps> = ({ setDrawerOpen }) => {
  const { config, user, selectedUser } = useChatSettingState();

  const modalUser: any = selectedUser ?? user;

  const HeaderLogo = useMemo(() => {
    const image = config?.headerLogo;

    if (image) {
      if (typeof image === "function") {
        const SvgComponent = image as React.FC<React.SVGProps<SVGSVGElement>>;
        return <SvgComponent />;
      } else {
        return <Image source={image} />;
      }
    }

    return <View />;
  }, [config?.backgroundChat?.image]);

  return (
    <View style={styles.headerContainer}>
      {!config?.disableRoomMenu && config?.headerMenu ? (
        <Button
          style={styles.menuButton}
          color="black"
          unstyled
          EndIcon={<BurgerMenuIcon color={config?.colors?.primary} />}
          onPress={() => config?.headerMenu && config?.headerMenu()}
        />
      ) : (
        <View style={styles.emptyContainer} />
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
          onPress: setDrawerOpen,
        }}
      />
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
  menuButton: {
    padding: 8,
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  emptyContainer: {
    width: 60,
  },
});
