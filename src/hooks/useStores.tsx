import {useDispatch, useSelector} from 'react-redux';

export const useStores = () => {
  const dispatch = useDispatch();
  const chatStore = useSelector(state => state.chat);
  const loginStore = useSelector(state => state.login);

  return {chatStore, loginStore, dispatch};
};
