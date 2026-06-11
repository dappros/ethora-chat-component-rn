import { Text, View } from 'react-native';
import { NoMessages } from '../../assets/icons';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { getIconColor } from '../../helpers/getIconColor';

const NoMessagesPlaceholder = () => {
  const { config } = useChatSettingState();
  return (
    <View
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <View style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <NoMessages color={getIconColor(config)} />
        <View
          style={{
            flexDirection: 'column',
            gap: 8,
            padding: 16,
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: '#a3a3a3',
              textAlign: 'center',
              fontSize: 16,
              fontWeight: '600',
            }}
          >
            This chat is empty
          </Text>
          <Text
            style={{
              color: '#a3a3a3',
              textAlign: 'center',
              fontSize: 14,
              fontWeight: '400',
            }}
          >
            Be the first one to start it.
          </Text>
        </View>
      </View>
    </View>
  );
};

export default NoMessagesPlaceholder;
