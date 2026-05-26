import React, { FC } from 'react';
import { IconButton } from './StyledComponents';
import { DownloadIcon } from '../../assets/icons';
import { RootState } from '../../roomStore';
import { useSelector } from 'react-redux';

interface ActionButtonProps {
  icon?: React.ReactNode;
  style?: any;
  [key: string]: any;
}

const ActionButton: FC<ActionButtonProps> = ({ icon, ...props }) => {
  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  return (
    <IconButton
      style={{
        height: 40,
        width: 40,
        borderRadius: 8,
        backgroundColor: '#fff',
        border: `1px solid ${config?.colors?.primary || '#0052CD'}`,
        ...props.style,
      } as any}
      {...props}
    >
      {icon ? (
        React.cloneElement(icon as React.ReactElement<any>, {
          style: { width: 40, height: 40 },
        })
      ) : (
        <DownloadIcon style={{ width: 40, height: 40 }} />
      )}
    </IconButton>
  );
};

export { ActionButton };
