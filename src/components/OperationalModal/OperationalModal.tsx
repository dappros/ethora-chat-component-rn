import React, {useState} from 'react';
// import QRCode from 'react-qr-code';
import {CloseButton} from '../Modals/styledModalComponents';
import {Overlay, StyledModal} from '../styled/MediaModal';
import {StyledInput} from '../styled/StyledInputComponents/StyledInputComponents';
import Button from '../styled/Button';

interface OperationalModalProps {
  isVisible: boolean;
  chatJid: string;
  setVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

const OperationalModal: React.FC<OperationalModalProps> = ({
  isVisible,
  chatJid,
  setVisible,
}) => {
  return (
    isVisible && (
      <Overlay
        style={{
          position: 'absolute',
        }}>
        <StyledModal
          style={{
            borderRadius: '16px',
            width: 'auto',
            height: 'auto',
            padding: '32px 64px',
            minWidth: '480px',
          }}>
          <CloseButton onClick={() => setVisible(false)} style={{fontSize: 24}}>
            &times;
          </CloseButton>
          <View
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              alignItems: 'center',
            }}>
            <View style={{width: '70%', position: 'relative'}}></View>

            <View
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                minWidth: '400px',
              }}>
              <StyledInput
                value={chatJid}
                disabled={true}
                style={{width: '80%'}}
              />
              <Button text="Copy" onClick={handleCopyClick} />
            </View>
          </View>
        </StyledModal>
      </Overlay>
    )
  );
};

export default OperationalModal;
