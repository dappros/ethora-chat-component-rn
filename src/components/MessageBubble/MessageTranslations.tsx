import React, { FC } from 'react';
import { CustomDivider } from './CustomDivider';
import { IConfig, IMessage } from '../../types/types';
import { CustomMessageText } from '../styled/StyledComponents';

interface MessageTranslationsProps {
  message: IMessage;
  langSource?: string;
  config?: IConfig;
}

const MessageTranslations: FC<MessageTranslationsProps> = ({
  message,
  langSource,
  config,
}) => {
  return (
    langSource &&
    message.langSource ? (
      <>
        <CustomDivider configColor={config?.colors?.primary} />
        <CustomMessageText colorUser="">
          {message.translations?.[langSource]?.translatedText}
        </CustomMessageText>
      </>
    ) : null
  );
};

export default MessageTranslations;
