import {View} from 'react-native';
import {NoMessages} from '../../assets/icons';

const NoMessagesPlaceholder = () => {
  return (
    <View
      style={{
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      <View style={{display: 'flex', flexDirection: 'column', gap: 16}}>
        {/* <NoMessages /> */}
        <View
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 16,
            justifyContent: 'center',
            textAlign: 'center',
          }}>
          <View style={{fontSize: '16px', fontWeight: 600}}>
            This chat is empty
          </View>
          <View style={{fontSize: '14px', fontWeight: 400}}>
            Be the first one to start it.
          </View>
        </View>
      </View>
    </View>
  );
};

export default NoMessagesPlaceholder;
