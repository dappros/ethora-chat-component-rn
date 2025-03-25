import React from 'react';
import {
  Modal,
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import {ImageSourcePropType} from 'react-native';

interface ActionModalProps {
  image: ImageSourcePropType;
  title: string;
  description: string;
  topButtonText: string;
  topButtonColor: string;
  botButtonText: string;
  isModalVisible: boolean;
  onClick: () => void;
  toggleModal: () => void;
}

export const ActionModal: React.FC<ActionModalProps> = ({
  image,
  title,
  description,
  topButtonText,
  topButtonColor,
  botButtonText,
  isModalVisible,
  onClick,
  toggleModal,
}) => {
  return (
    <Modal visible={isModalVisible} transparent={true} animationType={'slide'}>
      <Pressable style={styles.overlay} onPress={toggleModal}>
        <Pressable style={styles.modalContainer} onPress={null}>
          <View style={styles.modalContent}>
            <Image source={image} style={styles.icon} />
            <Text style={styles.modalTitle}>{title}</Text>
            <Text style={styles.modalMessage}>{description}</Text>

            <TouchableOpacity
              style={[styles.logoutButton, {backgroundColor: topButtonColor}]}
              onPress={onClick}>
              <Text style={styles.logoutButtonText}>{topButtonText}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={toggleModal}>
              <Text style={styles.cancelButtonText}>{botButtonText}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  modalContainer: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    margin: 0,
    padding: 16,
    zIndex: 100,
  },
  modalContent: {
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
  },
  icon: {
    marginBottom: 20,
  },
  modalTitle: {
    color: '#000000',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  modalMessage: {
    fontSize: 16,
    color: '#000000',
    textAlign: 'center',
    marginBottom: 30,
  },
  logoutButton: {
    width: '100%',
    height: 56,
    paddingVertical: 15,
    borderRadius: 50,
    marginBottom: 16,
  },
  logoutButtonText: {
    color: 'white',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    width: '100%',
    backgroundColor: '#F2E6F6',
    paddingVertical: 15,
    borderRadius: 50,
    height: 56,
  },
  cancelButtonText: {
    color: '#60269E',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },
});
