import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

type ViewRef = ComponentRef<typeof View>;

const SHOW = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/** How far the keyboard reaches into the view behind `ref`, so a list can leave that much room at its foot. */
export function useKeyboardInset(): { ref: RefObject<ViewRef | null>; inset: number } {
  const ref = useRef<ViewRef | null>(null);
  const [inset, setInset] = useState(0);

  const reach = useCallback((keyboardTop: number) => {
    ref.current?.measureInWindow((_x, y, _w, height) => setInset(Math.max(0, Math.round(y + height - keyboardTop))));
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener(SHOW, (e) => reach(e.endCoordinates.screenY));
    const hide = Keyboard.addListener(HIDE, () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reach]);

  return { ref, inset };
}
