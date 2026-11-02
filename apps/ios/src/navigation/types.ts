import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  /** First run, and after the last server is removed or revoked. Only in the stack while there is no session. */
  Connect: undefined;
  /** Home once a server is paired. */
  Channels: undefined;
  Channel: { id: string };
  Thread: { id: string };
  /** Starts a thread. Opens on the channel it was asked from, else the Conductor. */
  NewThread: { channel?: string } | undefined;
  /** Forks a thread onto another harness: a new, linked thread that picks up from it. Presented as a modal over the thread. */
  Continue: { id: string };
  Servers: undefined;
  /** Pairing another server. A separate route, so pairing the first server swaps Connect out for Channels. */
  AddServer: undefined;
};

export type RootScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Name
>;
