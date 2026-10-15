import React, { FC } from 'react';
import { LastMessage } from '../../types/types';
import LastMessageVideo from './styled/LastMessageVideo';
import LastTextMessage from './styled/LastTextMessage';
import LastMessagePhoto from './styled/LastMessagePhoto';
import LastMessageEmoji from './styled/LastMessageEmoji';
import LastMessageFile from './styled/LastMessageFile';
import LastAudioMessage from './styled/LastAudioMessage';
import LastMessageSealed from './styled/LastMessageSealed';
import { getMessageAttachments } from '../../helpers/attachments';
import { getMessageCaption } from '../../helpers/caption';
import { useT } from '../../i18n/useT';

interface LastMessageItemProps {
  lastMessage: LastMessage;
}

const LastMessageItem: FC<LastMessageItemProps> = ({ lastMessage }) => {
  const t = useT();
  const { body, emoji, mimetype } = lastMessage;

  if (lastMessage?.clientEncrypted === 'true') {
    return <LastMessageSealed {...lastMessage} />;
  }

  if (mimetype) {
    // What the row says about the file: its caption, else how many files
    // there are; undefined keeps the single file's own name.
    const count = getMessageAttachments(lastMessage).length;
    const label =
      getMessageCaption(lastMessage, { isMedia: true }) ??
      (count > 1 ? t('attachment.count', { count }) : undefined);

    if (mimetype.startsWith('image/')) {
      return <LastMessagePhoto {...lastMessage} label={label} />;
    }

    if (mimetype.startsWith('video/')) {
      return <LastMessageVideo {...lastMessage} label={label} />;
    }

    if (
      mimetype.startsWith('audio/') ||
      mimetype.includes('application/octet-stream')
    ) {
      return <LastAudioMessage {...lastMessage} label={label} />;
    }

    return <LastMessageFile {...lastMessage} label={label} />;
  }

  if (emoji) {
    return <LastMessageEmoji {...lastMessage} />;
  }

  if (body) {
    return <LastTextMessage {...lastMessage} />;
  }

  return undefined;
};

export default LastMessageItem;
