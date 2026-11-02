import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  /** First run, and after the last server is removed or revoked. Only in the stack while there is no session. */
  Connect: undefined;
  /** Home once a server is paired. */
  Channels: undefined;
  Channel: { id: string };
  Thread: { id: string };
  Servers: undefined;
  /** Pairing another server. A separate route, so pairing the first server swaps Connect out for Channels. */
  AddServer: undefined;
};

export type RootScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Name
>;
