import React, { FC, useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import DropdownMenu from '../DropdownMenu/DropdownMenu';
import Button from '../styled/Button';
import { BlockIcon, LeaveIcon, MoreIcon, ReportIcon } from '../../assets/icons';
import { useT } from '../../i18n/useT';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { canLeaveRoom } from '../../helpers/canLeaveRoom';
import ReportChatModal from '../Modals/ChatProfileModal/ReportChatModal';
import { useBlockUser } from '../../hooks/useBlockUser';
import { isUserBlockEnabled, privateRoomPeer } from '../../helpers/userBlock';
import { isReportEnabled } from '../../helpers/reportRoom';
import type { RootState } from '../../roomStore';

interface RoomMenuProps {
  handleLeaveClick: () => void;
  roomJid?: string;
}

export const RoomMenu: FC<RoomMenuProps> = ({ handleLeaveClick, roomJid }) => {
  const t = useT();
  const { config, user } = useChatSettingState();
  const showLeave = canLeaveRoom(roomJid, config?.defaultRooms);
  const showReport = isReportEnabled(config);

  const [isReportOpen, setIsReportOpen] = useState(false);

  const { confirmBlock } = useBlockUser();
  const room = useSelector((state: RootState) =>
    roomJid ? state.rooms.rooms?.[roomJid] : undefined
  );
  const blockPeer = useMemo(
    () => (isUserBlockEnabled(config) ? privateRoomPeer(room as any, user?.xmppUsername) : undefined),
    [config, room, user?.xmppUsername]
  );
  const handleBlock = useCallback(() => {
    if (blockPeer) {
      confirmBlock({ ...blockPeer, roomJid }).catch(() => {});
    }
  }, [blockPeer, confirmBlock, roomJid]);

  const menuOptions = useMemo(
    () => [
      ...(showReport
        ? [
            {
              label: t('action.report'),
              icon: <ReportIcon />,
              onClick: () => setIsReportOpen(true),
              styles: { color: 'red' },
            },
          ]
        : []),
      ...(blockPeer
        ? [
            {
              label: t('action.block'),
              icon: <BlockIcon />,
              onClick: handleBlock,
              styles: { color: 'red' },
            },
          ]
        : []),
      ...(showLeave
        ? [
            {
              label: t('action.leave'),
              icon: <LeaveIcon />,
              onClick: () => {
                handleLeaveClick();
              },
              styles: { color: 'red' },
            },
          ]
        : []),
    ],
    [handleLeaveClick, handleBlock, blockPeer, showLeave, showReport, t]
  );

  // Nothing to offer (report off, not a private chat, a room that can't be left)
  if (menuOptions.length === 0) {return null;}

  return (
    <>
      <DropdownMenu
        position="right"
        options={menuOptions}
        openButton={
          <Button
            style={{ padding: 8, maxHeight: 40 }}
            EndIcon={<MoreIcon />}
            unstyled
          />
        }
      />
      {showReport ? (
        <ReportChatModal
          visible={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          roomJid={roomJid}
        />
      ) : null}
    </>
  );
};
