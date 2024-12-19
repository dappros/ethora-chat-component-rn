import React, {useState, useEffect, ReactElement, useRef} from 'react';
import {View, TouchableOpacity, Text, StyleSheet, Animated} from 'react-native';

interface MenuOption {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  styles?: React.CSSProperties;
}

interface DropdownMenuProps {
  options: MenuOption[];
  onClose?: any;
  openButton?: ReactElement;
  position?: 'left' | 'right';
  menuIcon?: React.ReactNode;
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({
  options,
  openButton,
  position = 'right',
  menuIcon,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<View>(null);
  const buttonRef = useRef<TouchableOpacity>(null);

  const menuPosition =
    position === 'right' ? {top: 60, right: -140} : {top: 60, left: 0};

  const fadeAnim = useRef(new Animated.Value(0)).current; // For fade-in effect

  const toggleMenu = () => setIsOpen(prev => !prev);

  useEffect(() => {
    const handleClickOutside = (event: any) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }

    return () => {
      // Clean up
    };
  }, [isOpen]);

  return (
    <View style={styles.container}>
      {openButton ? (
        React.cloneElement(openButton, {ref: buttonRef, onPress: toggleMenu})
      ) : (
        <TouchableOpacity
          onPress={toggleMenu}
          ref={buttonRef}
          style={styles.button}>
          {menuIcon ?? <Text style={styles.icon}>☰</Text>}
        </TouchableOpacity>
      )}
      {isOpen && (
        <Animated.View
          ref={menuRef}
          style={[styles.menu, menuPosition, {opacity: fadeAnim}]}>
          {options.map((option, index) => (
            <View key={index} style={styles.menuItemWrapper}>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  option.onClick();
                  setIsOpen(false);
                }}>
                {option.icon}
                <Text style={[styles.label, option?.styles]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
              {index < options.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </Animated.View>
      )}
    </View>
  );
};

export default DropdownMenu;

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  button: {
    padding: 10,
    backgroundColor: '#0052CD',
    borderRadius: 8,
  },
  icon: {
    color: '#fff',
    fontSize: 24,
  },
  menu: {
    position: 'absolute',
    backgroundColor: '#fcfcfc',
    borderRadius: 8,
    padding: 16,
    minWidth: 150,
    zIndex: 1000,
    boxShadow: '0px 0px 6px -2px #12121908', // React Native doesn't support box-shadow
  },
  menuItemWrapper: {
    display: 'flex',
    flexDirection: 'column',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    cursor: 'pointer',
  },
  label: {
    fontSize: 16,
    marginLeft: 10,
  },
  divider: {
    height: 1,
    width: '100%',
    backgroundColor: '#0052cd0d',
  },
});
