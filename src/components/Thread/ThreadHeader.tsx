import {FC} from 'react';
import {
  ChatContainerHeader,
  ChatContainerHeaderLabel,
} from '../styled/StyledComponents';
import Button from '../styled/Button';
import {CloseIcon} from '../../assets/icons';
import {useDispatch} from 'react-redux';
import {setCloseActiveMessage} from '../../roomStore/roomsSlice';

interface ThreadHeaderProps {
  chatJID: string;
}

const ThreadHeader: FC<ThreadHeaderProps> = ({chatJID}) => {
  const dispatch = useDispatch();

  const handleCloseThread = () => {
    dispatch(setCloseActiveMessage({chatJID: chatJID}));
  };

  return (
    <ChatContainerHeader>
      <View style={{display: 'flex', gap: '8px'}}>
        <ChatContainerHeaderLabel>Thread</ChatContainerHeaderLabel>
      </View>

      <View style={{display: 'flex', gap: 16}}>
        <Button
          style={{padding: 8}}
          EndIcon={<CloseIcon />}
          unstyled
          onClick={handleCloseThread}
        />
      </View>
    </ChatContainerHeader>
  );
};

export default ThreadHeader;
