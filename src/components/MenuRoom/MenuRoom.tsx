import { FC, useMemo } from 'react';
import DropdownMenu from '../DropdownMenu/DropdownMenu';
import Button from '../styled/Button';
import { LeaveIcon, MoreIcon, ReportIcon } from '../../assets/icons';
import { useT } from '../../i18n/useT';

interface RoomMenuProps {
  handleLeaveClick: () => void;
}

export const RoomMenu: FC<RoomMenuProps> = ({ handleLeaveClick }) => {
  const t = useT();
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
      {
        label: t('action.leave'),
        icon: <LeaveIcon />,
        onClick: () => {
          handleLeaveClick();
        },
        styles: { color: 'red' },
      },
    ],
    [handleLeaveClick, t]
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
