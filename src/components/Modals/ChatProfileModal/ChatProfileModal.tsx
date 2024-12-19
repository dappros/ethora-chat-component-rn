import React, {useEffect, useState} from 'react';
import {
  CenterContainer,
  UserInfo,
  UserName,
  UserStatus,
  ModalContainerFullScreen,
  Label,
  BorderedContainer,
  LabelData,
  Viewider,
} from '../styledModalComponents';
import ModalHeaderComponent from '../ModalHeaderComponent';
import {ProfileImagePlaceholder} from '../../MainComponents/ProfileImagePlaceholder';
import {useDispatch, useSelector} from 'react-redux';
import {RootState, getActiveRoom} from '../../../roomStore';
import {uploadFile} from '../../../networking/api-requests/auth.api';
import {useXmppClient} from '../../../context/xmppProvider';
import {updateRoom} from '../../../roomStore/roomsSlice';
import Loader from '../../styled/Loader';
import Button from '../../styled/Button';
import {MoreIcon, QrIcon} from '../../../assets/icons';
import {View} from 'react-native';

interface ChatProfileModalProps {
  handleCloseModal: any;
}

const ChatProfileModal: React.FC<ChatProfileModalProps> = ({
  handleCloseModal,
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [visible, setVisible] = useState<boolean>(false);

  const dispatch = useDispatch();
  const {client} = useXmppClient();
  const activeRoom = useSelector((state: RootState) => getActiveRoom(state));

  useEffect(() => {
    setLoading(true);
    client.getRoomMembersStanza(activeRoom.jid);

    if (activeRoom.roomMembers?.length > 0) {
      setLoading(false);
    }

    return () => {};
  }, [activeRoom.roomMembers?.length]);

  const onUpload = async (file: File) => {
    try {
      let mediaData: FormData | null = new FormData();
      mediaData.append('files', file);

      const uploadResult = await uploadFile(mediaData);

      const location = uploadResult?.data?.results?.[0]?.location;
      if (!location) {
        throw new Error('No location found in upload result.');
      }

      client.setRoomImageStanza(activeRoom.jid, location, 'icon', 'none');
      dispatch(updateRoom({jid: activeRoom.jid, updates: {icon: location}}));
    } catch (error) {
      console.error('File upload failed or location is missing:', error);
    }
  };

  const onRemoveClick = async () => {
    client.setRoomImageStanza(activeRoom.jid, null, 'icon', 'none');
    dispatch(updateRoom({jid: activeRoom.jid, updates: {icon: null}}));
  };

  return (
    <ModalContainerFullScreen style={{position: 'relative'}}>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={'Chat Profile'}
        rightMenu={
          <>
            <Button EndIcon={<QrIcon />} onClick={() => setVisible(true)} />
            {/* <Button EndIcon={<MoreIcon />} /> */}
          </>
        }
      />
      <CenterContainer>
        <ProfileImagePlaceholder
          name={activeRoom.name}
          icon={activeRoom.icon}
          upload={{
            onUpload,
            active: activeRoom?.role !== 'participant' ? true : false,
          }}
          remove={{enabled: true, onRemoveClick}}
          role={activeRoom?.role}
          size={128}
        />
        <UserInfo>
          <UserName>{activeRoom.name}</UserName>
          <UserStatus>
            {activeRoom.usersCnt}{' '}
            {activeRoom.usersCnt > 1 ? 'members' : 'member'}
          </UserStatus>
        </UserInfo>
        <BorderedContainer>
          <LabelData>Description</LabelData>
          <Label>Chat's Description</Label>
        </BorderedContainer>
        <BorderedContainer style={{padding: '8px 16px'}}>
          {loading ? (
            <Loader />
          ) : (
            activeRoom?.roomMembers?.map((user, index) => (
              <View
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'start',
                  boxSizing: 'border-box',
                }}>
                <View
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 0px',
                    alignItems: 'center',
                    width: '100%',
                  }}>
                  <View style={{display: 'flex', gap: '8px'}}>
                    <ProfileImagePlaceholder name={user.name} size={40} />
                    <View
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        alignItems: 'start',
                      }}>
                      <Label style={{fontSize: '16px', fontWeight: 600}}>
                        {user.name}
                      </Label>
                      <LabelData>
                        {new Date(user.last_active * 1000).toLocaleString()}
                      </LabelData>
                    </View>
                  </View>
                  {user.role !== 'none' && (
                    <View
                      style={{
                        backgroundColor:
                          user.ban_status !== 'banned' ? '#F3F6FC' : '#FFEBEE',
                        color:
                          user.ban_status !== 'banned' ? '#0052CD' : '#F44336',
                        padding: '5px 8px',
                        borderRadius: '16px',
                        fontSize: '12px',
                      }}>
                      {user.role}
                    </View>
                  )}
                </View>
                {index < activeRoom?.roomMembers.length - 1 && <Viewider />}
              </View>
            ))
          )}
        </BorderedContainer>
      </CenterContainer>
    </ModalContainerFullScreen>
  );
};

export default ChatProfileModal;
