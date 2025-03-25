import { Image } from "native-base";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import ArrowBackIcon from "../assets/ArrowBack.svg";
import { useStores } from "../stores/context";
import { useNavigation } from "@react-navigation/native";
import { NavigationProps, ROUTES } from "../constants/routes";

const NoRoomScreen = () => {
  const navigation = useNavigation<NavigationProps>();
  const {loginStore} = useStores();

  const handleBack = async () => {
    await loginStore.logOut();
    navigation.navigate(ROUTES.LOGIN);
  };

  return (
    <View style={styles.screenContainer}>
        <TouchableOpacity
            style={styles.backContainer}
            onPress={handleBack}
        >
            <ArrowBackIcon/>
            <Text>Back login</Text>
        </TouchableOpacity>
      
      <Image
        source={require("../assets/noChat.png")}
        alt="no chat"
        style={styles.image}
      />
      <Text style={{fontSize: 20, fontWeight: 500}}>No Room</Text>
      <View style={{alignItems: "center"}}>
        <Text style={styles.textDescription}>Your chat has been deleted or modified.</Text>
        <Text style={styles.textDescription}>Please contact support </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  screenContainer: {
    position: 'relative',
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 16,
  },
  backContainer: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  image: {
    width: "100%",
    height: 250,
    resizeMode: "contain",
  },
  textDescription: {
    fontSize: 12
  }
})

export default NoRoomScreen;