import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** Every tab's stack takes these routes: its own root, and the detail routes any tab can push. */
export type RootStackParamList = {
  /** First run, and after the last server is removed or revoked. Only in the stack while there is no session. */
  Connect: undefined;
  /** The Activity tab's root, and home once a server is paired. */
  Activity: undefined;
  /** The Channels tab's root. */
  Channels: undefined;
  Channel: { id: string };
  Thread: { id: string };
  /** The channel's named actions, run in this thread's checkout. Pushed from a thread's header. */
  Actions: { threadId: string };
  Servers: undefined;
  /** Pairing another server. A separate route, so pairing the first server swaps Connect out for the tabs. */
  AddServer: undefined;
};

/** The tab bar while a session is open, in phone web's order. */
export type TabsParamList = {
  ActivityTab: undefined;
  ChannelsTab: undefined;
};

export type RootScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Name
>;
