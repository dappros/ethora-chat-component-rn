import React, {
  Dispatch,
  SetStateAction,
  useState,
  useMemo,
  useEffect,
} from 'react';
import { ModalTitle, LabelData } from '../Modals/styledModalComponents';
import {
  ScrollableContainer,
  UserItem,
  Checkbox,
  Label,
} from './StyledComponents';
import { useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import { RoomMember } from '../../types/types';
import { debounce } from '../../helpers/debounce';
import { StyledInput } from '../styled/StyledInputComponents/StyledInputComponents';
import { useRoomState } from '../../hooks/useRoomState';
import { Text, View } from 'react-native';

interface UsersListProps {
  selectedUsers: RoomMember[];
  setSelectedUsers: Dispatch<SetStateAction<RoomMember[]>>;
  headerElement?: boolean;
  style?: any;
  filter?: RoomMember[];
}

const UsersList: React.FC<UsersListProps> = ({
  style,
  selectedUsers,
  setSelectedUsers,
  headerElement,
  filter,
}) => {
  const { usersSet } = useRoomState();
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredUsers, setFilteredUsers] = useState<RoomMember[]>([]);

  const handleUserSelect = (user: RoomMember) => {
    setSelectedUsers((prev) => {
      const isSelected = prev.some((u) => u._id === user._id);
      return isSelected
        ? prev.filter((u) => u._id !== user._id)
        : [...prev, user];
    });
  };

  const debouncedFilter = useMemo(
    () =>
      debounce((term: string) => {
        const lower = term.toLowerCase();
        const users = Object.values(usersSet).filter((user) =>
          `${user.firstName} ${user.lastName}`.toLowerCase().includes(lower)
        );
        setFilteredUsers(users);
      }, 100),
    [usersSet]
  );

  useEffect(() => {
    debouncedFilter(searchTerm);
  }, [searchTerm, debouncedFilter]);

  useEffect(() => {
    setFilteredUsers(Object.values(usersSet));
  }, [usersSet]);

  return (
    <View style={{ maxHeight: '100px', ...style }}>
      {headerElement ? (
        <ModalTitle>Select Users (max 20)</ModalTitle>
      ) : (
        <Text style={{ fontSize: 14, fontWeight: '600' }}>
          Select Users (max 20)
        </Text>
      )}

      <StyledInput
        placeholder="Search users..."
        value={searchTerm}
        onChangeText={setSearchTerm}
        style={{ width: '100%' }}
      />

      <ScrollableContainer style={{ ...style }}>
        {filteredUsers.map((user) => (
          <UserItem
            key={user._id}
            onPress={() => handleUserSelect(user)}
            style={{ cursor: 'pointer' }}
          >
            <Checkbox
              value={selectedUsers.some((u) => u._id === user._id)}
              onValueChange={() => handleUserSelect(user)}
              disabled={selectedUsers.length === 20}
            />
            <View>
              <Label>{`${user.firstName} ${user.lastName}`}</Label>
              {/* <LabelData>{user.xmppUsername}</LabelData> */}
            </View>
          </UserItem>
        ))}
      </ScrollableContainer>
    </View>
  );
};

export default UsersList;
