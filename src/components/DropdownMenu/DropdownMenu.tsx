import React, { useState, useEffect, ReactElement, useRef } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Animated,
  TextStyle,
  TouchableWithoutFeedback,
  Modal,
} from "react-native";
import { BurgerMenuIcon } from "../../assets/icons";
import { IConfig } from "../../types/types";
import Button from "../styled/Button";

const positionMenu = {
  right: { top: 55, right: 10 },
  left: { top: 55, left: 0 },
  rightBottom: { bottom: 55, right: 10 },
  leftBottom: { bottom: 55, left: 10 },
};

interface MenuOption {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  styles?: TextStyle;
}

interface DropdownMenuProps {
  options: MenuOption[];
  onClose?: any;
  openButton?: ReactElement;
  position?: "left" | "right" | "rightBottom" | "leftBottom";
  config?: IConfig;
  menuIcon?: React.ReactNode;
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({
  options,
  openButton,
  position = "right",
  menuIcon,
  config,
  onClose,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<View>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current; // For fade-in effect
  const translateYAnim = useRef(new Animated.Value(-10)).current;

  const toggleMenu = () => setIsOpen((prev) => !prev);

  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isOpen]);

  return (
    <View style={styles.container}>
      {openButton ? (
        React.cloneElement(openButton, { onPress: toggleMenu })
      ) : (
        // <TouchableOpacity onPress={toggleMenu} style={styles.button}>
        //   {menuIcon ?? <Text style={styles.icon}>☰</Text>}
        // </TouchableOpacity>
        <Button
          style={{
            padding: 8,
            borderRadius: 16,
            backgroundColor: "transparent",
          }}
          color="black"
          unstyled
          EndIcon={<BurgerMenuIcon color={config?.colors?.primary} />}
          onPress={toggleMenu}
        />
      )}
      {isOpen && (
        <Modal transparent visible={isOpen} animationType="fade">
          <TouchableOpacity
            style={styles.overlay}
            activeOpacity={1}
            onPress={() => {
              setIsOpen(false);
              onClose && onClose();
            }}
          >
            <Animated.View
              ref={menuRef}
              style={[
                styles.menu,
                positionMenu[position],
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: translateYAnim }],
                },
              ]}
            >
              {options.map((option, index) => (
                <View key={`${option.label}-${index}`} style={styles.menuItemWrapper}>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => {
                      option.onClick();
                      setIsOpen(false);
                      onClose && onClose();
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        alignItems: "center",
                      }}
                    >
                      {option.icon}
                    </View>
                    <Text style={[styles.label, option?.styles]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                  {index < options.length - 1 && (
                    <View style={styles.divider} />
                  )}
                </View>
              ))}
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
};

export default DropdownMenu;

const styles = StyleSheet.create({
  container: {
    position: "relative",
    zIndex: 100,
  },
  overlay: {
    flex: 1,
    width: "100%",
    height: "100%",
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  button: {
    padding: 10,
    backgroundColor: "#0052CD",
    borderRadius: 8,
  },
  icon: {
    color: "#fff",
    fontSize: 24,
  },
  menu: {
    position: "absolute",
    backgroundColor: "#fcfcfc",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 150,
    zIndex: 1000,
    elevation: 4, // Android
    shadowColor: "#121219", // iOS
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  menuItemWrapper: {
    display: "flex",
    flexDirection: "column",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
  },
  label: {
    fontSize: 16,
    marginLeft: 10,
  },
  divider: {
    height: 1,
    width: "100%",
    backgroundColor: "#0052cd0d",
  },
});
