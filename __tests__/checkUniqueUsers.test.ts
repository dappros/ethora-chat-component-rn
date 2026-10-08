const mockRequestUsers = jest.fn();
jest.mock('../src/helpers/userResolver', () => ({
  requestUsers: (ids: string[]) => mockRequestUsers(ids),
}));

import { checkSingleUser, checkUniqueUsers } from '../src/helpers/checkUniqueUsers';

describe('checkUniqueUsers / checkSingleUser route through the shared resolver', () => {
  beforeEach(() => mockRequestUsers.mockClear());

  it('requests the "Deleted"-named senders of a history batch', () => {
    checkUniqueUsers([
      { user: { id: 'a_1', name: 'Deleted User' } },
      { user: { id: 'a_1', name: 'Deleted User' } },
      { user: { id: 'a_2', name: 'Bob' } },
      { user: undefined },
    ] as any);
    expect(mockRequestUsers).toHaveBeenCalledWith(['a_1']);
  });

  it('does nothing when every sender has a name', () => {
    checkUniqueUsers([{ user: { id: 'a_2', name: 'Bob' } }] as any);
    expect(mockRequestUsers).not.toHaveBeenCalled();
  });

  it('checkSingleUser requests an unknown sender and skips a known one', async () => {
    await checkSingleUser({}, 'a_3');
    expect(mockRequestUsers).toHaveBeenCalledWith(['a_3']);
    mockRequestUsers.mockClear();
    await checkSingleUser({ a_3: {} as any }, 'a_3');
    expect(mockRequestUsers).not.toHaveBeenCalled();
  });
});
