import { Text, View } from "react-native";
import { NoMessages } from "../../assets/icons";

const NoMessagesPlaceholder = () => {
  return (
    <View
      style={{
        height: "100%",
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
