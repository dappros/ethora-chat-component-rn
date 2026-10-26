import { FC, useMemo } from 'react';
import DropdownMenu from '../DropdownMenu/DropdownMenu';
import Button from '../styled/Button';
import { LeaveIcon, MoreIcon, ReportIcon } from '../../assets/icons';
import { useT } from '../../i18n/useT';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { canLeaveRoom } from '../../helpers/canLeaveRoom';

interface RoomMenuProps {
  handleLeaveClick: () => void;
  roomJid?: string;
}

export const RoomMenu: FC<RoomMenuProps> = ({ handleLeaveClick, roomJid }) => {
  const t = useT();
  const { config } = useChatSettingState();
  const showLeave = canLeaveRoom(roomJid, config?.defaultRooms);
  const menuOptions = useMemo(
    () => [
      {
        label: t('action.report'),
        icon: <ReportIcon />,
        onClick: () => {
          console.log('Report clicked');
        },
        styles: { color: 'red' },
      },
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
    [handleLeaveClick, showLeave, t]
  );

  return (
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
  );
};
