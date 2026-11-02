import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: undefined;
  Servers: undefined;
  /** First run and after the last server is removed. Only in the stack while no server is paired. */
  Connect: undefined;
  /** Pairing another server. A separate route, so pairing the first server swaps Connect out for Home. */
  AddServer: undefined;
};

export type RootScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Name
>;
