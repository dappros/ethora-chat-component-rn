import React, {useMemo} from 'react';
import {View, Text, StyleSheet} from 'react-native';

interface MessageBubbleProps {
  left: boolean;
  text: string;
  fn: string;
  time: Date;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({
  left,
  text,
  fn,
  time,
}) => {
  const initials = useMemo(
    () =>
      fn
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase(),
    [],
  );

  const formatDate = (date: Date) => {
    return `${date.getHours()}:${date.getMinutes()}, ${date.getDate()}/${
      date.getMonth() + 1
    }/${date.getFullYear()}`;
  };

  return (
    <View style={[styles.container, left ? styles.left : styles.right]}>
      <View style={styles.circle}>
        <Text style={styles.initials}>{initials}</Text>
      </View>
      <View style={styles.messageBubbleBox}>
        <Text style={styles.text}>{text}</Text>
        <Text style={styles.time}>{formatDate(time)}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    margin: 10,
    alignItems: 'center',
  },
  left: {
    justifyContent: 'flex-start',
  },
  right: {
    justifyContent: 'flex-start',
    flexDirection: 'row-reverse',
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  messageBubbleBox: {
    maxWidth: '80%',
    padding: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    marginLeft: 10,
    marginRight: 10,
  },
  text: {
    color: '#000',
  },
  time: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
});

export default MessageBubble;
