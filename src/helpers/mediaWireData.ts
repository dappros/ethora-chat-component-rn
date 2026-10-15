import { parseAttachments } from './attachments';
import { getMessageCaption, normalizeCaptionMentions } from './caption';

/**
 * Normalises the media parts of a message's flat `<data>` attributes:
 *
 *  - `attachments` (a JSON string on the wire) becomes the typed array, or is
 *    dropped when it decodes to nothing so the flat legacy fields win;
 *  - `caption` is kept only when it holds text, with `captionMentions` (JSON
 *    on the wire) checked against it;
 *  - in a sealed message (`clientEncrypted`) the caption attributes are
 *    always dropped: the only caption such a message may show is the one
 *    inside its encrypted body, which the caller lifts afterwards.
 *
 * Safe to apply twice, so the wrapped and the positional parsers can both
 * call it.
 */
export const normalizeMediaDataAttrs = (
  attrs: Record<string, any>
): Record<string, any> => {
  const out: Record<string, any> = { ...attrs };

  if ('attachments' in out) {
    const attachments = parseAttachments(out.attachments);
    if (attachments.length > 0) {
      out.attachments = attachments;
    } else {
      delete out.attachments;
    }
  }

  if (out.clientEncrypted === 'true') {
    delete out.caption;
    delete out.captionMentions;
    return out;
  }

  if ('caption' in out) {
    const caption = getMessageCaption({ caption: out.caption });
    if (caption) {
      out.caption = caption;
      const spans = normalizeCaptionMentions(out.captionMentions, caption);
      if (spans) {
        out.captionMentions = spans;
      } else {
        delete out.captionMentions;
      }
    } else {
      delete out.caption;
      delete out.captionMentions;
    }
  } else if ('captionMentions' in out) {
    delete out.captionMentions;
  }

  return out;
};
