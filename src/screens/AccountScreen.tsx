import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import React, {useEffect, useState} from 'react';
import {useStores} from '../stores/context';
import {VStack} from 'native-base';
import LogOut from '../assets/LogOut.svg';
import Pencil from '../assets/Pencil.svg';
import headerModalImage from '../assets/LogOut.png';
import {ActionModal} from '../components/UI/ActionModal/ActionModal';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useTranslation } from '../hooks/useTranslation';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { SelectLanguage } from '../components/UI/SelectLanguage';
import { BurgerMenuIcon } from '../components/ChatComponent/src/assets/icons';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Account'>;

const AccountScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const {loginStore, chatStore} = useStores();

  const {translatesValue} = useTranslation();

  const [isModalVisible, setModalVisible] = useState<boolean>(false);
  const [loungeOtion, setLoungeOtion] = useState(chatStore.langSouece);

  const handleLogout = () => {
    loginStore.logOut();
    toggleModal();
  };

  const toggleModal = () => {
    setModalVisible(!isModalVisible);
  };

  const getInitials = (name: string) => {
    const initials = name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase();
    return initials;
  };

  useEffect(() => {
    chatStore.setChangeLanguage(loungeOtion);
    useLocalStorage('translates').set(loungeOtion);
  }, [loungeOtion]);

  useEffect(() => {
    setLoungeOtion(translatesValue)
  }, [translatesValue]);

  return (
    <VStack style={styles.container}>
        <TouchableOpacity
        onPress={() =>  navigation.dispatch(DrawerActions.openDrawer())}
        style={{width: 24, position: 'absolute', top: 24, left: 24}}
        >
          <BurgerMenuIcon />
        </TouchableOpacity>
      <View style={styles.avatarContainer}>
        <View style={styles.initialsContainer}>
          <Text style={styles.initials}>
            {getInitials(loginStore.initialData.fullName)}
          </Text>
        </View>
        <TouchableOpacity style={styles.editIcon}>
          <Pencil />
        </TouchableOpacity>
      </View>

      <Text style={styles.userName}>{loginStore.initialData.fullName}</Text>
      <SelectLanguage
        backgroundColor='#FFFFFF'
        loungeOtion={loungeOtion}
        setLoungeOtion={setLoungeOtion}
      />
      <TouchableOpacity style={styles.logOutButton} onPress={toggleModal}>
        <LogOut style={styles.logOutIcon} />
        <Text style={styles.logOutText}>Log Out</Text>
      </TouchableOpacity>

      <ActionModal
        title="Log Out"
        description="Are you sure you want to log out?"
        topButtonText="Log Out"
        botButtonText="Cancel"
        topButtonColor="#E7004C"
        image={headerModalImage}
        isModalVisible={isModalVisible}
        toggleModal={toggleModal}
        onClick={handleLogout}
      />
    </VStack>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 20,
    backgroundColor: '#FAFAFA',
  },
  pickerButton: {
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  pickerButtonText: {
    fontSize: 16,
    color: '#53575A',
  },
  pickerContainer: {
    width: '100%',
  },
  avatarContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  initialsContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E0F8F8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    fontSize: 32,
    color: '#60269E',
    fontWeight: 'bold',
  },
  editIcon: {
    position: 'absolute',
    bottom: 0,
    right: -3,
    backgroundColor: '#F2E6F6',
    width: 20,
    aspectRatio: 1 / 1,
    borderRadius: 20,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#53575A',
    marginBottom: 38,
  },
  logOutButton: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    backgroundColor: '#FFFFFF',
    height: 56,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  logOutIcon: {
    marginRight: 10,
    fontWeight: '800',
  },
  logOutText: {
    color: '#53575A',
    fontSize: 16,
    fontWeight: '800',
  },
});

export default AccountScreen;
