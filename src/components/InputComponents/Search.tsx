/** @format */

import React, { useState, useEffect, useRef } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from "react-native";

interface SearchInputProps {
  icon?: React.ReactNode;
  animated?: boolean;
  direction?: "left" | "right";
  placeholder?: string;
}

const SearchInput: React.FC<SearchInputProps> = ({
  icon,
  animated = false,
  direction = "left",
  placeholder,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  const [width, setWidth] = useState(new Animated.Value(48)); // For animated width
  const [opacity, setOpacity] = useState(new Animated.Value(0)); // For opacity change

  const handleFocus = () => {
    setIsExpanded(true);
  };

  const handleBlur = () => {
    if (!isTyping) {
      setIsExpanded(false);
    }
  };

  const handleInput = (text: string) => {
    setIsTyping(!!text);
  };

  useEffect(() => {
    if (isExpanded && animated) {
      // Expanding width animation
      Animated.timing(width, {
        toValue: 300, // Expanded width
        duration: 700,
        useNativeDriver: false,
      }).start();

      Animated.timing(opacity, {
        toValue: 1, // Make input fully visible
        duration: 700,
        useNativeDriver: false,
      }).start();
    } else {
      // Collapse width animation
      Animated.timing(width, {
        toValue: 48, // Initial width
        duration: 700,
        useNativeDriver: false,
      }).start();

      Animated.timing(opacity, {
        toValue: 0, // Hide placeholder if collapsed
        duration: 700,
        useNativeDriver: false,
      }).start();
    }
  }, [isExpanded, animated]);

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity onPress={handleFocus} style={styles.iconContainer}>
        {icon}
      </TouchableOpacity>
      <Animated.View style={[styles.searchInputWrapper, { width }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { opacity }]}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChangeText={handleInput}
          value={isTyping ? "Typing..." : ""}
          placeholder={placeholder}
          placeholderTextColor="#999"
        />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconContainer: {
    padding: 10,
  },
  searchInputWrapper: {
    backgroundColor: "#f5f7f9",
    borderRadius: 16,
    height: 48,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  input: {
    backgroundColor: "transparent",
    borderWidth: 0,
    height: "100%",
    fontSize: 16,
    color: "#000",
  },
});

export { SearchInput };
