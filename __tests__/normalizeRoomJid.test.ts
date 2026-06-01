import { normalizeRoomJid } from '../src/helpers/normalizeRoomJid';

describe('normalizeRoomJid', () => {
  it('appends the conference domain for a bare room id', () => {
    expect(normalizeRoomJid('room-123', 'conference.example.com')).toBe(
      'room-123@conference.example.com'
    );
  });

  it('preserves a full JID unchanged', () => {
    expect(normalizeRoomJid('room-123@conference.example.com', 'conference.other.com')).toBe(
      'room-123@conference.example.com'
    );
  });

  it('leaves the input untouched when conference is missing', () => {
    expect(normalizeRoomJid('room-123')).toBe('room-123');
  });

  it('passes through empty input', () => {
    expect(normalizeRoomJid('')).toBe('');
  });
});
