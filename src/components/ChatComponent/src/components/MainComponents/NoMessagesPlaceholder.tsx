import { Image, ImageSourcePropType, Text, View } from "react-native";
import { NoMessages } from "../../assets/icons";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import { useMemo } from "react";
import React from "react";

const NoMessagesPlaceholder = () => {
  const {config} = useChatSettingState();

    const image = useMemo(() => {
      const image = config?.emptyChatLogo;
  
      if (image) {
        if (typeof image === 'object' && !React.isValidElement(image) && 'uri' in image) {
          return <Image source={image as ImageSourcePropType} />;
        }
  
        if (typeof image === 'function') {
          const SvgComponent = image as React.FC<React.SVGProps<SVGSVGElement>>;
          return (
            <SvgComponent/>
          );
        }
  
        if (React.isValidElement(image)) {
          return image;
        }
      }
  
      return <View />;
    }, [config?.backgroundChat?.image]);

  return (
    <View
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <View style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* <NoMessages /> */}
        <View
          style={{
            flexDirection: "column",
            gap: 8,
            padding: 16,
            justifyContent: "center",
          }}
        >
          {image}
          <Text
            style={{ textAlign: "center", fontSize: 16, fontWeight: "600" }}
          >
            This chat is empty
          </Text>
          <Text
            style={{ textAlign: "center", fontSize: 14, fontWeight: "400" }}
          >
            Be the first one to start it.
          </Text>
        </View>
      </View>
    </View>
  );
};

export default NoMessagesPlaceholder;
